import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  Platform,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { useCustomerPush } from "@/hooks/use-customer-push";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/constants/oauth";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { trpc } from "@/lib/trpc";
import { CustomerMessageBanner } from "@/components/customer-message-banner";
import { ReviewOverlay } from "@/components/review-overlay";
import * as Notifications from "expo-notifications";

// Brand colors
const BLUE = "#0057FF";
const DARK_BLUE = "#003DBF";
const BLACK = "#000000";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Default fallback URLs (used while server config loads or if fetch fails)
const DEFAULT_HERO_VIDEO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/smgYJKbBuUGgNeYq.mov";
const DEFAULT_ACTION_VIDEO_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/gXquUlgUBSvKrZIH.mov";

// Service pillars — what we do, no prices
const SERVICE_PILLARS = [
  {
    icon: "local-car-wash" as const,
    title: "Exterior Detail",
    description:
      "Hand wash, clay bar treatment, polish, and paint sealant. We restore your paint to a showroom-quality mirror finish.",
  },
  {
    icon: "airline-seat-recline-extra" as const,
    title: "Interior Detail",
    description:
      "Deep clean every surface — seats, carpets, dashboard, door panels, and headliner. Your cabin will feel brand new.",
  },
  {
    icon: "star" as const,
    title: "Full & Luxury Detail",
    description:
      "Our flagship service combines a complete exterior and interior detail. Every inch of your vehicle treated to perfection.",
  },
];

// How it works steps
const HOW_IT_WORKS = [
  {
    step: "01",
    title: "You Book",
    description: "Choose your service, pick a date and time, and tell us where to come.",
  },
  {
    step: "02",
    title: "We Come to You",
    description:
      "Our team arrives at your home, office, or wherever your vehicle is parked.",
  },
  {
    step: "03",
    title: "Drive Away Impressed",
    description:
      "We handle everything. You get back a spotless, protected vehicle — no drop-off needed.",
  },
];

// Package descriptions — informational, no prices
// Photos: real customer vehicles from the Luxury Wash On Wheels fleet
const PACKAGES = [
  {
    id: "luxury_detail",
    name: "Luxury Detail",
    tagline: "The ultimate experience",
    description:
      "Our flagship service. Every inch of your vehicle treated to perfection — paint correction, full interior, and ceramic protection.",
    image: {
      // White Maserati GranTurismo with Luxury Wash van behind it
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/XqsSZAMHNmenFqvg.jpeg",
    },
    duration: "3–4 hrs",
    badge: "Premium",
    highlight: "The ultimate detail",
  },
  {
    id: "full_detail",
    name: "Full Detail",
    tagline: "Inside and out",
    description:
      "Complete interior and exterior detail. Shampoo, polish, and protect every surface inside and out.",
    image: {
      // GMC Yukon Denali + Ford Raptor — two vehicles, one visit
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/RWXlycKkQdhsNZfO.jpeg",
    },
    duration: "2–3 hrs",
    badge: "Most Popular",
    highlight: "Best value",
  },
  {
    id: "basic_detail",
    name: "Basic Detail",
    tagline: "The essential clean",
    description:
      "Exterior hand wash, interior vacuum, window cleaning, and tire dressing. Perfect for regular maintenance.",
    image: {
      // Red Chevy Silverado Z71 — freshly washed in parking lot
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/CJtStJgrxOtnDyjx.jpeg",
    },
    duration: "1½–2 hrs",
    badge: null,
    highlight: "Great for maintenance",
  },
  {
    id: "interior_detail",
    name: "Interior Detail",
    tagline: "Deep clean inside",
    description:
      "Full interior deep clean — seats, carpets, dashboard, door panels, and more. Odor elimination included.",
    image: {
      // Van open showing interior detailing setup
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/rGcUJmkinKXyJmpu.jpeg",
    },
    duration: "1½–2 hrs",
    badge: null,
    highlight: "Fresh interior",
  },
  {
    id: "exterior_detail",
    name: "Exterior Detail",
    tagline: "Shine from the outside",
    description:
      "Hand wash, clay bar prep, polish, and paint sealant for a showroom finish that lasts.",
    image: {
      // Black Lexus LX on paver driveway — mirror finish
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/QnseblgQOubRMDke.jpeg",
    },
    duration: "1–1½ hrs",
    badge: null,
    highlight: "Mirror-like finish",
  },
];

