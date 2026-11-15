import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "android" },
  appState: { currentState: "active", addEventListener: vi.fn() },
  location: {
    requestForegroundPermissionsAsync: vi.fn(),
    requestBackgroundPermissionsAsync: vi.fn(),
    watchPositionAsync: vi.fn(),
    getCurrentPositionAsync: vi.fn(),
    Accuracy: { High: 4, Balanced: 3 },
  },
}));
vi.mock("react-native", () => ({ Platform: mocks.platform, AppState: mocks.appState }));
vi.mock("expo-location", () => mocks.location);
import { createForegroundLocationSession } from "../lib/foreground-location-session";

const position = { coords: { latitude: 30, longitude: -86 } } as any;
let onAppState: ((state: string) => void) | undefined;
let removeListener: ReturnType<typeof vi.fn>;
let subscriptions: { remove: ReturnType<typeof vi.fn>; callback: (location: any) => void }[];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const changeState = (state: string) => {
  mocks.appState.currentState = state;
  onAppState?.(state);
};
const options = () => ({
  key: "employee-1:job-1",
  onReady: vi.fn().mockResolvedValue(undefined),
  onLocation: vi.fn(),
  onStarted: vi.fn(),
});
const setup = () => {
  const session = createForegroundLocationSession();
  session.mount();
  return session;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = "android";
  mocks.appState.currentState = "active";
  onAppState = undefined;
  removeListener = vi.fn();
  subscriptions = [];
  mocks.appState.addEventListener.mockImplementation((_event, callback) => {
    onAppState = callback;
    return { remove: removeListener };
  });
  mocks.location.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mocks.location.getCurrentPositionAsync.mockResolvedValue(position);
  mocks.location.watchPositionAsync.mockImplementation(async (_config, callback) => {
    const sub = { remove: vi.fn(), callback };
    subscriptions.push(sub);
    return sub;
  });
});

