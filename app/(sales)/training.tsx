import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  emoji: string;
  accent: string;
  lessons: Lesson[];
}

interface Lesson {
  id: string;
  title: string;
  content: string;
  duration: string;
}

const SALES_TRAINING: TrainingModule[] = [
  {
    id: "intro",
    title: "Sales Fundamentals",
    description: "Core principles for booking more jobs",
    emoji: "🎯",
    accent: "#2563EB",
    lessons: [
      {
        id: "intro-1",
        title: "The Luxury Wash Sales Approach",
        duration: "5 min",
        content: `Welcome to Luxury Wash On Wheels Sales Training!

Our sales approach is built on three pillars:

1. **Value First** — Lead with the transformation we deliver, not the price. Customers buy clean, shiny, protected vehicles. Paint them that picture.

2. **Urgency Without Pressure** — We have limited availability on each calendar. Let customers know slots fill fast — because they do.

3. **Follow Through** — A scheduled callback is a commitment. Honor it every time.

Key phrases to use:
• "We're one of the top-rated mobile detailing services in [city]"
• "Our team comes to you — no waiting at a shop"
• "We have an opening this week — want me to grab it for you?"`,
      },
      {
        id: "intro-2",
        title: "Understanding Our Services",
        duration: "8 min",
        content: `Know what you're selling inside and out.

**Core Services:**
• Exterior Detail — Full wash, clay bar, tire shine, windows
• Interior Detail — Vacuum, wipe-down, leather conditioning
• Full Detail — Interior + Exterior combined
• Paint Correction — Multi-stage polish for swirl removal
• Ceramic Coating — Long-term paint protection (premium)

**Key Selling Points:**
• Mobile — We come to the customer's home or office
• Professional-grade products
• Insured and background-checked team members
• Before/after photos provided

**Upsell Opportunities:**
• Add ceramic coating to any detail
• Headlight restoration
• Engine bay cleaning
• Odor elimination treatment`,
      },
      {
        id: "intro-3",
        title: "Handling Objections",
        duration: "10 min",
        content: `Common objections and how to handle them:

**"It's too expensive"**
→ "I understand. Our pricing reflects professional-grade products and certified technicians. What's your budget? We have packages starting at [price]."

**"I'll think about it"**
→ "Totally fair! I do want to mention our schedule fills up quickly — I can hold a spot for 24 hours if you'd like. What day works best for you?"

**"I can just go to a car wash"**
→ "Automated car washes actually cause micro-scratches over time. Our hand-detailing protects your paint and adds real value to your vehicle."

**"I'm not ready right now"**
→ "No problem at all! Can I schedule a quick follow-up call for [specific day]? I'll reach back out when you're ready."

Always end with a specific next step — never leave it open-ended.`,
      },
    ],
  },
  {
    id: "booking",
    title: "Booking Mastery",
    description: "How to convert leads into confirmed appointments",
    emoji: "📅",
    accent: "#9333EA",
    lessons: [
      {
        id: "booking-1",
        title: "The Booking Process",
        duration: "6 min",
        content: `Step-by-step booking process:

**Step 1: Qualify**
Ask 3 quick questions:
• "What type of vehicle do you have?"
• "When was the last time it was detailed?"
• "Are you looking for interior, exterior, or both?"

**Step 2: Recommend**
Based on their answers, recommend a specific package. Don't overwhelm with options — give them ONE recommendation.

**Step 3: Check Availability**
Open the booking calendar for their city. "Let me check what we have available..."

**Step 4: Offer Specific Times**
"I have Tuesday at 10am or Thursday at 2pm — which works better for you?"

**Step 5: Confirm**
"Perfect! I'm booking you for [day] at [time]. You'll get a confirmation email at [email]. Is there anything else I can help with?"

**Always record the booking in the app** — it counts toward your daily stats!`,
      },
      {
        id: "booking-2",
        title: "Using the Booking Calendars",
        duration: "4 min",
        content: `How to use the booking system:

1. Tap the **Book** tab at the bottom of the screen
2. Select the customer's **city/location**
3. The booking form will open — fill it out with the customer's information
4. When the customer completes the booking, you'll see a confirmation page
5. Your stats will automatically update

**Important Notes:**
• Each city has its own calendar — make sure you select the right one
• Bookings go directly to the Zapier automation for that city
• The customer receives an automatic confirmation email
• You can book from both the mobile app and the web app

**Pro Tip:** Have the customer on the phone while you fill out the form together — it dramatically increases show rates.`,
      },
    ],
  },
  {
    id: "callbacks",
    title: "Callback Strategy",
    description: "Turn leads into bookings with effective follow-up",
    emoji: "📞",
    accent: "#F59E0B",
    lessons: [
      {
        id: "callback-1",
        title: "The 24-Hour Follow-Up Rule",
        duration: "5 min",
        content: `The most important rule in sales: **follow up within 24 hours**.

Research shows that leads contacted within 1 hour are 7x more likely to convert than those contacted after 24 hours.

**Callback Schedule:**
• Same day if possible
• Next morning at the latest
• Never let a lead go more than 48 hours without contact

**What to say on a callback:**
"Hi [Name], this is [Your Name] from Luxury Wash On Wheels! I'm following up on your interest in getting your [vehicle] detailed. I wanted to reach out while we still have availability this week — do you have 2 minutes?"

**If they don't answer:**
Leave a voicemail AND send a text. Text message follow-ups have a 98% open rate.

**Text template:**
"Hi [Name]! This is [Name] from Luxury Wash On Wheels. I tried calling — we have a few openings this week for your [vehicle]. Reply here or call me back at [number]. 🚗✨"`,
      },
      {
        id: "callback-2",
        title: "Managing Your Callback List",
        duration: "4 min",
        content: `How to stay organized with callbacks:

**In the App:**
1. Go to Dashboard → Callbacks tab
2. Add new callbacks with customer name, phone, and best time to call
3. Mark callbacks as completed when done
4. Track your conversion rate over time

**Prioritization:**
• Hot leads (expressed strong interest) — call same day
• Warm leads (asked for more info) — call within 24 hours
• Cold leads (general inquiry) — call within 48 hours

**Daily Routine:**
• Morning: Review today's scheduled callbacks
• Midday: Make calls, log outcomes
• Evening: Schedule tomorrow's callbacks

**Goal:** 5+ completed callbacks per day with a 30%+ conversion rate.`,
      },
    ],
  },
  {
    id: "performance",
    title: "Performance & Goals",
    description: "Understanding your metrics and hitting targets",
    emoji: "🏆",
    accent: "#22C55E",
    lessons: [
      {
        id: "perf-1",
        title: "Your Daily Goals",
        duration: "3 min",
        content: `Your daily performance targets:

**Jobs Booked:** 5 per day
**Revenue Scheduled:** $2,500 per day
**Callbacks Completed:** 5 per day
**Conversion Rate Target:** 30%+

**How Stats Are Tracked:**
• Jobs booked are automatically counted when a customer completes the booking form
• Revenue is updated when the job is confirmed on the calendar
• Callbacks are tracked manually in the Callbacks tab

**Weekly Targets:**
• 25 jobs booked (Mon-Fri)
• $12,500 in revenue scheduled
• 25 callbacks completed

**Monthly Targets:**
• 100 jobs booked
• $50,000 in revenue scheduled

Top performers consistently exceed these targets by staying organized, following up quickly, and using the booking system efficiently.`,
      },
    ],
  },
];

