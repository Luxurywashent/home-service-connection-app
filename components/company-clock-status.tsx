import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { useColors } from "@/hooks/use-colors";
import {
  clockInHomeServiceConnected,
  clockOutHomeServiceConnected,
  endHomeServiceConnectedBreak,
  getHomeServiceConnectedTimeState,
  startHomeServiceConnectedBreak,
  type HomeServiceConnectedTimeState,
} from "@/lib/jobsync-mobile-api";
import { useJobSyncSync } from "@/lib/jobsync-sync-context";

export function CompanyClockStatus({ token }: { token: string }) {
  const colors = useColors();
  const { revision } = useJobSyncSync();
  const [state, setState] = useState<HomeServiceConnectedTimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShiftRecovery, setActiveShiftRecovery] = useState(false);
  const [activeBreakRecovery, setActiveBreakRecovery] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const nextState = await getHomeServiceConnectedTimeState(token);
      setState(nextState);
      if (nextState.isClockedIn) setActiveShiftRecovery(false);
      if (nextState.activeBreak?.isActive) setActiveBreakRecovery(false);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh your time status.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [refresh, revision]);

  const run = useCallback(async (
    action: () => Promise<unknown>,
    nextState: "clock-in" | "clock-out" | "break-start" | "break-end",
  ) => {
    setWorking(true);
    setError(null);
    try {
      await Promise.race([
        action(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Time action did not respond. Please sign out and sign in again, then retry.")), 12_000)),
      ]);
      setState((current) => {
        const clockedIn = nextState === "clock-in" ? true : nextState === "clock-out" ? false : current?.isClockedIn === true;
        const activeBreak = nextState === "break-start"
          ? { isActive: true, startedAt: new Date().toISOString() }
          : nextState === "break-end"
            ? null
            : current?.activeBreak ?? null;
        return { isClockedIn: clockedIn, clockInAt: clockedIn ? current?.clockInAt ?? new Date().toISOString() : null, activeBreak };
      });
      if (nextState === "clock-in" || nextState === "clock-out") setActiveShiftRecovery(false);
      if (nextState === "break-start" || nextState === "break-end") setActiveBreakRecovery(false);
      void refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Unable to update your time status.";
      if (nextState === "clock-in" && /already\s+(?:clocked\s+)?in|already\s+on\s+shift/i.test(message)) {
        setActiveShiftRecovery(true);
        setState((current) => ({
          isClockedIn: true,
          clockInAt: current?.clockInAt ?? new Date().toISOString(),
          activeBreak: current?.activeBreak ?? null,
        }));
        setError(null);
      } else if (nextState === "break-start" && /break\s+is\s+already\s+active|already\s+(?:on\s+)?break/i.test(message)) {
        setActiveShiftRecovery(true);
        setActiveBreakRecovery(true);
        setState((current) => ({
          isClockedIn: true,
          clockInAt: current?.clockInAt ?? new Date().toISOString(),
          activeBreak: { isActive: true, startedAt: current?.activeBreak?.startedAt ?? new Date().toISOString() },
        }));
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  if (loading) return <ActivityIndicator color={colors.primary} size="small" />;

  const isClockedIn = state?.isClockedIn === true || activeShiftRecovery;
  const isOnBreak = state?.activeBreak?.isActive === true || activeBreakRecovery;
  const buttonBase = { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 } as const;

  return (
    <View style={{ alignItems: "flex-end", gap: 5 }}>
      {error ? <Text style={{ color: colors.error, fontSize: 11, maxWidth: 220, textAlign: "right" }}>{error}</Text> : null}
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
