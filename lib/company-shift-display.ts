export type CompanyShiftDescription = {
  clockInLabel: string;
  clockOutLabel: string;
  spansCalendarDays: boolean;
  elapsedHours: number | null;
  paidHoursFromTimestamps: number | null;
  /** Null when the shift is still open or the timestamps cannot be read. False does not change the stored record. */
  recordedHoursMatchTimestamps: boolean | null;
};

function parsedInstant(value: string | null | undefined) {
  if (!value) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function roundHours(milliseconds: number) {
  return Math.max(0, Math.round((milliseconds / 3_600_000) * 100) / 100);
}

export function companyCalendarDay(value: string, timeZone?: string | null) {
  const instant = parsedInstant(value);
  if (instant == null) return null;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  if (timeZone) options.timeZone = timeZone;
  try {
    return new Intl.DateTimeFormat("en-CA", options).format(new Date(instant));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
  }
}

export function formatCompanyClockTime(value: string | null, timeZone?: string | null, includeDate = false) {
  if (!value) return "--:--";
  const instant = parsedInstant(value);
  if (instant == null) return "--:--";
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(includeDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
  };
  if (timeZone) options.timeZone = timeZone;
  try {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(instant));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(includeDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    }).format(new Date(instant));
  }
}

function intervalHours(start: string | null | undefined, end: string | null | undefined) {
  const started = parsedInstant(start);
  const ended = parsedInstant(end);
  if (started == null || ended == null || ended < started) return 0;
  return ended - started;
}

/** Paid hours follow the server rule: clock span minus one break, without writing a new total. */
export function describeCompanyShift(input: {
  clockIn: string | null;
  clockOut: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  totalHours: number | null;
  timeZone?: string | null;
}): CompanyShiftDescription {
  const clockInDay = input.clockIn ? companyCalendarDay(input.clockIn, input.timeZone) : null;
  const clockOutDay = input.clockOut ? companyCalendarDay(input.clockOut, input.timeZone) : null;
  const spansCalendarDays = Boolean(clockInDay && clockOutDay && clockInDay !== clockOutDay);
  const elapsedMs = input.clockIn && input.clockOut ? intervalHours(input.clockIn, input.clockOut) : null;
  const elapsedHours = elapsedMs == null ? null : roundHours(elapsedMs);
  let paidHoursFromTimestamps: number | null = null;
  if (elapsedMs != null && input.clockOut) {
    const breakEnd = input.breakStart && !input.breakEnd ? input.clockOut : input.breakEnd;
    const breakMs = input.breakStart ? intervalHours(input.breakStart, breakEnd) : 0;
    paidHoursFromTimestamps = roundHours(Math.max(0, elapsedMs - breakMs));
  }
  const recordedHoursMatchTimestamps = elapsedHours == null || input.totalHours == null || paidHoursFromTimestamps == null
    ? null
    : Math.abs(paidHoursFromTimestamps - input.totalHours) <= 0.02;
  return {
    clockInLabel: formatCompanyClockTime(input.clockIn, input.timeZone, spansCalendarDays),
    clockOutLabel: formatCompanyClockTime(input.clockOut, input.timeZone, spansCalendarDays),
    spansCalendarDays,
    elapsedHours,
    paidHoursFromTimestamps,
    recordedHoursMatchTimestamps,
  };
}
