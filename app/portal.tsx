import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { ScreenContainer } from "@/components/screen-container";
import {
  getJobSyncPortalUrl,
  isJobSyncPortal,
  type JobSyncPortal,
} from "@/lib/jobsync-portal";

const portalCopy: Record<JobSyncPortal, { title: string; subtitle: string; icon: "business" | "admin-panel-settings" }> = {
  company: {
    title: "Company Sign In",
    subtitle: "Use the same email and password as your JobSync Company account.",
    icon: "business",
  },
  platform: {
    title: "Platform Admin",
    subtitle: "Use your separate platform-owner credentials to manage every Company.",
    icon: "admin-panel-settings",
  },
};

export default function JobSyncPortalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ portal?: string | string[] }>();
  const requestedPortal = Array.isArray(params.portal) ? params.portal[0] : params.portal;
  const portal: JobSyncPortal = isJobSyncPortal(requestedPortal) ? requestedPortal : "company";
  const sourceUrl = useMemo(() => getJobSyncPortalUrl(portal), [portal]);
  const copy = portalCopy[portal];
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleNavigationChange = (state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
    setLoading(state.loading);
  };

  if (Platform.OS === "web") {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background">
        <View style={styles.webFallback}>
          <View style={styles.webFallbackIcon}>
            <MaterialIcons color="#4D8DFF" name={copy.icon} size={34} />
          </View>
          <Text style={styles.webFallbackTitle}>{copy.title}</Text>
          <Text style={styles.webFallbackBody}>{copy.subtitle}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openURL(sourceUrl)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Open secure portal</Text>
            <MaterialIcons color="#FFFFFF" name="open-in-new" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back to portal selection</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to portal selection" onPress={() => router.replace("/login")} style={styles.iconButton}>
          <MaterialIcons color="#D8E3F5" name="close" size={24} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{copy.title}</Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>Connected to JobSync</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back in the portal"
          disabled={!canGoBack}
          onPress={() => webViewRef.current?.goBack()}
          style={[styles.iconButton, !canGoBack && styles.iconButtonDisabled]}
        >
          <MaterialIcons color="#D8E3F5" name="arrow-back" size={22} />
        </Pressable>
      </View>
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: sourceUrl }}
          originWhitelist={["https://*"]}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loader}>
              <ActivityIndicator color="#4D8DFF" size="large" />
              <Text style={styles.loaderText}>Opening your secure workspace…</Text>
            </View>
          )}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={handleNavigationChange}
        />
        {loading ? <View pointerEvents="none" style={styles.loadingLine} /> : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: "#0B1730",
    borderBottomColor: "#243754",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 62,
    paddingHorizontal: 12,
  },
  headerCopy: { flex: 1, marginHorizontal: 10 },
  headerTitle: { color: "#F6F8FC", fontSize: 16, fontWeight: "800" },
  headerSubtitle: { color: "#94A3B8", fontSize: 12, marginTop: 1 },
  iconButton: { alignItems: "center", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  iconButtonDisabled: { opacity: 0.35 },
  webViewContainer: { flex: 1, overflow: "hidden" },
  loader: { alignItems: "center", backgroundColor: "#0B1730", flex: 1, gap: 14, justifyContent: "center", padding: 28 },
  loaderText: { color: "#C9D5E8", fontSize: 14, textAlign: "center" },
  loadingLine: { backgroundColor: "#4D8DFF", height: 3, left: 0, position: "absolute", right: 0, top: 0 },
  webFallback: { alignItems: "center", flex: 1, justifyContent: "center", padding: 28 },
  webFallbackIcon: { alignItems: "center", backgroundColor: "#102038", borderColor: "#243754", borderRadius: 22, borderWidth: 1, height: 76, justifyContent: "center", marginBottom: 20, width: 76 },
  webFallbackTitle: { color: "#F6F8FC", fontSize: 24, fontWeight: "800", textAlign: "center" },
  webFallbackBody: { color: "#94A3B8", fontSize: 15, lineHeight: 22, marginBottom: 26, marginTop: 10, maxWidth: 340, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: "#4D8DFF", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", maxWidth: 360, paddingVertical: 16, width: "100%" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: { marginTop: 18, padding: 10 },
  secondaryButtonText: { color: "#9FC1FF", fontSize: 14, fontWeight: "700" },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
