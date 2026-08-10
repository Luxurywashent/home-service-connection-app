import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

/**
 * Registers the device for push notifications and saves the Expo push token
 * to the team member's account so the server can send them chat and portal message alerts.
 *
 * Call this hook once from the admin layout or home screen.
 */
export function useEmployeePush() {
  const { employee, isAuthenticated } = useEmployeeAuth();
  const savePushTokenMutation = trpc.employee.savePushToken.useMutation();

  useEffect(() => {
    if (!isAuthenticated || !employee?.employeeId || Platform.OS === "web") return;

    (async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: "adfde9c0-02c1-4a12-8e86-e75b79a4edcf",
        });
        if (tokenData?.data) {
          await savePushTokenMutation.mutateAsync({
            employeeId: employee.employeeId,
            pushToken: tokenData.data,
          });
        }
      } catch (e) {
        console.log("[push] Could not register employee push token:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, employee?.employeeId]);
}
