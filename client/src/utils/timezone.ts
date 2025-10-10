import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { parse, format as dateFnsFormat } from 'date-fns';

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

/**
 * Convert UTC ISO string to user's local time and format it
 * 
 * @param utcIsoString - ISO 8601 UTC string from database (e.g., "2025-10-09T14:00:00.000Z")
 * @param formatString - Format string for date-fns (e.g., "h:mm a" for "10:00 AM")
 * @returns Formatted time in user's timezone (e.g., "10:00 AM")
 */
export function formatInLocalTimezone(utcIsoString: string, formatString: string): string {
  if (!utcIsoString) return '';
  
  const userTz = getUserTimezone();
  
  // Parse UTC string to Date object
  const utcDate = new Date(utcIsoString);
  
  // Convert to user's timezone
  const localDate = utcToZonedTime(utcDate, userTz);
  
  // Format and return
  return dateFnsFormat(localDate, formatString);
}
