import Stripe from "stripe";
import { db } from "../db";
import { companies, jobs, invoices, payments, jobReferrals, subcontractPayoutAudit } from "../../shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import * as stripeConnectService from "../services/stripeConnect";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const OWNER_COMPANY_ID = 393;
const SUBCONTRACTOR_COMPANY_ID = 450;
const REAL_CONNECTED_ACCOUNT = "acct_1T8UPyPVfiifLJm9";
const TEST_OWNER_USER_ID = "email_1772826985007_264108f9";
const P = "[REAL-E2E]";

function log(msg: string) { console.log(`${P} ${msg}`); }

async function cleanupTestData() {
  await db.delete(subcontractPayoutAudit).where(
    sql`${subcontractPayoutAudit.jobId} IN (SELECT id FROM jobs WHERE title LIKE 'REAL-E2E-%')`
  );
  await db.delete(payments).where(
    sql`${payments.invoiceId} IN (SELECT id FROM invoices WHERE ${invoices.invoiceNumber} LIKE 'REAL-E2E-%')`
  );
  await db.delete(invoices).where(sql`${invoices.invoiceNumber} LIKE 'REAL-E2E-%'`);
  await db.delete(jobReferrals).where(
    sql`${jobReferrals.jobId} IN (SELECT id FROM jobs WHERE title LIKE 'REAL-E2E-%')`
  );
  await db.delete(jobs).where(sql`${jobs.title} LIKE 'REAL-E2E-%'`);
  log("Cleaned up previous test data");
}

async function createPI(amountCents: number, meta: Record<string, string>) {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents, currency: "usd", payment_method: "pm_card_visa", confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" }, metadata: meta,
  });
  const chargeId = pi.latest_charge
    ? (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id)
    : null;
  return { pi, chargeId };
}

