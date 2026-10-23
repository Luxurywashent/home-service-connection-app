import { describe, expect, it } from "vitest";

import { companyRequestLoading, companyRequestValue } from "../lib/company-request-resource";

describe("Company request resources", () => {
  it("shows loading and no stale member detail when the selected resource key changes", () => {
    const memberA = { requestKey: "company-token:41:2", data: { id: 41, name: "Alex" } };

    expect(companyRequestValue("company-token:41:2", memberA)).toEqual({ id: 41, name: "Alex" });
    expect(companyRequestLoading("company-token:41:2", memberA)).toBe(false);

    expect(companyRequestValue("company-token:42:2", memberA)).toBeNull();
    expect(companyRequestLoading("company-token:42:2", memberA)).toBe(true);
    expect(companyRequestValue(null, memberA)).toBeNull();
    expect(companyRequestLoading(null, memberA)).toBe(false);
  });

  it("treats a new shared revision as a new roster request instead of displaying old data", () => {
    const priorRoster = { requestKey: "company-token:9:3", data: [{ id: 41, name: "Alex" }] };

    expect(companyRequestValue("company-token:9:4", priorRoster)).toBeNull();
    expect(companyRequestLoading("company-token:9:4", priorRoster)).toBe(true);
    expect(companyRequestValue("company-token:9:4", {
      requestKey: "company-token:9:4",
      data: [],
    })).toEqual([]);
  });
});
