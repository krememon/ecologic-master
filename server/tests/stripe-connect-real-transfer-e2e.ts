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

async function run() {
  log("================================================================");
  log("STRIPE CONNECT — REAL TRANSFER E2E (70/30 SPLIT)");
  log("================================================================");

  const platform = await stripe.accounts.retrieve();
  log(`Platform account: ${platform.id}`);
  log(`Stripe key prefix: ${(process.env.STRIPE_SECRET_KEY || '').slice(0, 7)}`);
  log(`STRIPE_SUBCONTRACT_TRANSFERS_ENABLED: ${process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED}`);

  const connectedAcct = await stripe.accounts.retrieve(REAL_CONNECTED_ACCOUNT);
  log(`Connected account: ${connectedAcct.id}`);
  log(`  charges_enabled: ${connectedAcct.charges_enabled}`);
  log(`  payouts_enabled: ${connectedAcct.payouts_enabled}`);
  log(`  details_submitted: ${connectedAcct.details_submitted}`);

  if (!connectedAcct.charges_enabled || !connectedAcct.payouts_enabled) {
    log("FATAL: Connected account is not fully enabled. Aborting.");
    process.exit(1);
  }

  const [subCo] = await db.select().from(companies).where(eq(companies.id, SUBCONTRACTOR_COMPANY_ID)).limit(1);
  log(`\nSubcontractor company DB record:`);
  log(`  id: ${subCo.id}`);
  log(`  name: ${subCo.name}`);
  log(`  stripeConnectAccountId: ${subCo.stripeConnectAccountId}`);
  log(`  stripeConnectStatus: ${subCo.stripeConnectStatus}`);
  log(`  stripeConnectChargesEnabled: ${subCo.stripeConnectChargesEnabled}`);
  log(`  stripeConnectPayoutsEnabled: ${subCo.stripeConnectPayoutsEnabled}`);

  if (subCo.stripeConnectAccountId !== REAL_CONNECTED_ACCOUNT) {
    log(`MISMATCH: Expected ${REAL_CONNECTED_ACCOUNT}, got ${subCo.stripeConnectAccountId}. Aborting.`);
    process.exit(1);
  }
  log(`  ✅ Stripe Connect account ID matches`);

  await cleanupTestData();

  const origEnv = process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED;
  process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED = "true";

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 1 — CREATE JOB                                         ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const [job] = await db.insert(jobs).values({
    title: "REAL-E2E-70-30-Split",
    companyId: OWNER_COMPANY_ID,
    status: "in_progress",
  }).returning();
  log(`Job: id=${job.id} title="${job.title}"`);

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 2 — CREATE REFERRAL (30% fee → 70/30 split)            ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const jobTotalCents = 100000;
  const referralFeePercent = 30;
  const contractorPayoutCents = Math.round(jobTotalCents * (1 - referralFeePercent / 100));
  const companyShareCents = jobTotalCents - contractorPayoutCents;

  log(`Job total: ${jobTotalCents}¢ ($${(jobTotalCents/100).toFixed(2)})`);
  log(`Referral fee: ${referralFeePercent}%`);
  log(`Contractor payout (70%): ${contractorPayoutCents}¢ ($${(contractorPayoutCents/100).toFixed(2)})`);
  log(`Platform share (30%): ${companyShareCents}¢ ($${(companyShareCents/100).toFixed(2)})`);

  const [referral] = await db.insert(jobReferrals).values({
    jobId: job.id,
    senderCompanyId: OWNER_COMPANY_ID,
    receiverCompanyId: SUBCONTRACTOR_COMPANY_ID,
    referralType: "percent",
    referralValue: String(referralFeePercent),
    status: "accepted" as any,
    acceptedAt: new Date(),
    jobTotalAtAcceptanceCents: jobTotalCents,
    contractorPayoutAmountCents: contractorPayoutCents,
    companyShareAmountCents: companyShareCents,
  }).returning();

  log(`Referral: id=${referral.id} sender=393 → receiver=450`);

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 3 — CREATE INVOICE                                     ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const [invoice] = await db.insert(invoices).values({
    invoiceNumber: `REAL-E2E-${Date.now()}`,
    companyId: OWNER_COMPANY_ID,
    jobId: job.id,
    amount: (jobTotalCents / 100).toFixed(2),
    amountCents: jobTotalCents,
    status: "sent",
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
  }).returning();
  log(`Invoice: id=${invoice.id} number="${invoice.invoiceNumber}" amount=$${invoice.amount}`);

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 4 — CREATE REAL PaymentIntent ($1,000 test charge)      ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const pi = await stripe.paymentIntents.create({
    amount: jobTotalCents,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: {
      invoiceId: String(invoice.id),
      companyId: String(OWNER_COMPANY_ID),
      jobId: String(job.id),
    },
  });

  let chargeId: string | null = null;
  if (pi.latest_charge) {
    chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
  }

  log(`PaymentIntent: ${pi.id}`);
  log(`  status: ${pi.status}`);
  log(`  amount: ${pi.amount}¢ ($${(pi.amount/100).toFixed(2)})`);
  log(`  chargeId: ${chargeId}`);

  const [payment] = await db.insert(payments).values({
    companyId: OWNER_COMPANY_ID,
    invoiceId: invoice.id,
    amount: (jobTotalCents / 100).toFixed(2),
    amountCents: jobTotalCents,
    method: "stripe",
    status: "succeeded",
    paidDate: new Date(),
    stripePaymentIntentId: pi.id,
  }).returning();
  log(`Payment: id=${payment.id}`);

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 5 — EXECUTE SUBCONTRACT PAYOUT (with source_transaction)║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const result = await stripeConnectService.executeSubcontractPayout({
    jobId: job.id,
    invoiceId: invoice.id,
    paymentId: payment.id,
    paymentIntentId: pi.id,
    paymentAmountCents: jobTotalCents,
    ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-70-30-split",
    chargeId: chargeId,
  });

  log(`\nPayout result:`);
  log(`  status: ${result?.status}`);
  log(`  auditId: ${result?.auditId}`);
  log(`  transferId: ${result?.transferId}`);
  log(`  reason: ${result?.reason || "N/A"}`);

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 6 — VERIFY TRANSFER ON STRIPE                          ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  let transfer: Stripe.Transfer | null = null;
  if (result?.transferId) {
    transfer = await stripe.transfers.retrieve(result.transferId);
    log(`TRANSFER CONFIRMED ON STRIPE:`);
    log(`  transferId:         ${transfer.id}`);
    log(`  amount:             ${transfer.amount}¢ ($${(transfer.amount/100).toFixed(2)})`);
    log(`  currency:           ${transfer.currency}`);
    log(`  destination:        ${transfer.destination}`);
    log(`  source_transaction: ${(transfer as any).source_transaction || "NONE"}`);
    log(`  created:            ${new Date(transfer.created * 1000).toISOString()}`);
    log(`  metadata:`);
    Object.entries(transfer.metadata).forEach(([k, v]) => log(`    ${k}: ${v}`));
  } else {
    log(`❌ NO TRANSFER CREATED — status: ${result?.status}, reason: ${result?.reason}`);
  }

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 7 — VERIFY CHARGE SHOWS TRANSFER                       ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  if (chargeId) {
    const charge = await stripe.charges.retrieve(chargeId);
    log(`Charge: ${charge.id}`);
    log(`  amount:  ${charge.amount}¢ ($${(charge.amount/100).toFixed(2)})`);
    log(`  transfer_group: ${(charge as any).transfer_group || "NONE"}`);

    const balTx = await stripe.balanceTransactions.retrieve(charge.balance_transaction as string);
    log(`  net to platform: ${balTx.net}¢ ($${(balTx.net/100).toFixed(2)})`);
    log(`  fee: ${balTx.fee}¢ ($${(balTx.fee/100).toFixed(2)})`);
  }

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 8 — VERIFY AUDIT RECORD                                ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const audits = await db.select().from(subcontractPayoutAudit)
    .where(eq(subcontractPayoutAudit.jobId, job.id))
    .orderBy(subcontractPayoutAudit.createdAt);

  log(`Audit records: ${audits.length}`);
  audits.forEach(a => {
    log(`  Audit #${a.id}:`);
    log(`    status:                ${a.status}`);
    log(`    grossAmountCents:      ${a.grossAmountCents}`);
    log(`    contractorPayoutCents: ${a.contractorPayoutAmountCents}`);
    log(`    companyShareCents:     ${a.companyShareAmountCents}`);
    log(`    transferAmountCents:   ${a.transferAmountCents}`);
    log(`    stripeTransferId:      ${a.stripeTransferId}`);
    log(`    destinationAccountId:  ${a.destinationAccountId}`);
    log(`    idempotencyKey:        ${a.idempotencyKey}`);
    log(`    source:                ${a.source}`);
    log(`    failureReason:         ${a.failureReason || "NONE"}`);
  });

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ STEP 9 — DUPLICATE REPLAY PROTECTION                        ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const replayResult = await stripeConnectService.executeSubcontractPayout({
    jobId: job.id,
    invoiceId: invoice.id,
    paymentId: payment.id,
    paymentIntentId: pi.id,
    paymentAmountCents: jobTotalCents,
    ownerCompanyId: OWNER_COMPANY_ID,
    source: "real-e2e-duplicate-replay",
    chargeId: chargeId,
  });
  log(`Replay: status=${replayResult?.status} auditId=${replayResult?.auditId}`);

  const allTransfers = await stripe.transfers.list({ destination: REAL_CONNECTED_ACCOUNT, limit: 100 });
  const jobTransfers = allTransfers.data.filter(t => t.metadata.jobId === String(job.id));
  log(`Stripe transfers for this job: ${jobTransfers.length}`);
  jobTransfers.forEach(t => log(`  ${t.id} amount=${t.amount}¢ created=${new Date(t.created * 1000).toISOString()}`));

  log("");
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║ FINAL SUMMARY — 70/30 SPLIT VERIFICATION                    ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  const transferCreated = !!transfer && transfer.amount === contractorPayoutCents;
  const destinationCorrect = transfer?.destination === REAL_CONNECTED_ACCOUNT;
  const sourceTransactionLinked = !!(transfer as any)?.source_transaction;
  const auditCorrect = audits.length >= 1 && audits.some(a => a.status === "completed" && !!a.stripeTransferId);
  const duplicateBlocked = replayResult?.status === "duplicate_skipped";
  const exactlyOneTransfer = jobTransfers.length === 1;

  const platformKeeps = transfer ? (jobTotalCents - transfer.amount) : 0;
  const connectedGets = transfer?.amount || 0;

  log(`┌──────────────────────────────────────────────────────────────┐`);
  log(`│ IDs                                                          │`);
  log(`├──────────────────────────────────────────────────────────────┤`);
  log(`│ PaymentIntent:  ${pi.id}     │`);
  log(`│ ChargeId:       ${chargeId || "NONE"}     │`);
  log(`│ TransferId:     ${transfer?.id || "NONE"}     │`);
  log(`│ Destination:    ${REAL_CONNECTED_ACCOUNT}     │`);
  log(`│ Audit ID:       ${result?.auditId || "NONE"}     │`);
  log(`│ Job ID:         ${job.id}     │`);
  log(`│ Invoice ID:     ${invoice.id}     │`);
  log(`│ Payment ID:     ${payment.id}     │`);
  log(`│ Referral ID:    ${referral.id}     │`);
  log(`├──────────────────────────────────────────────────────────────┤`);
  log(`│ SPLIT                                                        │`);
  log(`├──────────────────────────────────────────────────────────────┤`);
  log(`│ Total charged:   ${jobTotalCents}¢ ($${(jobTotalCents/100).toFixed(2)})     │`);
  log(`│ Connected gets:  ${connectedGets}¢ ($${(connectedGets/100).toFixed(2)}) = ${((connectedGets/jobTotalCents)*100).toFixed(0)}%     │`);
  log(`│ Platform keeps:  ${platformKeeps}¢ ($${(platformKeeps/100).toFixed(2)}) = ${((platformKeeps/jobTotalCents)*100).toFixed(0)}%     │`);
  log(`│ source_transaction: ${sourceTransactionLinked ? "✅ LINKED" : "⚠️ NOT LINKED"}     │`);
  log(`├──────────────────────────────────────────────────────────────┤`);
  log(`│ CHECKS                                                       │`);
  log(`├──────────────────────────────────────────────────────────────┤`);
  log(`│ Transfer created (70%):     ${transferCreated ? "✅ PASS" : "❌ FAIL"}     │`);
  log(`│ Destination correct:        ${destinationCorrect ? "✅ PASS" : "❌ FAIL"}     │`);
  log(`│ source_transaction linked:  ${sourceTransactionLinked ? "✅ PASS" : "⚠️ WARN"}     │`);
  log(`│ Audit record correct:       ${auditCorrect ? "✅ PASS" : "❌ FAIL"}     │`);
  log(`│ Duplicate blocked:          ${duplicateBlocked ? "✅ PASS" : "❌ FAIL"}     │`);
  log(`│ Exactly 1 transfer:         ${exactlyOneTransfer ? "✅ PASS" : "❌ FAIL"}     │`);
  log(`└──────────────────────────────────────────────────────────────┘`);

  const allPassed = transferCreated && destinationCorrect && auditCorrect && duplicateBlocked && exactlyOneTransfer;
  log(`\n${"=".repeat(64)}`);
  log(`OVERALL: ${allPassed ? "✅ ALL CHECKS PASSED — 70/30 SPLIT CONFIRMED" : "❌ SOME CHECKS FAILED"}`);
  log(`${"=".repeat(64)}`);

  process.env.STRIPE_SUBCONTRACT_TRANSFERS_ENABLED = origEnv;
  log("\nTest data preserved for inspection.");
}

run().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
