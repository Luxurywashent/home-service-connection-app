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

const DEFAULT_COMPANY_TIMEZONE = "America/Chicago";

function safeTimezone(timezone?: string | null) {
  const candidate = timezone?.trim() || DEFAULT_COMPANY_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_COMPANY_TIMEZONE;
  }
}

function zonedParts(value: Date, timezone?: string | null): ZonedParts | null {
  if (Number.isNaN(value.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
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

/**
 * Converts a Company calendar day and decimal wall-clock hour to the UTC instant
 * required by the Company Jobs API. This deliberately avoids the device timezone:
 * dragging a Pensacola 9 AM appointment must send 9 AM Central, not 9 AM where the
 * phone happens to be located.
 */
export function companyCalendarInstant(date: string, hour: number, timezone?: string | null) {
  const [year, month, day] = date.split("-").map(Number);
  if (![year, month, day, hour].every(Number.isFinite)) return null;

  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  const intendedUtcWallTime = Date.UTC(year, month - 1, day, wholeHour, minute, 0, 0);
  let instant = intendedUtcWallTime;
  const resolvedTimezone = safeTimezone(timezone);

  // Reconcile the intended wall time with the saved Company timezone. Repeating
  // converges across standard and daylight-saving offsets without consulting the
  // phone's local timezone.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(new Date(instant), resolvedTimezone);
    if (!observed) return null;
    const observedUtcWallTime = dateAtUtcMidnight(observed.date)
      + observed.hour * 3_600_000
      + observed.minute * 60_000;
    const adjustment = intendedUtcWallTime - observedUtcWallTime;
    if (adjustment === 0) break;
    instant += adjustment;
  }

  return new Date(instant).toISOString();
}

/**
 * Translates UTC API instants into the Company calendar's wall-clock date and time.
 * The mobile device timezone is deliberately not used: a 9 AM Pensacola appointment
 * remains 9 AM on the Company calendar even when the device is in another timezone.
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
  const durationHours = endInstant && !Number.isNaN(endInstant.getTime())
    ? (endInstant.getTime() - startInstant.getTime()) / 3_600_000
    : 1;

  let endHour = end && end.date === start.date
    ? end.hour + end.minute / 60
    : startHour + Math.max(0.5, durationHours);

  // Preserve the actual elapsed duration when a DST change or malformed endpoint
  // would otherwise create a zero/negative wall-clock range.
  if (!Number.isFinite(endHour) || endHour <= startHour) {
    endHour = startHour + Math.max(0.5, Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1);
  }

  return {
    date: start.date,
    startHour,
    endHour: Math.min(24, endHour),
  };
}

/** Returns the Monday-based day and week offset used by the mobile timeline. */
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
    weekOffset: Math.round((appointmentMonday - todayMonday) / (7 * 86_400_000)),
  };
}
