export type JobProgressStatus = "scheduled" | "on_my_way" | "arrived" | "started" | "finished" | "cancelled";

type PersistedJobStatus = "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | string | null | undefined;

export type JobProgressTimestamps = {
  travelStartedAt?: string;
  onMyWayAt?: string;
  arrivedAt?: string;
  jobStartedAt?: string;
  jobFinishedAt?: string;
  finishedAt?: string;
};

export type JobProgressTransition = {
  nextStatus: JobProgressStatus;
  timestamps: JobProgressTimestamps;
  serverStatus: "confirmed" | "in_progress" | "completed";
};

/**
 * Advances the three user-facing job-card actions in order. The returned server
 * status is deliberately coarse because the local schedule service represents
 * travel as `confirmed` and work in progress as `in_progress`; timestamps retain
 * the detailed On My Way and Arrived milestones.
 */
export function getJobProgressTransition(
  currentStatus: JobProgressStatus,
  now: string,
): JobProgressTransition | null {
  switch (currentStatus) {
    case "scheduled":
      return {
        nextStatus: "on_my_way",
        timestamps: { travelStartedAt: now, onMyWayAt: now },
        serverStatus: "confirmed",
      };
    case "on_my_way":
      return {
        nextStatus: "arrived",
        timestamps: { arrivedAt: now, jobStartedAt: now },
        serverStatus: "in_progress",
      };
    case "arrived":
    case "started":
      return {
        nextStatus: "finished",
        timestamps: { jobFinishedAt: now, finishedAt: now },
        serverStatus: "completed",
      };
    case "finished":
    case "cancelled":
      return null;
  }
}

/**
 * Restores detailed progress after a refresh from the local schedule service.
 * The service status alone cannot distinguish travel from a scheduled job, or
 * arrived from an in-progress job, so the stamped milestones take precedence.
 */
export function restoreJobProgressStatus(
  serverStatus: PersistedJobStatus,
  timestamps: JobProgressTimestamps,
): JobProgressStatus {
  if (serverStatus === "cancelled") {
    return "cancelled";
  }
  if (serverStatus === "completed" || timestamps.finishedAt || timestamps.jobFinishedAt) {
    return "finished";
  }
  if (timestamps.arrivedAt || timestamps.jobStartedAt) {
    return "arrived";
  }
  if (timestamps.onMyWayAt || timestamps.travelStartedAt) {
    return "on_my_way";
  }
  if (serverStatus === "in_progress") {
    return "started";
  }
  return "scheduled";
}
