import type { ReactNode } from "react";

import { CompanyAuthorityLoading } from "@/components/company-authority-state";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { resolveCompanyFinancialMountedSurface } from "@/lib/jobsync-company-authority";

export function CompanyFinancialGate({
  loadingMessage,
  company,
  legacy,
}: {
  loadingMessage: string;
  company: (token: string) => ReactNode;
  legacy: () => ReactNode;
}) {
  const { session, isLoading } = useJobSyncAuth();
  const mounted = resolveCompanyFinancialMountedSurface({ session, sessionLoading: isLoading });
  if (mounted.screen === "loading") {
    return <CompanyAuthorityLoading message={loadingMessage} />;
  }
  if (mounted.screen === "company" && session?.token) {
    return <>{company(session.token)}</>;
  }
  if (mounted.screen !== "legacy") {
    return <CompanyAuthorityLoading message={loadingMessage} />;
  }
  return <>{legacy()}</>;
}
