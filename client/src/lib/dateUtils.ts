/**
 * dateUtils.ts — EcoLogic shared date/time helpers
 *
 * SCHEMA CLASSIFICATION (from shared/schema.ts):
 *   DATE-ONLY fields  (Drizzle `date()`, API sends "YYYY-MM-DD"):
 *     invoices.issueDate, invoices.dueDate, invoices.paidDate
 *     jobs.startDate, jobs.endDate
 *
 *   TIMESTAMP fields  (Drizzle `timestamp()`, API sends full ISO string):
 *     *.createdAt, *.updatedAt, *.paidAt, *.scheduledAt, *.sentAt,
 *     payments.paidDate, clockInAt, clockOutAt, signedAt, message timestamps
 *
 * ROOT CAUSE OF OFF-BY-ONE BUG:
 *   `new Date("2026-03-13")` → UTC midnight → local time shows March 12 in
 *   any US timezone (UTC-4 … UTC-8). Fix: parse date-only strings as local noon.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Detect whether a string is a date-only value ("YYYY-MM-DD").
 */
export function isDateOnly(str: string): boolean {
  return DATE_ONLY_RE.test(str.trim());
}

/**
 * Parse a date-only string ("YYYY-MM-DD") as LOCAL noon.
 * This prevents the UTC-midnight shift that causes off-by-one-day bugs.
 * Falls back to null if the input is falsy or invalid.
 */
export function parseDateOnly(str: string | null | undefined): Date | null {
  if (!str) return null;
  const s = str.trim();
  if (!DATE_ONLY_RE.test(s)) return null;
  const d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse any date string.
 * Date-only strings are parsed as local noon (no UTC shift).
 * Full ISO strings are parsed normally (UTC → local, correct).
 */
export function parseAnyDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  const s = str.trim();
  if (DATE_ONLY_RE.test(s)) return parseDateOnly(s);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date-only field to "Mar 13, 2026".
 * Safe: returns `fallback` for null/undefined/invalid input.
 */
export function fmtDate(
  str: string | null | undefined,
  fallback = '—',
): string {
  const d = parseDateOnly(str);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a full timestamp to "Mar 13, 2026 at 7:59 PM".
 * Safe: returns `fallback` for null/undefined/invalid input.
 */
export function fmtDateTime(
  str: string | null | undefined,
  fallback = '—',
): string {
  if (!str) return fallback;
  const d = new Date(str);
  if (isNaN(d.getTime())) return fallback;
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${datePart} at ${timePart}`;
}

/**
 * Format any date string to "Mar 13, 2026" (no time).
 * Auto-detects date-only vs full timestamp; date-only strings are parsed safely.
 */
export function fmtDateAny(
  str: string | null | undefined,
  fallback = '—',
): string {
  if (!str) return fallback;
  const d = parseAnyDate(str);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Relative label for a TIMESTAMP field:
 *   same day  → "Today • 2:30 PM"
 *   yesterday → "Yesterday • 2:30 PM"
 *   older     → "Mar 13, 2026"
 */
export function fmtRelativeTimestamp(
  str: string | null | undefined,
  fallback = '—',
): string {
  if (!str) return fallback;
  const d = new Date(str);
  if (isNaN(d.getTime())) return fallback;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = todayStart.getTime() - dStart.getTime();
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (diff === 0) return `Today \u2022 ${timePart}`;
  if (diff === 86400000) return `Yesterday \u2022 ${timePart}`;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Relative label for a DATE-ONLY field:
 *   same day  → "Today"
 *   yesterday → "Yesterday"
 *   older     → "Mar 13, 2026"
 */
export function fmtRelativeDateOnly(
  str: string | null | undefined,
  fallback = '—',
): string {
  if (!str) return fallback;
  const d = parseDateOnly(str);
  if (!d) return fallback;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = todayStart.getTime() - dStart.getTime();
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Is a date-only string the same local day as today?
 * Safe replacement for date-fns `isToday` on date-only fields.
 */
export function isTodayDateOnly(str: string | null | undefined): boolean {
  const d = parseDateOnly(str);
  if (!d) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Is a date-only string the same local day as yesterday?
 */
export function isYesterdayDateOnly(str: string | null | undefined): boolean {
  const d = parseDateOnly(str);
  if (!d) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  );
}
