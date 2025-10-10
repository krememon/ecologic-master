import { zonedTimeToUtc } from 'date-fns-tz';
import { parse } from 'date-fns';

/**
 * Get the user's IANA timezone (e.g., "America/New_York")
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a datetime-local input value (no timezone) to UTC ISO string
 * Treats the input as local time in the user's timezone
 * 
 * @param datetimeLocalValue - Value from datetime-local input (e.g., "2025-10-09T10:00")
 * @returns UTC ISO string with Z suffix (e.g., "2025-10-09T14:00:00.000Z")
 */
export function datetimeLocalToUTC(datetimeLocalValue: string): string {
  if (!datetimeLocalValue) return '';
  
  const userTz = getUserTimezone();
  
  // Parse the datetime-local format and treat it as being in the user's timezone
  const localDate = parse(datetimeLocalValue, "yyyy-MM-dd'T'HH:mm", new Date());
  
  // Convert to UTC
  const utcDate = zonedTimeToUtc(localDate, userTz);
  
  // Return ISO string
  return utcDate.toISOString();
}
