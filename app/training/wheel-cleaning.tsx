import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, Image, Animated,
  Platform, Alert,
} from "react-native";
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


// ─── Asset URLs ───────────────────────────────────────────────────────────────
const ASSETS = {
  car:          "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yTSKfFQFgwpMLgwW.png",
  brakeBuster:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/lhsuZUYbhiBKKqpd.png",
  barrelBlade:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/AGyXhSDJMkUJAwld.png",
  detailBrush:  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/FYnkxOMqIwUaQBBY.png",
  greenBrush:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NelUOcEPRlqCgFRv.png",
  microfiber:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZalbSzHhFnIdhpPH.png",
  // Decoys from handbook
  degreaser:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WSuWfFRKJAWNAEIx.png",
  tireBrush:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/oVWCANWtxKUVQBUG.png",
  washMitt:     "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/PgjXXPdhTyflzwoX.png",
};

// ─── Step definitions ─────────────────────────────────────────────────────────
interface Choice { id: string; label: string; image: string; }
interface Step {
  id: string;
  title: string;
  instruction: string;
  area: string; // what part of the wheel
  question: string;
  choices: Choice[];
  correctId: string;
  wrongExplanation: string;
  correctExplanation: string;
  proTip: string;
}

const STEPS: Step[] = [
  {
    id: "step1",
    title: "Step 1 — Apply Chemical to Back of Wheel",
    instruction: "Before touching the wheel face, you always start at the back. Spray the back of the wheel barrel to loosen brake dust and grime.",
    area: "🔙 Wheel Barrel (Back)",
    question: "Which chemical do you spray on the back of the wheel?",
    choices: [
      { id: "brakeBuster", label: "Brake Buster",   image: ASSETS.brakeBuster },
      { id: "degreaser",   label: "Degreaser",    image: ASSETS.degreaser },
      { id: "tireBrush",   label: "Tire Brush",    image: ASSETS.tireBrush },
    ],
    correctId: "brakeBuster",
    wrongExplanation: "❌ Wrong! Degreaser and Tire Brush are not designed for brake dust. Use Brake Buster — it chemically reacts with iron particles.",
    correctExplanation: "✅ Correct! Brake Buster is an iron remover — it chemically reacts with brake dust and turns purple as it works.",
    proTip: "💡 Pro Tip: Let Brake Buster dwell for 30–60 seconds before agitating. You'll see it turn purple as it reacts with iron particles.",
  },
  {
    id: "step2",
    title: "Step 2 — Agitate the Wheel Barrel",
    instruction: "After the chemical has dwelled, you need to physically agitate the inside of the wheel barrel to loosen all the built-up grime.",
    area: "🔙 Wheel Barrel (Back)",
    question: "Which tool do you use to agitate the back of the wheel?",
    choices: [
      { id: "washMitt",   label: "Wash Mitt",    image: ASSETS.washMitt },
      { id: "barrelBlade", label: "Barrel Blade", image: ASSETS.barrelBlade },
      { id: "detailBrush", label: "Detail Brush", image: ASSETS.detailBrush },
    ],
    correctId: "barrelBlade",
    wrongExplanation: "❌ Wrong! A wash mitt can't reach inside the barrel, and a detail brush is too small. You need the Barrel Blade to reach deep inside.",
    correctExplanation: "✅ Correct! The Barrel Blade is specifically designed to reach inside the wheel barrel and agitate all the brake dust.",
    proTip: "💡 Pro Tip: Spin the Barrel Blade in a circular motion inside the barrel. Work from the center outward to push grime toward the edges.",
  },
  {
    id: "step3",
    title: "Step 3 — Spray & Scrub the Wheel Face",
    instruction: "Now move to the front face of the wheel. Spray Brake Buster on the face and use the correct brush to scrub all the spokes and surface.",
    area: "⭕ Wheel Face (Front)",
    question: "Which brush do you use to scrub the front face of the wheel?",
    choices: [
      { id: "barrelBlade", label: "Barrel Blade", image: ASSETS.barrelBlade },
      { id: "detailBrush", label: "Detail Brush", image: ASSETS.detailBrush },
      { id: "greenBrush",  label: "Green Brush",  image: ASSETS.greenBrush },
    ],
    correctId: "greenBrush",
    wrongExplanation: "❌ Wrong! The Barrel Blade is for the inside barrel. The Detail Brush is too small for the wheel face. Use the Green Brush.",
    correctExplanation: "✅ Correct! The Green Brush has the right size and stiffness to scrub the entire wheel face, including between the spokes.",
    proTip: "💡 Pro Tip: Scrub in a back-and-forth motion across each spoke, then a circular motion on the center cap. Don't forget the inner lip.",
  },
  {
    id: "step4",
    title: "Step 4 — Clean the Lug Nuts",
    instruction: "Lug nuts are a detail that customers notice. They collect brake dust and grime in the tight grooves. Use the right tool to get them spotless.",
    area: "🔩 Lug Nuts",
    question: "Which tool do you use to clean the lug nuts?",
    choices: [
      { id: "greenBrush",  label: "Green Brush",  image: ASSETS.greenBrush },
      { id: "detailBrush", label: "Detail Brush", image: ASSETS.detailBrush },
      { id: "barrelBlade", label: "Barrel Blade", image: ASSETS.barrelBlade },
    ],
    correctId: "detailBrush",
    wrongExplanation: "❌ Wrong! The Green Brush is too large for lug nuts. The Barrel Blade is for the barrel. The Detail Brush fits perfectly in the lug nut grooves.",
    correctExplanation: "✅ Correct! The Detail Brush's small, stiff bristles fit perfectly around and between lug nuts to remove all the packed-in grime.",
    proTip: "💡 Pro Tip: Twist the Detail Brush around each lug nut in a circular motion. This is what separates a good detail from a great one.",
  },
  {
    id: "step5",
    title: "Step 5 — Pressure Wash",
    instruction: "After all the chemical and agitation work, rinse everything off. Always start from the bottom and work your way up to push dirty water down and away.",
    area: "💦 Full Wheel Rinse",
    question: "What direction do you pressure wash the wheel?",
    choices: [
      { id: "topDown",    label: "Top to Bottom", image: ASSETS.washMitt },
      { id: "bottomUp",  label: "Bottom to Top",  image: ASSETS.greenBrush },
      { id: "leftRight", label: "Left to Right",  image: ASSETS.barrelBlade },
    ],
    correctId: "bottomUp",
    wrongExplanation: "❌ Wrong! Washing top to bottom pushes dirty water back over clean areas. Always start at the bottom.",
    correctExplanation: "✅ Correct! Starting from the bottom and working up ensures dirty water flows down and away from areas you've already cleaned.",
    proTip: "💡 Pro Tip: After rinsing, hit the barrel one more time from the front to flush out any remaining chemical and debris.",
  },
  {
    id: "step6",
    title: "Step 6 — Dry the Wheel",
    instruction: "After rinsing, dry the wheel immediately to prevent water spots. Use the correct towel — never use a glass towel or paint towel on wheels.",
    area: "🧹 Drying",
    question: "Which towel do you use to dry the wheels?",
    choices: [
      { id: "microfiber",  label: "All-Purpose Microfiber", image: ASSETS.microfiber },
      { id: "degreaser",    label: "Degreaser",            image: ASSETS.degreaser },
      { id: "washMitt",    label: "Wash Mitt",              image: ASSETS.washMitt },
    ],
    correctId: "microfiber",
    wrongExplanation: "❌ Wrong! Never use a degreaser towel on wheels after drying. A wash mitt is for washing, not drying. Use the All-Purpose Microfiber.",
    correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to dry the wheels. Keep it dedicated to wheels — never use it on paint or glass.",
    proTip: "💡 Pro Tip: Fold the microfiber into quarters so you have 8 clean surfaces to work with. Flip to a fresh side for each wheel.",
  },
];

