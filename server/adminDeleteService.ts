import { db } from './db';
import { inArray, or, eq, sql } from 'drizzle-orm';
import {
  companies,
  companyMembers,
  users,
  jobs,
  estimates,
  conversations,
  approvalWorkflows,
  campaigns,
  signatureRequests,
  estimateAttachments,
  estimateDocuments,
  estimateItems,
  approvalHistory,
  approvalSignatures,
  payments,
  invoices,
  jobPhotos,
  jobLineItems,
  jobAssignments,
  crewAssignments,
  scheduleItems,
  documents,
  messages,
  conversationParticipants,
  campaignRecipients,
  notifications,
  timeLogs,
  leads,
  companyTaxes,
  serviceCatalogItems,
  companyCounters,
  companyEmailBranding,
  customers,
  clients,
  subcontractors,
  subscriptions,
  scheduleEvents,
  paymentSignatures,
  refunds,
  bankRefunds,
  plaidAccounts,
  customerPayoutDestinations,
  payoutSetupTokens,
  employeeLocationPings,
  userLiveLocations,
  pushTokens,
  supportRequests,
  jobReferrals,
  subcontractPayoutAudit,
  documentFolders,
  growthSubscribers,
  growthAccountAdmin,
  pendingSignups,
  loginChallenges,
} from '@shared/schema';

// ── Protected companies / emails that can NEVER be deleted ──────────────────
// Backend is the true enforcement layer — frontend may also hide the button,
// but backend always re-validates before executing any deletion.
const PROTECTED_COMPANY_IDS = new Set<number>([
  415, // EcoLogic (dev account — pjpell077@gmail.com)
]);

const PROTECTED_OWNER_EMAILS = new Set<string>([
  'pjpell077@gmail.com',
]);

export interface KeptUser {
  userId: string;
  email: string | null;
  reason:
    | "belongs_to_other_company"
    | "protected_or_admin"
    | "actor_self";
}

export interface DeleteCompanyResult {
  ok: boolean;
  companyId: number;
  companyName: string;
  tablesAffected: string[];
  orphanedUsersDeleted: number;
  /** Lowercased emails of users actually removed from the users table. */
  deletedUserEmails: string[];
  /** Users we intentionally did NOT delete, with the reason why. */
  keptUsers: KeptUser[];
  /** Total auth-side rows wiped (pending_signups + login_challenges). */
  authIdentitiesDeleted: number;
  /** Sessions deleted via best-effort scan. -1 if scan failed/skipped. */
  sessionsDeleted: number;
  error?: string;
}

/**
 * Build the set of emails that must NEVER be deleted from the users table,
 * regardless of orphan status. Includes hardcoded protected owners plus the
 * runtime DASHBOARD_ADMIN_EMAILS allow-list (admins must be able to keep
 * logging in even if every company they admin gets removed).
 */
