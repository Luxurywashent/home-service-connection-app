import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mapCanonicalJobToScheduleFields } from "../lib/jobsync-company-authority";

const adminSchedule = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const authority = readFileSync(new URL("../lib/jobsync-company-authority.ts", import.meta.url), "utf8");

describe("HSC QA native linked-customer profile mapping", () => {
  it("preserves the canonical customer id through the shared schedule mapping", () => {
    const mapped = mapCanonicalJobToScheduleFields({
      id: 701,
      customerId: 4401,
      assignedUserId: 91,
      title: "Synthetic exact-profile job",
      serviceName: "Fixture service",
      status: "scheduled",
      scheduledStartAt: "2026-10-23T15:00:00.000Z",
      scheduledEndAt: "2026-10-23T16:00:00.000Z",
      updatedAt: "2026-10-23T14:00:00.000Z",
      addressLine1: "1 Synthetic Way",
      city: "Chicago",
      amount: 125,
      paidTotal: 0,
      refundTotal: 0,
      appliedEstimateCredit: 0,
      balance: 125,
      paymentStatus: "unpaid",
      customerName: "Exact Customer",
      assignedName: "Assigned Technician",
    }, "Chicago", "America/Chicago");

    expect(mapped.canonicalCustomerId).toBe(4401);
    expect(mapped.assignedTo).toBe("jobsync-91");
    expect(mapped.firstName).toBe("Exact");
    expect(mapped.lastName).toBe("Customer");
  });

  it("offers a Company-mode View profile action only with the exact mapped customer id", () => {
    expect(authority).toContain("canonicalCustomerId: job.customerId");
    expect(adminSchedule).toContain("isJobSyncCompany && Number.isSafeInteger(selectedJob.canonicalCustomerId)");
    expect(adminSchedule).toContain('pathname: "/(tabs)/admin-customer-profile" as any');
    expect(adminSchedule).toContain("params: { customerId: String(customerId) }");
    expect(adminSchedule).toContain("View linked customer profile");
  });
});
