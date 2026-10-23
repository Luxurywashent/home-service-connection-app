import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyCalendarSlot } from "../lib/company-calendar";
import { companyScheduleDateTime, mapCanonicalJobToScheduleFields } from "../lib/jobsync-company-authority";

const adminScheduleSource = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");

const canonicalJob = {
  id: 101,
  customerId: 8,
  assignedUserId: 41,
  title: "Synthetic appointment",
  serviceName: "Synthetic appointment",
  status: "scheduled",
  scheduledStartAt: "2026-10-02T19:00:00.000Z",
  scheduledEndAt: "2026-10-02T20:00:00.000Z",
  updatedAt: "2026-10-02T12:00:00.000Z",
  addressLine1: "1 Main St",
  city: "Austin",
  amount: 0,
  paidTotal: 0,
  refundTotal: 0,
  appliedEstimateCredit: 0,
  balance: 0,
  paymentStatus: "unpaid",
  customerName: "Synthetic Customer",
  assignedName: "Synthetic Technician",
};

describe("HSC scheduling mobile authority regressions", () => {
  it("keeps a Chicago-local 14:00 canonical appointment at 14:00 on the Company calendar", () => {
    expect(companyScheduleDateTime("2026-10-02", 14, "America/Chicago")).toBe("2026-10-02T19:00:00.000Z");
    expect(companyCalendarSlot(canonicalJob.scheduledStartAt, canonicalJob.scheduledEndAt, "America/Chicago")).toEqual({
      date: "2026-10-02",
      startHour: 14,
      endHour: 15,
    });
    expect(mapCanonicalJobToScheduleFields(canonicalJob, "", "America/Chicago").startHour).toBe(14);
  });

  it("does not remap a canonical cancelled Job into the active admin schedule", () => {
    expect(mapCanonicalJobToScheduleFields({ ...canonicalJob, status: "cancelled" }, "", "America/Chicago").status).toBe("cancelled");
    expect(adminScheduleSource).toContain('serverJobs.filter((job) => job.status !== "cancelled")');
  });
});
