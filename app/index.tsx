import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useEffect, useRef } from "react";
import { useEmployeeAuth } from "@/lib/auth-context";
import { getNativeEmployeeSession, useJobSyncAuth } from "@/lib/jobsync-auth-context";

/**
 * Home Service Connection starts at sign-in. The copied public sales landing
 * page is intentionally not part of this independent CRM experience.
 */
export default function IndexRoute() {
  const { session, isLoading } = useJobSyncAuth();
  const { employee, login: establishNativeRole } = useEmployeeAuth();
  const bridgedEmployeeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nativeEmployee = session ? getNativeEmployeeSession(session) : null;
    if (!nativeEmployee || employee?.employeeId === nativeEmployee.employeeId) return;
    if (bridgedEmployeeIdRef.current === nativeEmployee.employeeId) return;

    bridgedEmployeeIdRef.current = nativeEmployee.employeeId;
    void establishNativeRole(nativeEmployee, true).catch(() => {
      bridgedEmployeeIdRef.current = null;
    });
  }, [employee?.employeeId, establishNativeRole, session]);

  if (isLoading) return <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/login" />;
  if (session.portal === "platform") return <Redirect href="/platform-dashboard" />;
  const nativeEmployee = getNativeEmployeeSession(session);
  if (!nativeEmployee || employee?.employeeId !== nativeEmployee.employeeId) return <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator /></View>;
  if (nativeEmployee.role === "detailer") return <Redirect href="/(tabs)" />;
  return <Redirect href={nativeEmployee.role === "operations_manager" ? "/(tabs)/ops-dashboard" : "/(tabs)/admin-dashboard"} />;
}