export default function CustomerHomeScreen() {
  const router = useRouter();
  const { customer, token } = useCustomerAuth();
  const insets = useSafeAreaInsets();
  useCustomerPush();
  // Fetch all jobs to find the next upcoming appointment
  const jobsQuery = trpc.customer.allJobs.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const nextAppointment = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const now = new Date().toISOString().split("T")[0];
    const upcoming = jobs
      .filter(j => j.date >= now && j.status !== "completed" && j.status !== "cancelled")
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? null;
  }, [jobsQuery.data]);

  // Poll for active tracking token (detailer on the way)
  const { data: activeTracking } = trpc.customer.activeTracking.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 60000 }
  );
  // Pulse animation for tracking banner
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeTracking) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [activeTracking]);
  // Active promotions from admin
  const { data: activePromos = [] } = trpc.promotions.getActive.useQuery(undefined, { refetchInterval: 5 * 60 * 1000 });
  const [expandedPromo, setExpandedPromo] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Review overlay state
  const [reviewOverlay, setReviewOverlay] = useState<{
    visible: boolean;
    city?: string;
    detailerName?: string;
  }>({ visible: false });

  // Listen for push notifications with screen:'review' (foreground + tap)
  useEffect(() => {
    const handleReviewNotif = (data: Record<string, string | undefined>) => {
      if (data?.screen === 'review') {
        setReviewOverlay({
          visible: true,
          city: data.city,
          detailerName: data.detailerName,
        });
      }
    };
    // Foreground: notification received while app is open
    const fgSub = Notifications.addNotificationReceivedListener((notif) => {
      handleReviewNotif(notif.request.content.data as Record<string, string | undefined>);
    });
    // Background/killed: user taps the notification
    const bgSub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleReviewNotif(response.notification.request.content.data as Record<string, string | undefined>);
    });
    // Cold-start tap
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleReviewNotif(response.notification.request.content.data as Record<string, string | undefined>);
        Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => { fgSub.remove(); bgSub.remove(); };
  }, []);

  async function handleCopyCode(code: string) {
    await Clipboard.setStringAsync(code);
    setCopiedCode(code);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopiedCode(null), 2500);
  }

  // ─── Server-configurable hero media (video or image) ───
  const [heroConfig, setHeroConfig] = useState<{ type: string; url: string }>({ type: "video", url: DEFAULT_HERO_VIDEO_URL });
  const [actionConfig, setActionConfig] = useState<{ type: string; url: string }>({ type: "video", url: DEFAULT_ACTION_VIDEO_URL });

  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    fetch(`${baseUrl}/api/hero-config`)
      .then(r => r.json())
      .then(data => {
        if (data.hero?.url) setHeroConfig(data.hero);
        if (data.action?.url) setActionConfig(data.action);
      })
      .catch(() => { /* use defaults */ });
  }, []);

  // Set up the hero video player — muted, looping, auto-play
  const player = useVideoPlayer(heroConfig.type === "video" ? heroConfig.url : DEFAULT_HERO_VIDEO_URL, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Second video player — "See It In Action" (auto-play, muted, looping)
  const player2 = useVideoPlayer(actionConfig.type === "video" ? actionConfig.url : DEFAULT_ACTION_VIDEO_URL, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Ensure both players play on mount (handles cases where autoplay is deferred)
  useEffect(() => {
    if (heroConfig.type === "video") {
      player.muted = true;
      player.play();
    }
    if (actionConfig.type === "video") {
      player2.muted = true;
      player2.play();
    }
  }, [heroConfig, actionConfig]);

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF", paddingTop: insets.top }}>
      <StatusBar style="dark" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        style={{ backgroundColor: "#FFFFFF" }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Centered full logo */}
          <Image
            source={{ uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/VQdrWFhkiJKKSDFk.png" }}
            style={styles.headerLogo}
            resizeMode="contain"
          />

          {/* Login/Profile button pinned to top-right */}
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={() => {
              if (token) {
                router.push("/(customer)/profile" as any);
              } else {
                router.push("/login" as any);
              }
            }}
          >
            <MaterialIcons name="person" size={20} color="#1A1A1A" />
          </TouchableOpacity>
        </View>

        {/* Customer Message Banner */}
        <CustomerMessageBanner />

        {/* ── Live Tracking Banner (shown when detailer is on the way) ─── */}
        {activeTracking && (
          <Animated.View style={{ transform: [{ scale: pulseAnim }], marginHorizontal: 16, marginBottom: 10 }}>
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={() => router.push(`/(customer)/track/${activeTracking.jobId}` as any)}
              style={{
                backgroundColor: "#0057FF",
                borderRadius: 16,
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                shadowColor: "#0057FF",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.45,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              {/* Pulsing dot */}
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
                <MaterialIcons name="local-shipping" size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
                  🚚 {activeTracking.detailerName} is on the way!
                </Text>
                {activeTracking.packageName ? (
                  <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>
                    {activeTracking.packageName} · Tap to track live
                  </Text>
                ) : (
                  <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>Tap to see live location</Text>
                )}
              </View>
              <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </Animated.View>
        )}
        {/* ── Next Appointment Banner ─────────────────────────── */}
        {nextAppointment ? (
          <TouchableOpacity
            style={styles.nextApptBanner}
            onPress={() => router.push(`/(customer)/job/${nextAppointment.id}` as any)}
            activeOpacity={0.85}
          >
            <View style={styles.nextApptLeft}>
              <MaterialIcons name="event" size={18} color={BLUE} />
              <View style={styles.nextApptTextWrap}>
                <Text style={styles.nextApptLabel}>Next Appointment</Text>
                <Text style={styles.nextApptDate}>
                  {new Date(nextAppointment.date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {nextAppointment.time ? ` · ${nextAppointment.time}` : ""}
                </Text>
                {nextAppointment.packageName && (
                  <Text style={styles.nextApptPackage}>{nextAppointment.packageName}</Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ backgroundColor: BLUE, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>View</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color="#6B7280" />
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextApptBanner, { borderColor: BLUE, borderWidth: 1.5 }]}
            onPress={() => router.push("/login" as any)}
            activeOpacity={0.85}
          >
            <View style={styles.nextApptLeft}>
              <MaterialIcons name="add-circle" size={20} color={BLUE} />
              <View style={styles.nextApptTextWrap}>
                <Text style={[styles.nextApptLabel, { color: BLUE, fontWeight: "700" }]}>Book Your Next Appointment</Text>
                <Text style={[styles.nextApptDate, { color: "#9CA3AF" }]}>Tap to schedule a detail</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={BLUE} />
          </TouchableOpacity>
        )}

        {/* ── Promo Banners ───────────────────────────────────────── */}
        {(activePromos as any[]).length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 4, gap: 10 }}>
            {(activePromos as any[]).map((promo) => {
              const isExpanded = expandedPromo === promo.promoId;
              return (
                <TouchableOpacity
                  key={promo.promoId}
                  activeOpacity={0.9}
                  onPress={() => {
                    setExpandedPromo(isExpanded ? null : promo.promoId);
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={{
                    borderRadius: 18,
                    overflow: "hidden",
                    shadowColor: promo.bgColor ?? "#0057FF",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.35,
                    shadowRadius: 12,
                    elevation: 6,
                  }}
                >
                  <LinearGradient
                    colors={[promo.bgColor ?? "#0057FF", (promo.bgColor ?? "#0057FF") + "CC"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ padding: 16 }}
                  >
                    {/* Top row */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Text style={{ fontSize: 30 }}>{promo.emoji ?? "🎉"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff", lineHeight: 20 }}>
                          {promo.title}
                        </Text>
                        {!isExpanded && promo.description ? (
                          <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 }} numberOfLines={1}>
                            {promo.description}
                          </Text>
                        ) : null}
                      </View>
                      <MaterialIcons
                        name={isExpanded ? "keyboard-arrow-up" : "keyboard-arrow-down"}
                        size={22}
                        color="rgba(255,255,255,0.8)"
                      />
                    </View>

                    {/* Expanded content */}
                    {isExpanded && (
                      <View style={{ marginTop: 12 }}>
                        {promo.description ? (
                          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 20, marginBottom: 12 }}>
                            {promo.description}
                          </Text>
                        ) : null}

                        {/* Discount badge */}
                        {promo.discountType !== "none" && parseFloat(promo.discountValue ?? "0") > 0 && (
                          <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginBottom: 10 }}>
                            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>
                              {promo.discountType === "percent"
                                ? `${parseFloat(promo.discountValue)}% OFF`
                                : `$${parseFloat(promo.discountValue)} OFF`}
                            </Text>
                          </View>
                        )}

                        {/* Promo code copy button */}
                        {promo.promoCode ? (
                          <TouchableOpacity
                            onPress={() => handleCopyCode(promo.promoCode)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 10,
                              backgroundColor: "rgba(255,255,255,0.15)",
                              borderRadius: 12,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              borderWidth: 1,
                              borderColor: "rgba(255,255,255,0.3)",
                              borderStyle: "dashed",
                            }}
                          >
                            <Text style={{ flex: 1, color: "#fff", fontWeight: "700", fontSize: 16, letterSpacing: 2 }}>
                              {promo.promoCode}
                            </Text>
                            <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                                {copiedCode === promo.promoCode ? "✓ Copied!" : "Tap to Copy"}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ) : null}

                        {/* Date range */}
                        {(promo.startDate || promo.endDate) && (
                          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 10 }}>
                            Valid: {promo.startDate ?? "Now"} – {promo.endDate ?? "Until further notice"}
                          </Text>
                        )}

                        {/* Book now CTA */}
                        <TouchableOpacity
                          onPress={() => router.push("/login" as any)}
                          style={{
                            marginTop: 14,
                            backgroundColor: "#fff",
                            borderRadius: 12,
                            paddingVertical: 12,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: promo.bgColor ?? "#0057FF", fontWeight: "800", fontSize: 15 }}>
                            Book Now & Save
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Video Hero ──────────────────────────────────────────── */}
        <View style={styles.heroContainer}>
          {/* Media fills the hero area — video or image based on server config */}
          {heroConfig.type === "image" ? (
            <Image
              source={{ uri: heroConfig.url }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
          ) : (
            <VideoView
              player={player}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              nativeControls={false}
            />
          )}

          {/* Dark gradient overlay so text is readable */}
          <LinearGradient
            colors={["rgba(0,0,0,0.15)", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.88)"]}
            style={styles.heroGradient}
          >
            <View style={styles.heroContent}>
              <View style={styles.heroBlueLine} />
              <Text style={styles.heroTitle}>Your Car Deserves{"\n"}The Best</Text>
              <Text style={styles.heroSubtitle}>
                Premium mobile detailing — we come to you
              </Text>
              <TouchableOpacity
                style={styles.heroBtn}
                onPress={() => router.push(customer ? "/(customer)/book/vehicle" : "/login" as any)}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[BLUE, DARK_BLUE]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.heroBtnGradient}
                >
                  <Text style={styles.heroBtnText}>Book Now</Text>
                  <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* ── Stats Strip ─────────────────────────────────────────── */}
        <View style={styles.statsStrip}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>65,000+</Text>
            <Text style={styles.statLabel}>Cars Detailed</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>4.9★</Text>
            <Text style={styles.statLabel}>Rated Service</Text>
          </View>
        </View>

        {/* ── How It Works ────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>How It Works</Text>
          <Text style={styles.sectionSubtitle}>Three simple steps to a spotless vehicle</Text>
        </View>

        <View style={styles.stepsContainer}>
          {HOW_IT_WORKS.map((step, index) => (
            <View key={step.step} style={styles.stepRow}>
              {/* Step number + connector line */}
              <View style={styles.stepLeft}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{step.step}</Text>
                </View>
                {index < HOW_IT_WORKS.length - 1 && (
                  <View style={styles.stepConnector} />
                )}
              </View>

              {/* Step content */}
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>{step.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── See It In Action Video ──────────────────────────────── */}
        <View style={{ marginHorizontal: 16, marginTop: 24, marginBottom: 8, borderRadius: 16, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
          {actionConfig.type === "image" ? (
            <Image
              source={{ uri: actionConfig.url }}
              style={{ width: "100%", height: 220 }}
              resizeMode="cover"
            />
          ) : (
            <VideoView
              player={player2}
              style={{ width: "100%", height: 220 }}
              contentFit="cover"
              nativeControls={true}
            />
          )}
          <View style={{ padding: 14 }}>
            <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "700", marginBottom: 4 }}>See Us In Action</Text>
            <Text style={{ color: "#6B7280", fontSize: 13, lineHeight: 18 }}>Watch how our team delivers a showroom-quality detail right at your door.</Text>
          </View>
        </View>
        {/* ── What We Do ──────────────────────────────────────────── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>What We Do</Text>
          <Text style={styles.sectionSubtitle}>
            Professional detailing brought directly to your door
          </Text>
        </View>

        <View style={styles.pillarsRow}>
          {SERVICE_PILLARS.map((pillar) => (
            <View key={pillar.title} style={styles.pillarCard}>
              <View style={styles.pillarIconWrap}>
                <MaterialIcons name={pillar.icon} size={26} color={BLUE} />
              </View>
              <Text style={styles.pillarTitle}>{pillar.title}</Text>
              <Text style={styles.pillarDesc}>{pillar.description}</Text>
            </View>
          ))}
        </View>

        {/* ── Our Services ────────────────────────────────────────── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>Our Services</Text>
          <Text style={styles.sectionSubtitle}>
            Select a service when you book to see pricing
          </Text>
        </View>

        {PACKAGES.map((pkg, index) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            reversed={index % 2 !== 0}
            onBook={() => router.push("/login" as any)}
          />
        ))}

        {/* ── Why Choose Us ───────────────────────────────────────── */}
        <View style={styles.whySection}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>Why Luxury Wash?</Text>

          {[
            {
              icon: "home" as const,
              title: "We Come to You",
              desc: "No need to drive anywhere. We detail your vehicle at your home, office, or any location.",
            },
            {
              icon: "verified" as const,
              title: "Trained Professionals",
              desc: "Our detailers follow a strict step-by-step process to ensure consistent, high-quality results every time.",
            },
            {
              icon: "eco" as const,
              title: "Premium Products",
              desc: "Professional products used to clean and protect your vehicle.",
            },
            {
              icon: "schedule" as const,
              title: "Flexible Scheduling",
              desc: "Book at a time that works for you. Morning, afternoon, or weekend — we work around your schedule.",
            },
          ].map((item) => (
            <View key={item.title} style={styles.whyRow}>
              <View style={styles.whyIconWrap}>
                <MaterialIcons name={item.icon} size={22} color={BLUE} />
              </View>
              <View style={styles.whyText}>
                <Text style={styles.whyTitle}>{item.title}</Text>
                <Text style={styles.whyDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Final CTA ───────────────────────────────────────────── */}
        <View style={styles.ctaSection}>
          <Text style={styles.ctaHeadline}>Ready for a spotless vehicle?</Text>
          <Text style={styles.ctaSubtext}>
            Book your detail in minutes. We'll handle the rest.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login" as any)}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[BLUE, DARK_BLUE]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaBtn}
            >
              <Text style={styles.ctaBtnText}>Schedule Your Detail</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <ReviewOverlay
        visible={reviewOverlay.visible}
        city={reviewOverlay.city}
        detailerName={reviewOverlay.detailerName}
        onDismiss={() => setReviewOverlay({ visible: false })}
      />
    </View>
  );
}

// ── Package Card ──────────────────────────────────────────────────────────────
function PackageCard({
  pkg,
  reversed,
  onBook,
}: {
  pkg: (typeof PACKAGES)[0];
  reversed: boolean;
  onBook: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.packageCard, reversed && styles.packageCardReversed]}
      onPress={onBook}
      activeOpacity={0.88}
    >
      {/* Image side */}
      <View style={styles.packageImageWrap}>
        <Image source={pkg.image} style={styles.packageImage} resizeMode="cover" />
        <LinearGradient
          colors={
            reversed
              ? ["transparent", "rgba(0,0,0,0.4)"]
              : ["rgba(0,0,0,0.4)", "transparent"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

      {/* Info side */}
      <View style={styles.packageInfo}>
        {pkg.badge && (
          <View style={styles.packageBadge}>
            <Text style={styles.packageBadgeText}>{pkg.badge}</Text>
          </View>
        )}
        <Text style={styles.packageName}>{pkg.name}</Text>
        <Text style={styles.packageTagline}>{pkg.tagline}</Text>
        <Text style={styles.packageDesc} numberOfLines={3}>
          {pkg.description}
        </Text>
        <View style={styles.packageMeta}>
          <View style={styles.durationPill}>
            <MaterialIcons name="schedule" size={11} color="#60A5FA" />
            <Text style={styles.packageDuration}>{pkg.duration}</Text>
          </View>
          <View style={styles.highlightPill}>
            <Text style={styles.highlightText}>{pkg.highlight}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    position: "relative",
  },
  headerLogo: {
    width: 200,
    height: 64,
  },
  calendarBtn: {
    position: "absolute",
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
  },

  // Next Appointment Banner
  nextApptBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  nextApptLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  nextApptTextWrap: {
    flex: 1,
  },
  nextApptLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: BLUE,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  nextApptDate: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  nextApptPackage: {
    fontSize: 11,
    color: "#9CA3AF",
    marginTop: 2,
  },

  // Video Hero
  heroContainer: {
    marginHorizontal: 0,
    marginBottom: 16,
    borderRadius: 0,
    overflow: "hidden",
    height: Math.round(Dimensions.get("window").height * 0.65),
    backgroundColor: "#111",
  },
  heroGradient: {
    flex: 1,
    justifyContent: "flex-end",
  },
  heroContent: {
    padding: 22,
  },
  heroBlueLine: {
    width: 36,
    height: 3,
    backgroundColor: BLUE,
    borderRadius: 2,
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 34,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    marginBottom: 18,
  },
  heroBtn: {
    alignSelf: "flex-start",
    borderRadius: 100,
    overflow: "hidden",
  },
  heroBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 12,
    gap: 8,
  },
  heroBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  // Stats Strip
  statsStrip: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "900",
    color: BLUE,
  },
  statLabel: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },

  // Section header
  sectionHeader: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionAccent: {
    width: 28,
    height: 3,
    backgroundColor: BLUE,
    borderRadius: 2,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A1A",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 3,
  },

  // Service Pillars
  pillarsRow: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 28,
  },
  pillarCard: {
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  pillarIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(0,87,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  pillarTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 6,
  },
  pillarDesc: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 20,
  },

  // How It Works
  stepsContainer: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  stepRow: {
    flexDirection: "row",
    gap: 16,
  },
  stepLeft: {
    alignItems: "center",
    width: 44,
  },
  stepCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,87,255,0.15)",
    borderWidth: 2,
    borderColor: BLUE,
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: "800",
    color: BLUE,
  },
  stepConnector: {
    width: 2,
    flex: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 6,
    minHeight: 24,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 24,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 4,
    marginTop: 10,
  },
  stepDesc: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 20,
  },

  // Package Cards
  packageCard: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    overflow: "hidden",
    height: 160,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  packageCardReversed: {
    flexDirection: "row-reverse",
  },
  packageImageWrap: {
    width: 130,
    height: "100%",
  },
  packageImage: {
    width: "100%",
    height: "100%",
  },
  packageInfo: {
    flex: 1,
    padding: 14,
    justifyContent: "center",
  },
  packageBadge: {
    backgroundColor: BLUE,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  packageBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  packageName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 2,
  },
  packageTagline: {
    fontSize: 11,
    color: "#6B7280",
    marginBottom: 5,
  },
  packageDesc: {
    fontSize: 11,
    color: "#9CA3AF",
    lineHeight: 16,
    marginBottom: 8,
  },
  packageMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  durationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(0,87,255,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 100,
  },
  packageDuration: {
    fontSize: 10,
    color: BLUE,
    fontWeight: "600",
  },
  highlightPill: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 100,
  },
  highlightText: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "600",
  },

  // Why Choose Us
  whySection: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 28,
  },
  whyRow: {
    flexDirection: "row",
    gap: 14,
    marginTop: 16,
    alignItems: "flex-start",
  },
  whyIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(0,87,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  whyText: {
    flex: 1,
  },
  whyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 3,
  },
  whyDesc: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 19,
  },

  // Final CTA
  ctaSection: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
    alignItems: "center",
  },
  ctaHeadline: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1A1A1A",
    textAlign: "center",
    marginBottom: 6,
  },
  ctaSubtext: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    marginBottom: 20,
  },
  ctaBtn: {
    borderRadius: 100,
    paddingVertical: 16,
    paddingHorizontal: 36,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
