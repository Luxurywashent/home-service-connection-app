import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { Text, View, ScrollView, Pressable, ActivityIndicator } from "react-native";

const MODULE_CONFIG: Record<string, { emoji: string; color: string; name: string }> = {
  TM_WELCOME:  { emoji: "⭐", color: "#F59E0B", name: "Welcome & Company Standards" },
  TM_SAFETY:   { emoji: "🛡️", color: "#EF4444", name: "Safety & Chemical Handling" },
  TM_EXTERIOR: { emoji: "🚗", color: "#3B82F6", name: "Exterior Detailing" },
  TM_INTERIOR: { emoji: "💺", color: "#8B5CF6", name: "Interior Detailing" },
  TM_CUSTOMER: { emoji: "🤝", color: "#10B981", name: "Customer Service & Upselling" },
  TM_APP:      { emoji: "📱", color: "#0EA5E9", name: "Using the App" },
};
const DEFAULT_CONFIG = { emoji: "📚", color: "#6B7280", name: "Training Quiz" };

const PASS_THRESHOLD = 0.8; // 80% to pass

interface QuizQuestion {
  id: number;
  questionId: string;
  moduleId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  orderIndex: number;
}

type AnswerKey = "A" | "B" | "C" | "D";

export default function QuizScreen() {
  const router = useRouter();
  const { moduleId } = useLocalSearchParams<{ moduleId: string }>();
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerKey | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [answers, setAnswers] = useState<Record<number, AnswerKey>>({});
  const [quizComplete, setQuizComplete] = useState(false);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const questionsQuery = trpc.training.getQuizQuestions.useQuery(
    { moduleId: moduleId || "" },
    { enabled: !!moduleId, staleTime: 5 * 60 * 1000, refetchOnMount: false }
  );
  const submitAttemptMutation = trpc.training.submitQuizAttempt.useMutation();
  const utils = trpc.useUtils();

  const questions: QuizQuestion[] = (questionsQuery.data || []) as QuizQuestion[];
  const cfg = MODULE_CONFIG[moduleId || ""] || DEFAULT_CONFIG;
  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleSelectAnswer = (answer: AnswerKey) => {
    if (showFeedback) return;
    setSelectedAnswer(answer);
  };

  const handleConfirmAnswer = () => {
    if (!selectedAnswer || !currentQuestion) return;
    setShowFeedback(true);
    setAnswers((prev) => ({ ...prev, [currentIndex]: selectedAnswer }));
  };

  const handleNextQuestion = async () => {
    if (!selectedAnswer || !currentQuestion) return;

    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
    const newAnswers = { ...answers, [currentIndex]: selectedAnswer };

    if (isLastQuestion) {
      // Calculate final score
      let finalScore = 0;
      questions.forEach((q, i) => {
        const ans = i === currentIndex ? selectedAnswer : newAnswers[i];
        if (ans === q.correctAnswer) finalScore++;
      });

      const passed = finalScore / questions.length >= PASS_THRESHOLD;
      setScore(finalScore);
      setQuizComplete(true);
      setSubmitting(true);

      try {
        await submitAttemptMutation.mutateAsync({
          employeeId: employee?.employeeId || "",
          moduleId: moduleId || "",
          score: finalScore,
          totalQuestions: questions.length,
          answers: JSON.stringify(newAnswers),
          passed: passed ? "yes" : "no",
        });
        // Invalidate progress queries so dashboard updates
        utils.training.getAllUserProgress.invalidate();
        utils.training.getQuizAttempts.invalidate();
      } catch (e) {
        console.error("Failed to submit quiz attempt", e);
      } finally {
        setSubmitting(false);
      }
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setShowFeedback(false);
    }
  };

  const handleRetakeQuiz = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowFeedback(false);
    setAnswers({});
    setQuizComplete(false);
    setScore(0);
  };

  const handleBackToModule = () => {
    router.back();
  };

  if (questionsQuery.isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 12, color: colors.muted, fontSize: 14 }}>
            Loading quiz...
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (questions.length === 0) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📝</Text>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>
            No quiz questions yet
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginTop: 20 })}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>← Back to Module</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // ── Quiz Results Screen ──────────────────────────────────────────────────
  if (quizComplete) {
    const passed = score / questions.length >= PASS_THRESHOLD;
    const pct = Math.round((score / questions.length) * 100);

    return (
      <ScreenContainer edges={["left", "right"]}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {/* Result card */}
          <View
            style={{
              backgroundColor: passed ? "#D1FAE5" : "#FEF2F2",
              borderRadius: 20,
              padding: 28,
              alignItems: "center",
              borderWidth: 1.5,
              borderColor: passed ? "#6EE7B7" : "#FECACA",
              marginBottom: 24,
            }}
          >
            <Text style={{ fontSize: 56, marginBottom: 8 }}>
              {passed ? "🎉" : "📖"}
            </Text>
            <Text
              style={{
                fontSize: 24,
                fontWeight: "800",
                color: passed ? "#065F46" : "#991B1B",
                marginBottom: 6,
                textAlign: "center",
              }}
            >
              {passed ? "Quiz Passed!" : "Not Quite Yet"}
            </Text>
            <Text
              style={{
                fontSize: 15,
                color: passed ? "#047857" : "#B91C1C",
                textAlign: "center",
                lineHeight: 22,
                marginBottom: 16,
              }}
            >
              {passed
                ? "Excellent work! You've passed this module."
                : `You scored ${pct}%. You need 80% to pass. Review the material and try again.`}
            </Text>

            {/* Score display */}
            <View
              style={{
                backgroundColor: passed ? "#A7F3D0" : "#FECACA",
                borderRadius: 50,
                width: 90,
                height: 90,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  fontSize: 28,
                  fontWeight: "800",
                  color: passed ? "#065F46" : "#991B1B",
                }}
              >
                {pct}%
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: passed ? "#047857" : "#B91C1C", fontWeight: "600" }}>
              {score} / {questions.length} correct
            </Text>
          </View>

          {/* Question review */}
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 12,
            }}
          >
            Review Answers
          </Text>
          <View style={{ gap: 10, marginBottom: 24 }}>
            {questions.map((q, i) => {
              const userAnswer = answers[i];
              const isCorrect = userAnswer === q.correctAnswer;
              const optionLabels: Record<AnswerKey, string> = {
                A: q.optionA,
                B: q.optionB,
                C: q.optionC,
                D: q.optionD,
              };
              return (
                <View
                  key={q.questionId}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: isCorrect ? "#22C55E" : "#EF4444",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 16 }}>{isCorrect ? "✅" : "❌"}</Text>
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: colors.foreground,
                        flex: 1,
                        lineHeight: 18,
                      }}
                    >
                      {q.questionText}
                    </Text>
                  </View>
                  {!isCorrect && (
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, color: "#EF4444" }}>
                        Your answer: {userAnswer} — {optionLabels[userAnswer]}
                      </Text>
                      <Text style={{ fontSize: 12, color: "#22C55E", fontWeight: "600" }}>
                        Correct: {q.correctAnswer} — {optionLabels[q.correctAnswer]}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Action buttons */}
          <View style={{ gap: 10 }}>
            {passed ? (
              <Pressable
                onPress={() => router.push("/training")}
                style={({ pressed }) => ({
                  backgroundColor: "#22C55E",
                  paddingVertical: 16,
                  borderRadius: 14,
                  alignItems: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                  Back to Training →
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleRetakeQuiz}
                style={({ pressed }) => ({
                  backgroundColor: cfg.color,
                  paddingVertical: 16,
                  borderRadius: 14,
                  alignItems: "center",
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                  Retake Quiz
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleBackToModule}
              style={({ pressed }) => ({
                backgroundColor: colors.surface,
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ fontWeight: "600", color: colors.foreground }}>
                ← Back to Module
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Active Quiz ──────────────────────────────────────────────────────────
  const isCorrect = showFeedback && selectedAnswer === currentQuestion?.correctAnswer;
  const isWrong = showFeedback && selectedAnswer !== currentQuestion?.correctAnswer;

  const optionKeys: AnswerKey[] = ["A", "B", "C", "D"];
  const optionValues: Record<AnswerKey, string> = {
    A: currentQuestion?.optionA || "",
    B: currentQuestion?.optionB || "",
    C: currentQuestion?.optionC || "",
    D: currentQuestion?.optionD || "",
  };

  const getOptionStyle = (key: AnswerKey) => {
    if (!showFeedback) {
      return {
        backgroundColor: selectedAnswer === key ? `${cfg.color}20` : colors.surface,
        borderColor: selectedAnswer === key ? cfg.color : colors.border,
        borderWidth: selectedAnswer === key ? 2 : 1,
      };
    }
    if (key === currentQuestion?.correctAnswer) {
      return { backgroundColor: "#D1FAE5", borderColor: "#22C55E", borderWidth: 2 };
    }
    if (key === selectedAnswer && key !== currentQuestion?.correctAnswer) {
      return { backgroundColor: "#FEF2F2", borderColor: "#EF4444", borderWidth: 2 };
    }
    return { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, opacity: 0.5 };
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={handleBackToModule}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>✕ Exit</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: colors.muted, fontWeight: "600" }}>
              {cfg.emoji} {cfg.name}
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>
            {currentIndex + 1}/{questions.length}
          </Text>
        </View>

        {/* Progress bar */}
        <View
          style={{
            height: 4,
            backgroundColor: colors.border,
            borderRadius: 2,
            marginTop: 10,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${((currentIndex + (showFeedback ? 1 : 0)) / questions.length) * 100}%`,
              backgroundColor: cfg.color,
              borderRadius: 2,
            }}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Question */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 20,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: cfg.color, marginBottom: 8 }}>
            QUESTION {currentIndex + 1}
          </Text>
          <Text
            style={{
              fontSize: 17,
              fontWeight: "700",
              color: colors.foreground,
              lineHeight: 26,
            }}
          >
            {currentQuestion?.questionText}
          </Text>
        </View>

        {/* Answer options */}
        <View style={{ gap: 10, marginBottom: 20 }}>
          {optionKeys.map((key) => (
            <Pressable
              key={key}
              onPress={() => handleSelectAnswer(key)}
              style={({ pressed }) => ({
                borderRadius: 12,
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                opacity: showFeedback ? 1 : pressed ? 0.85 : 1,
                ...getOptionStyle(key),
              })}
            >
              {/* Option letter */}
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: showFeedback
                    ? key === currentQuestion?.correctAnswer
                      ? "#22C55E"
                      : key === selectedAnswer
                      ? "#EF4444"
                      : `${cfg.color}20`
                    : selectedAnswer === key
                    ? cfg.color
                    : `${cfg.color}20`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: showFeedback
                      ? key === currentQuestion?.correctAnswer || key === selectedAnswer
                        ? "#fff"
                        : cfg.color
                      : selectedAnswer === key
                      ? "#fff"
                      : cfg.color,
                  }}
                >
                  {showFeedback
                    ? key === currentQuestion?.correctAnswer
                      ? "✓"
                      : key === selectedAnswer
                      ? "✗"
                      : key
                    : key}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "500",
                  color: colors.foreground,
                  flex: 1,
                  lineHeight: 20,
                }}
              >
                {optionValues[key]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Feedback banner */}
        {showFeedback && (
          <View
            style={{
              backgroundColor: isCorrect ? "#D1FAE5" : "#FEF2F2",
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: isCorrect ? "#6EE7B7" : "#FECACA",
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 22 }}>{isCorrect ? "✅" : "❌"}</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "700",
                  color: isCorrect ? "#065F46" : "#991B1B",
                  marginBottom: 2,
                }}
              >
                {isCorrect ? "Correct!" : "Incorrect"}
              </Text>
              {isWrong && (
                <Text style={{ fontSize: 13, color: "#B91C1C", lineHeight: 18 }}>
                  The correct answer is {currentQuestion?.correctAnswer} — {optionValues[currentQuestion?.correctAnswer]}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Action button */}
        {!showFeedback ? (
          <Pressable
            onPress={handleConfirmAnswer}
            disabled={!selectedAnswer}
            style={({ pressed }) => ({
              backgroundColor: selectedAnswer ? cfg.color : colors.border,
              paddingVertical: 16,
              borderRadius: 14,
              alignItems: "center",
              opacity: pressed && !!selectedAnswer ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                color: selectedAnswer ? "#fff" : colors.muted,
                fontWeight: "700",
                fontSize: 16,
              }}
            >
              {selectedAnswer ? "Confirm Answer" : "Select an Answer"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleNextQuestion}
            disabled={submitting}
            style={({ pressed }) => ({
              backgroundColor: cfg.color,
              paddingVertical: 16,
              borderRadius: 14,
              alignItems: "center",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                {isLastQuestion ? "See Results →" : "Next Question →"}
              </Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