describe("Android foreground sharing lifecycle", () => {
  it("starts only on a user action while active, with foreground permission and existing watch cadence", async () => {
    const session = setup();
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    changeState("background");
    await session.start(options());
    expect(mocks.location.watchPositionAsync).not.toHaveBeenCalled();
    changeState("active");
    const handlers = options();
    await session.start(handlers);
    expect(mocks.location.watchPositionAsync.mock.calls[0][0]).toEqual({ accuracy: 4, timeInterval: 5000, distanceInterval: 10 });
    subscriptions[0].callback(position);
    expect(handlers.onLocation).toHaveBeenCalledWith(position);
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(handlers.onStarted).toHaveBeenCalledOnce();
    expect(mocks.location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    session.dispose();
  });

  it.each(["background", "inactive", "unknown"])("pauses for %s and resumes the same sharing session without another permission or token", async (state) => {
    const session = setup();
    const handlers = options();
    await session.start(handlers);
    changeState(state);
    expect(subscriptions[0].remove).toHaveBeenCalledOnce();
    subscriptions[0].callback(position);
    expect(handlers.onLocation).not.toHaveBeenCalled();
    changeState("active");
    await flush();
    expect(subscriptions).toHaveLength(2);
    subscriptions[0].callback(position);
    expect(handlers.onLocation).not.toHaveBeenCalled();
    subscriptions[1].callback(position);
    expect(handlers.onLocation).toHaveBeenCalledOnce();
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    session.dispose();
  });

  it("guards callbacks using current AppState even before the event listener runs", async () => {
    const session = setup();
    const handlers = options();
    await session.start(handlers);
    mocks.appState.currentState = "background";
    subscriptions[0].callback(position);
    expect(handlers.onLocation).not.toHaveBeenCalled();
    session.dispose();
  });

  it("removes resources on unmount and never resumes or accepts stale callbacks", async () => {
    const session = setup();
    const handlers = options();
    await session.start(handlers);
    session.dispose();
    expect(subscriptions[0].remove).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    subscriptions[0].callback(position);
    changeState("active");
    await flush();
    expect(handlers.onLocation).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(1);
  });

  it("does not restart after an explicit stop and invalidates pending session guards", async () => {
    const session = setup();
    const handlers = options();
    await session.start(handlers);
    const isCurrent = handlers.onReady.mock.calls[0][0];
    session.stop();
    expect(isCurrent()).toBe(false);
    changeState("background");
    changeState("active");
    await flush();
    subscriptions[0].callback(position);
    expect(handlers.onLocation).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(1);
    session.dispose();
  });

  it("deduplicates repeated starts for the same job, including pending permission", async () => {
    const permission = deferred<any>();
    mocks.location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise);
    const session = setup();
    const handlers = options();
    const first = session.start(handlers);
    const second = session.start(handlers);
    permission.resolve({ status: "granted" });
    await Promise.all([first, second]);
    await session.start(handlers);
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(1);
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    session.dispose();
  });

  it("defers permission results received in background, then resumes without prompting again", async () => {
    const permission = deferred<any>();
    mocks.location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise);
    const session = setup();
    const handlers = options();
    const start = session.start(handlers);
    changeState("background");
    permission.resolve({ status: "granted" });
    await start;
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(0);
    changeState("active");
    await flush();
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(1);
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    session.dispose();
  });

  it.each(["stop", "unmount"])("does not prepare tokens or watch after %s while permission is pending", async (action) => {
    const permission = deferred<any>();
    mocks.location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise);
    const session = setup();
    const handlers = options();
    const start = session.start(handlers);
    if (action === "stop") session.stop(); else session.dispose();
    permission.resolve({ status: "granted" });
    await start;
    expect(handlers.onReady).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(0);
    session.dispose();
  });

  it("waits for one in-flight token preparation across background/resume without duplicating it", async () => {
    const ready = deferred<void>();
    const session = setup();
    const handlers = options();
    handlers.onReady.mockReturnValue(ready.promise);
    const start = session.start(handlers);
    await flush();
    changeState("background");
    changeState("active");
    ready.resolve();
    await start;
    await flush();
    expect(handlers.onReady).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(1);
    expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    session.dispose();
  });

  it.each(["background", "stop", "unmount"])("removes a late watch subscription resolving after %s and rejects its callback", async (state) => {
    const watch = deferred<any>();
    const remove = vi.fn();
    mocks.location.watchPositionAsync.mockReturnValue(watch.promise);
    const session = setup();
    const handlers = options();
    const start = session.start(handlers);
    await flush();
    const callback = mocks.location.watchPositionAsync.mock.calls[0][1];
    if (state === "unmount") session.dispose();
    else if (state === "stop") session.stop();
    else changeState("background");
    callback(position);
    watch.resolve({ remove });
    await start;
    expect(remove).toHaveBeenCalledOnce();
    expect(handlers.onLocation).not.toHaveBeenCalled();
    expect(handlers.onStarted).not.toHaveBeenCalled();
    session.dispose();
  });

  it("serializes resume with a stale pending watch and removes it before creating a new one", async () => {
    const watch = deferred<any>();
    const remove = vi.fn();
    mocks.location.watchPositionAsync.mockReturnValueOnce(watch.promise);
    const session = setup();
    const handlers = options();
    const start = session.start(handlers);
    await flush();
    const staleCallback = mocks.location.watchPositionAsync.mock.calls[0][1];
    changeState("background");
    changeState("active");
    changeState("active");
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
    watch.resolve({ remove });
    await start;
    await flush();
    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.location.watchPositionAsync).toHaveBeenCalledTimes(2);
    staleCallback(position);
    expect(handlers.onLocation).not.toHaveBeenCalled();
    expect(handlers.onReady).toHaveBeenCalledOnce();
    session.dispose();
  });

  it("rejects a late old-job subscription when another sharing session replaces it", async () => {
    const watch = deferred<any>();
    const remove = vi.fn();
    mocks.location.watchPositionAsync.mockReturnValueOnce(watch.promise);
    const session = setup();
    const first = options();
    const start = session.start(first);
    await flush();
    const callback = mocks.location.watchPositionAsync.mock.calls[0][1];
    await session.start({ ...options(), key: "employee-1:job-2" });
    watch.resolve({ remove });
    await start;
    callback(position);
    expect(remove).toHaveBeenCalledOnce();
    expect(first.onLocation).not.toHaveBeenCalled();
    session.dispose();
  });

  it("requires another explicit user start after a permission error instead of prompting on resume", async () => {
    const permission = deferred<any>();
    mocks.location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise);
    const session = setup();
    const handlers = options();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const start = session.start(handlers);
      changeState("background");
      changeState("active");
      permission.reject(new Error("permission failed"));
      await start;
      changeState("background");
      changeState("active");
      await flush();
      expect(mocks.location.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
      expect(handlers.onReady).not.toHaveBeenCalled();
      expect(mocks.location.watchPositionAsync).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); session.dispose(); }
  });

  it("does not auto-retry a denied permission or native watch error", async () => {
    const session = setup();
    const handlers = options();
    mocks.location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    await session.start(handlers);
    changeState("background"); changeState("active");
    await flush();
    expect(handlers.onReady).not.toHaveBeenCalled();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.location.watchPositionAsync.mockRejectedValueOnce(new Error("watch failed"));
      await session.start(handlers);
      await flush();
      expect(mocks.location.watchPositionAsync).toHaveBeenCalledOnce();
    } finally { warning.mockRestore(); session.dispose(); }
  });
});

