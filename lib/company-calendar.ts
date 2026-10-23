export type CompanyCalendarSlot = {
  date: string;
  startHour: number;
  endHour: number;
};

type ZonedParts = {
  date: string;
  hour: number;
  minute: number;
};

export const DEFAULT_COMPANY_TIMEZONE = "America/Chicago";

function isSupportedTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function safeCompanyTimezone(timezone?: string | null) {
  const candidate = timezone?.trim() || DEFAULT_COMPANY_TIMEZONE;
  return isSupportedTimezone(candidate) ? candidate : DEFAULT_COMPANY_TIMEZONE;
}

function zonedParts(value: Date, timezone?: string | null): ZonedParts | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeCompanyTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour");
  const minute = read("minute");
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    hour,
    minute,
  };
}

function dateAtUtcMidnight(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function validCalendarDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isSafeInteger(year) ||
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

/** Returns the calendar date at the Company, never the device, timezone. */
export function companyCalendarToday(
  timezone?: string | null,
  now = new Date(),
) {
  return zonedParts(now, timezone)?.date ?? null;
}

/**
 * Gets a Monday-based Company calendar date for a timeline cell. `now` is
 * interpreted in the Company zone, preventing a device near midnight in a
 * different zone from moving a job to the wrong date.
 */
export function companyCalendarWeekDate(
  dayIndex: number,
  weekOffset: number,
  timezone?: string | null,
  now = new Date(),
) {
  if (
    !Number.isSafeInteger(dayIndex) ||
    dayIndex < 0 ||
    dayIndex > 6 ||
    !Number.isSafeInteger(weekOffset)
  )
    return null;
  const today = companyCalendarToday(timezone, now);
  if (!today) return null;
  const todayUtc = dateAtUtcMidnight(today);
  const mondayOffset = (new Date(todayUtc).getUTCDay() + 6) % 7;
  return new Date(
    todayUtc -
      mondayOffset * 86_400_000 +
      (weekOffset * 7 + dayIndex) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

function companyCalendarDisplayContainer(date: string) {
  const parsedDate = validCalendarDate(date);
  if (!parsedDate) return null;
  const displayDate = new Date(0);
  // This is intentionally a device-local calendar container, not an instant.
  // Setting the calendar fields at noon keeps .getDate(), .getMonth(), and
  // .getDay() aligned with the Company YYYY-MM-DD in every device timezone.
  displayDate.setFullYear(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
  );
  displayDate.setHours(12, 0, 0, 0);
  return displayDate;
}

/**
 * Returns the seven Monday-through-Sunday Company calendar dates for a week.
 *
 * Each returned Date is a device-local, noon display container for its Company
 * YYYY-MM-DD -- it is not the UTC instant at which that Company date begins.
 * This lets existing display code safely read .getDate(), .getMonth(), and
 * .getDay() without a device timezone shifting the visible calendar day.
 */
export function companyCalendarDisplayWeekDates(
  offset: number,
  timezone: string,
  now = new Date(),
): Date[] {
  const dates: Date[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const calendarDate = companyCalendarWeekDate(
      dayIndex,
      offset,
      timezone,
      now,
    );
    if (!calendarDate) return [];
    const displayDate = companyCalendarDisplayContainer(calendarDate);
    if (!displayDate) return [];
    dates.push(displayDate);
  }
  return dates;
}

/** Returns today's Company-local weekday index, with Monday as 0 and Sunday as 6. */
export function companyCalendarTodayDayIndex(
  timezone: string,
  now = new Date(),
): number {
  const today = companyCalendarToday(timezone, now);
  if (!today) return 0;
  return (new Date(dateAtUtcMidnight(today)).getUTCDay() + 6) % 7;
}

/**
 * Converts a Company calendar day and decimal wall-clock hour to the UTC instant
 * expected by the Company Jobs API. Device timezone is intentionally never used.
 */
export function companyCalendarInstant(
  date: string,
  hour: number,
  timezone?: string | null,
) {
  const parsedDate = validCalendarDate(date);
  // An explicit invalid Company timezone must never be silently treated as the
  // default when writing an appointment, because that would schedule it at a
  // different real-world time.
  if (
    !parsedDate ||
    !Number.isFinite(hour) ||
    hour < 0 ||
    hour >= 24 ||
    (timezone?.trim() && !isSupportedTimezone(timezone.trim()))
  )
    return null;
  const { year, month, day } = parsedDate;
  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  if (!Number.isSafeInteger(minute) || minute < 0 || minute >= 60) return null;
  const intendedUtcWallTime = Date.UTC(
    year,
    month - 1,
    day,
    wholeHour,
    minute,
    0,
    0,
  );
  let instant = intendedUtcWallTime;
  const resolvedTimezone = safeCompanyTimezone(timezone);
  // Iteration resolves either standard or daylight-saving offsets without the phone's locale.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(new Date(instant), resolvedTimezone);
    if (!observed) return null;
    const observedUtcWallTime =
      dateAtUtcMidnight(observed.date) +
      observed.hour * 3_600_000 +
      observed.minute * 60_000;
    const adjustment = intendedUtcWallTime - observedUtcWallTime;
    if (adjustment === 0) break;
    instant += adjustment;
  }
  // Spring-forward gaps (for example 02:30 in America/Chicago) have no matching
  // instant. Intl will normalize them to a different wall time unless the final
  // round trip is checked explicitly.
  const resolved = zonedParts(new Date(instant), resolvedTimezone);
  if (
    !resolved ||
    resolved.date !== date ||
    resolved.hour !== wholeHour ||
    resolved.minute !== minute
  )
    return null;
  return new Date(instant).toISOString();
}

/**
 * Translates API instants into the Company calendar's date and wall-clock time.
 * A 9 AM Company appointment stays 9 AM even when the device is in another zone.
 */
export function companyCalendarSlot(
  scheduledStartAt: string | null | undefined,
  scheduledEndAt: string | null | undefined,
  timezone?: string | null,
): CompanyCalendarSlot | null {
  if (!scheduledStartAt) return null;
  const startInstant = new Date(scheduledStartAt);
  const start = zonedParts(startInstant, timezone);
  if (!start) return null;
  const startHour = start.hour + start.minute / 60;
  const endInstant = scheduledEndAt ? new Date(scheduledEndAt) : null;
  const end = endInstant ? zonedParts(endInstant, timezone) : null;
  const durationHours =
    endInstant && !Number.isNaN(endInstant.getTime())
      ? (endInstant.getTime() - startInstant.getTime()) / 3_600_000
      : 1;
  let endHour =
    end && end.date === start.date
      ? end.hour + end.minute / 60
      : startHour + Math.max(0.5, durationHours);
  if (!Number.isFinite(endHour) || endHour <= startHour) {
    endHour =
      startHour +
      Math.max(
        0.5,
        Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1,
      );
  }
  return { date: start.date, startHour, endHour: Math.min(24, endHour) };
}

/** Returns the Monday-based position used by the mobile weekly timeline. */
export function companyCalendarWeekPosition(
  date: string,
  now = new Date(),
  timezone?: string | null,
) {
  const current = zonedParts(now, timezone);
  if (!current) return { dayIndex: 0, weekOffset: 0 };
  const appointmentUtc = dateAtUtcMidnight(date);
  const todayUtc = dateAtUtcMidnight(current.date);
  const appointmentDay = new Date(appointmentUtc).getUTCDay();
  const todayDay = new Date(todayUtc).getUTCDay();
  const dayIndex = (appointmentDay + 6) % 7;
  const appointmentMonday = appointmentUtc - dayIndex * 86_400_000;
  const todayMonday = todayUtc - ((todayDay + 6) % 7) * 86_400_000;
  return {
    dayIndex,
    weekOffset: Math.round(
      (appointmentMonday - todayMonday) / (7 * 86_400_000),
    ),
  };
}
