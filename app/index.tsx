import { useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useCustomerAuth } from "@/lib/customer-context";

const BLUE = "#0057FF";
const DARK_BLUE = "#003DBF";
const BLACK = "#000000";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

const HERO_VIDEO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/smgYJKbBuUGgNeYq.mov";

const LOGO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZqxpZtYbMceGAmri.png";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "You Book",
    description:
      "Choose your service, pick a date and time, and tell us where to come.",
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

const PACKAGES = [
  {
    id: "luxury_detail",
    name: "Luxury Detail",
    tagline: "The ultimate experience",
    description:
      "Our flagship service. Every inch of your vehicle treated to perfection — paint correction, full interior, and ceramic protection.",
    image: {
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
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/CJtStJgrxOtnDyjx.jpeg",
    },
    duration: "1–2 hrs",
    badge: null,
    highlight: "Great for maintenance",
  },
  {
    id: "exterior_detail",
    name: "Exterior Detail",
    tagline: "Shine from the outside",
    description:
      "Hand wash, clay bar prep, polish, and paint sealant for a showroom finish that lasts.",
    image: {
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/QnseblgQOubRMDke.jpeg",
    },
    duration: "1½–2 hrs",
    badge: null,
    highlight: "Mirror-like finish",
  },
  {
    id: "interior_detail",
    name: "Interior Detail",
    tagline: "Deep clean inside",
    description:
      "Full interior deep clean — seats, carpets, dashboard, door panels, and more. Odor elimination included.",
    image: {
      uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/rGcUJmkinKXyJmpu.jpeg",
    },
    duration: "2–2½ hrs",
    badge: null,
    highlight: "Fresh interior",
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isAdmin, isOpsManager, isSalesRep, isDoorHangerRep, loading } =
    useEmployeeAuth();
  const { isCustomerAuthenticated, loading: customerLoading } = useCustomerAuth();

  // Set up the hero video player — muted, looping, auto-play
  const player = useVideoPlayer(HERO_VIDEO_URL, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    player.muted = true;
    player.play();
    return () => {
      // Release the native video player when this screen unmounts to prevent memory leaks
      // and native crashes during rapid navigation (e.g. auth redirect after booking)
      try { player.release?.(); } catch (_) {}
    };
  }, []);

  const pathname = usePathname();

  // Redirect to the right screen based on auth state.
  // IMPORTANT: Only redirect when the user is actually on the root index screen ("/").
  // If we redirect from any other screen (e.g. after booking success), it causes a
  // double router.replace crash on iOS native stack.
  useEffect(() => {
    if (!loading && !customerLoading && pathname === "/") {
      if (isAuthenticated) {
        // Employee/admin portals
        if (isOpsManager) {
          router.replace("/(tabs)/ops-punctuality" as any);
        } else if (isAdmin) {
          router.replace("/(tabs)/admin-dashboard" as any);
        } else if (isSalesRep || isDoorHangerRep) {
          router.replace("/(sales)/dashboard" as any);
        } else {
          router.replace("/(tabs)" as any);
        }
      } else {
        // Everyone else (customers logged in or guests) → customer home
        router.replace("/(customer)/home" as any);
      }
    }
  }, [loading, customerLoading, isAuthenticated, isCustomerAuthenticated, isOpsManager, isAdmin, pathname]);

  const handleBookNow = () => {
    // Allow guests to book without login - they'll enter their info during checkout
    router.push("/(customer)/book/vehicle" as any);
  };

  const handleLogin = () => {
    router.push("/login" as any);
  };

  // Show a blank screen while auth state is loading to avoid a flash of the
  // marketing page before the redirect fires.
  if (loading || customerLoading) {
    return <View style={{ flex: 1, backgroundColor: "#000000" }} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ backgroundColor: "#000000" }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Image
            source={{ uri: LOGO_URL }}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <MaterialIcons name="person-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* ── Video Hero ──────────────────────────────────────────── */}
        <View style={styles.heroContainer}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            nativeControls={false}
          />
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
                onPress={handleBookNow}
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
            <Text style={styles.statNumber}>6,500+</Text>
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
              <View style={styles.stepLeft}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{step.step}</Text>
                </View>
                {index < HOW_IT_WORKS.length - 1 && (
                  <View style={styles.stepConnector} />
                )}
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDesc}>{step.description}</Text>
              </View>
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
            onBook={handleBookNow}
          />
        ))}

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
              desc: "We use professional-grade chemicals and tools — the same products used by luxury dealerships.",
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
          <TouchableOpacity onPress={handleBookNow} activeOpacity={0.85}>
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

        {/* ── Footer ──────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <MaterialIcons name="location-on" size={14} color="#6B7280" />
          <Text style={styles.footerText}>
            Pensacola · Destin · Crestview · Niceville · Fort Walton Beach
          </Text>
        </View>
      </ScrollView>

      {/* ── Floating Sign In / Create Account Bar ───────────────── */}
      <View style={[styles.floatingBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.floatingPrimaryBtn} onPress={handleBookNow} activeOpacity={0.88}>
          <Text style={styles.floatingPrimaryText}>Create Account & Book</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.floatingSecondaryBtn} onPress={handleLogin} activeOpacity={0.8}>
          <Text style={styles.floatingSecondaryText}>Sign In</Text>
        </TouchableOpacity>
      </View>
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
  container: {
    flex: 1,
    backgroundColor: BLACK,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: "#000000",
    position: "relative",
  },
  headerLogo: {
    width: 200,
    height: 64,
  },
  loginBtn: {
    position: "absolute",
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#1A1A2E",
    borderWidth: 1,
    borderColor: "#1E3A5F",
    justifyContent: "center",
    alignItems: "center",
  },
  // Video Hero
  heroContainer: {
    marginHorizontal: 0,
    marginBottom: 16,
    borderRadius: 0,
    overflow: "hidden",
    height: Math.round(SCREEN_HEIGHT * 0.68),
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
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#1E3A5F",
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
    color: "#9CA3AF",
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: "#1E3A5F",
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
    color: "#FFFFFF",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 3,
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
    backgroundColor: "#1E3A5F",
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
    color: "#FFFFFF",
    marginBottom: 4,
    marginTop: 10,
  },
  stepDesc: {
    fontSize: 13,
    color: "#9CA3AF",
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
    borderColor: "#1E3A5F",
    backgroundColor: "#111827",
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
    color: "#FFFFFF",
    marginBottom: 2,
  },
  packageTagline: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    marginBottom: 5,
  },
  packageDesc: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
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
    color: "#60A5FA",
    fontWeight: "600",
  },
  highlightPill: {
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 100,
  },
  highlightText: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
  },
  // Service Pillars
  pillarsRow: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 28,
  },
  pillarCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "#1E3A5F",
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
    color: "#FFFFFF",
    marginBottom: 6,
  },
  pillarDesc: {
    fontSize: 13,
    color: "#9CA3AF",
    lineHeight: 20,
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
    color: "#FFFFFF",
    marginBottom: 3,
  },
  whyDesc: {
    fontSize: 13,
    color: "#9CA3AF",
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
    color: "#FFFFFF",
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
  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  footerText: {
    fontSize: 11,
    color: "#6B7280",
    textAlign: "center",
    flex: 1,
    lineHeight: 17,
  },
  // Floating Auth Bar
  floatingBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "rgba(10,10,10,0.97)",
    borderTopWidth: 1,
    borderTopColor: "#1E3A5F",
    gap: 8,
  },
  floatingPrimaryBtn: {
    backgroundColor: BLUE,
    borderRadius: 100,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  floatingPrimaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  floatingSecondaryBtn: {
    borderRadius: 100,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1E3A5F",
  },
  floatingSecondaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9CA3AF",
  },
});
