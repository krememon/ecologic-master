import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';

/**
 * Check if two date ranges overlap
 * Uses strict overlap logic: itemStart < rangeEnd AND itemEnd > rangeStart
 * 
 * @param rangeStartUtc - Range start in UTC
 * @param rangeEndUtc - Range end in UTC
 * @param itemStartUtc - Item start in UTC
 * @param itemEndUtc - Item end in UTC
 * @returns true if ranges overlap
 */
export function overlaps(
  rangeStartUtc: Date,
  rangeEndUtc: Date,
  itemStartUtc: Date,
  itemEndUtc: Date
): boolean {
  return itemStartUtc < rangeEndUtc && itemEndUtc > rangeStartUtc;
}

/**
 * Get start of day in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Start of day in UTC
 */
export function getStartOfDayUTC(date: Date, timezone: string = 'UTC'): Date {
  // Convert UTC date to the target timezone
  const zonedDate = utcToZonedTime(date, timezone);
  // Get start of day in the target timezone
  const startOfDayInZone = startOfDay(zonedDate);
  // Convert back to UTC
  return zonedTimeToUtc(startOfDayInZone, timezone);
}

/**
 * Get end of day in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string
 * @returns End of day (23:59:59.999) in UTC
 */
export function getEndOfDayUTC(date: Date, timezone: string = 'UTC'): Date {
  // Convert UTC date to the target timezone
  const zonedDate = utcToZonedTime(date, timezone);
  // Get end of day in the target timezone
  const endOfDayInZone = endOfDay(zonedDate);
  // Convert back to UTC
  return zonedTimeToUtc(endOfDayInZone, timezone);
}

/**
 * Get start of week (Sunday) in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string
 * @returns Start of week (Sunday 00:00:00) in UTC
 */
export function getStartOfWeekUTC(date: Date, timezone: string = 'UTC'): Date {
  // Convert UTC date to the target timezone
  const zonedDate = utcToZonedTime(date, timezone);
  // Get start of week (Sunday) in the target timezone
  const startOfWeekInZone = startOfWeek(zonedDate, { weekStartsOn: 0 });
  // Get start of that day
  const startOfDayInZone = startOfDay(startOfWeekInZone);
  // Convert back to UTC
  return zonedTimeToUtc(startOfDayInZone, timezone);
}

/**
 * Get end of week (Saturday) in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string
 * @returns End of week (Saturday 23:59:59.999) in UTC
 */
export function getEndOfWeekUTC(date: Date, timezone: string = 'UTC'): Date {
  // Convert UTC date to the target timezone
  const zonedDate = utcToZonedTime(date, timezone);
  // Get end of week (Saturday) in the target timezone
  const endOfWeekInZone = endOfWeek(zonedDate, { weekStartsOn: 0 });
  // Get end of that day
  const endOfDayInZone = endOfDay(endOfWeekInZone);
  // Convert back to UTC
  return zonedTimeToUtc(endOfDayInZone, timezone);
}

/**
 * Get date range for a given view mode
 * @param viewMode - 'day' or 'week'
 * @param anchorDate - The selected date
 * @param timezone - IANA timezone string
 * @returns Object with startUtc and endUtc Date objects
 */
export function getViewRange(
  viewMode: 'day' | 'week',
  anchorDate: Date,
  timezone: string = 'UTC'
): { startUtc: Date; endUtc: Date; startUtcISO: string; endUtcISO: string } {
  let startUtc: Date;
  let endUtc: Date;

  if (viewMode === 'day') {
    startUtc = getStartOfDayUTC(anchorDate, timezone);
    endUtc = getEndOfDayUTC(anchorDate, timezone);
  } else {
    // week
    startUtc = getStartOfWeekUTC(anchorDate, timezone);
    endUtc = getEndOfWeekUTC(anchorDate, timezone);
  }

  return {
    startUtc,
    endUtc,
    startUtcISO: startUtc.toISOString(),
    endUtcISO: endUtc.toISOString(),
  };
}

/**
 * Convert ISO string to Date, ensuring UTC interpretation
 * @param isoString - ISO 8601 date string
 * @returns Date object in UTC
 */
export function parseUTC(isoString: string): Date {
  return new Date(isoString);
}
