import React, { useState, useRef, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Image, Animated, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { useStepOverrides } from "@/hooks/use-step-overrides";
import { InteractiveVideoGate } from "@/components/interactive-video-gate";
import { ModuleToolsScreen } from "@/components/module-tools-screen";

const VEHICLE_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_interior-YZAGdgNPwHaMWgn2UMvpaa.png";
const VACUUM_IMG  = "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_vacuum-NibYoEjTDYHUwq6TN4rDu9.png";
const SEATS_IMG   = "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_cloth_seats-UF8BWMx8ZgvojRKwhg2bb4.png";
const LEATHER_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_leather_seats-cDhTbZGuMscD2GhXHii44w.png";
const WINDOWS_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_windows-SsFPZDT5p9LGxiZaT5Nwbh.png";
const DRESSING_IMG= "https://d2xsxph8kpxj0f.cloudfront.net/310519663471903126/n2wVeYQgKmefAVwyN2KSSe/v2_dressing-jGmpM86Uzd3FNJh7tmiFi5.png";

const ASSETS = {
  car:         VEHICLE_IMG,
  allPurpose:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZalbSzHhFnIdhpPH.png",
  degreaser:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WSuWfFRKJAWNAEIx.png",
  brakeBuster: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/lhsuZUYbhiBKKqpd.png",
  greenBrush:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NelUOcEPRlqCgFRv.png",
  detailBrush: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/FYnkxOMqIwUaQBBY.png",
  washMitt:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/PgjXXPdhTyflzwoX.png",
};

interface Choice { id: string; label: string; image: string; }
interface Step {
  id: string; title: string; instruction: string; area: string;
  question: string; choices: Choice[]; correctId: string;
  wrongExplanation: string; correctExplanation: string; proTip: string;
  vehicleImg?: string;
}

const STEPS: Step[] = [
  {
    id: "step1",
    title: "Step 1 — Remove Trash & Floor Mats",
    instruction: "Start by removing ALL trash from the vehicle — cup holders, door pockets, seat pockets, and under seats. Then remove ALL floor mats. Shake mats out and set them aside for separate cleaning.",
    area: "🗑️ Interior — Remove Trash & Mats",
    vehicleImg: VEHICLE_IMG,
    question: "What is the FIRST step of the interior cleaning process?",
    choices: [
      { id: "trashMats",  label: "Remove Trash & Mats", image: ASSETS.allPurpose },
      { id: "vacuum",     label: "Start Vacuuming",     image: ASSETS.degreaser },
      { id: "wipeDown",   label: "Wipe Down Surfaces",  image: ASSETS.greenBrush },
    ],
    correctId: "trashMats",
    wrongExplanation: "❌ Wrong! Always remove trash and floor mats FIRST — vacuuming over trash is inefficient and mats must be removed for proper carpet cleaning.",
    correctExplanation: "✅ Correct! Remove all trash and floor mats first — this clears the way for thorough vacuuming and surface cleaning.",
    proTip: "💡 Pro Tip: Check UNDER the seats and in ALL pockets — customers often leave valuables. If you find something, set it on the seat where the customer can see it.",
  },
  {
    id: "step2",
    title: "Step 2 — Clean the Headliner",
    instruction: "Spray All-Purpose Cleaner onto an All-Purpose Towel (NOT directly onto the headliner). Gently wipe the headliner. Use light pressure — the headliner fabric can sag if it gets too wet.",
    area: "🪟 Interior — Headliner",
    vehicleImg: VEHICLE_IMG,
    question: "How do you apply cleaner to the headliner?",
    choices: [
      { id: "onTowel",   label: "Spray on Towel First", image: ASSETS.allPurpose },
      { id: "onHeadliner","label": "Spray on Headliner", image: ASSETS.degreaser },
      { id: "noClean",   label: "Skip — Vacuum Only",   image: ASSETS.greenBrush },
    ],
    correctId: "onTowel",
    wrongExplanation: "❌ Wrong! Never spray directly on the headliner — too much moisture can cause the headliner to sag and separate from the roof.",
    correctExplanation: "✅ Correct! Always spray the cleaner on the towel first, then wipe — this controls moisture and prevents headliner damage.",
    proTip: "💡 Pro Tip: Use very light pressure on the headliner — it's delicate. If there's a stain, dab gently rather than scrubbing.",
  },
  {
    id: "step3",
    title: "Step 3 — Clean Door Panels & Dashboard",
    instruction: "Spray All-Purpose Cleaner on the door panels and dashboard. Use the Detail Brush to get into all the vents, buttons, and crevices. Then wipe down with the All-Purpose Towel.",
    area: "🚗 Interior — Door Panels & Dash",
    vehicleImg: VEHICLE_IMG,
    question: "Which tool do you use to clean vents and button crevices?",
    choices: [
      { id: "detailBrush", label: "Detail Brush",       image: ASSETS.detailBrush },
      { id: "greenBrush",  label: "Green Brush",        image: ASSETS.greenBrush },
      { id: "allPurpose",  label: "All-Purpose Towel",  image: ASSETS.allPurpose },
    ],
    correctId: "detailBrush",
    wrongExplanation: "❌ Wrong! The Green Brush is too large and stiff for interior vents. The towel can't reach into crevices. Use the Detail Brush.",
    correctExplanation: "✅ Correct! The Detail Brush is perfect for vents, buttons, and crevices — it reaches where towels can't and is gentle on surfaces.",
    proTip: "💡 Pro Tip: Use the Detail Brush in a flicking motion on vents — this pushes dust out rather than just moving it around.",
  },
  {
    id: "step4",
    title: "Step 4 — Vacuum All Surfaces",
    instruction: "Vacuum the entire interior — seats, carpet, floor, under seats, and the trunk. Use the crevice tool for tight spaces. Vacuum BEFORE wiping down seats to remove loose debris first.",
    area: "🧹 Interior — Vacuuming",
    vehicleImg: VACUUM_IMG,
    question: "When do you vacuum — before or after wiping down seats?",
    choices: [
      { id: "before",  label: "Before Wiping Seats",  image: ASSETS.allPurpose },
      { id: "after",   label: "After Wiping Seats",   image: ASSETS.degreaser },
      { id: "either",  label: "Doesn't Matter",       image: ASSETS.greenBrush },
    ],
    correctId: "before",
    wrongExplanation: "❌ Wrong! Vacuum BEFORE wiping — vacuuming first removes loose debris so you're not just pushing it around when you wipe.",
    correctExplanation: "✅ Correct! Vacuum before wiping seats — this removes loose debris so the wipe-down is actually cleaning, not just spreading dirt.",
    proTip: "💡 Pro Tip: Don't forget the trunk! Many customers expect the trunk to be vacuumed as part of the interior service.",
  },
  {
    id: "step5",
    title: "Step 5 — Clean Kick Plates",
    instruction: "Clean the kick plates (the metal or plastic strips at the bottom of each door opening). These are high-traffic areas that collect dirt and scuff marks. Use All-Purpose Cleaner and the All-Purpose Towel.",
    area: "🚪 Interior — Kick Plates",
    vehicleImg: VEHICLE_IMG,
    question: "What are kick plates and where are they located?",
    choices: [
      { id: "doorBottom", label: "Bottom of Door Openings", image: ASSETS.allPurpose },
      { id: "pedals",     label: "Foot Pedals",             image: ASSETS.degreaser },
      { id: "doorHandle", label: "Door Handles",            image: ASSETS.greenBrush },
    ],
    correctId: "doorBottom",
    wrongExplanation: "❌ Wrong! Kick plates are the strips at the bottom of each door opening — not the pedals or door handles.",
    correctExplanation: "✅ Correct! Kick plates are the strips at the bottom of each door opening — they take a lot of abuse from feet and need thorough cleaning.",
    proTip: "💡 Pro Tip: Kick plates often have scuff marks from shoes. For stubborn scuffs, use a slightly damp Detail Brush with All-Purpose Cleaner.",
  },
  {
    id: "step6",
    title: "Step 6 — Clean Cloth Seats",
    instruction: "For CLOTH seats: Spray All-Purpose Cleaner on the seat, agitate with the Green Brush in straight lines, then wipe clean with the All-Purpose Towel. For stains, let the cleaner dwell for 30 seconds before agitating.",
    area: "💺 Interior — Cloth Seats",
    vehicleImg: SEATS_IMG,
    question: "Which brush do you use to agitate cloth seats?",
    choices: [
      { id: "greenBrush",  label: "Green Brush",   image: ASSETS.greenBrush },
      { id: "detailBrush", label: "Detail Brush",  image: ASSETS.detailBrush },
      { id: "washMitt",    label: "Wash Mitt",     image: ASSETS.washMitt },
    ],
    correctId: "greenBrush",
    wrongExplanation: "❌ Wrong! The Detail Brush is too small for seats. The Wash Mitt is for exterior paint. The Green Brush is the right tool for cloth seats.",
    correctExplanation: "✅ Correct! The Green Brush is used to agitate cloth seats — its stiff bristles lift embedded dirt from the fabric fibers.",
    proTip: "💡 Pro Tip: Work in straight lines on cloth seats — circular motions can cause the fabric to pill. Straight lines are more effective and safer.",
  },
  {
    id: "step7",
    title: "Step 7 — Clean Leather Seats",
    instruction: "For LEATHER seats: Spray All-Purpose Cleaner on the All-Purpose Towel (NOT directly on leather). Wipe gently. Then apply Leather Conditioner to protect and moisturize the leather.",
    area: "💺 Interior — Leather Seats",
    vehicleImg: LEATHER_IMG,
    question: "How do you apply cleaner to leather seats?",
    choices: [
      { id: "onTowel",   label: "Spray on Towel First", image: ASSETS.allPurpose },
      { id: "onLeather", label: "Spray on Leather",     image: ASSETS.degreaser },
      { id: "noClean",   label: "Just Condition It",    image: ASSETS.greenBrush },
    ],
    correctId: "onTowel",
    wrongExplanation: "❌ Wrong! Never spray directly on leather — too much moisture can damage the leather. Spray on the towel first for controlled application.",
    correctExplanation: "✅ Correct! Spray cleaner on the towel first, then wipe leather — this prevents over-saturation that can damage or discolor leather.",
    proTip: "💡 Pro Tip: After cleaning, always apply Leather Conditioner — leather dries out and cracks without conditioning. This is what makes the interior look premium.",
  },
  {
    id: "step8",
    title: "Step 8 — Clean Carpet",
    instruction: "Spray All-Purpose Cleaner on the carpet and agitate with the Green Brush. For stubborn stains, let it dwell for 60 seconds. Wipe up with the All-Purpose Towel and vacuum any remaining residue.",
    area: "🏠 Interior — Carpet",
    vehicleImg: VACUUM_IMG,
    question: "For stubborn carpet stains, how long do you let the cleaner dwell?",
    choices: [
      { id: "60sec",  label: "60 Seconds",    image: ASSETS.allPurpose },
      { id: "5sec",   label: "5 Seconds",     image: ASSETS.degreaser },
      { id: "5min",   label: "5 Minutes",     image: ASSETS.greenBrush },
    ],
    correctId: "60sec",
    wrongExplanation: "❌ Wrong! 5 seconds isn't enough dwell time. 5 minutes may cause the product to dry and leave residue. 60 seconds is the right dwell time.",
    correctExplanation: "✅ Correct! Let All-Purpose Cleaner dwell for 60 seconds on stubborn carpet stains — this gives it time to penetrate and break down the stain.",
    proTip: "💡 Pro Tip: After cleaning carpet, do a final vacuum pass — this lifts the carpet fibers back up and removes any remaining cleaner residue.",
  },
  {
    id: "step9",
    title: "Step 9 — Final Blow Out & Wipe Down",
    instruction: "Use the blower to blow out any remaining debris from vents, crevices, and tight spaces. Then do a final wipe-down of all surfaces with a clean All-Purpose Towel.",
    area: "💨 Interior — Final Blow & Wipe",
    vehicleImg: VEHICLE_IMG,
    question: "What is the purpose of the final blow-out?",
    choices: [
      { id: "debris",  label: "Remove Debris from Crevices", image: ASSETS.allPurpose },
      { id: "dry",     label: "Dry the Carpet",              image: ASSETS.degreaser },
      { id: "smell",   label: "Freshen the Air",             image: ASSETS.greenBrush },
    ],
    correctId: "debris",
    wrongExplanation: "❌ Wrong! The blower is used to remove debris from vents and crevices — not to dry carpet or freshen air.",
    correctExplanation: "✅ Correct! The final blow-out removes debris from vents, crevices, and tight spaces that the vacuum and towels can't reach.",
    proTip: "💡 Pro Tip: After blowing out, do one final vacuum pass to pick up everything the blower dislodged — this is what separates a good detail from a great one.",
  },
  {
    id: "step10",
    title: "Step 10 — Clean Interior Windows",
    instruction: "Spray Glass Cleaner on the All-Purpose Towel and wipe all interior glass — windshield, rear window, and side windows. Use a second clean towel to buff to a streak-free finish.",
    area: "🪟 Interior — Windows",
    vehicleImg: WINDOWS_IMG,
    question: "How do you apply glass cleaner to interior windows?",
    choices: [
      { id: "onTowel",   label: "Spray on Towel First", image: ASSETS.allPurpose },
      { id: "onGlass",   label: "Spray on Glass",       image: ASSETS.degreaser },
      { id: "noSpray",   label: "Use Dry Towel Only",   image: ASSETS.washMitt },
    ],
    correctId: "onTowel",
    wrongExplanation: "❌ Wrong! Spraying directly on interior glass can overspray onto the headliner or dashboard. Always spray on the towel first.",
    correctExplanation: "✅ Correct! Spray glass cleaner on the towel first — this prevents overspray onto the headliner, dashboard, and other interior surfaces.",
    proTip: "💡 Pro Tip: Use two towels for windows — one to clean, one to buff. The buffing towel removes streaks for a crystal-clear finish.",
  },
  {
    id: "step11",
    title: "Step 11 — Apply Interior Dressing",
    instruction: "Apply Interior Dressing to all plastic and vinyl surfaces — dashboard, door panels, center console, and trim. Apply to the towel first, then wipe onto surfaces. This protects and gives a clean, matte finish.",
    area: "✨ Interior — Dressing",
    vehicleImg: DRESSING_IMG,
    question: "Which surfaces do you apply Interior Dressing to?",
    choices: [
      { id: "plasticVinyl", label: "Plastic & Vinyl Surfaces", image: ASSETS.allPurpose },
      { id: "seats",        label: "Seats & Carpet",           image: ASSETS.degreaser },
      { id: "windows",      label: "Windows & Glass",          image: ASSETS.greenBrush },
    ],
    correctId: "plasticVinyl",
    wrongExplanation: "❌ Wrong! Interior Dressing is for plastic and vinyl surfaces only — never apply it to seats, carpet, or glass.",
    correctExplanation: "✅ Correct! Interior Dressing is applied to plastic and vinyl surfaces — dashboard, door panels, console, and trim.",
    proTip: "💡 Pro Tip: Use a MATTE dressing, not a glossy one — glossy dressing on the dashboard creates glare that can be a safety hazard for the driver.",
  },
];

function ChoiceCard({ choice, onPress, state, colors }: { choice: Choice; onPress: () => void; state: "idle" | "correct" | "wrong" | "disabled"; colors: any; }) {
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);
  React.useEffect(() => { if (state === "wrong") triggerShake(); }, [state, triggerShake]);
  const borderColor = state === "correct" ? "#22C55E" : state === "wrong" ? "#EF4444" : colors.border;
  const bgColor = state === "correct" ? "#F0FDF4" : state === "wrong" ? "#FEF2F2" : colors.surface;
  return (
    <Animated.View style={{ transform: [{ translateX: shakeAnim }], flex: 1 }}>
      <Pressable
        onPress={state === "idle" ? onPress : undefined}
        style={({ pressed }) => ({ opacity: pressed && state === "idle" ? 0.8 : state === "disabled" ? 0.35 : 1, transform: [{ scale: pressed && state === "idle" ? 0.96 : 1 }], backgroundColor: bgColor, borderWidth: 2, borderColor, borderRadius: 14, padding: 10, alignItems: "center", gap: 6, minHeight: 64, justifyContent: "center" })}
      >
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>{choice.label}</Text>
        {state === "correct" && <Text style={{ fontSize: 16 }}>✅</Text>}
        {state === "wrong" && <Text style={{ fontSize: 16 }}>❌</Text>}
      </Pressable>
    </Animated.View>
  );
}

