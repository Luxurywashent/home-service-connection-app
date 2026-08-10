import React, { useRef } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ScreenContainer } from "@/components/screen-container";
import { router } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const VAN_IMAGE = require("@/assets/images/investor/van-transparent.png");
const ADRIAN_IMAGE = require("@/assets/images/investor/adrian-transparent.png");
const FERRARI_IMAGE = require("@/assets/images/investor/ferrari-detail.jpeg");
const BMW_IMAGE = require("@/assets/images/investor/bmw-detail.jpeg");
const TEAM_IMAGE = require("@/assets/images/investor/team-work.jpeg");

// Investment pathway steps
const PATHWAY_STEPS = [
  { icon: "💰", title: "You Invest", desc: "Fund a mobile detailing van" },
  { icon: "🚐", title: "Van Deploys", desc: "Fully equipped & branded" },
  { icon: "⚙️", title: "We Operate", desc: "14 years of proven systems" },
  { icon: "📈", title: "Revenue Flows", desc: "Premium clients, consistent income" },
  { icon: "💎", title: "You Earn", desc: "Dividends paid back to you" },
];

// Stats
const STATS = [
  { value: "14+", label: "Years in Business" },
  { value: "5", label: "Locations" },
  { value: "25%", label: "Target Returns" },
  { value: "6-12", label: "Month Terms" },
];

// VIP Benefits
const VIP_BENEFITS = [
  { icon: "🏆", title: "Monthly Strategy Meetings", desc: "Sit in on company strategy sessions and provide your input as a stakeholder" },
  { icon: "🚗", title: "Free Year of Detailing", desc: "Experience our premium service firsthand — a full year of detailing on us" },
  { icon: "📊", title: "Real-Time Dashboard", desc: "Track your investment performance, payments, and ROI in real-time" },
  { icon: "🤝", title: "Direct Access", desc: "Direct line to leadership — you're not just an investor, you're family" },
];

