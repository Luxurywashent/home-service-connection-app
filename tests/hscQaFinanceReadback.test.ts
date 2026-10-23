import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getJobSyncCompanyInvoices } from "../lib/jobsync-mobile-api";

const invoicesScreen = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("HSC finance invoice readback", () => {
  it("HSC-DEF-014 reads a newly persisted canonical unpaid customer invoice in the native Company invoice surface", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        invoices: [{
          id: 401,
          customerId: 1101,
          customerName: "QA Customer",
          title: "Invoice · Wash",
          serviceName: "Wash",
          status: "scheduled",
          paymentStatus: "unpaid",
          scheduledStartAt: "2026-10-22T15:00:00.000Z",
          total: 159.9,
          paid: 0,
          balance: 159.9,
        }],
      }),
    } as Response);

    await expect(getJobSyncCompanyInvoices("company-token")).resolves.toEqual([expect.objectContaining({
      id: 401, customerId: 1101, customerName: "QA Customer", paymentStatus: "unpaid", total: 159.9, paid: 0, balance: 159.9,
    })]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/invoices");
  });

  it("keeps Company invoice readback canonical and blocks the legacy local create modal for Company authority", () => {
    expect(invoicesScreen).toContain("getJobSyncCompanyInvoices(jobSyncSession.token)");
    expect(invoicesScreen).toContain("const [companyInvoices, setCompanyInvoices]");
    expect(invoicesScreen).toContain("{allowLegacy && (");
    expect(invoicesScreen).toContain("Job invoices come from canonical Job balances");
  });
});