function getProtectedEmailSet(): Set<string> {
  const set = new Set<string>();
  // Array.from() avoids needing the --downlevelIteration TS flag.
  Array.from(PROTECTED_OWNER_EMAILS).forEach((e) => set.add(e.toLowerCase()));
  const raw = process.env.DASHBOARD_ADMIN_EMAILS || "";
  for (const e of raw.split(/[,\s;]+/)) {
    const trimmed = e.trim().toLowerCase();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

/**
 * Hard-check whether a company is protected.
 * Returns a non-null string reason if protected, null if safe to delete.
 */
export async function getProtectionReason(companyId: number): Promise<string | null> {
  if (PROTECTED_COMPANY_IDS.has(companyId)) {
    return `Company ID ${companyId} is in the protected-company denylist and cannot be deleted.`;
  }

  // Fetch company to check owner email
  const [company] = await db.select({ id: companies.id, name: companies.name, ownerId: companies.ownerId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    return null; // not found — will 404 at route level
  }

  if (company.ownerId) {
    const [owner] = await db.select({ email: users.email })
      .from(users)
      .where(eq(users.id, company.ownerId))
      .limit(1);
    if (owner?.email && PROTECTED_OWNER_EMAILS.has(owner.email.toLowerCase())) {
      return `Owner email ${owner.email} is in the protected-owner denylist and cannot be deleted.`;
    }
  }

  return null;
}

/**
 * Fully delete a company and all company-scoped data in a single DB transaction.
 * Raises an error if the company is protected.
 */
export async function deleteCompanyDeep(companyId: number, actorEmail: string): Promise<DeleteCompanyResult> {
  console.log(`[admin-delete] deleteCompanyDeep start — companyId=${companyId} actor=${actorEmail}`);

  // Re-check protection inside service (backend is source of truth)
  const protectionReason = await getProtectionReason(companyId);
  if (protectionReason) {
    console.warn(`[admin-delete] BLOCKED — ${protectionReason}`);
    throw new Error(protectionReason);
  }

  // Fetch company name for logging before we delete it
  const [companyRow] = await db.select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!companyRow) {
    throw new Error(`Company ${companyId} not found.`);
  }

  const companyName = companyRow.name;
  const tablesAffected: string[] = [];
  let orphanedUsersDeleted = 0;
  const deletedUserEmails: string[] = [];
  const keptUsers: KeptUser[] = [];
  let authIdentitiesDeleted = 0;
  let sessionsDeleted = 0;

  await db.transaction(async (tx) => {
    // ── Pre-fetch IDs needed for child table deletions ─────────────────────

    const memberRows = await tx.select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(eq(companyMembers.companyId, companyId));
    const memberUserIds = memberRows.map(m => m.userId);

    // Owner is always considered a candidate even if they aren't (or aren't
    // any longer) in companyMembers. createCompany typically inserts an
    // OWNER row but defensively dedupe in case the membership was removed.
    const [companyMeta] = await tx.select({ ownerId: companies.ownerId })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const candidateUserIdSet = new Set<string>(memberUserIds);
    if (companyMeta?.ownerId) candidateUserIdSet.add(companyMeta.ownerId);
    const candidateUserIds = Array.from(candidateUserIdSet);

    // Pre-fetch emails for safety classification (protected/admin/actor).
    const userInfoRows = candidateUserIds.length
      ? await tx.select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, candidateUserIds))
      : [];
    const emailById = new Map<string, string | null>(
      userInfoRows.map((u) => [u.id, u.email ? u.email.toLowerCase() : null]),
    );

    const jobRows = await tx.select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));
    const jobIds = jobRows.map(j => j.id);

    const estimateRows = await tx.select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.companyId, companyId));
    const estimateIds = estimateRows.map(e => e.id);

    const conversationRows = await tx.select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.companyId, companyId));
    const conversationIds = conversationRows.map(c => c.id);

    const workflowRows = await tx.select({ id: approvalWorkflows.id })
      .from(approvalWorkflows)
      .where(eq(approvalWorkflows.companyId, companyId));
    const workflowIds = workflowRows.map(w => w.id);

    const campaignRows = await tx.select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.companyId, companyId));
    const campaignIds = campaignRows.map(c => c.id);

    const invoiceRows = await tx.select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.companyId, companyId));
    const invoiceIds = invoiceRows.map(i => i.id);

    const paymentRows = await tx.select({ id: payments.id })
      .from(payments)
      .where(eq(payments.companyId, companyId));
    const paymentIds = paymentRows.map(p => p.id);

    const customerRows = await tx.select({ id: customers.id })
      .from(customers)
      .where(eq(customers.companyId, companyId));
    const customerIds = customerRows.map(c => c.id);

    // ── 1. subcontractPayoutAudit (refs jobId, invoiceId, paymentId, referralId) ──
    console.log(`[admin-delete] subcontract_payout_audit`);
    await tx.delete(subcontractPayoutAudit).where(
      or(
        eq(subcontractPayoutAudit.ownerCompanyId, companyId),
        eq(subcontractPayoutAudit.subcontractorCompanyId, companyId),
      )
    );
    tablesAffected.push('subcontract_payout_audit');

    // ── 2. jobReferrals (before jobs — refs jobId + sender/receiverCompanyId) ──
    console.log(`[admin-delete] job_referrals`);
    await tx.delete(jobReferrals).where(
      or(
        eq(jobReferrals.senderCompanyId, companyId),
        eq(jobReferrals.receiverCompanyId, companyId),
      )
    );
    tablesAffected.push('job_referrals');

    // ── 3. signatureRequests ──────────────────────────────────────────────────
    console.log(`[admin-delete] signature_requests`);
    await tx.delete(signatureRequests).where(eq(signatureRequests.companyId, companyId));
    tablesAffected.push('signature_requests');

    // ── 4. paymentSignatures (before payments) ────────────────────────────────
    console.log(`[admin-delete] payment_signatures`);
    await tx.delete(paymentSignatures).where(eq(paymentSignatures.companyId, companyId));
    tablesAffected.push('payment_signatures');

    // ── 5. bankRefunds (before refunds + customers) ───────────────────────────
    console.log(`[admin-delete] bank_refunds`);
    await tx.delete(bankRefunds).where(eq(bankRefunds.companyId, companyId));
    tablesAffected.push('bank_refunds');

    // ── 6. refunds (before payments + invoices) ───────────────────────────────
    console.log(`[admin-delete] refunds`);
    await tx.delete(refunds).where(eq(refunds.companyId, companyId));
    tablesAffected.push('refunds');

    // ── 7. payoutSetupTokens (before customers) ───────────────────────────────
    console.log(`[admin-delete] payout_setup_tokens`);
    if (customerIds.length > 0) {
      await tx.delete(payoutSetupTokens).where(eq(payoutSetupTokens.companyId, companyId));
    }
    tablesAffected.push('payout_setup_tokens');

    // ── 8. customerPayoutDestinations (before customers) ─────────────────────
    console.log(`[admin-delete] customer_payout_destinations`);
    await tx.delete(customerPayoutDestinations).where(eq(customerPayoutDestinations.companyId, companyId));
    tablesAffected.push('customer_payout_destinations');

    // ── 9. plaidAccounts ──────────────────────────────────────────────────────
    console.log(`[admin-delete] plaid_accounts`);
    await tx.delete(plaidAccounts).where(eq(plaidAccounts.companyId, companyId));
    tablesAffected.push('plaid_accounts');

    // ── 10. subscriptions (billing records) ───────────────────────────────────
    console.log(`[admin-delete] subscriptions`);
    await tx.delete(subscriptions).where(eq(subscriptions.companyId, companyId));
    tablesAffected.push('subscriptions');

    // ── 11. estimate-related data ─────────────────────────────────────────────
    console.log(`[admin-delete] estimates + children`);
    await tx.delete(estimateAttachments).where(eq(estimateAttachments.companyId, companyId));
    await tx.delete(estimateDocuments).where(eq(estimateDocuments.companyId, companyId));
    if (estimateIds.length > 0) {
      await tx.delete(estimateItems).where(inArray(estimateItems.estimateId, estimateIds));
    }
    await tx.delete(estimates).where(eq(estimates.companyId, companyId));
    tablesAffected.push('estimate_attachments', 'estimate_documents', 'estimate_items', 'estimates');

    // ── 12. approval data ─────────────────────────────────────────────────────
    console.log(`[admin-delete] approval_workflows + children`);
    if (workflowIds.length > 0) {
      await tx.delete(approvalHistory).where(inArray(approvalHistory.workflowId, workflowIds));
      await tx.delete(approvalSignatures).where(inArray(approvalSignatures.workflowId, workflowIds));
    }
    await tx.delete(approvalWorkflows).where(eq(approvalWorkflows.companyId, companyId));
    tablesAffected.push('approval_history', 'approval_signatures', 'approval_workflows');

    // ── 13. payments + invoices ───────────────────────────────────────────────
    console.log(`[admin-delete] payments + invoices`);
    await tx.delete(payments).where(eq(payments.companyId, companyId));
    await tx.delete(invoices).where(eq(invoices.companyId, companyId));
    tablesAffected.push('payments', 'invoices');

    // ── 14. employeeLocationPings (before timeLogs) ───────────────────────────
    console.log(`[admin-delete] employee_location_pings`);
    await tx.delete(employeeLocationPings).where(eq(employeeLocationPings.companyId, companyId));
    tablesAffected.push('employee_location_pings');

    // ── 15. userLiveLocations ─────────────────────────────────────────────────
    console.log(`[admin-delete] user_live_locations`);
    await tx.delete(userLiveLocations).where(eq(userLiveLocations.companyId, companyId));
    tablesAffected.push('user_live_locations');

    // ── 16. pushTokens ────────────────────────────────────────────────────────
    console.log(`[admin-delete] push_tokens`);
    await tx.delete(pushTokens).where(eq(pushTokens.companyId, companyId));
    tablesAffected.push('push_tokens');

    // ── 17. timeLogs ──────────────────────────────────────────────────────────
    console.log(`[admin-delete] time_logs`);
    await tx.delete(timeLogs).where(eq(timeLogs.companyId, companyId));
    tablesAffected.push('time_logs');

    // ── 18. scheduleEvents ────────────────────────────────────────────────────
    console.log(`[admin-delete] schedule_events`);
    await tx.delete(scheduleEvents).where(eq(scheduleEvents.companyId, companyId));
    tablesAffected.push('schedule_events');

    // ── 19. job children + jobs ───────────────────────────────────────────────
    console.log(`[admin-delete] jobs + children`);
    if (jobIds.length > 0) {
      await tx.delete(jobPhotos).where(inArray(jobPhotos.jobId, jobIds));
      await tx.delete(jobLineItems).where(inArray(jobLineItems.jobId, jobIds));
      await tx.delete(jobAssignments).where(inArray(jobAssignments.jobId, jobIds));
    }
    await tx.delete(crewAssignments).where(eq(crewAssignments.companyId, companyId));
    await tx.delete(scheduleItems).where(eq(scheduleItems.companyId, companyId));
    await tx.delete(jobs).where(eq(jobs.companyId, companyId));
    tablesAffected.push('job_photos', 'job_line_items', 'job_assignments', 'crew_assignments', 'schedule_items', 'jobs');

    // ── 20. documents + document folders ─────────────────────────────────────
    console.log(`[admin-delete] documents + folders`);
    await tx.delete(documents).where(eq(documents.companyId, companyId));
    await tx.delete(documentFolders).where(eq(documentFolders.companyId, companyId));
    tablesAffected.push('documents', 'document_folders');

    // ── 21. messages + conversations ─────────────────────────────────────────
    console.log(`[admin-delete] messages + conversations`);
    if (conversationIds.length > 0) {
      await tx.delete(messages).where(inArray(messages.conversationId, conversationIds));
      await tx.delete(conversationParticipants).where(inArray(conversationParticipants.conversationId, conversationIds));
    }
    await tx.delete(conversations).where(eq(conversations.companyId, companyId));
    tablesAffected.push('messages', 'conversation_participants', 'conversations');

    // ── 22. campaigns ─────────────────────────────────────────────────────────
    console.log(`[admin-delete] campaigns + recipients`);
    if (campaignIds.length > 0) {
      await tx.delete(campaignRecipients).where(inArray(campaignRecipients.campaignId, campaignIds));
    }
    await tx.delete(campaigns).where(eq(campaigns.companyId, companyId));
    tablesAffected.push('campaign_recipients', 'campaigns');

    // ── 23. notifications for all members ────────────────────────────────────
    console.log(`[admin-delete] notifications`);
    if (memberUserIds.length > 0) {
      await tx.delete(notifications).where(inArray(notifications.recipientUserId, memberUserIds));
    }
    tablesAffected.push('notifications');

    // ── 24. leads ─────────────────────────────────────────────────────────────
    console.log(`[admin-delete] leads`);
    await tx.delete(leads).where(eq(leads.companyId, companyId));
    tablesAffected.push('leads');

    // ── 25. company taxes ─────────────────────────────────────────────────────
    console.log(`[admin-delete] company_taxes`);
    await tx.delete(companyTaxes).where(eq(companyTaxes.companyId, companyId));
    tablesAffected.push('company_taxes');

    // ── 26. service catalog ───────────────────────────────────────────────────
    console.log(`[admin-delete] service_catalog_items`);
    await tx.delete(serviceCatalogItems).where(eq(serviceCatalogItems.companyId, companyId));
    tablesAffected.push('service_catalog_items');

    // ── 27. company counters ──────────────────────────────────────────────────
    console.log(`[admin-delete] company_counters`);
    await tx.delete(companyCounters).where(eq(companyCounters.companyId, companyId));
    tablesAffected.push('company_counters');

    // ── 28. company email branding ────────────────────────────────────────────
    console.log(`[admin-delete] company_email_branding`);
    await tx.delete(companyEmailBranding).where(eq(companyEmailBranding.companyId, companyId));
    tablesAffected.push('company_email_branding');

    // ── 29. supportRequests (set null on delete but explicit delete is cleaner) ─
    console.log(`[admin-delete] support_requests`);
    await tx.delete(supportRequests).where(eq(supportRequests.companyId, companyId));
    tablesAffected.push('support_requests');

    // ── 30. customers + clients ───────────────────────────────────────────────
    console.log(`[admin-delete] customers + clients`);
    await tx.delete(customers).where(eq(customers.companyId, companyId));
    await tx.delete(clients).where(eq(clients.companyId, companyId));
    tablesAffected.push('customers', 'clients');

    // ── 31. subcontractors ────────────────────────────────────────────────────
    console.log(`[admin-delete] subcontractors`);
    await tx.delete(subcontractors).where(eq(subcontractors.companyId, companyId));
    tablesAffected.push('subcontractors');

    // ── 31b. growth dashboard tables (per-company attribution + admin notes) ──
    // NOTE: We never delete growthCampaigns themselves — they are global marketing
    // entities and other accounts may reference them. We only remove THIS company's
    // attribution row + admin metadata.
    console.log(`[admin-delete] growth_subscribers + growth_account_admin`);
    await tx.delete(growthSubscribers).where(eq(growthSubscribers.companyId, companyId));
    await tx.delete(growthAccountAdmin).where(eq(growthAccountAdmin.companyId, companyId));
    tablesAffected.push('growth_subscribers', 'growth_account_admin');

    // ── 32. company members ───────────────────────────────────────────────────
    console.log(`[admin-delete] company_members`);
    await tx.delete(companyMembers).where(eq(companyMembers.companyId, companyId));
    tablesAffected.push('company_members');

    // ── 33. company record ────────────────────────────────────────────────────
    console.log(`[admin-delete] companies`);
    await tx.delete(companies).where(eq(companies.id, companyId));
    tablesAffected.push('companies');

    // ── 34. Orphaned user + auth-identity cleanup ─────────────────────────────
    // After companies + company_members are deleted, classify every candidate
    // user (members + owner) into delete/keep buckets. Per requested spec:
    //   • If user still belongs to ANOTHER company → KEEP (only membership wiped)
    //   • If user email is in DASHBOARD_ADMIN_EMAILS or PROTECTED_OWNER_EMAILS
    //     → KEEP (admins must stay alive even when their workspaces vanish)
    //   • If user is the dashboard admin performing this delete → KEEP
    //   • Otherwise → DELETE the user row + every auth-side identity tied to
    //     that email so the email is fully reusable for re-signup testing.
    console.log(
      `[dashboard-accounts] deleting company users — candidates=${candidateUserIds.length} actor=${actorEmail}`,
    );

    const protectedEmails = getProtectedEmailSet();
    const actorEmailLower = actorEmail ? actorEmail.toLowerCase() : null;
    const orphanedUserIds: string[] = [];

    for (const userId of candidateUserIds) {
      const email = emailById.get(userId) ?? null;

      // 1) Protected/admin guard — never delete these regardless of orphan status.
      if (email && protectedEmails.has(email)) {
        keptUsers.push({ userId, email, reason: "protected_or_admin" });
        console.log(
          `[dashboard-accounts] skipping protected/admin user — userId=${userId} email=${email}`,
        );
        continue;
      }

      // 2) Actor self-guard — never delete the dashboard admin running the delete.
      if (actorEmailLower && email === actorEmailLower) {
        keptUsers.push({ userId, email, reason: "actor_self" });
        console.log(
          `[dashboard-accounts] skipping actor user (self) — userId=${userId} email=${email}`,
        );
        continue;
      }

      // 3) Multi-tenant guard — keep users still belonging to another company.
      const remaining = await tx.select({ id: companyMembers.id })
        .from(companyMembers)
        .where(eq(companyMembers.userId, userId))
        .limit(1);
      if (remaining.length > 0) {
        keptUsers.push({ userId, email, reason: "belongs_to_other_company" });
        console.log(
          `[dashboard-accounts] user belongs to other companies, keeping user — userId=${userId} email=${email ?? "<none>"}`,
        );
        continue;
      }

      // Eligible for full removal.
      orphanedUserIds.push(userId);
      if (email) deletedUserEmails.push(email);
      console.log(
        `[dashboard-accounts] user has no other companies, deleting auth/user — userId=${userId} email=${email ?? "<none>"}`,
      );
    }

    if (orphanedUserIds.length > 0) {
      // (a) Clean up push tokens (userId-scoped, no companyId).
      await tx.delete(pushTokens).where(inArray(pushTokens.userId, orphanedUserIds));

      // (b) Login challenges keyed by userId.
      const lcDel = await tx.delete(loginChallenges)
        .where(inArray(loginChallenges.userId, orphanedUserIds));
      const lcCount = (lcDel as any)?.rowCount ?? 0;
      authIdentitiesDeleted += lcCount;

      // (c) Pending signups keyed by lower(email) — this is what makes
      //     "An account with this email already exists" go away on re-signup.
      if (deletedUserEmails.length > 0) {
        const psDel = await tx.delete(pendingSignups)
          .where(sql`LOWER(${pendingSignups.email}) IN (${sql.join(deletedUserEmails.map((e) => sql`${e}`), sql`, `)})`);
        const psCount = (psDel as any)?.rowCount ?? 0;
        authIdentitiesDeleted += psCount;
      }
      console.log(
        `[dashboard-accounts] deleted auth identity rows — pendingSignups+loginChallenges+pushTokens for ${orphanedUserIds.length} users (auth rows=${authIdentitiesDeleted})`,
      );

      // (d) Sessions: connect-pg-simple stores sess as JSONB. Passport puts
      //     the authenticated user under sess.passport.user.id, so we match
      //     that EXACT JSON path instead of a substring scan — that prevents
      //     accidentally logging out unrelated users whose ids happen to
      //     contain a matching substring. Failures are non-fatal —
      //     express-session will TTL-expire stale rows anyway.
      try {
        const sDel = await tx.execute(
          sql`DELETE FROM sessions
              WHERE (sess->'passport'->'user'->>'id') IN (${sql.join(
                orphanedUserIds.map((u) => sql`${u}`),
                sql`, `,
              )})`,
        );
        sessionsDeleted = Number((sDel as any)?.rowCount ?? 0);
        console.log(
          `[dashboard-accounts] deleted sessions — count=${sessionsDeleted} (exact JSON path match)`,
        );
      } catch (sessErr: any) {
        sessionsDeleted = -1;
        console.warn(
          `[dashboard-accounts] session cleanup skipped (non-fatal): ${sessErr?.message ?? sessErr}`,
        );
      }

      // (e) Finally: the users row itself.
      await tx.delete(users).where(inArray(users.id, orphanedUserIds));
      orphanedUsersDeleted = orphanedUserIds.length;
      tablesAffected.push('users (orphaned)');
      tablesAffected.push('pending_signups (by email)');
      tablesAffected.push('login_challenges (by userId)');
      if (sessionsDeleted >= 0) tablesAffected.push('sessions (best-effort)');
    }

    console.log(
      `[dashboard-accounts] delete completed with user cleanup — companyId=${companyId} deletedUsers=${orphanedUsersDeleted} keptUsers=${keptUsers.length} authIdentities=${authIdentitiesDeleted} sessions=${sessionsDeleted}`,
    );
    console.log(
      `[admin-delete] DONE — companyId=${companyId} name="${companyName}" tables=${tablesAffected.length} orphaned=${orphanedUsersDeleted}`,
    );
  });

  return {
    ok: true,
    companyId,
    companyName,
    tablesAffected,
    orphanedUsersDeleted,
    deletedUserEmails,
    keptUsers,
    authIdentitiesDeleted,
    sessionsDeleted,
  };
}