export default function InteriorCleaningTraining() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [moduleVideoWatched, setModuleVideoWatched] = useState(false);
  const [toolsViewed, setToolsViewed] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const progressMutation = trpc.training.updateProgress.useMutation();
    const quizQuery = trpc.training.getQuizQuestions.useQuery(
    { moduleId: "TM_INTERIOR" },
    { staleTime: 5 * 60 * 1000, enabled: showQuiz }
  );
  const quizQuestions = quizQuery.data || [];
  const { applyOverrides, moduleVideoUrl: hookModuleVideoUrl } = useStepOverrides("interior-cleaning");
  const steps = applyOverrides(STEPS);

  const step = steps[currentStep];
  const progressPct = (currentStep / steps.length) * 100;

  const handleChoicePress = useCallback((choiceId: string) => {
    if (isAnswered) return;
    setSelectedChoice(choiceId);
    setIsAnswered(true);
    const isCorrect = choiceId === step.correctId;
    if (isCorrect) { setScore((s) => s + 1); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    else { setMistakes((m) => m + 1); if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
  }, [isAnswered, step.correctId]);

  const handleNext = useCallback(async () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1); setSelectedChoice(null); setIsAnswered(false);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } else {
      setShowQuiz(true);
      if (employee?.employeeId) {
        await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_INTERIOR", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
      }
    }
  }, [currentStep, employee, progressMutation]);

  const getChoiceState = (choiceId: string): "idle" | "correct" | "wrong" | "disabled" => {
    if (!isAnswered) return "idle";
    if (choiceId === step.correctId) return "correct";
    if (choiceId === selectedChoice) return "wrong";
    return "disabled";
  };
  const isCorrectAnswer = selectedChoice === step.correctId;

  // ── Quiz Screen ────────────────────────────────────────────────────────────
  if (showQuiz && !isComplete) {
    const questions = quizQuestions;
    return (
      <ScreenContainer edges={["left", "right"]} className="p-6">
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
          <View style={{ paddingTop: Math.max(insets.top, 12), marginBottom: 24 }}>
            <Pressable onPress={() => router.back()} style={{ marginBottom: 12, alignSelf: "flex-start" }}>
              <Text style={{ fontSize: 14, color: colors.primary }}>← Back to Training</Text>
            </Pressable>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>📝 Module Quiz</Text>
            <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>Answer all questions to complete the module.</Text>
          </View>
          {questions.length === 0 ? (
            <View style={{ alignItems: "center", gap: 16, paddingVertical: 32 }}>
              <Text style={{ fontSize: 40 }}>✅</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>No quiz for this module</Text>
              <Pressable
                onPress={async () => {
                  setIsComplete(true);
                  if (employee?.employeeId) {
                    await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_INTERIOR", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
                  }
                }}
                style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Complete Module 🏆</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 24 }}>
              {questions.map((q: any, qi: number) => (
                <View key={q.questionId} style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{qi + 1}. {q.questionText}</Text>
                  {[
                    { key: "A", label: q.optionA },
                    { key: "B", label: q.optionB },
                    { key: "C", label: q.optionC },
                    { key: "D", label: q.optionD },
                  ].filter((o) => o.label).map((opt) => {
                    const selected = quizAnswers[q.questionId] === opt.key;
                    const isCorrect = quizSubmitted && opt.key === q.correctAnswer;
                    const isWrong = quizSubmitted && selected && opt.key !== q.correctAnswer;
                    return (
                      <Pressable
                        key={opt.key}
                        onPress={() => !quizSubmitted && setQuizAnswers((prev) => ({ ...prev, [q.questionId]: opt.key }))}
                        style={{ backgroundColor: isCorrect ? "#F0FDF4" : isWrong ? "#FEF2F2" : selected ? colors.primary + "20" : colors.background, borderRadius: 10, padding: 12, borderWidth: 1.5, borderColor: isCorrect ? "#22C55E" : isWrong ? "#EF4444" : selected ? colors.primary : colors.border, flexDirection: "row", alignItems: "center", gap: 10 }}
                      >
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: isCorrect ? "#22C55E" : isWrong ? "#EF4444" : selected ? colors.primary : colors.border, alignItems: "center", justifyContent: "center", backgroundColor: selected ? (isWrong ? "#EF4444" : isCorrect ? "#22C55E" : colors.primary) : "transparent" }}>
                          {selected && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{isCorrect ? "✓" : isWrong ? "✗" : "•"}</Text>}
                        </View>
                        <Text style={{ fontSize: 14, color: colors.foreground, flex: 1 }}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                  {quizSubmitted && (
                    <Text style={{ fontSize: 13, color: quizAnswers[q.questionId] === q.correctAnswer ? "#15803D" : "#B91C1C", fontWeight: "600" }}>
                      {quizAnswers[q.questionId] === q.correctAnswer ? "✅ Correct!" : `❌ Correct answer: ${[{ key:"A",label:q.optionA },{ key:"B",label:q.optionB },{ key:"C",label:q.optionC },{ key:"D",label:q.optionD }].find(o=>o.key===q.correctAnswer)?.label}`}
                    </Text>
                  )}
                </View>
              ))}
              {!quizSubmitted ? (
                <Pressable
                  onPress={() => {
                    if (Object.keys(quizAnswers).length < questions.length) {
                      Alert.alert("Answer all questions", "Please answer every question before submitting.");
                      return;
                    }
                    setQuizSubmitted(true);
                  }}
                  style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Submit Quiz →</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={async () => {
                    setIsComplete(true);
                    if (employee?.employeeId) {
                      await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_INTERIOR", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
                    }
                  }}
                  style={{ backgroundColor: "#22C55E", borderRadius: 14, paddingVertical: 16, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Complete Module 🏆</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (isComplete) {
    const pct = Math.round((score / STEPS.length) * 100);
    const passed = pct >= 70;
    return (
      <ScreenContainer edges={["left", "right"]} className="p-6">
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 24, paddingVertical: 32 }}>
          <Text style={{ fontSize: 64 }}>{passed ? "🏆" : "📚"}</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground, textAlign: "center" }}>{passed ? "Interior Certified!" : "Keep Practicing!"}</Text>
          <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>{passed ? "Interior Cleaning module complete. Progress saved." : "Review the steps and try again."}</Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", gap: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>Your Score</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              <View style={{ alignItems: "center", gap: 4 }}><Text style={{ fontSize: 36, fontWeight: "800", color: passed ? "#22C55E" : "#EF4444" }}>{pct}%</Text><Text style={{ fontSize: 13, color: colors.muted }}>Overall</Text></View>
              <View style={{ alignItems: "center", gap: 4 }}><Text style={{ fontSize: 36, fontWeight: "800", color: "#22C55E" }}>{score}</Text><Text style={{ fontSize: 13, color: colors.muted }}>Correct</Text></View>
              <View style={{ alignItems: "center", gap: 4 }}><Text style={{ fontSize: 36, fontWeight: "800", color: mistakes > 0 ? "#EF4444" : "#22C55E" }}>{mistakes}</Text><Text style={{ fontSize: 13, color: colors.muted }}>Mistakes</Text></View>
            </View>
          </View>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }], width: "100%", alignItems: "center" })}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Back to Training</Text>
          </Pressable>
        </ScrollView>
      </ScreenContainer>
    );
  }

  const vehicleImg = (step as any).vehicleImageUrl || step.vehicleImg || VEHICLE_IMG;

  // ── Module Intro Video Gate (shown once before any steps) ──────────────────
  const moduleVideoUrl = hookModuleVideoUrl || (steps[0] as any)?.videoUrl || null;
  if (!moduleVideoWatched && moduleVideoUrl) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <InteractiveVideoGate
          videoUrl={moduleVideoUrl}
          watchKey={"interior-cleaning_intro"}
          title={"Interior Cleaning"}
          onContinue={() => { setModuleVideoWatched(true); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}
          onSkip={() => { setModuleVideoWatched(true); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}
          onExit={() => router.back()}
          scrollRef={scrollRef}
        />
      </ScreenContainer>
    );
  }

  // ── Tools & Products Screen ──────────────────────────────────────────────────
  if (moduleVideoWatched && !toolsViewed) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <ModuleToolsScreen
          moduleKey={"interior-cleaning"}
          moduleName={"Interior Cleaning"}
          onContinue={() => { setToolsViewed(true); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}
          onExit={() => { setModuleVideoWatched(false); }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}><Text style={{ fontSize: 24, color: colors.primary }}>←</Text></Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>💺 Interior Cleaning</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>Step {currentStep + 1} of {STEPS.length}</Text>
          </View>
          <View style={{ backgroundColor: colors.primary + "20", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>⭐ {score}/{STEPS.length}</Text>
          </View>
        </View>
        <View style={{ height: 4, backgroundColor: colors.border, marginHorizontal: 16, borderRadius: 2, marginBottom: 16 }}>
          <View style={{ height: 4, backgroundColor: colors.primary, borderRadius: 2, width: `${progressPct}%` }} />
        </View>
        <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
          <Image source={{ uri: vehicleImg }} style={{ width: "100%", height: 180 }} resizeMode="cover" />
          <View style={{ position: "absolute", bottom: 10, left: 10, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{step.area}</Text>
          </View>
        </View>
        <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16, gap: 8 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>{step.title}</Text>
          <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 22 }}>{step.instruction}</Text>
        </View>
        <View style={{ marginHorizontal: 16, gap: 12, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>CHALLENGE</Text>
            </View>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, flex: 1 }}>{step.question}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {step.choices.map((choice) => (
              <ChoiceCard key={choice.id} choice={choice} onPress={() => handleChoicePress(choice.id)} state={getChoiceState(choice.id)} colors={colors} />
            ))}
          </View>
          {isAnswered && (
            <View style={{ backgroundColor: isCorrectAnswer ? "#F0FDF4" : "#FEF2F2", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: isCorrectAnswer ? "#22C55E" : "#EF4444", gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: isCorrectAnswer ? "#15803D" : "#B91C1C", lineHeight: 20 }}>{isCorrectAnswer ? step.correctExplanation : step.wrongExplanation}</Text>
              {!isCorrectAnswer && (<Text style={{ fontSize: 13, fontWeight: "600", color: "#15803D" }}>✅ Correct answer: <Text style={{ fontWeight: "800" }}>{step.choices.find((c) => c.id === step.correctId)?.label}</Text></Text>)}
              <View style={{ backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }}>
                <Text style={{ fontSize: 13, color: "#92400E", lineHeight: 20 }}>{step.proTip}</Text>
              </View>
            </View>
          )}
        </View>
        {isAnswered && (
          <View style={{ marginHorizontal: 16, marginBottom: 32 }}>
            <Pressable onPress={handleNext} style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{currentStep < STEPS.length - 1 ? "Next Step →" : "Complete Module 🏆"}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
