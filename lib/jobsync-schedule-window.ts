export const COMPANY_SCHEDULE_START_HOUR = 0;
export const COMPANY_SCHEDULE_END_HOUR = 24;
export const COMPANY_SCHEDULE_HALF_HOUR_SLOTS = Array.from(
  { length: (COMPANY_SCHEDULE_END_HOUR - COMPANY_SCHEDULE_START_HOUR) * 2 },
  (_, index) => COMPANY_SCHEDULE_START_HOUR + index * 0.5,
);

export function companyScheduleSlotIndex(hour: number) {
  const slot = Math.floor((hour - COMPANY_SCHEDULE_START_HOUR) * 2);
  return Math.max(0, Math.min(COMPANY_SCHEDULE_HALF_HOUR_SLOTS.length - 1, Number.isFinite(slot) ? slot : 0));
}

export function companyScheduleInitialOffset(slotHeight: number, preferredHour = 8) {
  return Math.max(0, (preferredHour - COMPANY_SCHEDULE_START_HOUR) * 2 * slotHeight);
}
