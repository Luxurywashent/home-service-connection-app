import { Redirect, Stack } from "expo-router";
import { useEmployeeAuth } from "@/lib/auth-context";
import { getNativeEmployeeSession, useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { isTechnicianFeatureDisabled } from "@/lib/technician-features";

export default function TrainingLayout() {
  const { employee, loading } = useEmployeeAuth();
  const { session, isLoading } = useJobSyncAuth();
  const currentRole = (session ? getNativeEmployeeSession(session)?.role : null) ?? employee?.role;
  // The sibling training stack can be mounted directly from a cold-start URL.
  // Wait for the authoritative Company role before mounting any training module.
  if (loading || isLoading) return null;
  if (isTechnicianFeatureDisabled(currentRole, "/training")) return <Redirect href="/(tabs)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[moduleId]" />
      <Stack.Screen name="quiz/[moduleId]" />
    </Stack>
  );
}
