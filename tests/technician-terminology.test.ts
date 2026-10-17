import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Technician terminology", () => {
  it("uses Technician in Company scheduling and team-management labels", () => {
    const schedule = readProjectSource("app/(tabs)/admin-schedule.tsx");
    const addJob = readProjectSource("components/add-job-modal.tsx");
    const employees = readProjectSource("app/(tabs)/admin-employees.tsx");
    const locations = readProjectSource("app/(tabs)/admin-locations.tsx");

    for (const source of [schedule, addJob, employees, locations]) {
      expect(source).not.toContain("Assign Detailer");
      expect(source).not.toContain("No active detailers found");
    }

    expect(schedule).toContain("Assign Technician");
    expect(addJob).toContain("Assign Technician");
    expect(employees).toContain('case "detailer": return "Technician";');
    expect(locations).toContain('title="Assign Technicians"');
  });

  it("uses Technician in customer tracking, messages, and job status copy", () => {
    const tracking = readProjectSource("app/(customer)/track/[jobId].tsx");
    const job = readProjectSource("app/(customer)/job/[id].tsx");
    const bookings = readProjectSource("app/(customer)/bookings.tsx");
    const schedule = readProjectSource("app/(tabs)/schedule.tsx");

    for (const source of [tracking, job, bookings, schedule]) {
      expect(source).not.toContain("Your Detailer");
      expect(source).not.toContain("Track Your Detailer");
      expect(source).not.toContain("Message your detailer");
    }

    expect(tracking).toContain("Track Your Technician");
    expect(job).toContain("Message Your Technician");
    expect(schedule).toContain('senderName: employee?.fullName ?? "Technician"');
    expect(schedule).toContain('detailerName: employee?.fullName ?? "Your technician"');
  });
});
