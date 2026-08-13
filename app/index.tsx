import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";

/**
 * Home Service Connection starts at sign-in. The copied public sales landing
 * page is intentionally not part of this independent CRM experience.
 */
export default function IndexRoute() {
  const { session, isLoading } = useJobSyncAuth();
  if (isLoading) return <View style={{ alignItems: "center", flex: 1, justifyContent: "center" }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/login" />;
  if (session.portal === "platform") return <Redirect href="/platform-dashboard" />;
  return <Redirect href={session.user.role === "technician" ? "/(tabs)" : "/(tabs)/admin-dashboard"} />;
}
