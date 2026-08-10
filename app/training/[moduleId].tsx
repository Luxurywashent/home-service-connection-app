"use client";
import { useState, useRef, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { InteractiveVideoGate } from "@/components/interactive-video-gate";
import { ModuleToolsScreen } from "@/components/module-tools-screen";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import {
  Text,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";

// ── Module config (legacy TM_ modules) ───────────────────────────────────────
const MODULE_CONFIG: Record<string, { emoji: string; color: string; bgColor: string }> = {
  TM_WELCOME:  { emoji: "⭐", color: "#F59E0B", bgColor: "#FEF3C7" },
  TM_SAFETY:   { emoji: "🛡️", color: "#EF4444", bgColor: "#FEE2E2" },
  TM_EXTERIOR: { emoji: "🚗", color: "#3B82F6", bgColor: "#DBEAFE" },
  TM_INTERIOR: { emoji: "💺", color: "#8B5CF6", bgColor: "#EDE9FE" },
  TM_CUSTOMER: { emoji: "🤝", color: "#10B981", bgColor: "#D1FAE5" },
  TM_APP:      { emoji: "📱", color: "#0EA5E9", bgColor: "#E0F2FE" },
};
const DEFAULT_CONFIG = { emoji: "📚", color: "#6B7280", bgColor: "#F3F4F6" };

// ── Types ─────────────────────────────────────────────────────────────────────
interface TrainingStep {
  id: number;
  stepId: string;
  moduleId: string;
  orderIndex: number;
  title: string;
  description: string;
  imageUrl: string | null;
  videoUrl?: string | null;
  warnings: string | null;
  tips: string | null;
  createdAt: Date;
  question?: string | null;
  choices?: { id: string; label: string }[] | null;
  correctId?: string | null;
  wrongExplanation?: string | null;
  correctExplanation?: string | null;
}

interface TrainingModule {
  id: number;
  moduleId: string;
  name: string;
  description: string | null;
  icon: string | null;
  videoUrl: string | null;
  orderIndex: number;
  createdAt: Date;
}

type ViewMode = "intro-video" | "video-done" | "tools" | "step" | "score-summary" | "complete";

// ── Challenge tiles (Floor Mats design) ──────────────────────────────────────
function StepChallenge({
  question,
  choices,
  correctId,
  wrongExplanation,
  correctExplanation,
  accentColor,
  onAnswered,
}: {
  question: string;
  choices: { id: string; label: string }[];
  correctId: string;
  wrongExplanation?: string | null;
  correctExplanation?: string | null;
  accentColor: string;
  onAnswered?: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const isCorrect = selected === correctId;

  const handleSelect = (id: string) => {
    if (selected) return;
    setSelected(id);
    const correct = id === correctId;
    if (Platform.OS !== "web") {
      if (correct) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
    if (onAnswered) setTimeout(() => onAnswered(correct), 400);
  };

  return (
    <View style={{ marginTop: 20 }}>
      {/* CHALLENGE label + question */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <View style={{ backgroundColor: accentColor, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>CHALLENGE</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFFFFF", flex: 1, lineHeight: 22, minWidth: 200 }}>
          {question}
        </Text>
      </View>

      {/* 3-column answer tiles */}
      <View style={styles.tileGrid}>
        {choices.map((choice) => {
          const isSelected = selected === choice.id;
          const isCorrectChoice = choice.id === correctId;
          let borderColor = "#2A2A3A";
          let bgColor = "#1A1A2A";
          let textColor = "#FFFFFF";
          if (selected && isCorrectChoice) {
            borderColor = "#22C55E"; bgColor = "#052E16"; textColor = "#4ADE80";
          } else if (selected && isSelected && !isCorrectChoice) {
            borderColor = "#EF4444"; bgColor = "#2D0A0A"; textColor = "#FCA5A5";
          }
          return (
            <Pressable
              key={choice.id}
              onPress={() => handleSelect(choice.id)}
              style={({ pressed }) => [
                styles.tile,
                { borderColor, backgroundColor: bgColor, opacity: pressed && !selected ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.tileText, { color: textColor }]} numberOfLines={3}>
                {choice.label}
              </Text>
              {selected && isCorrectChoice && <Text style={{ fontSize: 14, marginTop: 4 }}>✅</Text>}
              {selected && isSelected && !isCorrectChoice && <Text style={{ fontSize: 14, marginTop: 4 }}>❌</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* Feedback banner */}
      {selected && (
        <View style={{
          marginTop: 12,
          backgroundColor: isCorrect ? "#052E16" : "#2D0A0A",
          borderRadius: 12,
          padding: 14,
          borderWidth: 1.5,
          borderColor: isCorrect ? "#22C55E" : "#EF4444",
        }}>
          <Text style={{ fontSize: 14, fontWeight: "800", color: isCorrect ? "#4ADE80" : "#FCA5A5" }}>
            {isCorrect ? "✅ Correct!" : "❌ Not quite — see the correct answer above"}
          </Text>
          {isCorrect && correctExplanation && (
            <Text style={{ fontSize: 13, color: "#86EFAC", marginTop: 6, lineHeight: 20 }}>
              {correctExplanation}
            </Text>
          )}
          {!isCorrect && wrongExplanation && (
            <Text style={{ fontSize: 13, color: "#FCA5A5", marginTop: 6, lineHeight: 20 }}>
              {wrongExplanation}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── Floor Mats step card — universal for ALL 43 modules ───────────────────────
function FloorMatsStepCard({
  step,
  stepNumber,
  totalSteps,
  accentColor,
  onNext,
  onPrev,
  isLastStep,
  isFirstStep,
  onScoreStep,
}: {
  step: TrainingStep;
  stepNumber: number;
  totalSteps: number;
  accentColor: string;
  onNext: () => void;
  onPrev: () => void;
  isLastStep: boolean;
  isFirstStep: boolean;
  onScoreStep: (correct: boolean) => void;
}) {
  const hasChallenge = !!(step.question && step.choices && step.choices.length > 0 && step.correctId);
  const [challengeAnswered, setChallengeAnswered] = useState(false);
  const canProceed = !hasChallenge || challengeAnswered;

  const handleAnswered = (correct: boolean) => {
    setChallengeAnswered(true);
    onScoreStep(correct);
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 48, backgroundColor: "#0A0A14" }}
      showsVerticalScrollIndicator={false}
    >
      {/* Step image — full-width at top with caption pill */}
      {step.imageUrl ? (
        <View style={{ position: "relative", marginHorizontal: 16, marginTop: 12, borderRadius: 16, overflow: "hidden" }}>
          <Image
            source={{ uri: step.imageUrl }}
            style={{ width: "100%", height: 220, backgroundColor: "#111827" }}
            resizeMode="cover"
          />
          <View style={styles.imageCaption}>
            <Text style={styles.imageCaptionText} numberOfLines={1}>
              {step.title}
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.noImageBanner, { backgroundColor: `${accentColor}18`, marginHorizontal: 16, marginTop: 12 }]}>
          <Text style={[styles.noImageTitle, { color: accentColor }]}>{step.title}</Text>
        </View>
      )}

      {/* Dark step card */}
      <View style={styles.stepCard}>
        <Text style={styles.stepCardTitle}>Step {stepNumber} — {step.title}</Text>
        <Text style={styles.stepCardDesc}>{step.description}</Text>
        {step.warnings ? (
          <View style={styles.warningBox}>
            <Text style={styles.warningLabel}>⚠️  IMPORTANT</Text>
            <Text style={styles.warningText}>{step.warnings}</Text>
          </View>
        ) : null}
        {step.tips ? (
          <View style={styles.tipBox}>
            <Text style={styles.tipLabel}>💡  PRO TIP</Text>
            <Text style={styles.tipText}>{step.tips}</Text>
          </View>
        ) : null}
      </View>

      {/* Challenge tiles */}
      {hasChallenge && (
        <View style={{ paddingHorizontal: 16 }}>
          <StepChallenge
            question={step.question!}
            choices={step.choices!}
            correctId={step.correctId!}
            wrongExplanation={step.wrongExplanation}
            correctExplanation={step.correctExplanation}
            accentColor={accentColor}
            onAnswered={handleAnswered}
          />
        </View>
      )}

      {/* Navigation */}
      <View style={{ paddingHorizontal: 16, marginTop: 24, gap: 10 }}>
        <Pressable
          onPress={canProceed ? onNext : undefined}
          style={({ pressed }) => [
            styles.nextBtn,
            {
              backgroundColor: canProceed ? "#2563EB" : "#374151",
              opacity: pressed && canProceed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[styles.nextBtnText, { color: canProceed ? "#fff" : "#9CA3AF" }]}>
            {!canProceed
              ? "Answer the challenge to continue"
              : isLastStep
              ? "Finish & See Results →"
              : "Next Step →"}
          </Text>
        </Pressable>

        {!isFirstStep && (
          <Pressable
            onPress={onPrev}
            style={({ pressed }) => [styles.prevBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.prevBtnText}>← Previous Step</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

// ── Score Summary screen ──────────────────────────────────────────────────────
function ScoreSummaryScreen({
  moduleName,
  emoji,
  correctCount,
  totalCount,
  onMarkComplete,
  onRetake,
  onExit,
  isMarkingComplete,
  isModuleCompleted,
}: {
  moduleName: string;
  emoji: string;
  correctCount: number;
  totalCount: number;
  onMarkComplete: () => void;
  onRetake: () => void;
  onExit: () => void;
  isMarkingComplete: boolean;
  isModuleCompleted: boolean;
}) {
  const pct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 100;
  const passed = pct >= 80;

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, backgroundColor: "#0A0A14", alignItems: "center" }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.scoreBadge, { borderColor: passed ? "#22C55E" : "#EF4444" }]}>
        <Text style={{ fontSize: 44 }}>{emoji}</Text>
      </View>

      <Text style={{ fontSize: 22, fontWeight: "800", color: "#FFFFFF", textAlign: "center", marginTop: 16, marginBottom: 4 }}>
        {moduleName}
      </Text>
      <Text style={{ fontSize: 14, color: "#9CA3AF", textAlign: "center", marginBottom: 28 }}>
        Module Complete — Here are your results
      </Text>

      {/* Score circle */}
      <View style={[styles.scoreCircle, { borderColor: passed ? "#22C55E" : "#EF4444", backgroundColor: passed ? "#052E16" : "#2D0A0A" }]}>
        <Text style={{ fontSize: 42, fontWeight: "900", color: passed ? "#4ADE80" : "#FCA5A5" }}>
          {pct}%
        </Text>
        <Text style={{ fontSize: 14, fontWeight: "700", color: passed ? "#86EFAC" : "#FCA5A5", marginTop: 2 }}>
          {correctCount} / {totalCount} correct
        </Text>
      </View>

      {/* Pass / Fail label */}
      <View style={[styles.resultPill, { backgroundColor: passed ? "#052E16" : "#2D0A0A", borderColor: passed ? "#22C55E" : "#EF4444" }]}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: passed ? "#4ADE80" : "#FCA5A5" }}>
          {passed ? "✅ PASSED" : "❌ FAILED"}
        </Text>
        <Text style={{ fontSize: 13, color: passed ? "#86EFAC" : "#FCA5A5", marginTop: 4, textAlign: "center" }}>
          {passed
            ? "Great work! You scored above 80% and are ready to complete this module."
            : "You need 80% or higher to pass. Review the steps and try again."}
        </Text>
      </View>

      {/* Action buttons */}
      <View style={{ width: "100%", gap: 12, marginTop: 28 }}>
        {passed ? (
          isModuleCompleted ? (
            <>
              <View style={styles.alreadyCompleteBox}>
                <Text style={{ color: "#4ADE80", fontWeight: "700", fontSize: 16 }}>✓ Already Completed</Text>
              </View>
              <Pressable onPress={onExit} style={({ pressed }) => [styles.exitBtn, { opacity: pressed ? 0.8 : 1 }]}>
                <Text style={styles.exitBtnText}>← Back to Training</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={onMarkComplete}
                disabled={isMarkingComplete}
                style={({ pressed }) => [styles.markCompleteBtn, { opacity: pressed || isMarkingComplete ? 0.8 : 1 }]}
              >
                {isMarkingComplete
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.markCompleteBtnText}>✓ Mark as Complete</Text>
                }
              </Pressable>
              <Pressable onPress={onRetake} style={({ pressed }) => [styles.retakeBtn, { opacity: pressed ? 0.8 : 1 }]}>
                <Text style={styles.retakeBtnText}>↺ Retake Module</Text>
              </Pressable>
            </>
          )
        ) : (
          <>
            <Pressable
              onPress={onRetake}
              style={({ pressed }) => [styles.retakeBtn, { backgroundColor: "#2563EB", borderColor: "#2563EB", opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.retakeBtnText, { color: "#FFFFFF" }]}>↺ Retake Module</Text>
            </Pressable>
            <Pressable onPress={onExit} style={({ pressed }) => [styles.exitBtn, { opacity: pressed ? 0.8 : 1 }]}>
              <Text style={styles.exitBtnText}>Exit Training</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Module Complete celebration ───────────────────────────────────────────────
function ModuleCompleteScreen({ moduleName, emoji, onBack }: { moduleName: string; emoji: string; onBack: () => void }) {
  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0A0A14" }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.completeIcon}>
        <Text style={{ fontSize: 48, color: "#4ADE80" }}>✓</Text>
      </View>
      <Text style={{ fontSize: 28, fontWeight: "800", color: "#FFFFFF", textAlign: "center", marginBottom: 8 }}>
        Module Complete!
      </Text>
      <Text style={{ fontSize: 16, color: "#9CA3AF", textAlign: "center", marginBottom: 32 }}>
        You've completed{"\n"}
        <Text style={{ fontWeight: "700", color: "#FFFFFF" }}>{moduleName}</Text>
      </Text>
      <View style={styles.completeBadge}>
        <Text style={{ fontSize: 40, marginBottom: 8 }}>{emoji}</Text>
        <Text style={{ fontSize: 15, fontWeight: "700", color: "#4ADE80", textAlign: "center" }}>
          Great work! This module has been marked complete.
        </Text>
      </View>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => ({
          backgroundColor: "#22C55E",
          paddingVertical: 16,
          paddingHorizontal: 40,
          borderRadius: 14,
          alignItems: "center",
          opacity: pressed ? 0.85 : 1,
          width: "100%",
          marginTop: 32,
        })}
      >
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>← Back to Training</Text>
      </Pressable>
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ModuleDetailScreen() {
  const router = useRouter();
  const { moduleId, preview } = useLocalSearchParams<{ moduleId: string; preview?: string }>();
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const scrollRef = useRef<ScrollView>(null);
  const isPreview = preview === "1";
  const isLegacyModule = (moduleId || "").startsWith("TM_");

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("intro-video");
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [stepScores, setStepScores] = useState<Record<number, boolean>>({});

  // ── Queries ───────────────────────────────────────────────────────────────────
  const moduleByIdQuery = trpc.training.getModuleById.useQuery(
    { moduleId: moduleId || "" },
    { enabled: !!moduleId && isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const legacyStepsQuery = trpc.training.getStepsForModule.useQuery(
    { moduleId: moduleId || "" },
    { enabled: !!moduleId && isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const interactiveModQuery = trpc.training.getAllInteractiveModules.useQuery(
    undefined,
    { enabled: !!moduleId && !isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const interactiveStepsQuery = trpc.training.getInteractiveSteps.useQuery(
    { moduleKey: moduleId || "" },
    { enabled: !!moduleId && !isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const overridesQuery = trpc.training.getInteractiveOverrides.useQuery(
    { moduleId: moduleId || "" },
    { enabled: !!moduleId && !isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const moduleToolsQuery = trpc.training.getModuleTools.useQuery(
    { moduleKey: moduleId || "" },
    { enabled: !!moduleId && !isLegacyModule, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const progressQuery = trpc.training.getAllUserProgress.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, staleTime: 60 * 1000, refetchOnMount: false }
  );
  const updateProgressMutation = trpc.training.updateProgress.useMutation();

  // ── Resolve module ────────────────────────────────────────────────────────────
  const interactiveMod = !isLegacyModule
    ? ((interactiveModQuery.data as any[] | undefined) || []).find((m: any) => m.moduleKey === moduleId)
    : null;

  const overrides = ((overridesQuery.data as any[] | undefined) || []).filter((o: any) => !o.isDeleted);
  const moduleVideoOverride = overrides.find((o: any) => o.stepIndex === -1);
  const adminVideoUrl: string | null = moduleVideoOverride?.videoUrl ?? null;

  const module: TrainingModule | null = isLegacyModule
    ? ((moduleByIdQuery.data as TrainingModule | null | undefined) ?? null)
    : interactiveMod
      ? {
          id: interactiveMod.id,
          moduleId: interactiveMod.moduleKey,
          name: interactiveMod.title,
          description: interactiveMod.subtitle || null,
          icon: interactiveMod.emoji || null,
          videoUrl: adminVideoUrl,
          orderIndex: interactiveMod.orderIndex,
          createdAt: new Date(interactiveMod.createdAt),
        } as TrainingModule
      : null;

  // ── Resolve steps ─────────────────────────────────────────────────────────────
  const rawInteractiveSteps = (interactiveStepsQuery.data as any[] | undefined) || [];
  const steps: TrainingStep[] = isLegacyModule
    ? ((legacyStepsQuery.data as TrainingStep[] | undefined) || [])
    : rawInteractiveSteps.map((s: any, i: number) => ({
        id: s.id,
        stepId: s.stepId,
        moduleId: moduleId || "",
        orderIndex: s.orderIndex ?? i,
        title: s.title,
        description: s.instruction || "",
        imageUrl: s.vehicleImageUrl || null,
        videoUrl: null,
        warnings: null,
        tips: s.proTip || null,
        createdAt: new Date(s.createdAt),
        question: s.question || null,
        choices: s.choices
          ? (s.choices as any[]).map((c: any) => ({ id: c.id, label: c.label ?? c.text ?? String(c.id) }))
          : null,
        correctId: s.correctId || null,
        wrongExplanation: s.wrongExplanation || null,
        correctExplanation: s.correctExplanation || null,
      } as TrainingStep));

  const moduleTools = (moduleToolsQuery.data as any[] | undefined) || [];
  const resolvedModuleId = module?.moduleId || moduleId || "";

  const progressList = (progressQuery.data || []) as any[];
  const isModuleCompleted = progressList.some(
    (p) => p.moduleId === resolvedModuleId && p.isModuleCompleted === "yes"
  );

  const cfg = isLegacyModule
    ? (MODULE_CONFIG[moduleId || ""] || DEFAULT_CONFIG)
    : { emoji: interactiveMod?.emoji || "📋", color: interactiveMod?.color || "#6B7280", bgColor: interactiveMod?.bgColor || "#F3F4F6" };

  const isLoading = isLegacyModule
    ? (moduleByIdQuery.isLoading || legacyStepsQuery.isLoading)
    : (interactiveModQuery.isLoading || interactiveStepsQuery.isLoading || overridesQuery.isLoading);

  const isVideoOnly = !!(module?.videoUrl) && steps.length === 0;
  const hasSteps = steps.length > 0;
  const hasTools = moduleTools.length > 0;

  // Score calculations
  const stepsWithChallenge = steps.filter(s => !!(s.question && s.choices && s.choices.length > 0 && s.correctId));
  const totalChallenges = stepsWithChallenge.length;
  const correctCount = Object.values(stepScores).filter(Boolean).length;

  // ── Mark complete ─────────────────────────────────────────────────────────────
  const handleMarkComplete = useCallback(async () => {
    if (isPreview) {
      Alert.alert("Preview Mode", "Module completion is disabled in preview mode.");
      return;
    }
    if (!employee?.employeeId) return;
    setIsMarkingComplete(true);
    try {
      await updateProgressMutation.mutateAsync({
        employeeId: employee.employeeId,
        moduleId: resolvedModuleId,
        isModuleCompleted: "yes",
        completedAt: new Date(),
      });
      await progressQuery.refetch();
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setViewMode("complete");
    } catch {
      Alert.alert("Error", "Could not save progress. Please try again.");
    } finally {
      setIsMarkingComplete(false);
    }
  }, [employee?.employeeId, resolvedModuleId, isPreview, updateProgressMutation, progressQuery]);

  // ── Retake ────────────────────────────────────────────────────────────────────
  const handleRetake = useCallback(() => {
    setStepScores({});
    setCurrentStepIndex(0);
    setViewMode("step");
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────────
  const goToStep = (index: number) => {
    setCurrentStepIndex(index);
    setViewMode("step");
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleAfterVideo = () => {
    if (isVideoOnly) setViewMode("video-done");
    else if (hasTools) setViewMode("tools");
    else goToStep(0);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleNextStep = () => {
    if (currentStepIndex < steps.length - 1) {
      goToStep(currentStepIndex + 1);
    } else {
      setViewMode("score-summary");
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      goToStep(currentStepIndex - 1);
    } else {
      if (hasTools) setViewMode("tools");
      else if (module?.videoUrl) setViewMode("intro-video");
      else router.back();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const handleScoreStep = (stepIndex: number, correct: boolean) => {
    setStepScores(prev => ({ ...prev, [stepIndex]: correct }));
  };

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0A0A14" }}>
          <ActivityIndicator size="large" color={cfg.color} />
          <Text style={{ marginTop: 12, color: "#9CA3AF", fontSize: 14 }}>Loading module...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!module) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0A0A14" }}>
          <Text style={{ fontSize: 16, color: "#9CA3AF" }}>Module not found</Text>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginTop: 16 })}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>← Go Back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (!module.videoUrl && !hasSteps) {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <View style={[styles.header, { borderBottomColor: "#1F2937", backgroundColor: "#0A0A14" }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>← Training</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0A0A14" }}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>🚧</Text>
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 8 }}>
            {module.name}
          </Text>
          <Text style={{ fontSize: 14, color: "#9CA3AF", textAlign: "center" }}>
            Content for this module hasn't been added yet. Check back soon.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  // ── COMPLETE ──────────────────────────────────────────────────────────────────
  if (viewMode === "complete") {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <ModuleCompleteScreen moduleName={module.name} emoji={cfg.emoji} onBack={() => router.back()} />
      </ScreenContainer>
    );
  }

  // ── SCORE SUMMARY ─────────────────────────────────────────────────────────────
  if (viewMode === "score-summary") {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <View style={[styles.header, { borderBottomColor: "#1F2937", backgroundColor: "#0A0A14" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>← Training</Text>
            </Pressable>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#FFFFFF" }}>Results</Text>
            <View style={{ width: 60 }} />
          </View>
        </View>
        <ScoreSummaryScreen
          moduleName={module.name}
          emoji={cfg.emoji}
          correctCount={correctCount}
          totalCount={totalChallenges}
          onMarkComplete={handleMarkComplete}
          onRetake={handleRetake}
          onExit={() => router.back()}
          isMarkingComplete={isMarkingComplete}
          isModuleCompleted={isModuleCompleted}
        />
      </ScreenContainer>
    );
  }

  // ── INTRO VIDEO ───────────────────────────────────────────────────────────────
  if (viewMode === "intro-video") {
    if (!module.videoUrl) {
      if (hasTools) setViewMode("tools");
      else if (hasSteps) { setCurrentStepIndex(0); setViewMode("step"); }
      return null;
    }
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <InteractiveVideoGate
          videoUrl={module.videoUrl}
          watchKey={`module_intro_${moduleId}`}
          title={module.name}
          accentColor={cfg.color}
          accentBgColor={cfg.bgColor}
          onContinue={handleAfterVideo}
          onSkip={handleAfterVideo}
          onExit={() => router.back()}
          scrollRef={scrollRef}
        />
      </ScreenContainer>
    );
  }

  // ── VIDEO-DONE ────────────────────────────────────────────────────────────────
  if (viewMode === "video-done") {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <View style={[styles.header, { borderBottomColor: "#1F2937", backgroundColor: "#0A0A14" }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>← Training</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center", paddingBottom: 48, backgroundColor: "#0A0A14" }}>
          <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: "#111827", alignItems: "center", justifyContent: "center", marginBottom: 20, borderWidth: 2, borderColor: `${cfg.color}40` }}>
            <Text style={{ fontSize: 40 }}>{cfg.emoji}</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#FFFFFF", textAlign: "center", marginBottom: 8 }}>
            {module.name}
          </Text>
          {module.description ? (
            <Text style={{ fontSize: 14, color: "#9CA3AF", textAlign: "center", marginBottom: 24, lineHeight: 22 }}>
              {module.description}
            </Text>
          ) : null}
          <View style={styles.videoDoneCard}>
            <Text style={{ fontSize: 32, marginBottom: 10 }}>🎬</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#4ADE80", textAlign: "center", marginBottom: 6 }}>Video Complete</Text>
            <Text style={{ fontSize: 13, color: "#86EFAC", textAlign: "center", lineHeight: 20 }}>
              You've watched the training video. Tap below to mark this module as complete.
            </Text>
          </View>
          {isModuleCompleted ? (
            <View style={{ width: "100%", gap: 12, marginTop: 24 }}>
              <View style={styles.alreadyCompleteBox}>
                <Text style={{ color: "#4ADE80", fontWeight: "700", fontSize: 16 }}>✓ Already Completed</Text>
              </View>
              <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.exitBtn, { opacity: pressed ? 0.8 : 1 }]}>
                <Text style={styles.exitBtnText}>← Back to Training</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ width: "100%", gap: 12, marginTop: 24 }}>
              <Pressable
                onPress={handleMarkComplete}
                disabled={isMarkingComplete}
                style={({ pressed }) => ({ backgroundColor: "#22C55E", paddingVertical: 18, borderRadius: 14, alignItems: "center", opacity: pressed || isMarkingComplete ? 0.8 : 1 })}
              >
                {isMarkingComplete
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 17 }}>✓ Mark as Complete</Text>
                }
              </Pressable>
              <Pressable onPress={() => setViewMode("intro-video")} style={({ pressed }) => ({ paddingVertical: 12, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 14, color: "#9CA3AF", fontWeight: "600" }}>▶ Rewatch Video</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── TOOLS ─────────────────────────────────────────────────────────────────────
  if (viewMode === "tools") {
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        <ModuleToolsScreen
          moduleKey={moduleId || ""}
          moduleName={module.name}
          onContinue={() => goToStep(0)}
          onExit={() => {
            if (module.videoUrl) setViewMode("intro-video");
            else router.back();
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          }}
        />
      </ScreenContainer>
    );
  }

  // ── STEP — Floor Mats design for ALL modules ──────────────────────────────────
  if (viewMode === "step" && steps.length > 0) {
    const step = steps[currentStepIndex];
    const isLastStep = currentStepIndex === steps.length - 1;
    const isFirstStep = currentStepIndex === 0;

    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-[#0A0A14]">
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: "#1F2937", backgroundColor: "#0A0A14" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pressable
              onPress={handlePrevStep}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: 4, paddingRight: 8 })}
            >
              <Text style={{ fontSize: 22, color: "#FFFFFF" }}>←</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "800", color: "#FFFFFF" }} numberOfLines={1}>
                {cfg.emoji} {module.name}
              </Text>
              <Text style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>
                Step {currentStepIndex + 1} of {steps.length}
              </Text>
            </View>
            <View style={styles.starBadge}>
              <Text style={{ fontSize: 13 }}>⭐</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#FFFFFF" }}>
                {currentStepIndex + 1}/{steps.length}
              </Text>
            </View>
          </View>
          {/* Progress bar */}
          <View style={{ height: 3, backgroundColor: "#1F2937", borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${((currentStepIndex + 1) / steps.length) * 100}%`, backgroundColor: cfg.color, borderRadius: 2 }} />
          </View>
          {isPreview && (
            <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8, alignSelf: "center" }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#92400E" }}>👁 PREVIEW MODE</Text>
            </View>
          )}
        </View>

        <FloorMatsStepCard
          key={`${step.stepId}-${currentStepIndex}`}
          step={step}
          stepNumber={currentStepIndex + 1}
          totalSteps={steps.length}
          accentColor={cfg.color}
          onNext={handleNextStep}
          onPrev={handlePrevStep}
          isLastStep={isLastStep}
          isFirstStep={isFirstStep}
          onScoreStep={(correct) => handleScoreStep(currentStepIndex, correct)}
        />
      </ScreenContainer>
    );
  }

  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  imageCaption: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.70)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  imageCaptionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  noImageBanner: {
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    borderRadius: 16,
  },
  noImageTitle: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  stepCard: {
    backgroundColor: "#111827",
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  stepCardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: 26,
  },
  stepCardDesc: {
    fontSize: 15,
    color: "#D1D5DB",
    lineHeight: 24,
  },
  warningBox: {
    backgroundColor: "#2D0A0A",
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#EF4444",
    gap: 4,
    marginTop: 4,
  },
  warningLabel: { fontSize: 12, fontWeight: "700", color: "#FCA5A5" },
  warningText: { fontSize: 13, color: "#FCA5A5", lineHeight: 20 },
  tipBox: {
    backgroundColor: "#052E16",
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#22C55E",
    gap: 4,
    marginTop: 4,
  },
  tipLabel: { fontSize: 12, fontWeight: "700", color: "#4ADE80" },
  tipText: { fontSize: 13, color: "#86EFAC", lineHeight: 20 },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tile: {
    flex: 1,
    minWidth: "28%",
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  tileText: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
  },
  nextBtn: {
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  nextBtnText: {
    fontWeight: "800",
    fontSize: 16,
  },
  prevBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  prevBtnText: {
    color: "#9CA3AF",
    fontWeight: "600",
    fontSize: 15,
  },
  markCompleteBtn: {
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#22C55E",
  },
  markCompleteBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 17,
  },
  retakeBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#374151",
    backgroundColor: "#1F2937",
  },
  retakeBtnText: {
    color: "#D1D5DB",
    fontWeight: "700",
    fontSize: 16,
  },
  exitBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#374151",
  },
  exitBtnText: {
    color: "#9CA3AF",
    fontWeight: "600",
    fontSize: 15,
  },
  starBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1F2937",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#374151",
  },
  scoreBadge: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
  },
  scoreCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    marginVertical: 20,
  },
  resultPill: {
    width: "100%",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    alignItems: "center",
  },
  alreadyCompleteBox: {
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#052E16",
    borderWidth: 1.5,
    borderColor: "#22C55E",
  },
  videoDoneCard: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  completeIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#052E16",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "#22C55E",
  },
  completeBadge: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1F2937",
  },
});
