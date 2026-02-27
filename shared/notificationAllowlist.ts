export const PUSH_ENABLED_TYPES = [
  "job_assigned",
  "dm_message",
  "job_starting_soon",
  "announcement",
] as const;

export const NOTIFICATIONS_TAB_ALLOWED_TYPES = [
  ...PUSH_ENABLED_TYPES,
] as const;
