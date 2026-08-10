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

const ASSETS = {
  car:          "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yTSKfFQFgwpMLgwW.png",
  washMitt:     "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/PgjXXPdhTyflzwoX.png",
  allPurpose:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZalbSzHhFnIdhpPH.png",
  degreaser:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WSuWfFRKJAWNAEIx.png",
  brakeBuster:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/lhsuZUYbhiBKKqpd.png",
  greenBrush:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NelUOcEPRlqCgFRv.png",
  tireBrush:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/oVWCANWtxKUVQBUG.png",
  detailBrush:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/FYnkxOMqIwUaQBBY.png",
};

interface Choice { id: string; label: string; image: string; }
interface Step {
  id: string; title: string; instruction: string; area: string;
  question: string; choices: Choice[]; correctId: string;
  wrongExplanation: string; correctExplanation: string; proTip: string;
}

const STEPS: Step[] = [
  {
    id: "step1",
    title: "Step 1 — Pre-Rinse the Entire Vehicle",
    instruction: "Before applying any soap, pre-rinse the entire vehicle from top to bottom. This removes loose dirt and debris so you don't grind it into the paint with the wash mitt.",
    area: "🚗 Exterior — Pre-Rinse",
    question: "What direction do you rinse the vehicle?",
    choices: [
      { id: "topDown",    label: "Top to Bottom", image: ASSETS.allPurpose },
      { id: "bottomUp",   label: "Bottom to Top", image: ASSETS.greenBrush },
      { id: "sides",      label: "Side to Side",  image: ASSETS.tireBrush },
    ],
    correctId: "topDown",
    wrongExplanation: "❌ Wrong! Rinsing bottom to top pushes dirty water onto already-rinsed areas. Always work top to bottom.",
    correctExplanation: "✅ Correct! Always rinse top to bottom — gravity carries the dirty water down and off the vehicle.",
    proTip: "💡 Pro Tip: Pre-rinse removes 80% of loose dirt. The cleaner the surface before you touch it, the less chance of scratching the paint.",
  },
  {
    id: "step2",
    title: "Step 2 — Two-Bucket Wash Method",
    instruction: "Fill one bucket with soapy water (car wash soap) and one bucket with clean rinse water. Always rinse your mitt in the clean water bucket before reloading with soap. This prevents dirt from going back onto the paint.",
    area: "🚗 Exterior — Wash Setup",
    question: "How many buckets do you use for the exterior wash?",
    choices: [
      { id: "one",   label: "1 Bucket",  image: ASSETS.degreaser },
      { id: "two",   label: "2 Buckets", image: ASSETS.allPurpose },
      { id: "three", label: "3 Buckets", image: ASSETS.greenBrush },
    ],
    correctId: "two",
    wrongExplanation: "❌ Wrong! Using one bucket means you're putting dirty water back on the paint. Always use two buckets — one soap, one rinse.",
    correctExplanation: "✅ Correct! Two buckets — one soapy, one clean rinse. This is the standard safe wash method that prevents swirl marks.",
    proTip: "💡 Pro Tip: Use a Grit Guard insert in the rinse bucket. It traps dirt at the bottom so it doesn't get picked back up by the mitt.",
  },
  {
    id: "step3",
    title: "Step 3 — Wash with the Mitt",
    instruction: "Use the wash mitt to wash the vehicle in straight lines from top to bottom. Never use circular motions — straight lines prevent swirl marks.",
    area: "🚗 Exterior — Washing",
    question: "Which tool do you use to wash the vehicle exterior?",
    choices: [
      { id: "greenBrush", label: "Green Brush", image: ASSETS.greenBrush },
      { id: "washMitt",   label: "Wash Mitt",   image: ASSETS.washMitt },
      { id: "tireBrush",  label: "Tire Brush",  image: ASSETS.tireBrush },
    ],
    correctId: "washMitt",
    wrongExplanation: "❌ Wrong! Never use a brush on painted surfaces — it will scratch the paint. The Wash Mitt is soft and safe for paint.",
    correctExplanation: "✅ Correct! The Wash Mitt is the only tool safe for painted surfaces. Its fibers lift dirt away from the paint without scratching.",
    proTip: "💡 Pro Tip: Wash in straight lines, not circles. Circular motions create swirl marks that are visible in direct sunlight.",
  },
  {
    id: "step4",
    title: "Step 4 — Rinse from Top to Bottom",
    instruction: "After washing each section, rinse thoroughly from top to bottom. Don't let soap dry on the paint — it leaves water spots and streaks.",
    area: "🚗 Exterior — Final Rinse",
    question: "What direction do you rinse after washing?",
    choices: [
      { id: "topDown",   label: "Top to Bottom", image: ASSETS.allPurpose },
      { id: "bottomUp",  label: "Bottom to Top", image: ASSETS.greenBrush },
      { id: "random",    label: "Any Direction", image: ASSETS.degreaser },
    ],
    correctId: "topDown",
    wrongExplanation: "❌ Wrong! Always rinse top to bottom. Rinsing bottom to top pushes soapy water back onto already-clean areas.",
    correctExplanation: "✅ Correct! Rinse top to bottom on every pass. This ensures all soap and loosened dirt flows down and off the vehicle.",
    proTip: "💡 Pro Tip: Do a final sheet rinse — hold the hose flat and let water sheet off the paint. This reduces water spots by minimizing droplets.",
  },
  {
    id: "step5",
    title: "Step 5 — Dry with All-Purpose Microfiber",
    instruction: "Immediately after rinsing, dry the vehicle with the All-Purpose Microfiber towel. Work from top to bottom, section by section. Don't let water air-dry — it leaves water spots.",
    area: "🚗 Exterior — Drying",
    question: "Which towel do you use to dry the exterior paint?",
    choices: [
      { id: "allPurpose",  label: "All-Purpose Microfiber", image: ASSETS.allPurpose },
      { id: "brakeBuster", label: "Brake Buster",           image: ASSETS.brakeBuster },
      { id: "detailBrush", label: "Detail Brush",           image: ASSETS.detailBrush },
    ],
    correctId: "allPurpose",
    wrongExplanation: "❌ Wrong! Brake Buster is a chemical. The Detail Brush is a brush. Use the All-Purpose Microfiber towel to dry paint.",
    correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to dry the exterior paint. Its soft fibers absorb water without scratching.",
    proTip: "💡 Pro Tip: Use a large waffle-weave microfiber for drying — it holds more water and reduces the number of passes needed.",
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

export default function ExteriorWashTraining() {
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
    { moduleId: "TM_EXTWASH" },
    { staleTime: 5 * 60 * 1000, enabled: showQuiz }
  );
  const quizQuestions = quizQuery.data || [];
  const { applyOverrides, moduleVideoUrl: hookModuleVideoUrl } = useStepOverrides("exterior-wash");
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
        await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_EXTWASH", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
                    await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_EXTWASH", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
                      await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_EXTWASH", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground, textAlign: "center" }}>{passed ? "Exterior Wash Certified!" : "Keep Practicing!"}</Text>
          <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>{passed ? "Exterior Wash module complete. Progress saved." : "Review the steps and try again."}</Text>
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

  // ── Module Intro Video Gate (shown once before any steps) ──────────────────
  const moduleVideoUrl = hookModuleVideoUrl || (steps[0] as any)?.videoUrl || null;
  if (!moduleVideoWatched && moduleVideoUrl) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <InteractiveVideoGate
          videoUrl={moduleVideoUrl}
          watchKey={"exterior-wash_intro"}
          title={"Exterior Wash"}
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
          moduleKey={"exterior-wash"}
          moduleName={"Exterior Wash"}
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
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>🚗 Exterior Wash</Text>
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
          <Image source={{ uri: (step as any).vehicleImageUrl || ASSETS.car }} style={{ width: "100%", height: 180 }} resizeMode="cover" />
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
