import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getJobSyncCompanyCustomer,
  getJobSyncCompanyCustomers,
  normalizeJobSyncCompanyCustomers,
} from "../lib/jobsync-mobile-api";

const fetchMock = vi.fn();
const bearer = "fixture-only-customer-prefill-bearer";
const wireCustomer = (patch: Record<string, unknown> = {}) => ({
  id: 12, companyId: 9, name: "Canonical customer", firstName: "Canonical", lastName: "customer",
  email: "fixture@example.invalid", phone: "fixture-phone", addressLine1: "Fixture street", city: "Fixture city",
  region: "TX", postalCode: "75001", vehicleType: "suv", updatedAt: "2026-11-15T20:00:00.000Z", ...patch,
});
const response = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
beforeEach(() => {
  fetchMock.mockReset();
  // Every transport is mocked and unexpected requests reject instead of reaching a live endpoint.
  fetchMock.mockRejectedValue(new Error("Unexpected customer request"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const [, init] of fetchMock.mock.calls) {
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  }
  vi.unstubAllGlobals();
});

describe("Company customer prefill API: exact bearer-scoped read and complete normalized DTO", () => {
  it("reads only the requested canonical detail, preserves full fields and wire Company provenance", async () => {
    fetchMock.mockResolvedValueOnce(response({ customer: wireCustomer() }));
    await expect(getJobSyncCompanyCustomer(bearer, 12)).resolves.toEqual(wireCustomer());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/mobile/v1/customers/12");
    expect(new URL(url).search).toBe("");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" } });
    expect(url).not.toContain(bearer);
  });

  it("preserves an explicit different Company ID so the caller can reject it, never substitutes its own Company", async () => {
    fetchMock.mockResolvedValueOnce(response({ customer: wireCustomer({ companyId: 99 }) }));
    const result = await getJobSyncCompanyCustomer(bearer, 12);
    expect(result.companyId).toBe(99);
    expect(result.id).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps optional compatibility fields nullable and leaves absent Company provenance absent", async () => {
    fetchMock.mockResolvedValueOnce(response({ customer: { id: 12, name: "Customer" } }));
    await expect(getJobSyncCompanyCustomer(bearer, 12)).resolves.toEqual({
      id: 12, name: "Customer", firstName: "Customer", lastName: "", email: null, phone: null,
      addressLine1: null, city: null, region: null, postalCode: null, vehicleType: null, updatedAt: null,
    });
  });

  it("normalizes string IDs and preserves positive snake-case Company provenance and customer fields", () => {
    expect(normalizeJobSyncCompanyCustomers({ data: { customers: [{
      customer_id: "12", company_id: "99", first_name: "Fixture", last_name: "Customer", phoneNumber: "fixture-phone",
      address_line1: "Fixture street", city: "Fixture city", state: "TX", postal_code: "75001",
      vehicle_type: "suv", updated_at: "2026-11-15T20:00:00.000Z",
    }] } })).toEqual([{
      id: 12, companyId: 99, name: "Fixture Customer", firstName: "Fixture", lastName: "Customer",
      phone: "fixture-phone", email: null, addressLine1: "Fixture street", city: "Fixture city", region: "TX",
      postalCode: "75001", vehicleType: "suv", updatedAt: "2026-11-15T20:00:00.000Z",
    }]);
  });

  it.each([0, -1, 1.5, "bad", "1e2", Number.MAX_SAFE_INTEGER + 1, null])(
    "does not invent positive Company provenance for invalid wire value %s", (companyId) => {
      const result = normalizeJobSyncCompanyCustomers({ customers: [wireCustomer({ companyId })] })[0];
      expect(result.companyId).toBeUndefined();
    },
  );

  it.each([0, -1, 1.5, "bad", "1e2", Number.MAX_SAFE_INTEGER + 1, null])(
    "rejects invalid canonical wire customer ID %s", async (id) => {
      fetchMock.mockResolvedValueOnce(response({ customer: wireCustomer({ id }) }));
      await expect(getJobSyncCompanyCustomer(bearer, 12)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { customer: wireCustomer({ id: 13 }) },
    { customers: [wireCustomer()] },
    { customer: null },
    {},
  ])("rejects mismatched or absent exact detail, without list/name fallback %#", async (payload) => {
    fetchMock.mockResolvedValueOnce(response(payload));
    await expect(getJobSyncCompanyCustomer(bearer, 12)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("does not send a detail request for invalid selected ID %s", async (id) => {
    await expect(getJobSyncCompanyCustomer(bearer, id)).rejects.toThrow("existing Company customer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a request with an absent bearer", async () => {
    await expect(getJobSyncCompanyCustomer(" ", 12)).rejects.toThrow("existing Company customer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500])("passes through mocked HTTP %s denial/error without retry or list fallback", async (status) => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "FIXTURE_DENIED", message: "Fixture denied" } }, status));
    await expect(getJobSyncCompanyCustomer(bearer, 12)).rejects.toMatchObject({ status, code: "FIXTURE_DENIED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Company customer list transport remains read-only, complete and bounded", () => {
  it("keeps full list DTO fields, follows existing encoded cursor, deduplicates IDs, and uses bearer-only scope on every page", async () => {
    fetchMock.mockResolvedValueOnce(response({ customers: [wireCustomer()], page: { nextCursor: "fixture/cursor?next=1" } }))
      .mockResolvedValueOnce(response({ customers: [wireCustomer({ name: "Updated customer" }), wireCustomer({ id: 13 })], page: { nextCursor: null } }));
    const rows = await getJobSyncCompanyCustomers(bearer);
    expect(rows).toEqual([wireCustomer({ name: "Updated customer" }), wireCustomer({ id: 13 })]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(fetchMock.mock.calls[1][0]);
    expect(second.pathname).toBe("/api/mobile/v1/customers");
    expect(second.searchParams.get("cursor")).toBe("fixture/cursor?next=1");
    expect([...second.searchParams.keys()]).toEqual(["cursor"]);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBe(`Bearer ${bearer}`);
  });

  it("rejects a missing array rather than returning partial/known-empty list", async () => {
    fetchMock.mockResolvedValueOnce(response({ customers: [wireCustomer()], page: { nextCursor: "next" } }))
      .mockResolvedValueOnce(response({ data: { customers: [wireCustomer({ id: 13 })] } }));
    await expect(getJobSyncCompanyCustomers(bearer)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["", 1, "x".repeat(4097)])("rejects invalid next cursor without speculative requests %#", async (nextCursor) => {
    fetchMock.mockResolvedValueOnce(response({ customers: [wireCustomer()], page: { nextCursor } }));
    await expect(getJobSyncCompanyCustomers(bearer)).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated cursors rather than looping or accepting partial records", async () => {
    fetchMock.mockResolvedValue(response({ customers: [wireCustomer()], page: { nextCursor: "same" } }));
    await expect(getJobSyncCompanyCustomers(bearer)).rejects.toMatchObject({ code: "INVALID_PAGINATION" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains the existing twenty-page cap and rejects instead of returning a partial list", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => response({ customers: [wireCustomer({ id: ++page })], page: { nextCursor: `cursor-${page}` } }));
    await expect(getJobSyncCompanyCustomers(bearer)).rejects.toMatchObject({ code: "CUSTOMER_REFRESH_LIMIT" });
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});
