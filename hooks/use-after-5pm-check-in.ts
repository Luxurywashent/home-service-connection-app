/**
 * Polls the server every 60 seconds for a pending "clock_check_5pm" notification.
 * When found, exposes the notification data so the UI can show a confirmation modal.
 * The detailer taps "Still Working" or "Clock Me Out" to respond.
 */
import { useState, useEffect, useCallback } from "react";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

export function useAfter5pmCheckIn() {
  const { employee } = useEmployeeAuth();
  const [pendingNotification, setPendingNotification] = useState<{
    notificationId: string;
    message: string;
  } | null>(null);
  const [responding, setResponding] = useState(false);

  // Poll for a pending clock_check_5pm notification
  const pendingQuery = trpc.timesheet.getPendingClockCheck.useQuery(
    { employeeId: employee?.employeeId || "" },
    {
      enabled: !!employee?.employeeId,
      refetchInterval: 60 * 1000, // every 60s
      refetchIntervalInBackground: false,
    }
  );

  useEffect(() => {
    if (pendingQuery.data) {
      setPendingNotification({
        notificationId: pendingQuery.data.notificationId,
        message: pendingQuery.data.message ?? "",
      });
    }
  }, [pendingQuery.data]);

  const respondMutation = trpc.timesheet.respondToClockCheck.useMutation();

  const respond = useCallback(
    async (response: "still_working" | "clock_me_out") => {
      if (!employee || !pendingNotification) return;
      setResponding(true);
      try {
        await respondMutation.mutateAsync({
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          response,
          notificationId: pendingNotification.notificationId,
        });
        setPendingNotification(null);
      } catch (err) {
        console.error("[5PM check] respond error:", err);
      } finally {
        setResponding(false);
      }
    },
    [employee, pendingNotification, respondMutation]
  );

  return {
    /** Non-null when the server has sent a 5PM check prompt to this detailer */
    pendingClockCheck: pendingNotification,
    /** Call with the detailer's choice */
    respondToClockCheck: respond,
    responding,
  };
}
