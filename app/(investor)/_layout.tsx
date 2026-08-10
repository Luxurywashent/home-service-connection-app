import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { useInvestorAuth } from "@/lib/investor-auth";

export default function InvestorLayout() {
  const { investor, isLoading } = useInvestorAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !investor) {
      router.replace("/investor-login" as any);
    }
  }, [isLoading, investor]);

  if (isLoading || !investor) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="investment-detail" />
      <Stack.Screen name="documents" />
      <Stack.Screen name="updates" />
      <Stack.Screen name="support" />
      <Stack.Screen name="admin-home" />
      <Stack.Screen name="admin-investors" />
      <Stack.Screen name="admin-investor-detail" />
      <Stack.Screen name="admin-investor-support" />
      <Stack.Screen name="admin-investor-updates" />
      <Stack.Screen name="admin-investments" />
      <Stack.Screen name="admin-payments" />
      <Stack.Screen name="admin-documents" />
      <Stack.Screen name="admin-audit-log" />
    </Stack>
  );
}