export default function SalesTrainingScreen() {
  const colors = useColors();
  const [selectedModule, setSelectedModule] = useState<TrainingModule | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set());

  const handleModuleSelect = (module: TrainingModule) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModule(module);
    setSelectedLesson(null);
  };

  const handleLessonSelect = (lesson: Lesson) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLesson(lesson);
  };

  const handleCompleteLesson = () => {
    if (!selectedLesson) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCompletedLessons(prev => new Set([...prev, selectedLesson.id]));
    setSelectedLesson(null);
  };

  // Lesson detail view
  if (selectedLesson && selectedModule) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} className="flex-1 px-0">
        <View style={{
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16,
          backgroundColor: selectedModule.accent,
          flexDirection: "row", alignItems: "center", gap: 12,
        }}>
          <TouchableOpacity
            onPress={() => setSelectedLesson(null)}
            style={{
              backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>← Back</Text>
          </TouchableOpacity>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: "800", color: "#fff" }} numberOfLines={1}>
            {selectedLesson.title}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>
              {selectedLesson.duration} read
            </Text>
            {completedLessons.has(selectedLesson.id) && (
              <View style={{ backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: "#16A34A" }}>✅ Completed</Text>
              </View>
            )}
          </View>
          {selectedLesson.content.split("\n").map((line, i) => {
            const isBold = line.startsWith("**") && line.endsWith("**");
            const isHeader = line.startsWith("**") && !line.endsWith("**");
            const cleanLine = line.replace(/\*\*/g, "");
            if (!cleanLine.trim()) return <View key={i} style={{ height: 8 }} />;
            if (isBold) {
              return (
                <Text key={i} style={{ fontSize: 15, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
                  {cleanLine}
                </Text>
              );
            }
            return (
              <Text key={i} style={{ fontSize: 15, color: colors.foreground, lineHeight: 24, marginBottom: 2 }}>
                {cleanLine}
              </Text>
            );
          })}
          {!completedLessons.has(selectedLesson.id) && (
            <TouchableOpacity
              onPress={handleCompleteLesson}
              style={{
                backgroundColor: selectedModule.accent, borderRadius: 14,
                paddingVertical: 16, alignItems: "center", marginTop: 24,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>✅ Mark as Complete</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </ScreenContainer>
    );
  }

  // Module detail view
  if (selectedModule) {
    const moduleCompleted = selectedModule.lessons.every(l => completedLessons.has(l.id));
    return (
      <ScreenContainer edges={["top", "left", "right"]} className="flex-1 px-0">
        <View style={{
          paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
          backgroundColor: selectedModule.accent,
        }}>
          <TouchableOpacity
            onPress={() => setSelectedModule(null)}
            style={{
              backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start", marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>← Modules</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 28 }}>{selectedModule.emoji}</Text>
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#fff", marginTop: 6 }}>{selectedModule.title}</Text>
          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>{selectedModule.description}</Text>
          {moduleCompleted && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start", marginTop: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>🏆 Module Complete!</Text>
            </View>
          )}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
            {selectedModule.lessons.length} Lessons
          </Text>
          {selectedModule.lessons.map((lesson, idx) => {
            const done = completedLessons.has(lesson.id);
            return (
              <TouchableOpacity
                key={lesson.id}
                onPress={() => handleLessonSelect(lesson)}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16,
                  marginBottom: 10, borderWidth: 1, borderColor: done ? selectedModule.accent : colors.border,
                  flexDirection: "row", alignItems: "center", gap: 12,
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: done ? selectedModule.accent : colors.border,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: done ? "#fff" : colors.muted }}>
                    {done ? "✓" : String(idx + 1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{lesson.title}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{lesson.duration} read</Text>
                </View>
                <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </ScreenContainer>
    );
  }

  // Module list view
  const totalLessons = SALES_TRAINING.reduce((acc, m) => acc + m.lessons.length, 0);
  const completedCount = SALES_TRAINING.reduce((acc, m) => acc + m.lessons.filter(l => completedLessons.has(l.id)).length, 0);
  const overallPct = Math.round((completedCount / totalLessons) * 100);

  return (
    <ScreenContainer edges={["top", "left", "right"]} className="flex-1 px-0">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24,
          backgroundColor: "#1E3A8A",
        }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 }}>
            Sales Training
          </Text>
          <Text style={{ fontSize: 26, fontWeight: "900", color: "#fff" }}>
            🎓 Your Training Hub
          </Text>
          <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
            Master the skills to book more jobs
          </Text>

          {/* Progress */}
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.8)" }}>
                Overall Progress
              </Text>
              <Text style={{ fontSize: 12, fontWeight: "800", color: "#34D399" }}>
                {completedCount}/{totalLessons} lessons
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3 }}>
              <View style={{
                height: "100%", width: `${overallPct}%`,
                backgroundColor: "#34D399", borderRadius: 3,
              }} />
            </View>
          </View>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          {SALES_TRAINING.map((module) => {
            const moduleDone = module.lessons.filter(l => completedLessons.has(l.id)).length;
            const modulePct = Math.round((moduleDone / module.lessons.length) * 100);
            const allDone = moduleDone === module.lessons.length;
            return (
              <TouchableOpacity
                key={module.id}
                onPress={() => handleModuleSelect(module)}
                style={{
                  backgroundColor: colors.surface, borderRadius: 16, padding: 18,
                  borderWidth: 1, borderColor: allDone ? module.accent : colors.border,
                  borderLeftWidth: 4, borderLeftColor: module.accent,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <Text style={{ fontSize: 28 }}>{module.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>{module.title}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{module.description}</Text>
                  </View>
                  {allDone && (
                    <View style={{ backgroundColor: module.accent, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>✓ Done</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{module.lessons.length} lessons</Text>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: module.accent }}>{moduleDone}/{module.lessons.length}</Text>
                </View>
                <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
                  <View style={{
                    height: "100%", width: `${modulePct}%`,
                    backgroundColor: module.accent, borderRadius: 2,
                  }} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
