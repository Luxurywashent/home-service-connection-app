import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { customerContactUrl, findJobCustomerPhone } from "../lib/customer-contact";
import { getJobSyncCompanyCustomers, getJobSyncCompanyJobs, type JobSyncCompanyCustomer } from "../lib/jobsync-mobile-api";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const profile = (id: number, phone: string | null): JobSyncCompanyCustomer => ({
  id, phone, name: "Same Name", firstName: "Same", lastName: "Name", email: null, addressLine1: null, city: null,
});

describe("job-card customer contact actions", () => {
  it("resolves the phone from the exact customer ID, not a name or another profile", () => {
    const customers = [profile(10, "+1 (202) 555-0101"), profile(11, "+1 (202) 555-0102")];
    expect(findJobCustomerPhone(customers, "11")).toBe("+1 (202) 555-0102");
    expect(findJobCustomerPhone(customers, 10)).toBe("+1 (202) 555-0101");
    expect(findJobCustomerPhone(customers, 12)).toBeNull();
  });

  it("does not invent contacts for missing, malformed, or no-phone profiles", () => {
    for (const id of [null, undefined, "", "bad", -1, 0, 1.5]) expect(findJobCustomerPhone([profile(10, null)], id)).toBeNull();
    expect(findJobCustomerPhone([profile(10, null)], 10)).toBeNull();
    expect(findJobCustomerPhone([profile(10, "   ")], 10)).toBeNull();
  });

  it("opens dialer and message composer with a normalized profile phone and no body", () => {
    expect(customerContactUrl("call", "+1 (202) 555-0101")).toBe("tel:+12025550101");
    expect(customerContactUrl("message", "+1 (202) 555-0101")).toBe("sms:+12025550101");
    expect(customerContactUrl("call", "202.555.0101")).toBe("tel:2025550101");
    expect(customerContactUrl("message", "+44 20 7946 0018")).toBe("sms:+442079460018");
  });

  it("rejects missing/invalid numbers and injected message bodies or schemes", () => {
    for (const phone of [null, undefined, "", "123", "Not provided", "2025550101?body=send", "tel:2025550101", "+12025550101&body=send", "1234567890123456", "++12025550101"]) {
      expect(customerContactUrl("call", phone)).toBeNull();
      expect(customerContactUrl("message", phone)).toBeNull();
    }
  });

  it("retrieves the profile through only the current Company's bearer-scoped GET contract", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string, _options?: RequestInit) => ({
      ok: true,
      json: async () => url.includes("/company/jobs")
        ? { jobs: [{ id: 51, customerId: 11, customerName: "Same Name" }] }
        : { customers: [{ id: 11, name: "Same Name", phoneNumber: "+1 202 555 0102" }] },
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const jobs = await getJobSyncCompanyJobs("company-only-token");
      const customers = await getJobSyncCompanyCustomers("company-only-token");
      expect(findJobCustomerPhone(customers, jobs[0].customerId)).toBe("+1 202 555 0102");
      for (const [, options] of fetchSpy.mock.calls) {
        expect(options).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer company-only-token" } });
        expect(options?.body).toBeUndefined();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses shared labeled buttons in Company and technician job cards with their customer links", () => {
    for (const path of ["app/(tabs)/schedule.tsx", "app/(tabs)/admin-schedule.tsx"]) {
      const screen = source(path);
      expect(screen).toContain("customerId: String(job.customerId)");
      expect(screen).toContain("<CustomerContactActions customerId={selectedJob.customerId} phone={selectedJob.phone} requireCompanyProfile={isJobSyncCompany} />");
      expect(screen).not.toContain('Linking.openURL(`sms:${selectedJob.phone}`)');
      expect(screen).not.toContain('Linking.openURL(`tel:${selectedJob.phone}`)');
    }
  });

  it("prevents stale cross-company contact display and offers missing-phone and retry feedback", () => {
    const component = source("components/customer-contact-actions.tsx");
    expect(component).toContain("JSON.stringify([companyId, userId, token, customerId, attempt])");
    expect(component).toContain("result?.key === key ? result : null");
    expect(component).toContain("return () => { cancelled = true; }");
    expect(component).toContain("const resolvedPhone = isCompany ? currentResult?.phone : phone;");
    expect(component).toContain('accessibilityLabel="Call customer"');
    expect(component).toContain('accessibilityLabel="Message customer"');
    expect(component).toContain("No phone number on this customer's profile.");
    expect(component).toContain('await Linking.openURL(url)');
    expect(component).not.toMatch(/sendSms|sendSMS|twilio|\.mutate/);
    expect(component).toContain("setAttempt((value) => value + 1)");
  });

  it("keeps the historical reward handler intact and prevents Company IDs from reaching legacy rewards", () => {
    const schedule = source("app/(tabs)/schedule.tsx");
    expect(schedule).toContain("const fulfillRedemptionMutation = trpc.referral.fulfillRedemption.useMutation({");
    expect(schedule).toContain("enabled: !isJobSyncCompany && !!selectedJob?.customerId");
    expect(schedule).toContain("!isJobSyncCompany && !isAdminRole && selectedJob.customerId");
  });

  it("disables recommendation entry points without removing actual upsells or stored recommendations", () => {
    const schedule = source("app/(tabs)/schedule.tsx");
    expect(schedule).not.toContain("Recommend Services");
    expect(schedule).not.toContain("Recommended Services Section");
    expect(schedule).not.toContain("showRecsPanel");
    expect(schedule).not.toContain("saveRecommendations");
    expect(schedule).toContain("recommendedServices: job.recommendedIds");
    expect(schedule).toContain("+ Add Upsells");
    expect(schedule).toContain("Collect Payment");
  });
});
