import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { isValid, parseISO } from 'date-fns';

/**
 * Get the user's IANA timezone (e.g., "America/New_York")
 * Falls back to UTC if unable to determine
 */
export function getUserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'UTC';
  } catch {
    return 'UTC';
  }
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
  
  try {
    const userTz = getUserTimezone();
    
    // Parse the datetime-local format as a local date
    const localDate = new Date(datetimeLocalValue);
    
    if (!isValid(localDate)) {
      console.error('Invalid date:', datetimeLocalValue);
      return '';
    }
    
    // Convert from user's timezone to UTC
    const utcDate = fromZonedTime(localDate, userTz);
    
    // Return ISO string
    return utcDate.toISOString();
  } catch (error) {
    console.error('Error converting datetime-local to UTC:', error);
    return '';
  }
}

/**
 * Convert UTC ISO string to user's local time and format it
 * Safe version that handles errors gracefully
 * 
 * @param utcIsoString - ISO 8601 UTC string from database (e.g., "2025-10-09T14:00:00.000Z")
 * @param formatString - Format string for date-fns (e.g., "MMM d, yyyy h:mm a" for "Oct 9, 2025 10:00 AM")
 * @returns Formatted time in user's timezone, or empty string if invalid
 */
export function formatInLocalTimezone(utcIsoString: string | null | undefined, formatString: string = "MMM d, yyyy h:mm a"): string {
  if (!utcIsoString) return '';
  
  try {
    const userTz = getUserTimezone();
    
    // Parse UTC string to Date object
    const utcDate = typeof utcIsoString === 'string' ? parseISO(utcIsoString) : utcIsoString;
    
    if (!isValid(utcDate)) {
      console.error('Invalid UTC date:', utcIsoString);
      return '';
    }
    
    // Format in user's timezone
    return formatInTimeZone(utcDate, userTz, formatString);
  } catch (error) {
    console.error('Error formatting date in local timezone:', error);
    // Fallback to basic locale string
    try {
      const date = new Date(utcIsoString);
      return date.toLocaleString();
    } catch {
      return '';
    }
  }
}