async function run() {
  log("================================================================");
  log("STRIPE CONNECT — SPLIT AMOUNT FIX VERIFICATION");
  log("================================================================");
  log(`STRIPE_SUBCONTRACT_TRANSFERS_ENABLED: ${process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED}`);

  const connectedAcct = await stripe.accounts.retrieve(REAL_CONNECTED_ACCOUNT);
  log(`Connected account: ${connectedAcct.id} charges=${connectedAcct.charges_enabled} payouts=${connectedAcct.payouts_enabled}`);

  await cleanupTestData();
  const origEnv = process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED;
  process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED = "true";

  // =====================================================================
  // TEST A: $1,050 payment on a $1,000 job (30% fee → 70/30 split)
  //   Expected: contractor gets 70% of $1,050 = $735, platform keeps $315
  // =====================================================================
  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ TEST A — $1,050 payment on $1,000 job (70/30 split)          ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const jobTotalA = 100000;
  const paymentTotalA = 105000;
  const feeA = 30;
  const expectedContractorA = Math.round(paymentTotalA * (1 - feeA / 100));
  const expectedPlatformA = paymentTotalA - expectedContractorA;

  log(`Job total at acceptance: ${jobTotalA}¢ ($${(jobTotalA/100).toFixed(2)})`);
  log(`Customer actually pays:  ${paymentTotalA}¢ ($${(paymentTotalA/100).toFixed(2)})`);
  log(`Fee: ${feeA}%`);
  log(`Expected contractor:     ${expectedContractorA}¢ ($${(expectedContractorA/100).toFixed(2)}) = 70% of $1,050`);
  log(`Expected platform:       ${expectedPlatformA}¢ ($${(expectedPlatformA/100).toFixed(2)}) = 30% of $1,050`);

  const [jobA] = await db.insert(jobs).values({ title: "REAL-E2E-OverpayTest", companyId: OWNER_COMPANY_ID, status: "in_progress" }).returning();
  const [invA] = await db.insert(invoices).values({
    invoiceNumber: `REAL-E2E-A-${Date.now()}`, companyId: OWNER_COMPANY_ID, jobId: jobA.id,
    amount: (jobTotalA / 100).toFixed(2), amountCents: jobTotalA, status: "sent",
    issueDate: new Date().toISOString().split('T')[0], dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
  }).returning();
  const [refA] = await db.insert(jobReferrals).values({
    jobId: jobA.id, senderCompanyId: OWNER_COMPANY_ID, receiverCompanyId: SUBCONTRACTOR_COMPANY_ID,
    referralType: "percent", referralValue: String(feeA), status: "accepted" as any, acceptedAt: new Date(),
    jobTotalAtAcceptanceCents: jobTotalA,
    contractorPayoutAmountCents: Math.round(jobTotalA * (1 - feeA / 100)),
    companyShareAmountCents: Math.round(jobTotalA * feeA / 100),
  }).returning();

  log(`Job: ${jobA.id}, Invoice: ${invA.id}, Referral: ${refA.id}`);
  log(`Snapshot: contractorPayout=${refA.contractorPayoutAmountCents} companyShare=${refA.companyShareAmountCents} jobTotal=${refA.jobTotalAtAcceptanceCents}`);

  const { pi: piA, chargeId: chgA } = await createPI(paymentTotalA, {
    invoiceId: String(invA.id), companyId: String(OWNER_COMPANY_ID), jobId: String(jobA.id),
  });
  const [payA] = await db.insert(payments).values({
    companyId: OWNER_COMPANY_ID, invoiceId: invA.id,
    amount: (paymentTotalA / 100).toFixed(2), amountCents: paymentTotalA,
    method: "stripe", status: "succeeded", paidDate: new Date(), stripePaymentIntentId: piA.id,
  }).returning();

  log(`PI: ${piA.id} charge: ${chgA} payment: ${payA.id}`);

  const resultA = await stripeConnectService.executeSubcontractPayout({
    jobId: jobA.id, invoiceId: invA.id, paymentId: payA.id, paymentIntentId: piA.id,
    paymentAmountCents: paymentTotalA, ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-overpay-test", chargeId: chgA,
  });

  log(`\nResult: status=${resultA?.status} transferId=${resultA?.transferId} auditId=${resultA?.auditId}`);

  let transferA: Stripe.Transfer | null = null;
  if (resultA?.transferId) {
    transferA = await stripe.transfers.retrieve(resultA.transferId);
    log(`TRANSFER: ${transferA.id} amount=${transferA.amount}¢ ($${(transferA.amount/100).toFixed(2)}) dest=${transferA.destination} source_tx=${(transferA as any).source_transaction}`);
  }

  const passA = transferA?.amount === expectedContractorA;
  log(`\nTEST A: contractor got ${transferA?.amount || 0}¢, expected ${expectedContractorA}¢`);
  log(`TEST A: platform keeps ${paymentTotalA - (transferA?.amount || 0)}¢, expected ${expectedPlatformA}¢`);
  log(`TEST A RESULT: ${passA ? "✅ PASS" : "❌ FAIL"} — 70% of actual $1,050 payment`);

  // =====================================================================
  // TEST B: Two partial payments ($600 + $450 = $1,050) on $1,000 job
  //   Each payment should split 70/30 independently
  // =====================================================================
  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ TEST B — Partial payments $600 + $450 on $1,000 job          ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const [jobB] = await db.insert(jobs).values({ title: "REAL-E2E-PartialOverpay", companyId: OWNER_COMPANY_ID, status: "in_progress" }).returning();
  const [invB] = await db.insert(invoices).values({
    invoiceNumber: `REAL-E2E-B-${Date.now()}`, companyId: OWNER_COMPANY_ID, jobId: jobB.id,
    amount: (jobTotalA / 100).toFixed(2), amountCents: jobTotalA, status: "sent",
    issueDate: new Date().toISOString().split('T')[0], dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
  }).returning();
  const [refB] = await db.insert(jobReferrals).values({
    jobId: jobB.id, senderCompanyId: OWNER_COMPANY_ID, receiverCompanyId: SUBCONTRACTOR_COMPANY_ID,
    referralType: "percent", referralValue: String(feeA), status: "accepted" as any, acceptedAt: new Date(),
    jobTotalAtAcceptanceCents: jobTotalA,
    contractorPayoutAmountCents: Math.round(jobTotalA * (1 - feeA / 100)),
    companyShareAmountCents: Math.round(jobTotalA * feeA / 100),
  }).returning();

  log(`Job: ${jobB.id}, Invoice: ${invB.id}, Referral: ${refB.id}`);

  const pay1Cents = 60000;
  const pay2Cents = 45000;
  const exp1Contractor = Math.round(pay1Cents * 0.70);
  const exp2Contractor = Math.round(pay2Cents * 0.70);

  log(`--- Payment 1: $${(pay1Cents/100).toFixed(2)} ---`);
  log(`  Expected contractor: ${exp1Contractor}¢ ($${(exp1Contractor/100).toFixed(2)})`);

  const { pi: piB1, chargeId: chgB1 } = await createPI(pay1Cents, {
    invoiceId: String(invB.id), companyId: String(OWNER_COMPANY_ID), jobId: String(jobB.id),
  });
  const [payB1] = await db.insert(payments).values({
    companyId: OWNER_COMPANY_ID, invoiceId: invB.id,
    amount: (pay1Cents / 100).toFixed(2), amountCents: pay1Cents,
    method: "stripe", status: "succeeded", paidDate: new Date(), stripePaymentIntentId: piB1.id,
  }).returning();

  const resB1 = await stripeConnectService.executeSubcontractPayout({
    jobId: jobB.id, invoiceId: invB.id, paymentId: payB1.id, paymentIntentId: piB1.id,
    paymentAmountCents: pay1Cents, ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-partial-1", chargeId: chgB1,
  });

  let trB1: Stripe.Transfer | null = null;
  if (resB1?.transferId) trB1 = await stripe.transfers.retrieve(resB1.transferId);
  log(`  Transfer: ${trB1?.id || "NONE"} amount=${trB1?.amount || 0}¢ (expected ${exp1Contractor})`);
  const pass1 = trB1?.amount === exp1Contractor;
  log(`  ${pass1 ? "✅" : "❌"} Payment 1 split correct`);

  log(`--- Payment 2: $${(pay2Cents/100).toFixed(2)} ---`);
  log(`  Expected contractor: ${exp2Contractor}¢ ($${(exp2Contractor/100).toFixed(2)})`);

  const { pi: piB2, chargeId: chgB2 } = await createPI(pay2Cents, {
    invoiceId: String(invB.id), companyId: String(OWNER_COMPANY_ID), jobId: String(jobB.id),
  });
  const [payB2] = await db.insert(payments).values({
    companyId: OWNER_COMPANY_ID, invoiceId: invB.id,
    amount: (pay2Cents / 100).toFixed(2), amountCents: pay2Cents,
    method: "stripe", status: "succeeded", paidDate: new Date(), stripePaymentIntentId: piB2.id,
  }).returning();

  const resB2 = await stripeConnectService.executeSubcontractPayout({
    jobId: jobB.id, invoiceId: invB.id, paymentId: payB2.id, paymentIntentId: piB2.id,
    paymentAmountCents: pay2Cents, ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-partial-2", chargeId: chgB2,
  });

  let trB2: Stripe.Transfer | null = null;
  if (resB2?.transferId) trB2 = await stripe.transfers.retrieve(resB2.transferId);
  log(`  Transfer: ${trB2?.id || "NONE"} amount=${trB2?.amount || 0}¢ (expected ${exp2Contractor})`);
  const pass2 = trB2?.amount === exp2Contractor;
  log(`  ${pass2 ? "✅" : "❌"} Payment 2 split correct`);

  const totalToContractor = (trB1?.amount || 0) + (trB2?.amount || 0);
  const totalToPlatform = (pay1Cents + pay2Cents) - totalToContractor;
  log(`\nCumulative: contractor=${totalToContractor}¢ platform=${totalToPlatform}¢ total=${pay1Cents + pay2Cents}¢`);
  log(`Expected:   contractor=${exp1Contractor + exp2Contractor}¢ platform=${(pay1Cents + pay2Cents) - (exp1Contractor + exp2Contractor)}¢`);

  const passB = pass1 && pass2 && totalToContractor === (exp1Contractor + exp2Contractor);
  log(`TEST B RESULT: ${passB ? "✅ PASS" : "❌ FAIL"} — partial payments each split 70/30 correctly`);

  // =====================================================================
  // TEST C: Duplicate replay on TEST A payment
  // =====================================================================
  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ TEST C — Duplicate replay protection                         ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const replayRes = await stripeConnectService.executeSubcontractPayout({
    jobId: jobA.id, invoiceId: invA.id, paymentId: payA.id, paymentIntentId: piA.id,
    paymentAmountCents: paymentTotalA, ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-replay", chargeId: chgA,
  });
  log(`Replay: status=${replayRes?.status}`);
  const passC = replayRes?.status === "duplicate_skipped";
  log(`TEST C RESULT: ${passC ? "✅ PASS" : "❌ FAIL"} — duplicate blocked`);

  // =====================================================================
  // FINAL SUMMARY
  // =====================================================================
  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ FINAL SUMMARY                                               ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const results = [
    { name: "A: $1,050 on $1,000 job → contractor gets $735 (70%)", passed: passA },
    { name: "B: Partial $600+$450 → each split 70/30", passed: passB },
    { name: "C: Duplicate replay blocked", passed: passC },
  ];

  results.forEach(r => log(`${r.passed ? "✅ PASS" : "❌ FAIL"} | ${r.name}`));
  const allPassed = results.every(r => r.passed);

  if (passA && transferA) {
    log("");
    log("PROOF OF CORRECT SPLIT:");
    log(`  PaymentIntent:     ${piA.id}`);
    log(`  ChargeId:          ${chgA}`);
    log(`  TransferId:        ${transferA.id}`);
    log(`  Destination:       ${REAL_CONNECTED_ACCOUNT}`);
    log(`  source_transaction:${(transferA as any).source_transaction}`);
    log(`  Total charged:     ${paymentTotalA}¢ ($${(paymentTotalA/100).toFixed(2)})`);
    log(`  Contractor (70%):  ${transferA.amount}¢ ($${(transferA.amount/100).toFixed(2)})`);
    log(`  Platform (30%):    ${paymentTotalA - transferA.amount}¢ ($${((paymentTotalA - transferA.amount)/100).toFixed(2)})`);
  }

  log(`\n${"=".repeat(64)}`);
  log(`OVERALL: ${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);
  log(`${"=".repeat(64)}`);

  process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED = origEnv;
}

run().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