describe("final foreground position used by explicit Arrived/stop", () => {
  it("returns the final position when active, or unavailable on denied permission", async () => {
    const session = setup();
    expect(await session.getCurrentPosition()).toEqual({ status: "available", location: position });
    mocks.location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    expect(await session.getCurrentPosition()).toEqual({ status: "unavailable" });
    session.dispose();
  });

  it("does not request permission or a position when already backgrounded", async () => {
    const session = setup();
    changeState("background");
    expect(await session.getCurrentPosition()).toEqual({ status: "cancelled" });
    expect(mocks.location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.location.getCurrentPositionAsync).not.toHaveBeenCalled();
    session.dispose();
  });

  it("does not start a current-position lookup if its permission resolves after backgrounding", async () => {
    const permission = deferred<any>();
    mocks.location.requestForegroundPermissionsAsync.mockReturnValue(permission.promise);
    const session = setup();
    const final = session.getCurrentPosition();
    changeState("background");
    permission.resolve({ status: "granted" });
    expect(await final).toEqual({ status: "cancelled" });
    expect(mocks.location.getCurrentPositionAsync).not.toHaveBeenCalled();
    session.dispose();
  });

  it.each(["background", "inactive", "unmount", "background-resume"])("rejects a final position resolving after %s", async (state) => {
    const current = deferred<any>();
    mocks.location.getCurrentPositionAsync.mockReturnValue(current.promise);
    const session = setup();
    const final = session.getCurrentPosition();
    await flush();
    if (state === "unmount") session.dispose();
    else { changeState(state === "background-resume" ? "background" : state); }
    if (state === "background-resume") changeState("active");
    current.resolve(position);
    expect(await final).toEqual({ status: "cancelled" });
    session.dispose();
  });

  it("invalidates the caller's final-upload guard even if it backgrounds after the position resolves", async () => {
    const session = setup();
    const allowed = session.captureForegroundGuard();
    expect(await session.getCurrentPosition()).toEqual({ status: "available", location: position });
    changeState("background"); changeState("active");
    expect(allowed()).toBe(false);
    session.dispose();
  });
});

describe("iOS/web foreground GPS preservation", () => {
  it.each(["ios", "web"])("does not add an Android pause listener or suppress existing %s callbacks on background", async (platform) => {
    mocks.platform.OS = platform;
    const session = setup();
    const handlers = options();
    await session.start(handlers);
    expect(mocks.appState.addEventListener).not.toHaveBeenCalled();
    changeState("background");
    subscriptions[0].callback(position);
    expect(handlers.onLocation).toHaveBeenCalledOnce();
    expect(subscriptions[0].remove).not.toHaveBeenCalled();
    expect(await session.getCurrentPosition()).toEqual({ status: "available", location: position });
    session.dispose();
    expect(subscriptions[0].remove).toHaveBeenCalledOnce();
  });
});
