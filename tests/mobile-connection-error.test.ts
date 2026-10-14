import { describe, expect, it } from "vitest";

import { getMobileConnectionErrorMessage } from "../lib/mobile-connection-error";

describe("mobile connection error presentation", () => {
  it("replaces native iOS connection exceptions with a concise retry message", () => {
    expect(
      getMobileConnectionErrorMessage(
        new Error("fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)"),
        "Unable to refresh your time status.",
      ),
    ).toBe("Connection lost. Your Schedule is still available; check your internet connection and retry.");
  });

  it("explains timeouts without showing native abort details", () => {
    expect(
      getMobileConnectionErrorMessage(new Error("AbortError: The operation was aborted"), "Unable to refresh your time status."),
    ).toBe("Home Service Connected is taking too long to respond. Your Schedule is still available; please retry.");
  });

  it("keeps an actionable server message when the problem is not a connection failure", () => {
    expect(
      getMobileConnectionErrorMessage(new Error("Your session has expired."), "Unable to refresh your time status."),
    ).toBe("Your session has expired.");
  });
});
