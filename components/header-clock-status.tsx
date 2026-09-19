import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { BreakModal } from "./break-modal";
import { CompanyClockStatus } from "./company-clock-status";
import { EndBreakConfirmationModal } from "./end-break-confirmation-modal";
import { LocationDisclosureModal, hasAcceptedLocationDisclosure, markLocationDisclosureAccepted } from "./location-disclosure-modal";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  allowsLegacyTimekeepingAuthority,
  resolveCompanyTimekeepingAuthority,
  usesCompanyTimekeepingAuthority,
} from "@/lib/jobsync-company-authority";

function formatElapsedTime(startTime: Date | null): string {
  if (!startTime) return "00:00:00";
  
  const now = new Date();
  const elapsed = Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000);
  
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function HeaderClockStatus() {
  const { session, isLoading } = useJobSyncAuth();
  const authority = resolveCompanyTimekeepingAuthority({ session, sessionLoading: isLoading });
  if (authority === "unknown") {
    return <ActivityIndicator color="#0a7ea4" size="small" />;
  }
  if (usesCompanyTimekeepingAuthority(authority) && session?.token) {
    return <CompanyClockStatus token={session.token} />;
  }
  if (!allowsLegacyTimekeepingAuthority(authority)) {
    return <ActivityIndicator color="#0a7ea4" size="small" />;
  }
  return <LegacyHeaderClockStatus />;
}

