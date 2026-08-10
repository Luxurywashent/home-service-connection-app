import { ActivityIndicator, Animated, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { TrainingSection } from "@/components/training-section";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";
import { useRef, useEffect, useState, useMemo } from "react";

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  // Week-to-date: from Monday through today (not full Sunday)
  return {
    start: monday.toISOString().split("T")[0],
    end: now.toISOString().split("T")[0],
    today: now.toISOString().split("T")[0],
  };
}

function getEfficiencyColor(eff: number, colors: any) {
  if (eff >= 80) return colors.success;
  if (eff >= 70) return colors.warning;
  return colors.error;
}

function formatExpirationCountdown(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const now = new Date();
  const exp = new Date(expiresAt + "T23:59:59");
  const diffMs = exp.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days === 1) return "Expires today";
  return `${days} days left`;
}

function TreasureChestReveal({ prizeName, prizeEmoji, onClose, colors }: {
  prizeName: string; prizeEmoji: string; onClose: () => void; colors: any;
}) {
  const chestBounce = useRef(new Animated.Value(0)).current;
  const prizeScale = useRef(new Animated.Value(0)).current;
  const prizeY = useRef(new Animated.Value(30)).current;
  const sparkleOpacity = useRef(new Animated.Value(0)).current;
  const lidRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(chestBounce, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(lidRotate, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(prizeScale, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(prizeY, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  const lidRotateInterpolate = lidRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-45deg"],
  });

  return (
    <View style={{
      flex: 1, justifyContent: "center", alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.5)", padding: 20,
    }}>
      <View style={{ alignItems: "center" }}>
        <Animated.Text style={{
          fontSize: 80, marginBottom: 20,
          transform: [
            {
              translateY: Animated.multiply(chestBounce, -20),
            },
          ],
        }}>
          🎁
        </Animated.Text>

        <Animated.Text style={{
          fontSize: 60, marginBottom: 20,
          transform: [
            { scale: prizeScale },
            { translateY: prizeY },
          ],
        }}>
          {prizeEmoji}
        </Animated.Text>

        <Text style={{
          fontSize: 24, fontWeight: "800", color: "#FFF", marginBottom: 8, textAlign: "center",
        }}>
          {prizeName}
        </Text>
        <Text style={{
          fontSize: 14, color: "#FFF", marginBottom: 24, textAlign: "center",
        }}>
          Congratulations!
        </Text>

        <TouchableOpacity
          onPress={onClose}
          style={{
            backgroundColor: "#3B82F6", paddingVertical: 12, paddingHorizontal: 32, borderRadius: 8,
          }}
        >
          <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
            Awesome!
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const router = useRouter();
  const [view, setView] = useState<"today" | "week" | "alltime">("today");
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [answerResult, setAnswerResult] = useState<"correct" | "incorrect" | null>(null);
  const [resultExplanation, setResultExplanation] = useState("");
  const [correctAnswerHint, setCorrectAnswerHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPrizeReveal, setShowPrizeReveal] = useState(false);

  const weekRange = getWeekRange();
  
  // Query only the data for the selected view
  const metricsQuery = trpc.performance.getDateRange.useQuery(
    {
      employeeId: employee?.employeeId || "",
      startDate: view === "today" ? weekRange.today : view === "week" ? weekRange.start : "2020-01-01",
      endDate: view === "today" ? weekRange.today : view === "week" ? weekRange.end : weekRange.today,
    },
    { enabled: !!employee?.employeeId }
  );

  const challengeQuery = trpc.mysteryBonus.getChallenge.useQuery(
    { employeeId: employee?.employeeId || "" },
    { enabled: !!employee?.employeeId }
  );

  const utils = trpc.useUtils();
  const submitMutation = trpc.mysteryBonus.submitAnswer.useMutation();

  const isLoading = metricsQuery.isLoading;
  const challenge = challengeQuery.data;

  // Calculate metrics based on view - aggregate for week/alltime, single day for today
  const calculateMetrics = useMemo(() => {
    const data = metricsQuery.data ?? [];
    
    if (!data || data.length === 0) {
      return { revenue: 0, hours: 0, efficiency: 0, upsells: 0, tips: 0 };
    }

    if (view === "today") {
      return {
        revenue: Number(data[0]?.revenueProduced ?? 0),
        hours: Number(data[0]?.hoursWorked ?? 0),
        efficiency: Number(data[0]?.efficiencyPercent ?? 0),
        upsells: Number(data[0]?.upsells ?? 0),
        tips: Number(data[0]?.tips ?? 0),
      };
    } else {
      // Aggregate for week and alltime
      const totalRevenue = data.reduce((sum, d) => sum + Number(d.revenueProduced ?? 0), 0);
      const totalHours = data.reduce((sum, d) => sum + Number(d.hoursWorked ?? 0), 0);
      const avgEfficiency = data.length > 0 ? data.reduce((sum, d) => sum + Number(d.efficiencyPercent ?? 0), 0) / data.length : 0;
      const totalUpsells = data.reduce((sum, d) => sum + Number(d.upsells ?? 0), 0);
      const totalTips = data.reduce((sum, d) => sum + Number(d.tips ?? 0), 0);
      
      return {
        revenue: totalRevenue,
        hours: totalHours,
        efficiency: avgEfficiency,
        upsells: totalUpsells,
        tips: totalTips,
      };
    }
  }, [view, metricsQuery.data]);

  const metrics = calculateMetrics;

  // Calculate projected income: (tips + bonus + $17/hr * hours) - 16.65% tax
  const calculateProjectedIncome = (data: any[]) => {
    if (!data || data.length === 0) return 0;
    const totalTips = data.reduce((sum, d) => sum + Number(d.tips ?? 0), 0);
    const totalBonus = data.reduce((sum, d) => sum + Number(d.upsells ?? 0), 0);
    const totalHours = data.reduce((sum, d) => sum + Number(d.hoursWorked ?? 0), 0);
    const hourlyRate = 17;
    const grossIncome = totalTips + totalBonus + (totalHours * hourlyRate);
    const tax = grossIncome * 0.1665;
    return grossIncome - tax;
  };

  // Show projected income based on current view
  const projectedIncome = calculateProjectedIncome(metricsQuery.data ?? []);

  const answeredQ = Number((challenge as any)?.answeredCount ?? 0);
  const totalQ = Number((challenge as any)?.totalQuestions ?? 0);
  const prizeName = (challenge as any)?.prizeName ?? "Mystery Bonus";
  const prizeEmoji = (challenge as any)?.prizeEmoji ?? "🎁";
  const challengeTitle = (challenge as any)?.challengeTitle ?? "Mystery Challenge";

  const handleSubmitAnswer = async () => {
    if (!selectedAnswer || !challenge || !("questionText" in challenge) || !employee) return;
    setSubmitting(true);
    try {
      const result = await submitMutation.mutateAsync({
        employeeId: employee.employeeId,
        questionId: (challenge as any).questionId,
        answer: selectedAnswer as "A" | "B" | "C" | "D",
      });
      if (result.success && result.correct) {
        setAnswerResult("correct");
        setResultExplanation((result as any).explanationCorrect ?? "");
        await utils.mysteryBonus.getChallenge.invalidate();
      } else if (result.success && !result.correct) {
        setAnswerResult("incorrect");
        const correctLetter = (result as any).correctAnswer ?? "";
        const q = (challenge as any);
        const correctText = correctLetter === "A" ? q.optionA : correctLetter === "B" ? q.optionB : correctLetter === "C" ? q.optionC : q.optionD ?? "";
        setCorrectAnswerHint(`The correct answer is ${correctLetter}: ${correctText}`);
        setResultExplanation((result as any).explanationIncorrect ?? "");
      }
    } catch (e) {
      console.log("Answer error:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    setSelectedAnswer(null);
    setAnswerResult(null);
    setResultExplanation("");
    setCorrectAnswerHint("");
  };

  const handleCloseQuiz = () => {
    setShowQuiz(false);
    setShowPrizeReveal(false);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setResultExplanation("");
    setCorrectAnswerHint("");
  };

  const challengeFullyCompleted = challenge?.hasChallenge && challenge.alreadyAttempted && challenge.attemptResult === "correct";
  const challengeFailed = challenge?.hasChallenge && challenge.alreadyAttempted && challenge.attemptResult === "incorrect";

  const firstName = employee?.fullName?.split(" ")[0] ?? "Detailer";

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {challenge && challenge.hasChallenge && (
          <View style={{
            backgroundColor: "#F59E0B15",
            borderRadius: 16,
            padding: 16,
            marginTop: 8,
            marginBottom: 16,
            borderWidth: 1.5,
            borderColor: "#F59E0B40",
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 22 }}>🎁</Text>
              <Text style={{ fontSize: 16, fontWeight: "800", color: "#D97706", flex: 1 }}>
                Participate to earn a mystery bonus
              </Text>
            </View>

            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
              {challengeTitle}
            </Text>
            {totalQ > 1 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3 }}>
                  <View style={{
                    width: `${Math.min((Number(answeredQ) / Number(totalQ)) * 100, 100)}%`,
                    height: 6, backgroundColor: challengeFailed ? colors.error : colors.success, borderRadius: 3,
                  }} />
                </View>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>
                  {answeredQ}/{totalQ}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => setShowQuiz(true)}
              activeOpacity={0.8}
              disabled={challengeFailed}
              style={{
                backgroundColor: challengeFailed ? colors.border : "#D97706",
                borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginTop: 8,
              }}
            >
              <Text style={{ color: challengeFailed ? colors.muted : "#FFFFFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                {challengeFailed ? "Challenge Failed" : "Take Challenge"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 28, fontWeight: "900", color: colors.foreground }}>
            Hey, {firstName}! 👋
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
            {view === "today" ? "Here's your performance today" : view === "week" ? "Here's your performance this week" : "Here's your all-time performance"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
          {(["today", "week", "alltime"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setView(t)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                backgroundColor: view === t ? colors.primary : colors.surface,
                borderRadius: 10,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: view === t ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: view === t ? "#FFFFFF" : colors.muted, textAlign: "center" }}>
                {t === "today" ? "Today" : t === "week" ? "Week" : "All Time"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Efficiency Hero Card */}
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 24,
              alignItems: "center", marginBottom: 16, borderWidth: 1, borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 }}>
                Efficiency Score
              </Text>
              <Text style={{
                fontSize: 64, fontWeight: "900",
                color: getEfficiencyColor(Number(metrics.efficiency), colors), marginTop: 4,
              }}>
                {Number(metrics.efficiency).toFixed(1)}%
              </Text>
              <View style={{
                marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20,
                backgroundColor: getEfficiencyColor(Number(metrics.efficiency), colors) + "20",
              }}>
                <Text style={{
                  fontSize: 12, fontWeight: "600",
                  color: getEfficiencyColor(Number(metrics.efficiency), colors),
                }}>
                  {Number(metrics.efficiency) >= 80 ? "Excellent" : Number(metrics.efficiency) >= 70 ? "Good" : "Needs Improvement"}
                </Text>
              </View>
            </View>

            {/* Key Metrics */}
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: colors.border, marginBottom: 20,
            }}>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Revenue</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>
                    ${Number(metrics.revenue).toFixed(0)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Hours</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                    {Number(metrics.hours).toFixed(1)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Bonus</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                    ${Number(metrics.upsells).toFixed(0)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Tips</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                    ${Number(metrics.tips).toFixed(0)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Projected Income */}
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: colors.border, marginBottom: 20,
            }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Projected Income
              </Text>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>
                    {view === "today" ? "Today" : view === "week" ? "This Week" : "All Time"}
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>${Number(projectedIncome).toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {/* Weekly Trend */}
            <TrainingSection colors={colors} />
          </>
        )}
      </ScrollView>

      {showQuiz && challenge && "questionText" in challenge && (
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{
            backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 20, maxHeight: "80%",
          }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
                {(challenge as any).questionText}
              </Text>

              {["A", "B", "C", "D"].map((letter) => {
                const optionKey = `option${letter}` as const;
                const optionText = (challenge as any)[optionKey];
                const isSelected = selectedAnswer === letter;
                const isCorrect = (challenge as any).correctAnswer === letter;
                const showCorrect = answerResult && isCorrect;
                const showIncorrect = answerResult && isSelected && !isCorrect;

                return (
                  <TouchableOpacity
                    key={letter}
                    onPress={() => !answerResult && setSelectedAnswer(letter as "A" | "B" | "C" | "D")}
                    disabled={!!answerResult}
                    style={{
                      borderWidth: 2,
                      borderColor: showCorrect ? colors.success : showIncorrect ? colors.error : isSelected ? colors.primary : colors.border,
                      borderRadius: 12, padding: 12, marginBottom: 10,
                      backgroundColor: showCorrect ? colors.success + "15" : showIncorrect ? colors.error + "15" : isSelected ? colors.primary + "15" : colors.surface,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                      {letter}. {optionText}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {resultExplanation && (
                <View style={{ marginTop: 16, padding: 12, backgroundColor: colors.surface, borderRadius: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.foreground }}>
                    {resultExplanation}
                  </Text>
                </View>
              )}

              {correctAnswerHint && (
                <View style={{ marginTop: 8, padding: 12, backgroundColor: colors.error + "15", borderRadius: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.error }}>
                    {correctAnswerHint}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
                <TouchableOpacity
                  onPress={handleCloseQuiz}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.border }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                    Close
                  </Text>
                </TouchableOpacity>

                {answerResult === "correct" ? (
                  <TouchableOpacity
                    onPress={() => {
                      setShowPrizeReveal(true);
                      handleNextQuestion();
                    }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.success }}
                  >
                    <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                      Claim Prize
                    </Text>
                  </TouchableOpacity>
                ) : answerResult === "incorrect" ? (
                  <TouchableOpacity
                    onPress={handleNextQuestion}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.primary }}
                  >
                    <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                      Try Again
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={handleSubmitAnswer}
                    disabled={!selectedAnswer || submitting}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: !selectedAnswer || submitting ? colors.border : colors.primary }}
                  >
                    <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700", textAlign: "center" }}>
                      {submitting ? "Checking..." : "Submit"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {showPrizeReveal && (
        <TreasureChestReveal
          prizeName={prizeName}
          prizeEmoji={prizeEmoji}
          onClose={() => {
            setShowPrizeReveal(false);
            handleCloseQuiz();
          }}
          colors={colors}
        />
      )}
    </ScreenContainer>
  );
}
