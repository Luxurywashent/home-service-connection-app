import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { trpc } from "@/lib/trpc";
import { useCustomerAuth } from "@/lib/customer-context";

/**
 * Registers the device for push notifications and saves the Expo push token
 * to the customer's account so the server can send them job status updates.
 *
 * Call this hook once from the customer home screen or layout.
 */
export function useCustomerPush() {
  const { token, isCustomerAuthenticated } = useCustomerAuth();
  const savePushTokenMutation = trpc.customer.savePushToken.useMutation();

  useEffect(() => {
    if (!isCustomerAuthenticated || !token || Platform.OS === "web") return;

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
          await savePushTokenMutation.mutateAsync({ token, pushToken: tokenData.data });
        }
      } catch (e) {
        // Non-fatal — push notifications are optional
        console.log("[push] Could not register customer push token:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustomerAuthenticated, token]);
}
