export type NotificationPriority = 'action' | 'update' | 'activity';

export const NOTIFICATION_PRIORITY: Record<string, NotificationPriority> = {
  dm_message: 'action',
  job_assigned: 'action',
  job_unassigned: 'action',
  job_cancelled: 'action',
  job_rescheduled: 'action',
  estimate_approved: 'action',
  invoice_overdue: 'action',
  payment_failed: 'action',
  missed_clockout: 'action',

  payment_collected: 'update',
  payment_succeeded: 'update',
  invoice_paid: 'update',
  manual_payment_recorded: 'update',
  refund_issued: 'update',
  estimate_created: 'update',
  job_status_changed: 'update',

  tech_clocked_in: 'activity',
  tech_clocked_out: 'activity',
  job_starting_soon: 'activity',
  announcement: 'activity',
  job_updated: 'activity',
  job_completed: 'activity',
  document_uploaded: 'activity',
  estimate_updated: 'activity',
  estimate_status_changed: 'activity',
  estimate_converted: 'activity',
};

export function getNotificationPriority(type: string): NotificationPriority {
  return NOTIFICATION_PRIORITY[type] || 'activity';
}

export const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  action: 0,
  update: 1,
  activity: 2,
};

export const PUSH_ENABLED_TYPES = [
  "job_assigned",
  "job_unassigned",
  "job_cancelled",
  "job_rescheduled",
  "dm_message",
  "estimate_approved",
  "invoice_overdue",
  "payment_failed",
  "missed_clockout",
  "payment_collected",
  "payment_succeeded",
  "refund_issued",
  "job_starting_soon",
  "announcement",
] as const;

export const NOTIFICATIONS_TAB_ALLOWED_TYPES = [
  "dm_message",
  "job_assigned",
  "job_unassigned",
  "job_cancelled",
  "job_rescheduled",
  "estimate_approved",
  "invoice_overdue",
  "payment_failed",
  "missed_clockout",
  "payment_collected",
  "payment_succeeded",
  "invoice_paid",
  "manual_payment_recorded",
  "refund_issued",
  "estimate_created",
  "job_status_changed",
  "tech_clocked_in",
  "tech_clocked_out",
  "job_starting_soon",
  "announcement",
  "job_updated",
  "job_completed",
  "document_uploaded",
] as const;
