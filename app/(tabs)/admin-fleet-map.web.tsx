/**
 * Web fallback for the Fleet Map screen.
 * react-native-maps is native-only and cannot be bundled for web.
 * This file is automatically used by Metro on the web platform.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export default function AdminFleetMapScreen() {
  const colors = useColors();
  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🗺️</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Fleet Map</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          The live fleet map is available on the iOS and Android apps.{"\n"}
          Open the app on your phone to see real-time detailer locations.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
