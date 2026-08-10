/**
 * Timezone utilities for converting UTC times to Central Time (CT)
 * Handles both CDT (Central Daylight Time) and CST (Central Standard Time)
 */

/**
 * Format a UTC timestamp to Central Time with readable format
 * @param isoString - ISO 8601 timestamp string (e.g., "2026-08-01T17:20:10.719Z")
 * @param format - Format type: 'short' (12:30 PM), 'long' (Aug 1, 12:30 PM), 'full' (Aug 1, 2026 12:30 PM CDT)
 * @returns Formatted string in Central Time
 */
export function formatToCentral(isoString: string, format: 'short' | 'long' | 'full' = 'long'): string {
  try {
    const date = new Date(isoString);
    
    // Format using Intl API with Central Time zone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });

    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    
    parts.forEach(part => {
      partMap[part.type] = part.value;
    });

    const time = `${partMap.hour}:${partMap.minute}`;
    const ampm = partMap.dayPeriod;
    const timeWithAmpm = `${time} ${ampm}`;
    const dateStr = `${partMap.month} ${partMap.day}`;
    const fullDate = `${partMap.month} ${partMap.day}, ${partMap.year}`;
    const tz = partMap.timeZoneName;

    switch (format) {
      case 'short':
        return timeWithAmpm;
      case 'long':
        return `${dateStr}, ${timeWithAmpm}`;
      case 'full':
        return `${fullDate} ${timeWithAmpm} ${tz}`;
      default:
        return timeWithAmpm;
    }
  } catch (error) {
    console.warn('Error formatting timestamp:', error);
    return isoString;
  }
}

/**
 * Get just the time in Central Time
 * @param isoString - ISO 8601 timestamp string
 * @returns Time string (e.g., "12:30 PM")
 */
export function getTimeInCentral(isoString: string): string {
  return formatToCentral(isoString, 'short');
}

/**
 * Get date and time in Central Time
 * @param isoString - ISO 8601 timestamp string
 * @returns Date and time string (e.g., "Aug 1, 12:30 PM")
 */
export function getDateTimeInCentral(isoString: string): string {
  return formatToCentral(isoString, 'long');
}

/**
 * Get full date, time, and timezone in Central Time
 * @param isoString - ISO 8601 timestamp string
 * @returns Full string (e.g., "Aug 1, 2026 12:30 PM CDT")
 */
export function getFullDateTimeInCentral(isoString: string): string {
  return formatToCentral(isoString, 'full');
}

/**
 * Parse a UTC timestamp and return a Date object adjusted to Central Time
 * @param isoString - ISO 8601 timestamp string
 * @returns Date object (still represents the same moment in time)
 */
export function parseToDate(isoString: string): Date {
  return new Date(isoString);
}

/**
 * Get relative time string in Central Time (e.g., "2 hours ago")
 * @param isoString - ISO 8601 timestamp string
 * @returns Relative time string
 */
export function getRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return formatToCentral(isoString, 'long');
  } catch (error) {
    console.warn('Error calculating relative time:', error);
    return isoString;
  }
}


