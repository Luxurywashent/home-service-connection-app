export type JobSyncSessionGenerationGuard = {
  snapshot: () => number;
  advance: () => number;
  isCurrent: (snapshot: number) => boolean;
};

/** Prevent an in-flight auth request from overwriting a newer logout or login. */
export function createJobSyncSessionGenerationGuard(): JobSyncSessionGenerationGuard {
  let current = 0;
  return {
    snapshot: () => current,
    advance: () => {
      current += 1;
      return current;
    },
    isCurrent: (snapshot) => snapshot === current,
  };
}
