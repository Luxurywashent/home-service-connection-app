type ClockNoticeListener = (notice: string | null) => void;

let notice: string | null = null;
const listeners = new Set<ClockNoticeListener>();

export function publishCompanyClockNotice(next: string | null) {
  if (notice === next) return;
  notice = next;
  listeners.forEach((listener) => listener(notice));
}

export function subscribeCompanyClockNotice(listener: ClockNoticeListener) {
  listeners.add(listener);
  listener(notice);
  return () => {
    listeners.delete(listener);
  };
}