export default function InvestorPitchScreen() {
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* === HERO SECTION === */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={["#0a1628", "#0d2145", "#0a1e3d"]}
            style={styles.heroGradient}
          >
            {/* Back Button */}
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
            <Animated.View entering={FadeInDown.duration(800)} style={styles.heroContent}>
              <Text style={styles.heroEyebrow}>INVESTMENT OPPORTUNITY</Text>
              <Text style={styles.heroTitle}>
                Your Money.{"\n"}Our System.{"\n"}
                <Text style={styles.heroHighlight}>Real Returns.</Text>
              </Text>
              <Text style={styles.heroSubtitle}>
                Put your capital to work in a proven mobile detailing operation 
                that's been delivering results for over 14 years.
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInUp.delay(400).duration(800)} style={styles.vanContainer}>
              <Image
                source={VAN_IMAGE}
                style={styles.vanImage}
                contentFit="contain"
                tintColor={undefined}
              />
            </Animated.View>
          </LinearGradient>
        </View>

        {/* === STATS BAR === */}
        <View style={styles.statsBar}>
          {STATS.map((stat, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* === PERSONAL MESSAGE === */}
        <View style={styles.section}>
          <Image source={ADRIAN_IMAGE} style={styles.adrianPhoto} contentFit="contain" />
          <View style={styles.messageCard}>
            <View style={styles.messageHeader}>
              <View>
                <Text style={styles.messageName}>Adrian Miller</Text>
                <Text style={styles.messageRole}>Founder & CEO</Text>
              </View>
            </View>
            <Text style={styles.messageText}>
              "I started Luxury Wash On Wheels 14 years ago with one van and a vision. 
              Today, we operate across 5 cities with a fleet of vans serving premium clients 
              who trust us with their Ferraris, BMWs, and everything in between.{"\n\n"}
              Here's what I'm offering you — a chance to be part of this growth. You invest 
              in a van, we put it through our proven system, and you earn returns. It's that simple.{"\n\n"}
              This isn't some startup gamble. This is a 14-year-old machine that prints results. 
              Your money goes in, our system works it, and dividends come back to you. 
              Fast turnaround. Real returns. No guesswork.{"\n\n"}
              I want partners who believe in what we're building. People who want to grow 
              with us — not just watch from the sidelines."
            </Text>
          </View>
        </View>

        {/* === ACTION PHOTOS === */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>THE OPERATION</Text>
          <Text style={styles.sectionTitle}>Premium Service. Premium Clients.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
            <Image source={FERRARI_IMAGE} style={styles.actionPhoto} contentFit="cover" />
            <Image source={BMW_IMAGE} style={styles.actionPhoto} contentFit="cover" />
            <Image source={TEAM_IMAGE} style={styles.actionPhoto} contentFit="cover" />
          </ScrollView>
        </View>

        {/* === INVESTMENT PATHWAY === */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>HOW IT WORKS</Text>
          <Text style={styles.sectionTitle}>Your Path to Returns</Text>
          <Text style={styles.sectionSubtitle}>
            A simple, proven process from investment to dividends
          </Text>

          <View style={styles.pathwayContainer}>
            {PATHWAY_STEPS.map((step, i) => (
              <View key={i} style={styles.pathwayStep}>
                <View style={styles.pathwayIconContainer}>
                  <View style={styles.pathwayIconCircle}>
                    <Text style={styles.pathwayIcon}>{step.icon}</Text>
                  </View>
                  {i < PATHWAY_STEPS.length - 1 && (
                    <View style={styles.pathwayLine} />
                  )}
                </View>
                <View style={styles.pathwayTextContainer}>
                  <Text style={styles.pathwayTitle}>{step.title}</Text>
                  <Text style={styles.pathwayDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* === INVESTMENT TIERS === */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>INVESTMENT OPTIONS</Text>
          <Text style={styles.sectionTitle}>Choose Your Level</Text>

          {/* Standard Tier */}
          <View style={styles.tierCard}>
            <View style={styles.tierHeader}>
              <Text style={styles.tierName}>Standard Investor</Text>
              <View style={styles.tierBadge}>
                <Text style={styles.tierBadgeText}>POPULAR</Text>
              </View>
            </View>
            <Text style={styles.tierAmount}>$5,000 - $20,000</Text>
            <Text style={styles.tierReturn}>Target: 25% return in 6-12 months</Text>
            <View style={styles.tierFeatures}>
              <Text style={styles.tierFeature}>✓  Monthly dividend payments</Text>
              <Text style={styles.tierFeature}>✓  Real-time investment dashboard</Text>
              <Text style={styles.tierFeature}>✓  Quarterly performance reports</Text>
              <Text style={styles.tierFeature}>✓  Direct communication with leadership</Text>
            </View>
          </View>

          {/* VIP Tier */}
          <LinearGradient
            colors={["#1565C0", "#0D47A1"]}
            style={styles.vipTierCard}
          >
            <View style={styles.tierHeader}>
              <Text style={styles.vipTierName}>VIP Investor</Text>
              <View style={styles.vipTierBadge}>
                <Text style={styles.vipTierBadgeText}>EXCLUSIVE</Text>
              </View>
            </View>
            <Text style={styles.vipTierAmount}>$30,000+</Text>
            <Text style={styles.vipTierReturn}>Target: 25%+ return with VIP perks</Text>
            <View style={styles.tierFeatures}>
              <Text style={styles.vipTierFeature}>✓  Everything in Standard</Text>
              <Text style={styles.vipTierFeature}>✓  Monthly company strategy meetings</Text>
              <Text style={styles.vipTierFeature}>✓  Your input shapes company direction</Text>
              <Text style={styles.vipTierFeature}>✓  FREE year of detailing services</Text>
              <Text style={styles.vipTierFeature}>✓  Priority dividend payments</Text>
              <Text style={styles.vipTierFeature}>✓  Exclusive investor events</Text>
            </View>
          </LinearGradient>
        </View>

        {/* === VIP BENEFITS DETAIL === */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>VIP EXCLUSIVE</Text>
          <Text style={styles.sectionTitle}>More Than an Investor</Text>
          <Text style={styles.sectionSubtitle}>
            Top-tier investors don't just earn — they become part of the inner circle
          </Text>

          {VIP_BENEFITS.map((benefit, i) => (
            <View key={i} style={styles.benefitCard}>
              <View style={styles.benefitIcon}>
                <Text style={styles.benefitIconText}>{benefit.icon}</Text>
              </View>
              <View style={styles.benefitContent}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDesc}>{benefit.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* === SOCIAL PROOF === */}
        <View style={styles.section}>
          <View style={styles.proofCard}>
            <Text style={styles.proofQuote}>
              "I've been in business 14 years. I've built this from nothing to a multi-city 
              operation. Now I'm giving you the opportunity to ride with us. 
              Your money works while you sleep."
            </Text>
            <Text style={styles.proofAuthor}>— Adrian Miller, Founder</Text>
          </View>
        </View>

        {/* === CTA SECTION === */}
        <View style={styles.ctaSection}>
          <LinearGradient
            colors={["#1565C0", "#0D47A1", "#0a2d6e"]}
            style={styles.ctaGradient}
          >
            <Text style={styles.ctaTitle}>Ready to Grow With Us?</Text>
            <Text style={styles.ctaSubtitle}>
              Join the investors who are already earning returns with Luxury Wash On Wheels
            </Text>

            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => router.push("/investor-login" as any)}
            >
              <Text style={styles.ctaButtonText}>Sign In to Investor Portal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ctaSecondaryButton}
              onPress={() => router.push("/investor-login" as any)}
            >
              <Text style={styles.ctaSecondaryText}>Already an investor? Log in here</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Luxury Wash On Wheels © 2012-2026
          </Text>
          <Text style={styles.footerDisclaimer}>
            Investment involves risk. Past performance does not guarantee future results. 
            All investment terms are subject to individual agreements.
          </Text>
        </View>
      </ScrollView>

      {/* Floating CTA */}
      <View style={styles.floatingCta}>
        <TouchableOpacity
          style={styles.floatingButton}
          onPress={() => router.push("/investor-inquiry" as any)}
        >
          <Text style={styles.floatingButtonText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 100 },

  // Hero
  heroSection: { width: "100%" },
  heroGradient: { paddingTop: 16, paddingBottom: 20, paddingHorizontal: 24 },
  heroContent: { marginBottom: 24 },
  heroEyebrow: { color: "#60A5FA", fontSize: 12, fontWeight: "700", letterSpacing: 2, marginBottom: 12 },
  heroTitle: { color: "#fff", fontSize: 36, fontWeight: "800", lineHeight: 44, marginBottom: 16 },
  heroHighlight: { color: "#60A5FA" },
  heroSubtitle: { color: "#D1D5DB", fontSize: 16, lineHeight: 24 },
  vanContainer: { alignItems: "center", marginTop: 8, backgroundColor: "transparent" },
  vanImage: { width: SCREEN_WIDTH - 48, height: 180, backgroundColor: "transparent" },
  adrianPhoto: { width: SCREEN_WIDTH * 0.65, height: 280, alignSelf: "center", marginBottom: -16, backgroundColor: "transparent" },

  // Stats
  statsBar: { flexDirection: "row", backgroundColor: "#0d1f3c", paddingVertical: 20, paddingHorizontal: 12 },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { color: "#60A5FA", fontSize: 22, fontWeight: "800" },
  statLabel: { color: "#9CA3AF", fontSize: 10, marginTop: 4, textAlign: "center" },

  // Sections
  section: { paddingHorizontal: 24, paddingVertical: 32 },
  sectionEyebrow: { color: "#3B82F6", fontSize: 11, fontWeight: "700", letterSpacing: 2, marginBottom: 8 },
  sectionTitle: { color: "#fff", fontSize: 26, fontWeight: "800", marginBottom: 8 },
  sectionSubtitle: { color: "#9CA3AF", fontSize: 15, lineHeight: 22, marginBottom: 24 },

  // Personal Message
  messageCard: { backgroundColor: "#0d1f3c", borderRadius: 16, padding: 24, borderWidth: 1, borderColor: "#1e3a5f" },
  messageHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  messageAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#1565C0", alignItems: "center", justifyContent: "center", marginRight: 12 },
  messageAvatarText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  messageName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  messageRole: { color: "#9CA3AF", fontSize: 13 },
  messageText: { color: "#D1D5DB", fontSize: 15, lineHeight: 24, fontStyle: "italic" },

  // Action Photos
  photoScroll: { marginTop: 16 },
  actionPhoto: { width: SCREEN_WIDTH * 0.7, height: 220, borderRadius: 12, marginRight: 12 },

  // Pathway
  pathwayContainer: { marginTop: 8 },
  pathwayStep: { flexDirection: "row", marginBottom: 4 },
  pathwayIconContainer: { alignItems: "center", width: 56 },
  pathwayIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#0d2145", borderWidth: 2, borderColor: "#1565C0", alignItems: "center", justifyContent: "center" },
  pathwayIcon: { fontSize: 20 },
  pathwayLine: { width: 2, flex: 1, backgroundColor: "#1565C0", marginVertical: 4, opacity: 0.5 },
  pathwayTextContainer: { flex: 1, paddingLeft: 12, paddingTop: 10, paddingBottom: 20 },
  pathwayTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  pathwayDesc: { color: "#9CA3AF", fontSize: 14 },

  // Tiers
  tierCard: { backgroundColor: "#0d1f3c", borderRadius: 16, padding: 24, borderWidth: 1, borderColor: "#1e3a5f", marginBottom: 16 },
  tierHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  tierName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  tierBadge: { backgroundColor: "#22C55E20", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  tierBadgeText: { color: "#22C55E", fontSize: 10, fontWeight: "700" },
  tierAmount: { color: "#60A5FA", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  tierReturn: { color: "#9CA3AF", fontSize: 14, marginBottom: 16 },
  tierFeatures: { gap: 10 },
  tierFeature: { color: "#D1D5DB", fontSize: 14, lineHeight: 20 },

  vipTierCard: { borderRadius: 16, padding: 24, marginBottom: 16 },
  vipTierName: { color: "#fff", fontSize: 18, fontWeight: "700" },
  vipTierBadge: { backgroundColor: "#FBBF2420", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  vipTierBadgeText: { color: "#FBBF24", fontSize: 10, fontWeight: "700" },
  vipTierAmount: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  vipTierReturn: { color: "#E9D5FF", fontSize: 14, marginBottom: 16 },
  vipTierFeature: { color: "#fff", fontSize: 14, lineHeight: 20 },

  // VIP Benefits
  benefitCard: { flexDirection: "row", backgroundColor: "#0d1f3c", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#1e3a5f" },
  benefitIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#1565C020", alignItems: "center", justifyContent: "center", marginRight: 14 },
  benefitIconText: { fontSize: 22 },
  benefitContent: { flex: 1 },
  benefitTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 4 },
  benefitDesc: { color: "#9CA3AF", fontSize: 13, lineHeight: 20 },

  // Proof
  proofCard: { backgroundColor: "#0d1f3c", borderRadius: 16, padding: 24, borderLeftWidth: 3, borderLeftColor: "#1565C0" },
  proofQuote: { color: "#D1D5DB", fontSize: 16, lineHeight: 26, fontStyle: "italic", marginBottom: 12 },
  proofAuthor: { color: "#60A5FA", fontSize: 14, fontWeight: "600" },

  // CTA
  ctaSection: { marginTop: 16 },
  ctaGradient: { padding: 32, alignItems: "center" },
  ctaTitle: { color: "#fff", fontSize: 26, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  ctaSubtitle: { color: "#E9D5FF", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 28 },
  ctaButton: { backgroundColor: "#fff", paddingVertical: 16, paddingHorizontal: 40, borderRadius: 30, marginBottom: 16 },
  ctaButtonText: { color: "#0D47A1", fontSize: 16, fontWeight: "800" },
  ctaSecondaryButton: { paddingVertical: 12 },
  ctaSecondaryText: { color: "#E9D5FF", fontSize: 14, textDecorationLine: "underline" },

  // Footer
  footer: { padding: 24, alignItems: "center" },
  footerText: { color: "#6B7280", fontSize: 12, marginBottom: 8 },
  footerDisclaimer: { color: "#4B5563", fontSize: 10, textAlign: "center", lineHeight: 16 },

  // Floating CTA
  floatingCta: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingVertical: 16, backgroundColor: "rgba(10, 22, 40, 0.95)", borderTopWidth: 1, borderTopColor: "#1e3a5f" },
  floatingButton: { backgroundColor: "#1565C0", paddingVertical: 16, borderRadius: 30, alignItems: "center" },
  backButton: { marginBottom: 16, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 2 },
  backButtonText: { color: "#60A5FA", fontSize: 15, fontWeight: "600" },
  floatingButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
