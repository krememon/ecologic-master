export function formatTimeToDisplay(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return '';
    
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

export function formatScheduleTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): string {
  const formattedStart = formatTimeToDisplay(startTime);
  const formattedEnd = formatTimeToDisplay(endTime);
  
  if (formattedStart && formattedEnd) {
    return `${formattedStart} – ${formattedEnd}`;
  }
  
  if (formattedStart) {
    return formattedStart;
  }
  
  return '';
}

export function formatScheduleDateForDisplay(rawDate: string | Date | null | undefined): string {
  if (!rawDate) return '';
  
  try {
    let dateStr: string;
    if (rawDate instanceof Date) {
      const y = rawDate.getFullYear();
      const m = (rawDate.getMonth() + 1).toString().padStart(2, '0');
      const d = rawDate.getDate().toString().padStart(2, '0');
      dateStr = `${y}-${m}-${d}`;
    } else if (typeof rawDate === 'string') {
      dateStr = rawDate.split('T')[0];
    } else {
      return '';
    }
    
    const [year, month, day] = dateStr.split('-').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
    
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}
