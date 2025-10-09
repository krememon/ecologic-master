/**
 * Timezone and date range utilities for schedule filtering
 * Used by both frontend and backend for consistent date handling
 */

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
  // Create a date string in the user's timezone
  const dateStr = date.toLocaleString('en-US', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // Parse to get YYYY-MM-DD
  const [month, day, year] = dateStr.split('/');
  const localDateStr = `${year}-${month}-${day}T00:00:00`;
  
  // Create a date in the user's timezone
  const localDate = new Date(localDateStr);
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  
  // Adjust for timezone offset
  const userDate = new Date(localDate.toLocaleString('en-US', { timeZone: timezone }));
  const offset = localDate.getTime() - userDate.getTime();
  
  return new Date(localDate.getTime() - offset);
}

/**
 * Get end of day in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string
 * @returns End of day (23:59:59.999) in UTC
 */
export function getEndOfDayUTC(date: Date, timezone: string = 'UTC'): Date {
  const startOfDay = getStartOfDayUTC(date, timezone);
  return new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Get start of week (Monday) in user's timezone, converted to UTC
 * @param date - Date in any timezone
 * @param timezone - IANA timezone string
 * @returns Start of week (Monday 00:00:00) in UTC
 */
export function getStartOfWeekUTC(date: Date, timezone: string = 'UTC'): Date {
  const dayOfWeek = date.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust to Monday
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return getStartOfDayUTC(monday, timezone);
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
    // End is start + 7 days
    endUtc = new Date(startUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
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
