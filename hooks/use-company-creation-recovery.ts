import { useEffect } from "react";
import { companyCreateJobAllowed, createCompanyJobController } from "@/lib/company-create-job";
import type { JobSyncNativeSession } from "@/lib/jobsync-mobile-api";

/** Restore only this signed actor's encrypted/native-protected attempt on login or restart.
 * Calendar reconciliation belongs to the existing screen; this background reader
 * must not mark a detail/status GET as a successfully refreshed calendar.
 */
export function useCompanyCreationRecovery(session: JobSyncNativeSession | null, isLoading: boolean) {
  useEffect(() => {
    if (isLoading || !companyCreateJobAllowed(session)) return;
    let active = true;
    const controller = createCompanyJobController({
      session,
      isCurrent: () => active,
      verifyAssignment: async () => false,
      onState: () => {},
      onCreated: () => false,
    });
    void controller.restore().catch(() => {
      // The controller preserves a fail-closed attempt/error state. Never clear
      // local recovery information or send creation as a startup fallback.
    });
    return () => { active = false; controller.detach(); };
  }, [session, isLoading]);
}
