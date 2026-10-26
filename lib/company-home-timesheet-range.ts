/** Let the canonical backend resolve Today and This Week in the Company's timezone. */
export function companyHomeTimesheetRange(view: string): { today?: boolean; weekOffset?: number; start?: string } {
  if (view === "today") return { today: true };
  if (view === "week") return { weekOffset: 0 };
  return { start: "2020-01-01" };
}