function LegacyHeaderClockStatus() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [elapsedTime, setElapsedTime] = useState("00:00:00");
  const [clockingInOut, setClockinginOut] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [endingBreak, setEndingBreak] = useState(false);
  const [showEndBreakConfirmation, setShowEndBreakConfirmation] = useState(false);
  const [showLocationDisclosure, setShowLocationDisclosure] = useState(false);
  const [pendingClockIn, setPendingClockIn] = useState(false);

  const clockStatusQuery = trpc.timesheet.getTodayStatus.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000, refetchOnWindowFocus: false }
  );

  const clockInMutation = trpc.timesheet.clockIn.useMutation();
  const clockOutMutation = trpc.timesheet.clockOut.useMutation();
  const endBreakMutation = trpc.timesheet.endBreak.useMutation();
  const locationUpsertMutation = trpc.location.upsert.useMutation();

  const activeBreakQuery = trpc.timesheet.getActiveBreak.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, refetchInterval: 30000, refetchOnWindowFocus: false }
  );

  const clockStatus = clockStatusQuery.data;
  const isClockedIn = clockStatus?.status === "clocked_in";

  // Update elapsed time every second when clocked in
  useEffect(() => {
    if (!isClockedIn || !clockStatus?.clockInTime) {
      setElapsedTime("00:00:00");
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(formatElapsedTime(clockStatus.clockInTime));
    }, 1000);

    return () => clearInterval(interval);
  }, [isClockedIn, clockStatus?.clockInTime]);

  // Continuous background location updates every 5 minutes while clocked in.
  // This keeps the fleet map pin current even when no job is active.
  useEffect(() => {
    if (!isClockedIn || !employee?.employeeId || Platform.OS === "web") return;
    let cancelled = false;
    const pushLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        locationUpsertMutation.mutate({
          employeeId: employee.employeeId,
          fullName: employee.fullName,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          status: "clocked_in",
        });
      } catch (_) { /* non-fatal */ }
    };
    // Push immediately on clock-in state change, then every 2 minutes
    pushLocation();
    const interval = setInterval(pushLocation, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isClockedIn, employee?.employeeId]);

  // Auto-end break after duration expires
  useEffect(() => {
    const activeBreak = activeBreakQuery.data;
    if (!activeBreak?.breakStartTime || activeBreak?.breakEndTime) return;

    const durationMs = activeBreak.durationMinutes * 60 * 1000;
    const breakStartTime = new Date(activeBreak.breakStartTime).getTime();
    const now = new Date().getTime();
    const timeElapsed = now - breakStartTime;

    if (timeElapsed >= durationMs) {
      // Break duration expired, auto-end it
      handleConfirmEndBreak();
      return;
    }

    // Set timer to auto-end break when duration expires
    const timeRemaining = durationMs - timeElapsed;
    const timer = setTimeout(() => {
      handleConfirmEndBreak();
    }, timeRemaining);

    return () => clearTimeout(timer);
  }, [activeBreakQuery.data?.breakStartTime, activeBreakQuery.data?.breakEndTime, activeBreakQuery.data?.durationMinutes]);

  const handleClockIn = async () => {
    // Show prominent location disclosure on first clock-in (Google Play policy requirement)
    if (Platform.OS !== "web") {
      const accepted = await hasAcceptedLocationDisclosure();
      if (!accepted) {
        setShowLocationDisclosure(true);
        return;
      }
    }
    setClockinginOut(true);
    try {
      // Capture GPS before clocking in so coordinates are saved with the record
      let clockInLat: number | undefined;
      let clockInLng: number | undefined;
      if (Platform.OS !== "web" && employee?.employeeId) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            clockInLat = loc.coords.latitude;
            clockInLng = loc.coords.longitude;
            // Also update fleet map pin
            locationUpsertMutation.mutate({
              employeeId: employee.employeeId,
              fullName: employee.fullName,
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              status: "clocked_in",
            });
          }
        } catch (locErr) {
          console.warn("Clock-in location capture failed:", locErr);
        }
      }
      await clockInMutation.mutateAsync({ 
        employeeId: employee?.employeeId || "", 
        fullName: employee?.fullName || "",
        ...(clockInLat != null && clockInLng != null ? { lat: clockInLat, lng: clockInLng } : {}),
      });
      await clockStatusQuery.refetch();
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error("Clock in error:", error);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setClockinginOut(false);
    }
  };

  const handleLocationDisclosureAccept = async () => {
    await markLocationDisclosureAccepted();
    setShowLocationDisclosure(false);
    handleClockIn();
  };

  const handleLocationDisclosureDecline = () => {
    setShowLocationDisclosure(false);
  };

  const handleConfirmEndBreak = async () => {
    if (!activeBreakQuery.data?.breakId) {
      console.error("No active break found");
      return;
    }
    setEndingBreak(true);
    try {
      // Capture GPS when ending break
      let endLat: number | undefined;
      let endLng: number | undefined;
      if (Platform.OS !== "web") {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            endLat = loc.coords.latitude;
            endLng = loc.coords.longitude;
          }
        } catch (locErr) {
          console.warn("End-break location capture failed:", locErr);
        }
      }
      console.log("Ending break:", activeBreakQuery.data.breakId);
      const result = await endBreakMutation.mutateAsync({
        breakId: activeBreakQuery.data.breakId,
        ...(endLat != null && endLng != null ? { endLat, endLng } : {}),
      });
      console.log("End break result:", result);
      await activeBreakQuery.refetch();
      setShowEndBreakConfirmation(false);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error("End break error:", error);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setEndingBreak(false);
    }
  };

  const handleEndBreak = () => {
    setShowEndBreakConfirmation(true);
  };

  const handleClockOut = async () => {
    setClockinginOut(true);
    try {
      // Capture GPS before clocking out so coordinates are saved with the record
      let clockOutLat: number | undefined;
      let clockOutLng: number | undefined;
      if (Platform.OS !== "web" && employee?.employeeId) {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted") {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            clockOutLat = loc.coords.latitude;
            clockOutLng = loc.coords.longitude;
          }
        } catch (locErr) {
          console.warn("Clock-out location capture failed:", locErr);
        }
      }
      await clockOutMutation.mutateAsync({
        employeeId: employee?.employeeId || "",
        ...(clockOutLat != null && clockOutLng != null ? { lat: clockOutLat, lng: clockOutLng } : {}),
      });
      await clockStatusQuery.refetch();
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error("Clock out error:", error);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setClockinginOut(false);
    }
  };

  // When clocked in, show Break/End Break and Clock Out buttons
  if (isClockedIn) {
    const isOnBreak = !!activeBreakQuery.data?.breakId && !activeBreakQuery.data?.breakEndTime;

    return (
      <>
        <LocationDisclosureModal
          visible={showLocationDisclosure}
          onAccept={handleLocationDisclosureAccept}
          onDecline={handleLocationDisclosureDecline}
        />
        <BreakModal visible={showBreakModal} onClose={() => setShowBreakModal(false)} />
        <EndBreakConfirmationModal
          visible={showEndBreakConfirmation}
          onConfirm={handleConfirmEndBreak}
          onCancel={() => setShowEndBreakConfirmation(false)}
          isLoading={endingBreak}
        />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {/* Break/End Break Button - Tap to start break, tap again to end early */}
          <TouchableOpacity
            disabled={endingBreak || clockingInOut}
            style={{
              backgroundColor: isOnBreak ? colors.success : colors.warning,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              opacity: (endingBreak || clockingInOut) ? 0.6 : 1,
            }}
            onPress={() => {
              if (isOnBreak) {
                // End break early if already on break
                handleEndBreak();
              } else {
                // Start break if not on break
                setShowBreakModal(true);
              }
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
            }}
          >
            {endingBreak ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={{ fontSize: 14, fontWeight: "600", color: isOnBreak ? "#FFF" : "#000" }}>
                {isOnBreak ? "✓ End Break" : "⏸️ Break"}
              </Text>
            )}
          </TouchableOpacity>

        {/* Clock Out Button */}
        <TouchableOpacity
          disabled={clockingInOut}
          onPress={handleClockOut}
          style={{
            backgroundColor: colors.error,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            opacity: clockingInOut ? 0.6 : 1,
          }}
        >
          {clockingInOut ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#FFF" }}>
              ⏹️ Clock Out
            </Text>
          )}
        </TouchableOpacity>
        </View>
      </>
    );
  }

  // When clocked out, show Clock In button
  return (
    <>
      <LocationDisclosureModal
        visible={showLocationDisclosure}
        onAccept={handleLocationDisclosureAccept}
        onDecline={handleLocationDisclosureDecline}
      />
      <TouchableOpacity
      onPress={handleClockIn}
      disabled={clockingInOut}
      style={{
        backgroundColor: colors.primary,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        opacity: clockingInOut ? 0.6 : 1,
      }}
    >
      {clockingInOut ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <>
          <Text style={{ fontSize: 14, fontWeight: "600", color: "#FFF" }}>
            ▶️
          </Text>
          <Text style={{ fontSize: 14, fontWeight: "600", color: "#FFF" }}>
            Clock In
          </Text>
        </>
      )}
      </TouchableOpacity>
    </>
  );
}
