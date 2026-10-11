import { useCallback, useEffect, useMemo, useState } from "react";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  getJobSyncCompanyFeatureAccess,
} from "@/lib/jobsync-mobile-api";

export const MOBILE_TAB_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "schedule", label: "Schedule" },
  { key: "team_chat", label: "Team Chat" },
  { key: "timesheets", label: "Timesheets" },
  { key: "finance", label: "Finance" },
  { key: "invoices", label: "Invoices" },
  { key: "unpaid_jobs", label: "Unpaid Jobs" },
  { key: "customers", label: "Customers" },
  { key: "time_off", label: "Time Off" },
  { key: "team_members", label: "Team Members" },
  { key: "eod_review", label: "EOD Review" },
  { key: "reporting", label: "Reporting" },
  { key: "price_book", label: "Price Book" },
  { key: "expenses", label: "Expenses" },
  { key: "training", label: "Training" },
  { key: "door_hangers", label: "Door Hangers" },
  { key: "referrals", label: "Referrals" },
  { key: "request_off", label: "Request Off" },
  { key: "settings", label: "Settings" },
] as const;

export type MobileTabKey = (typeof MOBILE_TAB_DEFINITIONS)[number]["key"];

export function mobileTabKeyForRoute(route: string): MobileTabKey | null {
  const normalized = route.replace(/^\/\(sales\)/, "");
  if (normalized === "/" || normalized === "/admin-dashboard" || normalized === "/ops-dashboard") return "dashboard";
  if (normalized.includes("schedule")) return "schedule";
  if (normalized.includes("chat")) return "team_chat";
  if (normalized.includes("timesheet")) return "timesheets";
  if (normalized.includes("finance")) return "finance";
  if (normalized.includes("unpaid")) return "unpaid_jobs";
  if (normalized.includes("invoice")) return "invoices";
  if (normalized.includes("customer")) return "customers";
  if (normalized.includes("timeoff") || normalized.includes("request-off")) return "time_off";
  if (normalized.includes("employee")) return "team_members";
  if (normalized.includes("eod")) return "eod_review";
  if (normalized.includes("report")) return "reporting";
  if (normalized.includes("pricebook")) return "price_book";
  if (normalized.includes("expense")) return "expenses";
  if (normalized.includes("training")) return "training";
  if (normalized.includes("door-hanger")) return "door_hangers";
  if (normalized.includes("referral")) return "referrals";
  if (normalized.includes("profile")) return "settings";
  return null;
}

export function useMobileTabAccess() {
  const { session } = useJobSyncAuth();
  const token = session?.portal === "company" ? session.token : null;
  const [tabs, setTabs] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setTabs({});
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const access = await getJobSyncCompanyFeatureAccess(token);
      setTabs(access.mobileTabs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load mobile tab settings.");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const isVisible = useCallback((key: string) => tabs[key] !== false, [tabs]);
  const visibleTabs = useMemo(() => MOBILE_TAB_DEFINITIONS.filter((tab) => isVisible(tab.key)), [isVisible]);

  return { tabs, visibleTabs, isVisible, refresh, isLoading, error };
}
