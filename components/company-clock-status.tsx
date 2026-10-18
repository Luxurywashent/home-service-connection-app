import { AppState, type AppStateStatus, ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { useColors } from "@/hooks/use-colors";
import { publishCompanyClockNotice } from "@/lib/company-clock-notice";
import { reconcileClockAction, type CompanyClockIntent } from "@/lib/company-clock-reconcile";
import {
  clockInHomeServiceConnected,
  clockOutHomeServiceConnected,
  endHomeServiceConnectedBreak,
  getHomeServiceConnectedTimeState,
  isRequestCancellation,
  startHomeServiceConnectedBreak,
  type HomeServiceConnectedTimeState,
} from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";

const STATUS_POLL_MS = 30_000;

export function CompanyClockStatus({ token }: { token: string }) {
  const colors = useColors();
  const { revision } = useJobSyncSync();
  const [state, setState] = useState<HomeServiceConnectedTimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const actionInFlight = useRef(false);
  const refreshAbort = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    refreshAbort.current?.abort();
    const controller = new AbortController();
    refreshAbort.current = controller;
    const generation = ++refreshGeneration.current;
    try {
      const nextState = await getHomeServiceConnectedTimeState(token, { signal: controller.signal });
      if (generation !== refreshGeneration.current) return;
      setState(nextState);
      publishCompanyClockNotice(null);
    } catch (refreshError) {
      if (generation !== refreshGeneration.current || controller.signal.aborted || isRequestCancellation(refreshError)) return;
      const message = refreshError instanceof Error && refreshError.message.trim()
        ? refreshError.message
        : "Unable to refresh your time status.";
      publishCompanyClockNotice(message);
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const poll = () => {
      void refresh();
      interval = setInterval(() => { void refresh(); }, STATUS_POLL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      refreshAbort.current?.abort();
    };
    const foreground = (next: AppStateStatus) => next !== "background" && next !== "inactive";
    const onChange = (next: AppStateStatus) => {
      if (foreground(next)) {
        if (interval) clearInterval(interval);
        poll();
      } else {
        stop();
      }
    };
    if (foreground(AppState.currentState)) poll();
    const subscription = AppState.addEventListener("change", onChange);
    return () => {
      stop();
      publishCompanyClockNotice(null);
      subscription.remove();
    };
  }, [refresh, revision]);

  const run = useCallback(async (action: () => Promise<unknown>, intent: CompanyClockIntent) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setWorking(true);
    let actionError: unknown = null;
    try {
      await action();
    } catch (error) {
      actionError = error;
    }
    let server: HomeServiceConnectedTimeState | null = null;
    try {
      server = await getHomeServiceConnectedTimeState(token);
    } catch {
      server = null;
    }
    const result = reconcileClockAction(intent, server, actionError);
    if (result.status === "confirmed") {
      setState(result.state);
      publishCompanyClockNotice(null);
    } else {
      publishCompanyClockNotice(result.message);
    }
    actionInFlight.current = false;
    setWorking(false);
  }, [token]);

  if (loading && !state) return <ActivityIndicator color={colors.primary} size="small" />;

  const isClockedIn = state?.isClockedIn === true;
  const isOnBreak = state?.activeBreak?.isActive === true;
  const buttonBase = { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 } as const;

  return (
    <View style={{ alignItems: "flex-end" }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        {isClockedIn ? (
          <>
            <View style={{ alignItems: "center", flexDirection: "row", gap: 5 }}>
              <View style={{ backgroundColor: colors.success, borderRadius: 4, height: 8, width: 8 }} />
              <Text style={{ color: colors.success, fontSize: 12, fontWeight: "800" }}>{isOnBreak ? "On break" : "On shift"}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={working}
              onPress={() => void run(
                () => isOnBreak ? endHomeServiceConnectedBreak(token) : startHomeServiceConnectedBreak(token),
                isOnBreak ? "break-end" : "break-start",
              )}
              style={[buttonBase, { backgroundColor: isOnBreak ? colors.success : colors.warning, opacity: working ? 0.6 : 1 }]}
            >
              <Text style={{ color: isOnBreak ? "#FFFFFF" : "#111827", fontSize: 14, fontWeight: "800" }}>{isOnBreak ? "End Break" : "Break"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={working}
              onPress={() => void run(() => clockOutHomeServiceConnected(token), "clock-out")}
              style={[buttonBase, { backgroundColor: colors.error, opacity: working ? 0.6 : 1 }]}
            >
              {working ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>Clock Out</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={working}
            onPress={() => void run(() => clockInHomeServiceConnected(token), "clock-in")}
            style={[buttonBase, { alignItems: "center", backgroundColor: colors.primary, flexDirection: "row", gap: 6, opacity: working ? 0.6 : 1 }]}
          >
            {working ? <ActivityIndicator color="#FFFFFF" size="small" /> : <><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>▶</Text><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>Clock In</Text></>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
