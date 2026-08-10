import { useState, useRef } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

// ── Inline Quiz Component ────────────────────────────────────────────────────
type AnswerKey = "A" | "B" | "C" | "D";
interface QuizQuestion {
  questionId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: AnswerKey;
}

function QuizTaker({
  moduleId,
  moduleName,
  employeeId,
  onDone,
  colors,
}: {
  moduleId: string;
  moduleName: string;
  employeeId: string;
  onDone: (score: number, total: number, passed: boolean) => void;
  colors: any;
}) {
  const questionsQuery = trpc.training.getQuizQuestions.useQuery({ moduleId }, { staleTime: 60 * 1000 });
  const submitMutation = trpc.training.submitQuizAttempt.useMutation();
  const utils = trpc.useUtils();
  const questions = (questionsQuery.data || []) as QuizQuestion[];
  const [answers, setAnswers] = useState<Record<string, AnswerKey>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; passed: boolean } | null>(null);

  const handleSubmit = async () => {
    const unanswered = questions.filter(q => !answers[q.questionId]);
    if (unanswered.length > 0) {
      Alert.alert("Incomplete", `Please answer all ${questions.length} questions before submitting.`);
      return;
    }
    const score = questions.filter(q => answers[q.questionId] === q.correctAnswer).length;
    const total = questions.length;
    const pct = Math.round((score / total) * 100);
    const passed = pct >= 70;
    await submitMutation.mutateAsync({
      employeeId,
      moduleId,
      score,
      totalQuestions: total,
      answers: JSON.stringify(answers),
      passed: passed ? "yes" : "no",
    });
    utils.training.getAllQuizAttemptsForEmployee.invalidate({ employeeId });
    setResult({ score, total, passed });
    setSubmitted(true);
  };

  if (questionsQuery.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ marginTop: 12, color: colors.muted, fontSize: 14 }}>Loading questions...</Text>
      </View>
    );
  }

  if (questions.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Text style={{ fontSize: 32, marginBottom: 12 }}>📝</Text>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, textAlign: "center" }}>No Questions Yet</Text>
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
          The admin hasn't added questions to this quiz yet.
        </Text>
        <Pressable onPress={() => onDone(0, 0, false)} style={({ pressed }) => ({ marginTop: 24, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ fontWeight: "600", color: colors.foreground }}>← Back</Text>
        </Pressable>
      </View>
    );
  }

  if (submitted && result) {
    const pct = Math.round((result.score / result.total) * 100);
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 }}>
        <Text style={{ fontSize: 56 }}>{result.passed ? "🏆" : "📚"}</Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: result.passed ? "#22C55E" : colors.foreground, textAlign: "center" }}>
          {result.passed ? "Quiz Passed!" : "Keep Studying"}
        </Text>
        <View style={{ backgroundColor: result.passed ? "#D1FAE5" : colors.surface, borderRadius: 16, padding: 20, alignItems: "center", width: "100%", borderWidth: 1, borderColor: result.passed ? "#22C55E" : colors.border }}>
          <Text style={{ fontSize: 48, fontWeight: "900", color: result.passed ? "#16A34A" : colors.foreground }}>{pct}%</Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>{result.score} of {result.total} correct</Text>
          {!result.passed && (
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8, textAlign: "center" }}>
              You need 70% to pass. Review the material and try again.
            </Text>
          )}
        </View>
        <Pressable onPress={() => onDone(result.score, result.total, result.passed)} style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, opacity: pressed ? 0.85 : 1, width: "100%", alignItems: "center" })}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>{moduleName}</Text>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>{questions.length} questions · 70% to pass</Text>
      {questions.map((q, i) => (
        <View key={q.questionId} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: answers[q.questionId] ? colors.primary : colors.border }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, lineHeight: 20, marginBottom: 12 }}>
            {i + 1}. {q.questionText}
          </Text>
          {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => {
            const isSelected = answers[q.questionId] === key;
            return (
              <Pressable
                key={key}
                onPress={() => setAnswers(prev => ({ ...prev, [q.questionId]: key }))}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: 10,
                  marginBottom: 6,
                  backgroundColor: isSelected ? `${colors.primary}20` : colors.background,
                  borderWidth: 1.5,
                  borderColor: isSelected ? colors.primary : colors.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: isSelected ? colors.primary : colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: isSelected ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: isSelected ? "#fff" : colors.muted }}>{key}</Text>
                </View>
                <Text style={{ fontSize: 13, color: isSelected ? colors.primary : colors.foreground, fontWeight: isSelected ? "600" : "400", flex: 1, lineHeight: 18 }}>
                  {q[`option${key}` as keyof QuizQuestion] as string}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Pressable
        onPress={handleSubmit}
        disabled={submitMutation.isPending}
        style={({ pressed }) => ({ backgroundColor: "#22C55E", borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: pressed ? 0.85 : 1, marginTop: 8 })}
      >
        {submitMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Submit Quiz</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// ── Main Training Screen ─────────────────────────────────────────────────────
export default function TrainingScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const [activeTab, setActiveTab] = useState<"modules" | "quizzes" | "progress">("modules");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [activeQuiz, setActiveQuiz] = useState<{ moduleId: string; moduleName: string } | null>(null);
  const isCollapsedDefault = true;

  const foldersQuery = trpc.training.getFolders.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const interactiveQuery = trpc.training.getAllInteractiveModules.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const quizModulesQuery = trpc.training.getAllModules.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const progressQuery = trpc.training.getAllUserProgress.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, staleTime: 60 * 1000 }
  );
  const allInteractivesQuery = trpc.training.getAllInteractiveModules.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const quizAttemptsQuery = trpc.training.getAllQuizAttemptsForEmployee.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId, staleTime: 30 * 1000 }
  );

  const folders = (foldersQuery.data || []) as any[];
  const allMods = (interactiveQuery.data || []) as any[];
  const quizModules = (quizModulesQuery.data || []) as any[];
  const progressList = (progressQuery.data || []) as any[];
  const allInteractives = (allInteractivesQuery.data || []) as any[];
  const allAttempts = (quizAttemptsQuery.data || []) as any[];

  // 50% milestone calculation
  const totalInteractives = allInteractives.length;
  const completedInteractives = progressList.filter((p: any) => p.isModuleCompleted === "yes").length;
  const progressPct = totalInteractives > 0 ? Math.round((completedInteractives / totalInteractives) * 100) : 0;
  const hasReached50 = progressPct >= 50;

  // Quiz score summary: best score per module
  const quizScoresByModule: Record<string, { bestScore: number; attempts: number; passed: boolean; lastDate: string }> = {};
  for (const attempt of allAttempts) {
    const pct = attempt.totalQuestions > 0 ? Math.round((attempt.score / attempt.totalQuestions) * 100) : 0;
    const existing = quizScoresByModule[attempt.moduleId];
    if (!existing || pct > existing.bestScore) {
      quizScoresByModule[attempt.moduleId] = {
        bestScore: pct,
        attempts: (existing?.attempts || 0) + 1,
        passed: attempt.passed === "yes",
        lastDate: attempt.attemptedAt,
      };
    } else {
      existing.attempts += 1;
    }
  }

  const assignedKeys = new Set<string>();
  for (const folder of folders) {
    const mods: any[] = folder.modules || [];
    mods.forEach((m: any) => assignedKeys.add(m.moduleKey));
  }
  const unassigned = allMods.filter((m: any) => !assignedKeys.has(m.moduleKey));

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isLoading = foldersQuery.isLoading || interactiveQuery.isLoading;

  const renderModuleCard = (mod: any) => (
    <Pressable
      key={mod.moduleKey}
      onPress={() => router.push(`/training/${mod.moduleKey}` as any)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        marginBottom: 10,
      })}
    >
      <View style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 16,
        borderWidth: 2,
        borderColor: (mod.color || "#6B7280") + "40",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
      }}>
        <View style={{
          backgroundColor: mod.bgColor || "#F3F4F6",
          borderRadius: 14,
          width: 52,
          height: 52,
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Text style={{ fontSize: 26 }}>{mod.emoji || "📋"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
            {mod.title}
          </Text>
          {mod.subtitle ? (
            <Text style={{ fontSize: 12, color: mod.color || colors.muted, fontWeight: "600", marginTop: 2 }}>
              {mod.subtitle}
            </Text>
          ) : null}
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            🎯 {mod.stepCount ?? 0} interactive challenges
          </Text>
        </View>
        <View style={{
          backgroundColor: mod.color || "#6B7280",
          borderRadius: 20,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Start →</Text>
        </View>
      </View>
    </Pressable>
  );

  const renderFolder = (folder: any) => {
    const mods: any[] = folder.modules || [];
    const isCollapsed = folder.id in collapsedFolders ? collapsedFolders[folder.id] : isCollapsedDefault;
    return (
      <View key={folder.id} style={{ marginBottom: 20 }}>
        <Pressable
          onPress={() => toggleFolder(folder.id)}
          style={({ pressed }) => ({
            opacity: pressed ? 0.8 : 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginBottom: isCollapsed ? 0 : 12,
            paddingVertical: 8,
            paddingHorizontal: 4,
          })}
        >
          <Text style={{ fontSize: 22 }}>{folder.emoji || "📁"}</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, flex: 1 }}>
            {folder.name}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginRight: 4 }}>
            {mods.length} module{mods.length !== 1 ? "s" : ""}
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted }}>
            {isCollapsed ? "▶" : "▼"}
          </Text>
        </Pressable>
        {!isCollapsed && (
          <View>
            {mods.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.muted, paddingLeft: 8, paddingBottom: 8 }}>
                No modules in this folder yet.
              </Text>
            ) : (
              mods.map(renderModuleCard)
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 20,
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: 0,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Training</Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              backgroundColor: colors.surface,
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            })}
          >
            <Text style={{ fontSize: 13, color: colors.muted }}>✕</Text>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>Exit</Text>
          </Pressable>
        </View>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
          Complete all modules to become certified
        </Text>

        {/* Tab Bar */}
        <View style={{ flexDirection: "row", gap: 4, paddingBottom: 0 }}>
          {(["modules", "quizzes", "progress"] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                borderBottomWidth: 2.5,
                borderBottomColor: activeTab === tab ? colors.primary : "transparent",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ fontSize: 13, fontWeight: activeTab === tab ? "700" : "500", color: activeTab === tab ? colors.primary : colors.muted }}>
                {tab === "modules" ? "Modules" : tab === "quizzes" ? "Quizzes" : "My Progress"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Modules Tab ── */}
      {activeTab === "modules" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : allMods.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
              <Text style={{ fontSize: 32 }}>📋</Text>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>No modules yet</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                Ask your admin to add training modules.
              </Text>
            </View>
          ) : (
            <>
              {folders.map(renderFolder)}
              {unassigned.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12, paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 22 }}>📋</Text>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, flex: 1 }}>Other</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{unassigned.length} module{unassigned.length !== 1 ? "s" : ""}</Text>
                  </View>
                  {unassigned.map(renderModuleCard)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Quizzes Tab ── */}
      {activeTab === "quizzes" && (
        <>
          {activeQuiz ? (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Pressable onPress={() => setActiveQuiz(null)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingRight: 12 })}>
                  <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>← Back</Text>
                </Pressable>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }}>{activeQuiz.moduleName}</Text>
              </View>
              <QuizTaker
                moduleId={activeQuiz.moduleId}
                moduleName={activeQuiz.moduleName}
                employeeId={employee?.employeeId || ""}
                colors={colors}
                onDone={() => setActiveQuiz(null)}
              />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {quizModulesQuery.isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
              ) : quizModules.length === 0 ? (
                <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
                  <Text style={{ fontSize: 32 }}>📝</Text>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>No quizzes yet</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>The admin hasn't created any quizzes yet.</Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>
                    Tap a quiz to start. You need 70% to pass.
                  </Text>
                  {quizModules.map((mod: any) => {
                    const scoreInfo = quizScoresByModule[mod.moduleId];
                    const hasPassed = scoreInfo?.passed;
                    return (
                      <Pressable
                        key={mod.moduleId}
                        onPress={() => setActiveQuiz({ moduleId: mod.moduleId, moduleName: mod.name || mod.quizTitle || mod.moduleId })}
                        style={({ pressed }) => ({
                          backgroundColor: colors.surface,
                          borderRadius: 16,
                          padding: 16,
                          borderWidth: 1.5,
                          borderColor: hasPassed ? "#22C55E" : colors.border,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 14,
                          opacity: pressed ? 0.85 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        })}
                      >
                        <View style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          backgroundColor: hasPassed ? "#D1FAE5" : `${colors.primary}15`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <Text style={{ fontSize: 24 }}>{hasPassed ? "🏆" : "📝"}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                            {mod.quizTitle || mod.name}
                          </Text>
                          {scoreInfo ? (
                            <Text style={{ fontSize: 12, color: hasPassed ? "#16A34A" : colors.muted, marginTop: 2 }}>
                              {hasPassed ? "✓ Passed" : "Not passed yet"} · Best: {scoreInfo.bestScore}% · {scoreInfo.attempts} attempt{scoreInfo.attempts !== 1 ? "s" : ""}
                            </Text>
                          ) : (
                            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Not taken yet</Text>
                          )}
                        </View>
                        <View style={{ backgroundColor: hasPassed ? "#22C55E" : colors.primary, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{hasPassed ? "Retake" : "Start →"}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* ── My Progress Tab ── */}
      {activeTab === "progress" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* 50% First Day Milestone Banner */}
          <View style={{
            backgroundColor: hasReached50 ? "#D1FAE5" : `${colors.primary}15`,
            borderRadius: 16,
            padding: 16,
            marginBottom: 20,
            borderWidth: 1.5,
            borderColor: hasReached50 ? "#22C55E" : `${colors.primary}40`,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 28 }}>{hasReached50 ? "🎉" : "🎯"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: hasReached50 ? "#16A34A" : colors.foreground }}>
                  {hasReached50 ? "Ready for First Day!" : "First Day Goal: 50%"}
                </Text>
                <Text style={{ fontSize: 12, color: hasReached50 ? "#16A34A" : colors.muted, marginTop: 2 }}>
                  {hasReached50
                    ? "You've completed enough training to start working."
                    : `Complete ${Math.max(0, Math.ceil(totalInteractives * 0.5) - completedInteractives)} more module${Math.max(0, Math.ceil(totalInteractives * 0.5) - completedInteractives) !== 1 ? "s" : ""} to unlock your first day.`}
                </Text>
              </View>
            </View>
            <View style={{ height: 8, backgroundColor: hasReached50 ? "#A7F3D0" : `${colors.primary}25`, borderRadius: 4, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${Math.min(progressPct, 100)}%`, backgroundColor: hasReached50 ? "#22C55E" : colors.primary, borderRadius: 4 }} />
            </View>
            <Text style={{ fontSize: 12, color: hasReached50 ? "#16A34A" : colors.muted, marginTop: 6, textAlign: "right" }}>
              {completedInteractives}/{totalInteractives} modules · {progressPct}%
            </Text>
          </View>

          {/* Quiz Scores Section */}
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground, marginBottom: 12 }}>Quiz Scores</Text>
          {quizAttemptsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : quizModules.length === 0 ? (
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center", marginBottom: 20 }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>No quizzes available yet.</Text>
            </View>
          ) : (
            <View style={{ gap: 10, marginBottom: 24 }}>
              {quizModules.map((mod: any) => {
                const scoreInfo = quizScoresByModule[mod.moduleId];
                const hasPassed = scoreInfo?.passed;
                return (
                  <View key={mod.moduleId} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: hasPassed ? "#22C55E" : colors.border, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hasPassed ? "#D1FAE5" : `${colors.primary}15`, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 20 }}>{hasPassed ? "🏆" : "📝"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{mod.quizTitle || mod.name}</Text>
                      {scoreInfo ? (
                        <Text style={{ fontSize: 12, color: hasPassed ? "#16A34A" : colors.muted, marginTop: 2 }}>
                          Best: {scoreInfo.bestScore}% · {scoreInfo.attempts} attempt{scoreInfo.attempts !== 1 ? "s" : ""}
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Not taken yet</Text>
                      )}
                    </View>
                    {scoreInfo ? (
                      <View style={{ alignItems: "center" }}>
                        <Text style={{ fontSize: 20, fontWeight: "900", color: hasPassed ? "#16A34A" : colors.foreground }}>{scoreInfo.bestScore}%</Text>
                        <Text style={{ fontSize: 10, color: hasPassed ? "#16A34A" : "#EF4444", fontWeight: "700" }}>{hasPassed ? "PASS" : "FAIL"}</Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => { setActiveTab("quizzes"); setActiveQuiz({ moduleId: mod.moduleId, moduleName: mod.quizTitle || mod.name }); }}
                        style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, opacity: pressed ? 0.8 : 1 })}
                      >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Take</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Module Completion Section */}
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground, marginBottom: 12 }}>Module Completion</Text>
          {progressQuery.isLoading || allInteractivesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
          ) : allInteractives.length === 0 ? (
            <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>No modules available yet.</Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {allInteractives.map((mod: any) => {
                const isCompleted = progressList.some((p: any) => p.moduleId === mod.moduleKey && p.isModuleCompleted === "yes");
                return (
                  <View key={mod.moduleKey} style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: isCompleted ? "#22C55E" : colors.border, flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isCompleted ? "#D1FAE5" : `${mod.color || "#6B7280"}20`, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 18 }}>{isCompleted ? "✓" : (mod.emoji || "📋")}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: isCompleted ? "#16A34A" : colors.foreground, flex: 1 }}>{mod.title}</Text>
                    {isCompleted && <Text style={{ fontSize: 11, color: "#16A34A", fontWeight: "700" }}>DONE</Text>}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
