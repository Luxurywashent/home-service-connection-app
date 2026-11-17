import { useCallback, useLayoutEffect, useRef } from "react";
import { AppState, Keyboard, Platform, type ScrollView, type ScrollViewProps, type TextInputProps, TextInput } from "react-native";

export type CompanyJobKeyboardTarget = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};
type Rect = { y: number; height: number };

/** Smallest bounded correction; an oversized related selector must not hide the input. */
export function companyJobFocusScrollOffset({ viewport, input, related, offset, contentHeight, gap = 12 }: {
  viewport: Rect; input: Rect; related?: Rect; offset: number; contentHeight: number; gap?: number;
}): number | null {
  if (![viewport.y, viewport.height, input.y, input.height, offset, contentHeight, gap].every(Number.isFinite)
    || viewport.height <= 0 || input.height <= 0 || contentHeight <= 0 || gap < 0) return null;
  const inset = Math.min(gap, viewport.height / 4);
  const top = viewport.y + inset;
  const bottom = viewport.y + viewport.height - inset;
  let targetTop = input.y;
  let targetBottom = input.y + input.height;
  if (related && Number.isFinite(related.y) && Number.isFinite(related.height) && related.height > 0) {
    const unionTop = Math.min(targetTop, related.y);
    const unionBottom = Math.max(targetBottom, related.y + related.height);
    if (unionBottom - unionTop <= bottom - top) { targetTop = unionTop; targetBottom = unionBottom; }
  }
  const delta = targetBottom - targetTop > bottom - top ? targetTop - top
    : targetBottom > bottom ? targetBottom - bottom : targetTop < top ? targetTop - top : 0;
  const next = Math.max(0, Math.min(Math.max(0, contentHeight - viewport.height), offset + delta));
  return Math.abs(next - offset) >= 1 ? next : null;
}

const measurable = (value: unknown): value is CompanyJobKeyboardTarget => Boolean(value
  && typeof (value as CompanyJobKeyboardTarget).measureInWindow === "function");
const foreground = () => Platform.OS === "web" || (AppState.currentState !== "background" && AppState.currentState !== "inactive");

/**
 * Attach scrollProps/ref to the existing body ScrollView, and focus/blur to its
 * TextInputs. The viewport is measured AFTER iOS KAV / Android native Modal resize;
 * keyboard height is never added as padding, content inset, or another resize.
 * scopeKey must change with the caller's session/tenant/job/modal epoch.
 */
export function useCompanyJobKeyboard({ active, isCurrent, scopeKey }: {
  active: boolean; isCurrent: () => boolean; scopeKey: string | number;
}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const attachScrollRef = useCallback((scroll: ScrollView | null) => { scrollRef.current = scroll; }, []);
  const relatedTarget = useRef<CompanyJobKeyboardTarget | null>(null);
  const relatedRef = useCallback((target: CompanyJobKeyboardTarget | null) => { relatedTarget.current = target; }, []);
  const live = useRef({ active, isCurrent, scopeKey, mounted: false, foreground: foreground() });
  const focused = useRef<CompanyJobKeyboardTarget | null>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const suspended = useRef(false);
  const revision = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancel = useCallback(() => {
    revision.current++;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const allowed = useCallback(() => live.current.mounted && live.current.active && live.current.foreground
    && !suspended.current && live.current.isCurrent(), []);
  const reveal = useCallback((request: number) => {
    const scroll = scrollRef.current;
    const input = focused.current;
    const current = () => revision.current === request && allowed() && scrollRef.current === scroll && focused.current === input;
    if (!scroll || !input || !current()) return;
    const nativeScroll = scroll.getNativeScrollRef();
    if (!measurable(nativeScroll)) return;
    nativeScroll.measureInWindow((_x, y, _width, height) => {
      if (!current()) return;
      input.measureInWindow((_ix, inputY, _iw, inputHeight) => {
        if (!current()) return;
        const correct = (related?: Rect) => {
          if (!current()) return;
          const next = companyJobFocusScrollOffset({ viewport: { y, height }, input: { y: inputY, height: inputHeight },
            related, offset: offset.current, contentHeight: contentHeight.current });
          if (next !== null) {
            // Non-animated correction has no animation racing natural finger scrolling.
            offset.current = next;
            scroll.scrollTo({ y: next, animated: false });
          }
        };
        const related = relatedTarget.current;
        if (measurable(related)) related.measureInWindow((_rx, relatedY, _rw, relatedHeight) => correct({ y: relatedY, height: relatedHeight }));
        else correct();
      });
    });
  }, [allowed]);
  const schedule = useCallback(() => {
    cancel();
    if (!focused.current || !allowed() || Platform.OS === "web") return;
    const request = revision.current;
    // Bounded/coalesced passes cover focus-before-resize and delayed native layout.
    timers.current = [0, 80, 240].map((delay) => setTimeout(() => reveal(request), delay));
  }, [allowed, cancel, reveal]);
  useLayoutEffect(() => { live.current.active = active; live.current.isCurrent = isCurrent; live.current.scopeKey = scopeKey; }, [active, isCurrent, scopeKey]);
  useLayoutEffect(() => {
    const binding = live.current;
    binding.mounted = true;
    binding.foreground = foreground();
    focused.current = null;
    suspended.current = false;
    cancel();
    return () => { binding.mounted = false; focused.current = null; cancel(); };
  }, [active, scopeKey, cancel]);
  useLayoutEffect(() => {
    if (!active || Platform.OS === "web") return;
    const subscriptions = [Keyboard.addListener("keyboardDidShow", schedule), Keyboard.addListener("keyboardDidChangeFrame", schedule),
      Keyboard.addListener("keyboardDidHide", cancel), AppState.addEventListener("change", (state) => {
        live.current.foreground = state === "active";
        if (state !== "active") { focused.current = null; cancel(); }
      })];
    return () => { subscriptions.forEach((subscription) => subscription.remove()); cancel(); };
  }, [active, scopeKey, schedule, cancel]);
  const onInputFocus = useCallback<NonNullable<TextInputProps["onFocus"]>>((event) => {
    if (live.current.scopeKey !== scopeKey || !active || !live.current.mounted || !live.current.active || !live.current.foreground || !live.current.isCurrent()) return;
    const target = measurable(event.currentTarget) ? event.currentTarget : TextInput.State.currentlyFocusedInput();
    focused.current = measurable(target) ? target : null;
    suspended.current = false;
    schedule();
  }, [active, scopeKey, schedule]);
  const onInputBlur = useCallback<NonNullable<TextInputProps["onBlur"]>>(() => {
    if (live.current.scopeKey === scopeKey) { focused.current = null; cancel(); }
  }, [scopeKey, cancel]);
  const scrollProps: Pick<ScrollViewProps, "onLayout" | "onContentSizeChange" | "onScroll" | "onScrollBeginDrag" | "scrollEventThrottle"> = {
    onLayout: schedule,
    onContentSizeChange: (_width, height) => { contentHeight.current = height; schedule(); },
    onScroll: (event) => { offset.current = event.nativeEvent.contentOffset.y; },
    onScrollBeginDrag: () => { suspended.current = true; cancel(); },
    scrollEventThrottle: 16,
  };
  return { attachScrollRef, relatedRef, scrollProps, onInputFocus, onInputBlur, revealFocusedInput: schedule };
}
