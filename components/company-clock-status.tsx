import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { useColors } from "@/hooks/use-colors";
import { reconcileClockAction, type CompanyClockIntent } from "@/lib/company-clock-reconcile";
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
  const actionInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const nextState = await getHomeServiceConnectedTimeState(token);
      setState(nextState);
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

  const run = useCallback(async (action: () => Promise<unknown>, intent: CompanyClockIntent) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setWorking(true);
    setError(null);
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
      setError(null);
    } else {
      setError(result.message);
    }
    actionInFlight.current = false;
    setWorking(false);
  }, [token]);

  if (loading) return <ActivityIndicator color={colors.primary} size="small" />;
  if (error && !state) {
    return (
      <View style={{ alignItems: "flex-end", maxWidth: 220 }}>
        <Text style={{ color: colors.error, fontSize: 11, textAlign: "right" }}>{error}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => { setLoading(true); void refresh(); }} style={{ marginTop: 6 }}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isClockedIn = state?.isClockedIn === true;
  const isOnBreak = state?.activeBreak?.isActive === true;
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
