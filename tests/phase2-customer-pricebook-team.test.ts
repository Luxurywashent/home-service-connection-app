/**
 * HSC Mobile Reconciliation — Phase 2
 * Customers / Price Book / Team Members
 *
 * Proves Company sessions consume canonical jobsync authority for Phase 2
 * modules and do not fall through to local Express/tRPC or Luxury Wash hosts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_LOCAL_FINANCIAL_MUTATIONS,
  COMPANY_PAYMENT_CONTROLS,
  COMPANY_PRICE_BOOK_WEB_AUTHORITY_NOTICE,
  companyPriceBookAllowsLocalMutation,
  companyPriceBookUsesCanonicalRead,
  companyTeamMemberUpdateOmitsClientRole,
  companyTeamMembersUseCanonicalRead,
  companyCustomersUseCanonicalRead,
  resolveCompanyJobAuthority,
} from "../lib/jobsync-company-authority";
import {
  createJobSyncCompanyCustomer,
  createJobSyncCompanyCustomerUpdatePayload,
  createJobSyncCompanyJob,
  createJobSyncCompanyMemberUpdatePayload,
  getHomeServiceConnectedPriceBook,
  getJobSyncCompanyCustomer,
  getJobSyncCompanyCustomers,
  getJobSyncCompanyMembers,
  resolveJobSyncBaseUrl,
  sanitizeCompanyMutationBody,
  updateJobSyncCompanyCustomer,
  updateJobSyncCompanyMember,
} from "../lib/jobsync-mobile-api";

const apiSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");
const authoritySource = readFileSync(new URL("../lib/jobsync-company-authority.ts", import.meta.url), "utf8");
const customersSource = readFileSync(new URL("../components/company-customers-panel.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../components/company-customer-profile-panel.tsx", import.meta.url), "utf8");
const priceBookPanelSource = readFileSync(new URL("../components/company-price-book-panel.tsx", import.meta.url), "utf8");
const priceBookScreenSource = readFileSync(new URL("../app/(tabs)/admin-pricebook.tsx", import.meta.url), "utf8");
const employeesSource = readFileSync(new URL("../app/(tabs)/admin-employees.tsx", import.meta.url), "utf8");
const addJobSource = readFileSync(new URL("../components/add-job-modal.tsx", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");

const companySession = {
  token: "company-token",
  portal: "company" as const,
  user: { id: 1, name: "Casey", email: "casey@example.com", role: "owner" as const },
  company: {
    id: 9,
    name: "HSC Demo",
    slug: "hsc-demo",
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  },
};

const canonicalCustomer = {
  id: 88,
  firstName: "Nia",
  lastName: "Wells",
  name: "Nia Wells",
  email: "nia@example.com",
  phone: "555-0100",
  addressLine1: "9 Oak",
  city: "Austin",
  region: "TX",
  postalCode: "78701",
  vehicleType: "sedan",
  vehicleMake: "Toyota",
  vehicleModel: "Camry",
  vehicleYear: "2020",
  doNotService: false,
  preferredContact: "phone",
  updatedAt: "2026-09-15T12:00:00.000Z",
  vehicle: { make: "Toyota", model: "Camry", year: "2020", type: "sedan" },
};

function mockOk(body: unknown, assert?: (url: string, init?: RequestInit) => void) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    assert?.(url, init);
    return {
      ok: true,
      json: async () => body,
    } as Response;
  });
}

function mockFail(status: number, message: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { message, code: status === 404 ? "NOT_FOUND" : "FORBIDDEN" } }),
  } as Response);
}

describe("Phase 2 — Customers", () => {
  it("1. Mobile Customer list reads canonical Company Customers", async () => {
    const fetchMock = mockOk({ customers: [canonicalCustomer] });
    try {
      const customers = await getJobSyncCompanyCustomers("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "GET" }));
      expect(customers[0]).toMatchObject({ id: 88, firstName: "Nia", addressLine1: "9 Oak", vehicleType: "sedan" });
      expect(customersSource).toContain("getJobSyncCompanyCustomers");
      expect(companyCustomersUseCanonicalRead()).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("2. Mobile Customer detail reads canonical Customer", async () => {
    const fetchMock = mockOk({ customer: canonicalCustomer });
    try {
      const customer = await getJobSyncCompanyCustomer("company-token", 88);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers/88");
      expect(customer).toMatchObject({
        id: 88,
        addressLine1: "9 Oak",
        vehicleMake: "Toyota",
        vehicleType: "sedan",
      });
      expect(profileSource).toContain("getJobSyncCompanyCustomer");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("3. Mobile-created Customer posts to canonical HSC Customer API", async () => {
    const fetchMock = mockOk({ customer: { ...canonicalCustomer, id: 91, firstName: "Mobile", lastName: "Created" } });
    try {
      const created = await createJobSyncCompanyCustomer("company-token", {
        firstName: "Mobile",
        lastName: "Created",
        email: "mobile@example.com",
        addressLine1: "12 Pine",
        city: "Austin",
        vehicleType: "suv",
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ firstName: "Mobile", lastName: "Created", addressLine1: "12 Pine", vehicleType: "suv" });
      expect(body).not.toHaveProperty("companyId");
      expect(body).not.toHaveProperty("company_id");
      expect(created.id).toBe(91);
      expect(addJobSource).toContain("createJobSyncCompanyCustomer");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("4. Web-created canonical Customer shape is readable by mobile normalizer", async () => {
    const fetchMock = mockOk({
      customers: [{
        id: 77,
        firstName: "Web",
        lastName: "Created",
        name: "Web Created",
        email: "web@example.com",
        phone: null,
        addressLine1: "1 Main",
        city: "Mobile",
        region: "AL",
        postalCode: "36602",
        vehicleType: null,
      }],
    });
    try {
      const customers = await getJobSyncCompanyCustomers("company-token");
      expect(customers[0]).toMatchObject({ id: 77, firstName: "Web", addressLine1: "1 Main", city: "Mobile" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("5. Mobile update changes canonical Customer via PATCH", async () => {
    const fetchMock = mockOk({
      customer: { ...canonicalCustomer, lastName: "Updated", addressLine1: "42 Cedar", postalCode: "78702" },
    });
    try {
      const updated = await updateJobSyncCompanyCustomer("company-token", 88, {
        firstName: "Nia",
        lastName: "Updated",
        addressLine1: "42 Cedar",
        city: "Austin",
        postalCode: "78702",
      });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/customers/88");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "PATCH" }));
      expect(updated).toMatchObject({ lastName: "Updated", addressLine1: "42 Cedar", postalCode: "78702" });
      expect(profileSource).toContain("updateJobSyncCompanyCustomer");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("6-7. Another Company's Customer cannot be read or updated", async () => {
    const readFail = mockFail(404, "Customer not found in this Company.");
    try {
      await expect(getJobSyncCompanyCustomer("company-token", 2201)).rejects.toThrow(/Customer not found|Home Service Connected/i);
    } finally {
      readFail.mockRestore();
    }
    const updateFail = mockFail(404, "Customer not found in this Company.");
    try {
      await expect(updateJobSyncCompanyCustomer("company-token", 2201, { firstName: "X", lastName: "Y" })).rejects.toThrow();
    } finally {
      updateFail.mockRestore();
    }
  });

  it("8. Client cannot choose Company through payload", () => {
    expect(() => sanitizeCompanyMutationBody({ firstName: "A", lastName: "B", companyId: 22 })).toThrow(/authenticated/i);
    expect(() => sanitizeCompanyMutationBody({ firstName: "A", lastName: "B", company_id: 22 })).toThrow(/authenticated/i);
    const payload = createJobSyncCompanyCustomerUpdatePayload({
      firstName: "A",
      lastName: "B",
      addressLine1: "1 Main",
    });
    expect(payload).not.toHaveProperty("companyId");
    expect(payload).not.toHaveProperty("company_id");
    expect(payload).not.toHaveProperty("role");
  });

  it("9. Address information survives list/detail/update contracts", async () => {
    const fetchMock = mockOk({ customer: canonicalCustomer });
    try {
      const detail = await getJobSyncCompanyCustomer("company-token", 88);
      expect(detail.addressLine1).toBe("9 Oak");
      expect(detail.city).toBe("Austin");
      expect(detail.region).toBe("TX");
      expect(detail.postalCode).toBe("78701");
      const payload = createJobSyncCompanyCustomerUpdatePayload({
        firstName: "Nia",
        lastName: "Wells",
        addressLine1: "9 Oak",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
      });
      expect(payload).toMatchObject({ addressLine1: "9 Oak", city: "Austin", region: "TX", postalCode: "78701" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("10. Vehicle/customer relationship remains canonical where supported", async () => {
    const fetchMock = mockOk({ customer: canonicalCustomer });
    try {
      const detail = await getJobSyncCompanyCustomer("company-token", 88);
      expect(detail.vehicleType).toBe("sedan");
      expect(detail.vehicleMake).toBe("Toyota");
      expect(detail.vehicleModel).toBe("Camry");
      expect(profileSource).toContain("customer.vehicleType");
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("Phase 2 — Price Book", () => {
  it("11. Mobile Price Book reads canonical Company Price Book", async () => {
    const fetchMock = mockOk({
      services: [{ id: 501, name: "Window Cleaning", basePrice: 149, isActive: true, orderIndex: 0, description: "Exterior" }],
    });
    try {
      const services = await getHomeServiceConnectedPriceBook("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/price-book");
      expect(services[0]).toMatchObject({ serviceId: "501", name: "Window Cleaning", basePrice: 149 });
      expect(companyPriceBookUsesCanonicalRead()).toBe(true);
      expect(scheduleSource).toContain("useCompanyPriceBook");
      expect(adminScheduleSource).toContain("useCompanyPriceBook");
      expect(addJobSource).toContain("useCompanyPriceBook");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("12. Web price change is represented through the same canonical authority", () => {
    expect(apiSource).toContain('const COMPANY_PRICE_BOOK_PATH = "/api/mobile/v1/price-book"');
    expect(priceBookPanelSource).toContain("useCompanyPriceBook");
    expect(priceBookPanelSource).toContain(COMPANY_PRICE_BOOK_WEB_AUTHORITY_NOTICE);
    expect(priceBookScreenSource).toContain("CompanyPriceBookPanel");
    expect(priceBookScreenSource).toContain("LegacyAdminPricebookScreen");
  });

  it("13. Company Price Book mutations stay web-authoritative; local mutations blocked", () => {
    expect(companyPriceBookAllowsLocalMutation("company")).toBe(false);
    expect(companyPriceBookAllowsLocalMutation("legacy")).toBe(true);
    expect(COMPANY_LOCAL_FINANCIAL_MUTATIONS).toEqual(expect.arrayContaining([
      "pricebook.upsert",
      "pricebook.delete",
      "pricebook.toggleActive",
      "pricebook.reorder",
    ]));
    expect(priceBookScreenSource).toContain("CompanyFinancialGate");
    expect(priceBookPanelSource).not.toContain("trpc.pricebook");
  });

  it("14. Another Company's Price Book item is not reachable via client companyId", () => {
    expect(() => sanitizeCompanyMutationBody({ priceBookServiceId: 501, companyId: 22 })).toThrow(/authenticated/i);
  });

  it("15. Job creation sends owned Price Book service ID without client companyId", async () => {
    const fetchMock = mockOk({
      job: {
        id: 44,
        customerId: 88,
        assignedUserId: null,
        title: "Window Cleaning",
        serviceName: "Window Cleaning",
        status: "scheduled",
        scheduledStartAt: "2026-10-01T14:00:00.000Z",
        scheduledEndAt: "2026-10-01T15:00:00.000Z",
        amount: 149,
        paidTotal: 0,
        refundTotal: 0,
        appliedEstimateCredit: 0,
        balance: 149,
        paymentStatus: "unpaid",
        customerName: "Nia Wells",
        assignedName: null,
        addressLine1: "9 Oak",
        city: "Austin",
        updatedAt: "2026-09-15T12:00:00.000Z",
      },
    });
    try {
      await createJobSyncCompanyJob("company-token", {
        customerId: 88,
        priceBookServiceId: 501,
        scheduledStartAt: "2026-10-01T14:00:00.000Z",
      });
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ customerId: 88, priceBookServiceId: 501 });
      expect(body).not.toHaveProperty("companyId");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/jobs");
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("Phase 2 — Team Members", () => {
  it("16. Mobile Team list reads canonical Company membership", async () => {
    const fetchMock = mockOk({
      company: { id: 9, name: "HSC Demo" },
      members: [{ id: 41, name: "Alex Tech", firstName: "Alex", lastName: "Tech", email: "alex@example.com", role: "technician", memberId: "member-alex", isActive: true }],
    });
    try {
      const roster = await getJobSyncCompanyMembers("company-token", 9);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/company/team-members");
      expect(roster.members[0]).toMatchObject({ id: 41, role: "technician" });
      expect(employeesSource).toContain("getJobSyncCompanyMembers");
      expect(companyTeamMembersUseCanonicalRead()).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("17. Team member identity matches canonical assignment identity", () => {
    expect(employeesSource).toContain("jobsync-${member.id}");
    expect(adminScheduleSource).toContain("jobsync-");
    expect(addJobSource).toContain("assignedUserId");
    expect(apiSource).toContain("assignedUserId");
  });

  it("18. Another Company's Team Member path stays company-scoped", async () => {
    const fetchMock = mockFail(404, "Team Member not found.");
    try {
      await expect(updateJobSyncCompanyMember("company-token", 9999, { firstName: "X", lastName: "Y" })).rejects.toThrow();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("19. Client cannot grant itself another role through payload manipulation", () => {
    expect(companyTeamMemberUpdateOmitsClientRole()).toBe(true);
    const payload = createJobSyncCompanyMemberUpdatePayload({
      firstName: "Alex",
      lastName: "Tech",
      email: "alex@example.com",
    });
    expect(payload).not.toHaveProperty("role");
    expect(() => sanitizeCompanyMutationBody({ firstName: "Alex", lastName: "Tech", role: "owner" })).toThrow(/authenticated/i);
    expect(employeesSource).toContain("Access role is server-derived");
    expect(employeesSource).not.toContain("role: jobSyncRoleForNativeMember(editData.role)");
  });

  it("20. Job title does not grant authorization", () => {
    expect(authoritySource).toContain("companyTeamMemberUpdateOmitsClientRole");
    expect(employeesSource).toContain("mobile cannot grant owner/dispatcher/technician");
  });

  it("21. Job assignment continues to use canonical Team Member identity", async () => {
    expect(apiSource).toContain("assignedUserId");
    expect(addJobSource).toContain("createJobSyncCompanyJob");
    expect(resolveCompanyJobAuthority({ session: companySession })).toBe("company");
  });
});

describe("Phase 2 — General", () => {
  it("22. HSC Company mode does not call Luxury Wash APIs", () => {
    expect(resolveJobSyncBaseUrl("https://luxwashapp-n2wveyqg.manus.space")).toBe("https://www.homeserviceconnected.com");
    expect(resolveJobSyncBaseUrl("https://jobwash-veysiubh.manus.space")).toBe("https://jobwash-veysiubh.manus.space");
    expect(apiSource).toContain("HSC_API_HOSTS");
  });

  it("23-25. No duplicate local Company authority introduced for Phase 2 modules", () => {
    expect(COMPANY_LOCAL_FINANCIAL_MUTATIONS).toEqual(expect.arrayContaining([
      "customers.listAll",
      "pricebook.upsert",
      "employee.create",
    ]));
    expect(companyPriceBookAllowsLocalMutation("company")).toBe(false);
    expect(COMPANY_PAYMENT_CONTROLS.card).toBe(false);
    expect(COMPANY_PAYMENT_CONTROLS.recordPayment).toBe(false);
  });
});
