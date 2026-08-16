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

export function CompanyClockStatus({ token }: { token: string }) {
  const colors = useColors();
  const [state, setState] = useState<HomeServiceConnectedTimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setState(await getHomeServiceConnectedTimeState(token));
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
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update your time status.");
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  if (loading) return <ActivityIndicator color={colors.primary} size="small" />;

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
              onPress={() => void run(() => isOnBreak ? endHomeServiceConnectedBreak(token) : startHomeServiceConnectedBreak(token))}
              style={[buttonBase, { backgroundColor: isOnBreak ? colors.success : colors.warning, opacity: working ? 0.6 : 1 }]}
            >
              <Text style={{ color: isOnBreak ? "#FFFFFF" : "#111827", fontSize: 14, fontWeight: "800" }}>{isOnBreak ? "End Break" : "Break"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={working}
              onPress={() => void run(() => clockOutHomeServiceConnected(token))}
              style={[buttonBase, { backgroundColor: colors.error, opacity: working ? 0.6 : 1 }]}
            >
              {working ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>Clock Out</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={working}
            onPress={() => void run(() => clockInHomeServiceConnected(token))}
            style={[buttonBase, { alignItems: "center", backgroundColor: colors.primary, flexDirection: "row", gap: 6, opacity: working ? 0.6 : 1 }]}
          >
            {working ? <ActivityIndicator color="#FFFFFF" size="small" /> : <><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>▶</Text><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "800" }}>Clock In</Text></>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
