export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sun, 1=Mon

// Always create dates in LOCAL time (never parse ISO strings directly).
export function makeLocalDate(y: number, m1: number, d: number) {
  // m1 is 1-based month
  const dt = new Date(y, m1 - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// Given any Date, return Monday-start week anchor in LOCAL time.
export function startOfWeekLocal(d: Date, weekStartsOn: WeekStart = 1) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0..6 (Sun..Sat) in LOCAL time
  // shift so week starts on `weekStartsOn` (default Monday=1)
  const diff = (day - weekStartsOn + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x; // local midnight Monday
}

// Add days (LOCAL)
export function addDaysLocal(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Format helpers using toLocaleDateString (LOCAL)
export function fmtWeekOf(d: Date) {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function fmtDowShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(); // MON,TUE...
}

export function fmtDayNumber(d: Date) {
  return d.getDate().toString();
}

// Safe local parse for 'YYYY-MM-DD'
export function parseYmdLocal(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return makeLocalDate(y, m, d);
}

// Convert Date to local YYYY-MM-DD string (no UTC)
export function dateToYmdLocal(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format estimate's requestedStartAt for display.
 * This is the SINGLE SOURCE OF TRUTH for estimate schedule display.
 * Returns { date: string, time: string, full: string } or null if not scheduled.
 */
export function formatEstimateRequestedSchedule(estimate: { id?: number; requestedStartAt?: string | Date | null }): {
  date: string;
  time: string;
  full: string;
} | null {
  const rawDate = estimate?.requestedStartAt;
  
  // Debug log for schedule UI
  console.log("SCHEDULE UI:", { estimateId: estimate?.id, requestedStartAt: rawDate });
  
  if (!rawDate) {
    return null;
  }
  
  try {
    const dateObj = typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
    
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    
    const formattedTime = dateObj.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    
    return {
      date: formattedDate,
      time: formattedTime,
      full: `${formattedDate} · ${formattedTime}`,
    };
  } catch {
    return null;
  }
}
