import React, { act, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompanyPriceBook } from "../hooks/use-company-price-book";
import type { HomeServiceConnectedPriceBookService, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";

const mocks = vi.hoisted(() => ({
  focused: true,
  session: null as JobSyncNativeSession | null,
  appState: "active",
  listeners: new Set<(state: string) => void>(),
  read: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("../lib/jobsync-auth-context", () => ({ useJobSyncAuth: () => ({ session: mocks.session }) }));
vi.mock("../lib/jobsync-mobile-api", () => ({ getHomeServiceConnectedPriceBook: mocks.read }));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() { return mocks.appState; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listeners.add(listener);
      return { remove: () => mocks.listeners.delete(listener) };
    },
  },
}));

const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const fixture = (): JobSyncNativeSession => ({
  token: "mock-only-company-token",
  portal: "company",
  user: { id: 40, name: "Fixture Owner", email: null, role: "owner" },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const service = (serviceId = "fixture-service"): HomeServiceConnectedPriceBookService => ({
  serviceId,
  name: `Service ${serviceId}`,
  emoji: "",
  description: "Offline fixture",
  features: [],
  vehiclePrices: { standard: 125 },
  imageUrl: null,
  sortOrder: 0,
  serviceTypeId: 3,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type HookValue = ReturnType<typeof useCompanyPriceBook>;
function snapshot(value: HookValue) {
  return {
    services: value.services,
    isLoading: value.isLoading,
    error: value.error,
    hasLoaded: value.hasLoaded,
    isCompanySession: value.isCompanySession,
  };
}
let root: ReturnType<typeof createRoot>;
let mounted: boolean;
let latest: HookValue;
let renderHistory: ReturnType<typeof snapshot>[];
function Harness() {
  const value = useCompanyPriceBook();
  useLayoutEffect(() => {
    latest = value;
    renderHistory.push(snapshot(value));
  });
  return <div>{value.services.map((row) => row.serviceId).join(",")}</div>;
}
async function render(session: JobSyncNativeSession | null = mocks.session, strict = false) {
  mocks.session = session;
  await act(async () => {
    root.render(strict ? <React.StrictMode><Harness /></React.StrictMode> : <Harness />);
  });
}
async function unmount() {
  await act(async () => root.unmount());
  mounted = false;
}
async function appState(next: string) {
  await act(async () => {
    mocks.appState = next;
    for (const listener of mocks.listeners) listener(next);
  });
}
function expectUnknown(loading: boolean, company = true) {
  expect(snapshot(latest)).toEqual({ services: [], isLoading: loading, error: null, hasLoaded: false, isCompanySession: company });
}

beforeEach(() => {
  mocks.focused = true;
  mocks.session = fixture();
  mocks.appState = "active";
  mocks.listeners.clear();
  mocks.read.mockReset().mockResolvedValue([service()]);
  mocks.fetch.mockReset().mockImplementation(() => { throw new Error("Network forbidden in Company Price Book hook tests"); });
  vi.stubGlobal("fetch", mocks.fetch);
  renderHistory = [];
  root = createRoot(installPhotoTestDOM().body);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await unmount();
  expect(mocks.listeners.size).toBe(0);
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("Company Price Book — real React lifecycle, mocked read-only API", () => {
  it("starts unknown/loading and publishes the exact API services only after success", async () => {
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    await render();
    expectUnknown(true);
    expect(renderHistory[0]).toEqual(snapshot(latest));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith("mock-only-company-token");
    const rows = [service("canonical")];
    await act(async () => wait.resolve(rows));
    expect(latest.services).toBe(rows);
    expect(latest.isLoading).toBe(false);
    expect(latest.hasLoaded).toBe(true);
    expect(latest.error).toBeNull();
  });

  it("labels an empty result as known-empty only after a successful read", async () => {
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    await render();
    expectUnknown(true);
    await act(async () => wait.resolve([]));
    expect(snapshot(latest)).toEqual({ services: [], isLoading: false, error: null, hasLoaded: true, isCompanySession: true });
  });

  it("does not mistake a failed read for known-empty and retries through the existing refresh signature", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Fixture read refused"));
    await render();
    expect(snapshot(latest)).toEqual({ services: [], isLoading: false, error: "Fixture read refused", hasLoaded: false, isCompanySession: true });
    const retry = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(retry.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = latest.refresh(); });
    expectUnknown(true);
    expect(pending).toBeInstanceOf(Promise);
    await act(async () => { retry.resolve([service("retried")]); await pending; });
    expect(latest.services.map((row) => row.serviceId)).toEqual(["retried"]);
    expect(latest.hasLoaded).toBe(true);
    expect(latest.error).toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("uses the existing explanatory error for non-Error rejections", async () => {
    mocks.read.mockRejectedValueOnce("offline fixture");
    await render();
    expect(latest.error).toBe("Home Service Connected could not load this Company Price Book.");
    expect(latest.hasLoaded).toBe(false);
  });

  it("does not retain successful evidence or old services after a retry fails", async () => {
    await render();
    mocks.read.mockRejectedValueOnce(new Error("Offline fixture"));
    await act(async () => { await latest.refresh(); });
    expect(latest.services).toEqual([]);
    expect(latest.isLoading).toBe(false);
    expect(latest.hasLoaded).toBe(false);
    expect(latest.error).toBe("Offline fixture");
  });

  it("resets known-empty evidence while an explicit recheck is pending", async () => {
    mocks.read.mockResolvedValueOnce([]);
    await render();
    expect(latest.hasLoaded).toBe(true);
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    await act(async () => { void latest.refresh(); });
    expectUnknown(true);
    await act(async () => wait.resolve([service("created-on-web")]));
    expect(latest.services[0].serviceId).toBe("created-on-web");
  });

  it("coalesces concurrent manual and foreground refreshes into the current request", async () => {
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    await render();
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = latest.refresh(); second = latest.refresh(); });
    expect(first).toBe(second);
    await appState("background");
    await appState("active");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => { wait.resolve([]); await first; });
    mocks.read.mockResolvedValueOnce([service("next-read")]);
    await act(async () => { await latest.refresh(); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(latest.services[0].serviceId).toBe("next-read");
  });

  it("clears its concurrent slot even when the API throws synchronously", async () => {
    mocks.read.mockImplementationOnce(() => { throw new Error("Synchronous fixture failure"); });
    await render();
    expect(latest.error).toBe("Synchronous fixture failure");
    await act(async () => { await latest.refresh(); });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(latest.hasLoaded).toBe(true);
  });

  it("re-reads on every screen focus without requiring a remount", async () => {
    mocks.read.mockResolvedValueOnce([]);
    await render();
    expect(latest.hasLoaded).toBe(true);
    mocks.focused = false;
    await render();
    expectUnknown(false);
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    mocks.focused = true;
    const start = renderHistory.length;
    await render();
    expectUnknown(true);
    expect(renderHistory[start]).toEqual(snapshot(latest));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => wait.resolve([service("web-added")]));
    expect(latest.services[0].serviceId).toBe("web-added");
  });

  it("does not refresh on ordinary rerenders of the same signed scope", async () => {
    await render();
    await render(fixture());
    await render(fixture());
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("refreshes on foreground transitions but not duplicate active notifications", async () => {
    await render();
    await appState("active");
    await appState("inactive");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await appState("active");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await appState("active");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await appState("background");
    mocks.read.mockResolvedValueOnce([service("foreground-service")]);
    await appState("active");
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(latest.services[0].serviceId).toBe("foreground-service");
  });

  it("does not read or manually retry while the screen is unfocused", async () => {
    mocks.focused = false;
    await render();
    expectUnknown(false);
    await appState("background");
    await appState("active");
    await act(async () => { await latest.refresh(); });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.focused = true;
    await render();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("is safe under StrictMode commit/cleanup replay", async () => {
    await render(fixture(), true);
    expect(latest.hasLoaded).toBe(true);
    expect(latest.services).toEqual([service()]);
    expect(mocks.listeners.size).toBe(1);
  });
});

type Change = "Company" | "token" | "user" | "portal" | "logout";
const changes: Change[] = ["Company", "token", "user", "portal", "logout"];
function changed(change: Change): JobSyncNativeSession | null {
  const next = fixture();
  if (change === "Company") next.company = { ...next.company!, id: 10 };
  if (change === "token") next.token = "mock-only-rotated-token";
  if (change === "user") next.user.id = 41;
  if (change === "portal") next.portal = "platform";
  return change === "logout" ? null : next;
}

describe("Company Price Book — identity isolation and obsolete completions", () => {
  it.each(changes)("never renders prior services/loading/loaded evidence after %s changes", async (change) => {
    await render();
    const oldRefresh = latest.refresh;
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    const next = changed(change);
    const valid = next?.portal === "company";
    const start = renderHistory.length;
    await render(next);
    expectUnknown(valid, valid);
    expect(renderHistory[start]).toEqual(snapshot(latest));
    const calls = mocks.read.mock.calls.length;
    await act(async () => { await oldRefresh(); });
    expect(mocks.read).toHaveBeenCalledTimes(calls);
    if (valid) {
      await act(async () => wait.resolve([]));
      expect(latest.hasLoaded).toBe(true);
    }
  });

  it.each(changes)("hides the old error immediately after %s changes", async (change) => {
    mocks.read.mockRejectedValueOnce(new Error("Prior scope error"));
    await render();
    expect(latest.error).toBe("Prior scope error");
    const wait = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(wait.promise);
    const next = changed(change);
    const valid = next?.portal === "company";
    const start = renderHistory.length;
    await render(next);
    expectUnknown(valid, valid);
    expect(renderHistory[start].error).toBeNull();
    if (valid) await act(async () => wait.resolve([]));
  });

  describe.each(["resolve", "reject"] as const)("late old-scope %s", (outcome) => {
    it.each(changes)("cannot alter the new snapshot after %s changes", async (change) => {
      const old = deferred<HomeServiceConnectedPriceBookService[]>();
      mocks.read.mockReturnValueOnce(old.promise);
      await render();
      const nextRead = deferred<HomeServiceConnectedPriceBookService[]>();
      mocks.read.mockReturnValueOnce(nextRead.promise);
      const next = changed(change);
      const valid = next?.portal === "company";
      await render(next);
      expectUnknown(valid, valid);
      await act(async () => {
        if (outcome === "resolve") old.resolve([service("stale-company")]);
        else old.reject(new Error("Stale Company error"));
      });
      expectUnknown(valid, valid);
      if (valid) {
        await act(async () => { void latest.refresh(); });
        // Old finally must not clear the new Company's in-flight slot.
        expect(mocks.read).toHaveBeenCalledTimes(2);
        await act(async () => nextRead.resolve([service("current-company")]));
        expect(latest.services[0].serviceId).toBe("current-company");
        expect(latest.hasLoaded).toBe(true);
      }
    });
  });

  it("an old completion cannot overwrite a newer already successful read", async () => {
    const old = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(old.promise);
    await render();
    mocks.read.mockResolvedValueOnce([service("new-company")]);
    await render(changed("Company"));
    const expected = snapshot(latest);
    await act(async () => old.reject(new Error("Old failure")));
    expect(snapshot(latest)).toEqual(expected);
  });

  it("A -> B -> A does not revive the first A request or its old refresh callback", async () => {
    const oldA = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(oldA.promise);
    await render();
    const oldRefresh = latest.refresh;
    await render(changed("Company"));
    const newA = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(newA.promise);
    await render(fixture());
    await act(async () => { oldA.resolve([service("first-A")]); await oldRefresh(); });
    expectUnknown(true);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    await act(async () => newA.resolve([service("current-A")]));
    expect(latest.services[0].serviceId).toBe("current-A");
  });

  it.each(["resolve", "reject"] as const)("does not publish a late %s while still blurred", async (outcome) => {
    const old = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(old.promise);
    await render();
    mocks.focused = false;
    await render();
    expectUnknown(false);
    const count = renderHistory.length;
    await act(async () => {
      if (outcome === "resolve") old.resolve([service("blurred")]);
      else old.reject(new Error("Blurred error"));
    });
    expectUnknown(false);
    expect(renderHistory).toHaveLength(count);
    await appState("background");
    await appState("active");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)("ignores a request that %s after blur and still starts a fresh refocus read", async (outcome) => {
    const old = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(old.promise);
    await render();
    const oldRefresh = latest.refresh;
    mocks.focused = false;
    await render();
    expectUnknown(false);
    const next = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(next.promise);
    mocks.focused = true;
    await render();
    expectUnknown(true);
    await act(async () => {
      if (outcome === "resolve") old.resolve([service("blurred")]);
      else old.reject(new Error("Blurred failure"));
      await oldRefresh();
      void latest.refresh();
    });
    expectUnknown(true);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve([]));
    expect(latest.hasLoaded).toBe(true);
  });

  it.each(["resolve", "reject"] as const)("suppresses post-unmount %s and unsubscribes from AppState", async (outcome) => {
    const old = deferred<HomeServiceConnectedPriceBookService[]>();
    mocks.read.mockReturnValueOnce(old.promise);
    await render();
    const retainedRefresh = latest.refresh;
    const before = snapshot(latest);
    const count = renderHistory.length;
    await unmount();
    expect(mocks.listeners.size).toBe(0);
    await act(async () => {
      if (outcome === "resolve") old.resolve([service("unmounted")]);
      else old.reject(new Error("Unmounted failure"));
      await retainedRefresh();
    });
    await appState("background");
    await appState("active");
    expect(renderHistory).toHaveLength(count);
    expect(snapshot(latest)).toEqual(before);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("does not read without a positive integer Company identity (%s)", async (id) => {
    const next = fixture();
    next.company = { ...next.company!, id };
    await render(next);
    expectUnknown(false);
    await act(async () => { await latest.refresh(); });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("does not read a missing Company, blank token, or invalid user identity", async () => {
    for (const next of [
      { ...fixture(), company: undefined },
      { ...fixture(), token: " " },
      { ...fixture(), user: { ...fixture().user, id: 0 } },
    ]) {
      await render(next);
      expectUnknown(false);
      await act(async () => { await latest.refresh(); });
    }
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
