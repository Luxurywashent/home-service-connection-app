import { describe, expect, it } from "vitest";

import { getJobProgressTransition, restoreJobProgressStatus } from "../lib/job-progress";

const now = "2026-10-04T01:00:00.000Z";

describe("job-card progress actions", () => {
  it("advances On My Way, Arrived, and Finish with durable milestones", () => {
    expect(getJobProgressTransition("scheduled", now)).toEqual({
      nextStatus: "on_my_way",
      timestamps: { travelStartedAt: now, onMyWayAt: now },
      serverStatus: "confirmed",
    });
    expect(getJobProgressTransition("on_my_way", now)).toEqual({
      nextStatus: "arrived",
      timestamps: { arrivedAt: now, jobStartedAt: now },
      serverStatus: "in_progress",
    });
    expect(getJobProgressTransition("arrived", now)).toEqual({
      nextStatus: "finished",
      timestamps: { jobFinishedAt: now, finishedAt: now },
      serverStatus: "completed",
    });
  });

  it("does not advance a completed job", () => {
    expect(getJobProgressTransition("finished", now)).toBeNull();
  });

  it("preserves a cancelled job as non-actionable", () => {
    expect(getJobProgressTransition("cancelled", now)).toBeNull();
    expect(restoreJobProgressStatus("cancelled", {})).toBe("cancelled");
  });

  it("restores detailed progress from stamped milestones after refresh", () => {
    expect(restoreJobProgressStatus("confirmed", { onMyWayAt: now })).toBe("on_my_way");
    expect(restoreJobProgressStatus("in_progress", { arrivedAt: now, jobStartedAt: now })).toBe("arrived");
    expect(restoreJobProgressStatus("completed", { finishedAt: now })).toBe("finished");
  });
});
