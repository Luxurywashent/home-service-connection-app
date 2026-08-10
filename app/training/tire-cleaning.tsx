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
  car:           "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yTSKfFQFgwpMLgwW.png",
  brakeBuster:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/lhsuZUYbhiBKKqpd.png",
  tireBrush:     "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/oVWCANWtxKUVQBUG.png",
  allPurpose:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/ZalbSzHhFnIdhpPH.png",
  degreaser:     "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WSuWfFRKJAWNAEIx.png",
  barrelBlade:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/AGyXhSDJMkUJAwld.png",
  greenBrush:    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/NelUOcEPRlqCgFRv.png",
  detailBrush:   "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/FYnkxOMqIwUaQBBY.png",
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
    title: "Step 1 — Spray Tire with Brake Buster",
    instruction: "Spray Brake Buster generously on the tire sidewall. It breaks down brake dust, road grime, and old tire dressing. Let it dwell 30-60 seconds.",
    area: "🔘 Tire Sidewall",
    question: "Which chemical do you spray on the tire?",
    choices: [
      { id: "brakeBuster", label: "Brake Buster", image: ASSETS.brakeBuster },
      { id: "degreaser",   label: "Degreaser",    image: ASSETS.degreaser },
      { id: "allPurpose",  label: "All-Purpose Towel", image: ASSETS.allPurpose },
    ],
    correctId: "brakeBuster",
    wrongExplanation: "❌ Wrong! Degreaser won't effectively break down brake dust on tires. Brake Buster is formulated specifically for this.",
    correctExplanation: "✅ Correct! Brake Buster is used on both wheels AND tires — it breaks down brake dust and old tire dressing.",
    proTip: "💡 Pro Tip: Apply Brake Buster to the tire BEFORE the wheel so the dwell time starts while you work on the wheel.",
  },
  {
    id: "step2",
    title: "Step 2 — Scrub the Tire with Tire Brush",
    instruction: "Use the Tire Brush to aggressively scrub the tire sidewall in a circular motion. Get into all the lettering and grooves.",
    area: "🔘 Tire Scrubbing",
    question: "Which tool do you use to scrub the tire sidewall?",
    choices: [
      { id: "barrelBlade", label: "Barrel Blade", image: ASSETS.barrelBlade },
      { id: "tireBrush",   label: "Tire Brush",   image: ASSETS.tireBrush },
      { id: "detailBrush", label: "Detail Brush", image: ASSETS.detailBrush },
    ],
    correctId: "tireBrush",
    wrongExplanation: "❌ Wrong! The Barrel Blade is for wheel barrels. The Detail Brush is too small for tire sidewalls. Use the Tire Brush.",
    correctExplanation: "✅ Correct! The Tire Brush has stiff bristles designed to aggressively scrub tire sidewalls and get into the lettering.",
    proTip: "💡 Pro Tip: Scrub in a circular motion around the entire tire. Pay extra attention to the raised lettering — grime loves to hide there.",
  },
  {
    id: "step3",
    title: "Step 3 — Rinse the Tire",
    instruction: "After scrubbing, pressure wash the tire thoroughly to remove all the Brake Buster, loosened grime, and old dressing.",
    area: "🔘 Tire Rinse",
    question: "After scrubbing the tire, what is the next step?",
    choices: [
      { id: "rinse",      label: "Pressure Wash Rinse", image: ASSETS.greenBrush },
      { id: "dryTowel",   label: "Dry with Towel",      image: ASSETS.allPurpose },
      { id: "moreBrush",  label: "Scrub Again",         image: ASSETS.tireBrush },
    ],
    correctId: "rinse",
    wrongExplanation: "❌ Wrong! You must rinse all the chemical and loosened grime off before drying or applying dressing.",
    correctExplanation: "✅ Correct! Always rinse thoroughly after scrubbing to remove all chemical residue and loosened grime.",
    proTip: "💡 Pro Tip: Rinse from the top of the tire down. Make sure no Brake Buster residue remains — it can prevent tire dressing from bonding properly.",
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

export default function TireCleaningTraining() {
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
    { moduleId: "TM_TIRE" },
    { staleTime: 5 * 60 * 1000, enabled: showQuiz }
  );
  const quizQuestions = quizQuery.data || [];
  const { applyOverrides, moduleVideoUrl: hookModuleVideoUrl } = useStepOverrides("tire-cleaning");
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
        await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_TIRE", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
                    await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_TIRE", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
                      await progressMutation.mutateAsync({ employeeId: employee.employeeId, moduleId: "TM_TIRE", completedSteps: steps.map((s) => s.id).join(","), isModuleCompleted: "yes", completedAt: new Date() });
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
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground, textAlign: "center" }}>{passed ? "Tire Cleaning Certified!" : "Keep Practicing!"}</Text>
          <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>{passed ? "You've completed the Tire Cleaning module." : "Review the steps and try again."}</Text>
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
          watchKey={"tire-cleaning_intro"}
          title={"Tire Cleaning"}
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
          moduleKey={"tire-cleaning"}
          moduleName={"Tire Cleaning"}
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
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>🔘 Tire Cleaning</Text>
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