// ─── Choice Card Component ────────────────────────────────────────────────────
function ChoiceCard({
  choice, onPress, state, colors,
}: {
  choice: Choice;
  onPress: () => void;
  state: "idle" | "correct" | "wrong" | "disabled";
  colors: any;
}) {
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  React.useEffect(() => {
    if (state === "wrong") triggerShake();
  }, [state, triggerShake]);

  const borderColor =
    state === "correct" ? "#22C55E" :
    state === "wrong"   ? "#EF4444" :
    colors.border;
  const bgColor =
    state === "correct" ? "#F0FDF4" :
    state === "wrong"   ? "#FEF2F2" :
    colors.surface;

  return (
    <Animated.View style={{ transform: [{ translateX: shakeAnim }], flex: 1 }}>
      <Pressable
        onPress={state === "idle" ? onPress : undefined}
        style={({ pressed }) => ({
          opacity: pressed && state === "idle" ? 0.8 : state === "disabled" ? 0.35 : 1,
          transform: [{ scale: pressed && state === "idle" ? 0.96 : 1 }],
          backgroundColor: bgColor,
          borderWidth: 2,
          borderColor,
          borderRadius: 14,
          padding: 10,
          alignItems: "center",
          gap: 6,
          minHeight: 120,
          justifyContent: "center",
        })}
      >
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>
          {choice.label}
        </Text>
        {state === "correct" && <Text style={{ fontSize: 16 }}>✅</Text>}
        {state === "wrong"   && <Text style={{ fontSize: 16 }}>❌</Text>}
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WheelCleaningTraining() {
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
    { moduleId: "TM_WHEEL" },
    { staleTime: 5 * 60 * 1000, enabled: showQuiz }
  );
  const quizQuestions = quizQuery.data || [];
  const { applyOverrides, moduleVideoUrl: hookModuleVideoUrl } = useStepOverrides("wheel-cleaning");
  const steps = applyOverrides(STEPS);


  const step = steps[currentStep];
  const progressPct = ((currentStep) / STEPS.length) * 100;

  const handleChoicePress = useCallback((choiceId: string) => {
    if (isAnswered) return;
    setSelectedChoice(choiceId);
    setIsAnswered(true);
    const isCorrect = choiceId === step.correctId;
    if (isCorrect) {
      setScore((s) => s + 1);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setMistakes((m) => m + 1);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [isAnswered, step.correctId]);

  const handleNext = useCallback(async () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
      setSelectedChoice(null);
      setIsAnswered(false);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } else {
      // Complete!
      setIsComplete(true);
      if (employee?.employeeId) {
        await progressMutation.mutateAsync({
          employeeId: employee.employeeId,
          moduleId: "TM_WHEEL",
          completedSteps: steps.map((s) => s.id).join(","),
          isModuleCompleted: "yes",
          completedAt: new Date(),
        });
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

  // ── Completion Screen ──────────────────────────────────────────────────────
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
                    await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_WHEEL", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
                      await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_WHEEL", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground, textAlign: "center" }}>
            {passed ? "Wheel Cleaning Certified!" : "Keep Practicing!"}
          </Text>
          <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>
            {passed
              ? "You've completed the Wheel Cleaning module. Your progress has been saved."
              : "You didn't quite pass this time. Review the steps and try again."}
          </Text>
          {/* Score card */}
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", gap: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>Your Score</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 36, fontWeight: "800", color: passed ? "#22C55E" : "#EF4444" }}>{pct}%</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>Overall</Text>
              </View>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 36, fontWeight: "800", color: "#22C55E" }}>{score}</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>Correct</Text>
              </View>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 36, fontWeight: "800", color: mistakes > 0 ? "#EF4444" : "#22C55E" }}>{mistakes}</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>Mistakes</Text>
              </View>
            </View>
          </View>
          {/* Recap */}
          <View style={{ width: "100%", gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Quick Recap</Text>
            {STEPS.map((s, i) => (
              <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 18 }}>✅</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{s.title.replace(/Step \d+ — /, "")}</Text>
              </View>
            ))}
          </View>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: 14,
              paddingVertical: 16,
              paddingHorizontal: 32,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              width: "100%",
              alignItems: "center",
            })}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Back to Training</Text>
          </Pressable>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Main Training Screen ───────────────────────────────────────────────────
  // ── Module Intro Video Gate (shown once before any steps) ──────────────────
  const moduleVideoUrl = hookModuleVideoUrl || (steps[0] as any)?.videoUrl || null;
  if (!moduleVideoWatched && moduleVideoUrl) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <InteractiveVideoGate
          videoUrl={moduleVideoUrl}
          watchKey={"wheel-cleaning_intro"}
          title={"Wheel Cleaning"}
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
          moduleKey={"wheel-cleaning"}
          moduleName={"Wheel Cleaning"}
          onContinue={() => { setToolsViewed(true); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}
          onExit={() => { setModuleVideoWatched(false); }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
          >
            <Text style={{ fontSize: 24, color: colors.primary }}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>🚗 Wheel Cleaning</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>Step {currentStep + 1} of {STEPS.length}</Text>
          </View>
          <View style={{ backgroundColor: colors.primary + "20", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>⭐ {score}/{STEPS.length}</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={{ height: 4, backgroundColor: colors.border, marginHorizontal: 16, borderRadius: 2, marginBottom: 16 }}>
          <View style={{ height: 4, backgroundColor: colors.primary, borderRadius: 2, width: `${progressPct}%` }} />
        </View>

        {/* Vehicle illustration */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
          <Image
            source={{ uri: (step as any).vehicleImageUrl || ASSETS.car }}
            style={{ width: "100%", height: 180 }}
            resizeMode="cover"
          />
          {/* Area badge */}
          <View style={{ position: "absolute", bottom: 10, left: 10, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{step.area}</Text>
          </View>
        </View>

        {/* Step card */}
        <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16, gap: 8 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>{step.title}</Text>
          <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 22 }}>{step.instruction}</Text>
        </View>

        {/* Quiz challenge */}
        <View style={{ marginHorizontal: 16, gap: 12, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>CHALLENGE</Text>
            </View>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, flex: 1 }}>{step.question}</Text>
          </View>

          {/* Choice grid */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {step.choices.map((choice) => (
              <ChoiceCard
                key={choice.id}
                choice={choice}
                onPress={() => handleChoicePress(choice.id)}
                state={getChoiceState(choice.id)}
                colors={colors}
              />
            ))}
          </View>

          {/* Feedback */}
          {isAnswered && (
            <View style={{
              backgroundColor: isCorrectAnswer ? "#F0FDF4" : "#FEF2F2",
              borderRadius: 14,
              padding: 14,
              borderWidth: 1.5,
              borderColor: isCorrectAnswer ? "#22C55E" : "#EF4444",
              gap: 8,
            }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: isCorrectAnswer ? "#15803D" : "#B91C1C", lineHeight: 20 }}>
                {isCorrectAnswer ? step.correctExplanation : step.wrongExplanation}
              </Text>
              {!isCorrectAnswer && (
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#15803D" }}>
                  ✅ Correct answer: <Text style={{ fontWeight: "800" }}>{step.choices.find((c) => c.id === step.correctId)?.label}</Text>
                </Text>
              )}
              <View style={{ backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }}>
                <Text style={{ fontSize: 13, color: "#92400E", lineHeight: 20 }}>{step.proTip}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Next button */}
        {isAnswered && (
          <View style={{ marginHorizontal: 16, marginBottom: 32 }}>
            <Pressable
              onPress={handleNext}
              style={({ pressed }) => ({
                backgroundColor: colors.primary,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                {currentStep < STEPS.length - 1 ? `Next Step →` : "Complete Module 🏆"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
