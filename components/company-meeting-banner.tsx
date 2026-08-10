import { View, Text, TouchableOpacity, Linking } from "react-native";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Checks whether the current CST time falls within the banner window for a given meeting.
 * Window: 30 minutes before the meeting until 1 minute after it starts.
 */
function isInMeetingWindow(meetingTime: string): boolean {
  const now = new Date();
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = cstParts.find((p) => p.type === "hour");
  const minutePart = cstParts.find((p) => p.type === "minute");
  if (!hourPart || !minutePart) return false;
  const currentTotal = parseInt(hourPart.value, 10) * 60 + parseInt(minutePart.value, 10);
  const [mHour, mMinute] = meetingTime.split(":").map(Number);
  const meetingTotal = mHour * 60 + mMinute;
  return currentTotal >= meetingTotal - 30 && currentTotal < meetingTotal + 1;
}

/**
 * Returns minutes remaining until the meeting starts (negative if already started).
 */
function minutesUntilMeeting(meetingTime: string): number {
  const now = new Date();
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = cstParts.find((p) => p.type === "hour");
  const minutePart = cstParts.find((p) => p.type === "minute");
  if (!hourPart || !minutePart) return 99;
  const currentTotal = parseInt(hourPart.value, 10) * 60 + parseInt(minutePart.value, 10);
  const [mHour, mMinute] = meetingTime.split(":").map(Number);
  return (mHour * 60 + mMinute) - currentTotal;
}

export function CompanyMeetingBanner() {
  const [visible, setVisible] = useState(false);
  const [minsUntil, setMinsUntil] = useState(30);

  const { data: meeting, refetch } = trpc.companyMeetings.getImminent.useQuery(undefined, {
    // Refetch every minute to pick up new meetings and expire old ones
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const checkWindow = () => {
      if (meeting) {
        const inWindow = isInMeetingWindow(meeting.meetingTime);
        setVisible(inWindow);
        if (inWindow) setMinsUntil(minutesUntilMeeting(meeting.meetingTime));
      } else {
        setVisible(false);
      }
    };
    checkWindow();
    const interval = setInterval(checkWindow, 30_000);
    return () => clearInterval(interval);
  }, [meeting]);

  if (!visible || !meeting) return null;

  const handleJoin = () => {
    if (meeting.zoomLink) {
      Linking.openURL(meeting.zoomLink).catch(() => {
        alert("Unable to open Zoom link. Please try again.");
      });
    }
  };

  const subtitle = minsUntil > 1
    ? `Starting in ${minsUntil} min — tap to join`
    : minsUntil === 1
    ? "Starting in 1 min — join now!"
    : "Meeting is starting now!";

  return (
    <TouchableOpacity
      onPress={meeting.zoomLink ? handleJoin : undefined}
      activeOpacity={0.8}
      style={{
        marginHorizontal: 16,
        marginBottom: 16,
        backgroundColor: "#7C3AED",
        borderRadius: 12,
        padding: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>📅 {meeting.title}</Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 }}>{subtitle}</Text>
        </View>
        {meeting.zoomLink ? (
          <View style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 }}>
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Join Now</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
