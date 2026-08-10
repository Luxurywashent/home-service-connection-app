import { useState } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { CalendarPicker } from "@/components/calendar-picker";

export default function AdminQuizScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();

  // Challenge list / detail
  const [selectedChallenge, setSelectedChallenge] = useState<any>(null);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [showEditChallenge, setShowEditChallenge] = useState(false);
  const [showCreateQuestion, setShowCreateQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);

  // Challenge form
  const [cTitle, setCTitle] = useState("");
  const [cPrizeName, setCPrizeName] = useState("");
  const [cPrizeEmoji, setCPrizeEmoji] = useState("🍽️");
  const [cIsActive, setCIsActive] = useState(true);
  const [cExpiresAt, setCExpiresAt] = useState("");
  const [showExpPicker, setShowExpPicker] = useState(false);
  const [cSaving, setCSaving] = useState(false);

  // Question form
  const [questionText, setQuestionText] = useState("");
  const [optionA, setOptionA] = useState("");
  const [optionB, setOptionB] = useState("");
  const [optionC, setOptionC] = useState("");
  const [optionD, setOptionD] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState<"A" | "B" | "C" | "D">("A");
  const [explanationCorrect, setExplanationCorrect] = useState("");
  const [explanationIncorrect, setExplanationIncorrect] = useState("");
  const [qSaving, setQSaving] = useState(false);

  const { data: challengesList, isLoading } = trpc.challenge.getAll.useQuery();
  const { data: detailers } = trpc.employee.listDetailers.useQuery();

  const challengeQuestions = trpc.quiz.getForChallenge.useQuery(
    { challengeId: selectedChallenge?.challengeId ?? "" },
    { enabled: !!selectedChallenge }
  );

  const attemptSummary = trpc.mysteryBonus.getAttemptSummary.useQuery(
    { challengeId: selectedChallenge?.challengeId ?? "" },
    { enabled: !!selectedChallenge && showResults }
  );

  const createChallengeMut = trpc.challenge.create.useMutation();
  const updateChallengeMut = trpc.challenge.update.useMutation();
  const deleteChallengeMut = trpc.challenge.delete.useMutation();
  const createQuestionMut = trpc.quiz.create.useMutation();
  const updateQuestionMut = trpc.quiz.update.useMutation();
  const deleteQuestionMut = trpc.quiz.delete.useMutation();

  const resetChallengeForm = () => {
    setCTitle(""); setCPrizeName(""); setCPrizeEmoji("🍽️"); setCIsActive(true); setCExpiresAt("");
  };

  const resetQuestionForm = () => {
    setQuestionText(""); setOptionA(""); setOptionB(""); setOptionC(""); setOptionD("");
    setCorrectAnswer("A"); setExplanationCorrect(""); setExplanationIncorrect(""); setEditingQuestion(null);
  };

  const handleCreateChallenge = async () => {
    if (!cTitle.trim()) return;
    setCSaving(true);
    try {
      await createChallengeMut.mutateAsync({
        challengeId: `CH${Date.now()}`,
        title: cTitle.trim(),
        prizeName: cPrizeName.trim() || undefined,
        prizeEmoji: cPrizeEmoji.trim() || undefined,
        isActive: cIsActive ? "yes" : "no",
        expiresAt: cExpiresAt || null,
        createdBy: employee?.fullName,
      });
      utils.challenge.getAll.invalidate();
      resetChallengeForm();
      setShowCreateChallenge(false);
    } catch (e) {
      if (Platform.OS === "web") alert("Failed to create challenge");
      else Alert.alert("Error", "Failed to create challenge");
    } finally { setCSaving(false); }
  };

  const handleUpdateChallenge = async () => {
    if (!selectedChallenge) return;
    setCSaving(true);
    try {
      await updateChallengeMut.mutateAsync({
        challengeId: selectedChallenge.challengeId,
        title: cTitle.trim() || undefined,
        prizeName: cPrizeName.trim() || null,
        prizeEmoji: cPrizeEmoji.trim() || null,
        isActive: cIsActive ? "yes" : "no",
        expiresAt: cExpiresAt || null,
      });
      utils.challenge.getAll.invalidate();
      setSelectedChallenge({ ...selectedChallenge, title: cTitle, prizeName: cPrizeName, prizeEmoji: cPrizeEmoji, isActive: cIsActive ? "yes" : "no", expiresAt: cExpiresAt || null });
      setShowEditChallenge(false);
    } catch (e) {
      if (Platform.OS === "web") alert("Failed to update challenge");
      else Alert.alert("Error", "Failed to update challenge");
    } finally { setCSaving(false); }
  };

  const handleDeleteChallenge = async (challengeId: string) => {
    const doDelete = async () => {
      await deleteChallengeMut.mutateAsync({ challengeId });
      utils.challenge.getAll.invalidate();
      setSelectedChallenge(null);
    };
    if (Platform.OS === "web") { if (confirm("Delete this challenge and all its questions?")) doDelete(); }
    else Alert.alert("Delete Challenge", "This will delete the challenge and all its questions.", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const handleCreateQuestion = async () => {
    if (!questionText.trim() || !optionA.trim() || !optionB.trim() || !optionC.trim()) return;
    setQSaving(true);
    try {
      const existingCount = challengeQuestions.data?.length ?? 0;
      await createQuestionMut.mutateAsync({
        questionId: `Q${Date.now()}`,
        challengeId: selectedChallenge.challengeId,
        orderIndex: existingCount + 1,
        questionText: questionText.trim(),
        optionA: optionA.trim(),
        optionB: optionB.trim(),
        optionC: optionC.trim(),
        optionD: optionD.trim() || undefined,
        correctAnswer,
        explanationCorrect: explanationCorrect.trim() || undefined,
        explanationIncorrect: explanationIncorrect.trim() || undefined,
      });
      utils.quiz.getForChallenge.invalidate({ challengeId: selectedChallenge.challengeId });
      resetQuestionForm();
      setShowCreateQuestion(false);
    } catch (e) {
      if (Platform.OS === "web") alert("Failed to create question");
      else Alert.alert("Error", "Failed to create question");
    } finally { setQSaving(false); }
  };

  const handleUpdateQuestion = async () => {
    if (!editingQuestion) return;
    setQSaving(true);
    try {
      await updateQuestionMut.mutateAsync({
        questionId: editingQuestion.questionId,
        questionText: questionText.trim(),
        optionA: optionA.trim(),
        optionB: optionB.trim(),
        optionC: optionC.trim(),
        optionD: optionD.trim() || null,
        correctAnswer,
        explanationCorrect: explanationCorrect.trim() || null,
        explanationIncorrect: explanationIncorrect.trim() || null,
      });
      utils.quiz.getForChallenge.invalidate({ challengeId: selectedChallenge.challengeId });
      resetQuestionForm();
      setShowCreateQuestion(false);
    } catch (e) {
      if (Platform.OS === "web") alert("Failed to update question");
      else Alert.alert("Error", "Failed to update question");
    } finally { setQSaving(false); }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    const doDelete = async () => {
      await deleteQuestionMut.mutateAsync({ questionId });
      utils.quiz.getForChallenge.invalidate({ challengeId: selectedChallenge.challengeId });
    };
    if (Platform.OS === "web") { if (confirm("Delete this question?")) doDelete(); }
    else Alert.alert("Delete Question", "Are you sure?", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
  };

  const startEditQuestion = (q: any) => {
    setQuestionText(q.questionText);
    setOptionA(q.optionA);
    setOptionB(q.optionB);
    setOptionC(q.optionC);
    setOptionD(q.optionD ?? "");
    setCorrectAnswer(q.correctAnswer);
    setExplanationCorrect(q.explanationCorrect ?? "");
    setExplanationIncorrect(q.explanationIncorrect ?? "");
    setEditingQuestion(q);
    setShowCreateQuestion(true);
  };

  const startEditChallenge = () => {
    setCTitle(selectedChallenge.title);
    setCPrizeName(selectedChallenge.prizeName ?? "");
    setCPrizeEmoji(selectedChallenge.prizeEmoji ?? "🍽️");
    setCIsActive(selectedChallenge.isActive === "yes");
    setCExpiresAt(selectedChallenge.expiresAt ?? "");
    setShowEditChallenge(true);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "No expiration";
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // Results view: per-detailer breakdown
  const getResultsData = () => {
    if (!attemptSummary.data || !detailers) return [];
    const totalQ = attemptSummary.data.questions;
    return detailers.map((d) => {
      const empAttempts = attemptSummary.data!.attempts.filter((a) => a.employeeId === d.employeeId);
      const correctCount = empAttempts.filter((a) => a.attemptResult === "correct").length;
      const incorrectCount = empAttempts.filter((a) => a.attemptResult === "incorrect").length;
      const status = incorrectCount > 0 ? "failed" : correctCount === totalQ ? "completed" : "pending";
      return { ...d, correctCount, incorrectCount, totalQ, status };
    });
  };

  // ─── Challenge List View ───
  if (!selectedChallenge) {
    return (
      <ScreenContainer edges={["left", "right"]} className="px-5">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 16 }}>
          <View>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Mystery Bonus</Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>{challengesList?.length ?? 0} challenges</Text>
          </View>
          <TouchableOpacity
            onPress={() => { resetChallengeForm(); setShowCreateChallenge(true); }}
            activeOpacity={0.7}
            style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>+ New</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (challengesList ?? []).length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 60, gap: 8 }}>
            <Text style={{ fontSize: 40 }}>🎁</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.muted }}>No challenges yet</Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>Create a challenge with multiple questions{"\n"}for your team to earn mystery bonuses</Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={challengesList}
            keyExtractor={(item) => item.challengeId}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedChallenge(item)}
                activeOpacity={0.7}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border,
                  borderLeftWidth: 3, borderLeftColor: item.isActive === "yes" ? colors.success : colors.muted,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontSize: 28 }}>{item.prizeEmoji || "🎁"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.title}</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                      <Text style={{ fontSize: 11, color: item.isActive === "yes" ? colors.success : colors.muted, fontWeight: "600" }}>
                        {item.isActive === "yes" ? "Active" : "Inactive"}
                      </Text>
                      {item.prizeName && (
                        <Text style={{ fontSize: 11, color: colors.muted }}>Prize: {item.prizeName}</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                      Expires: {formatDate(item.expiresAt)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Create Challenge Modal */}
        <Modal visible={showCreateChallenge} animationType="slide" presentationStyle="pageSheet">
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <TouchableOpacity onPress={() => { resetChallengeForm(); setShowCreateChallenge(false); }} activeOpacity={0.7}>
                    <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>New Challenge</Text>
                  <View style={{ width: 60 }} />
                </View>

                <FieldInput label="Challenge Title" value={cTitle} onChangeText={setCTitle} placeholder="e.g. Weekly Detailing Quiz" colors={colors} />
                <FieldInput label="Prize Name" value={cPrizeName} onChangeText={setCPrizeName} placeholder="e.g. Lunch On The Boss" colors={colors} />
                <FieldInput label="Prize Emoji" value={cPrizeEmoji} onChangeText={setCPrizeEmoji} placeholder="🍽️" colors={colors} />

                {/* Active Toggle */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Active</Text>
                  <TouchableOpacity
                    onPress={() => setCIsActive(!cIsActive)}
                    activeOpacity={0.7}
                    style={{
                      width: 52, height: 30, borderRadius: 15,
                      backgroundColor: cIsActive ? colors.success : colors.border,
                      justifyContent: "center", paddingHorizontal: 2,
                    }}
                  >
                    <View style={{
                      width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFF",
                      alignSelf: cIsActive ? "flex-end" : "flex-start",
                    }} />
                  </TouchableOpacity>
                </View>

                {/* Expiration Date */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Expiration Date</Text>
                  <TouchableOpacity
                    onPress={() => setShowExpPicker(!showExpPicker)}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
                      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
                    }}
                  >
                    <Text style={{ fontSize: 15, color: cExpiresAt ? colors.foreground : colors.muted }}>
                      {cExpiresAt ? formatDate(cExpiresAt) : "Tap to set expiration"}
                    </Text>
                  </TouchableOpacity>
                  {showExpPicker && (
                    <View style={{ marginTop: 8 }}>
                      <CalendarPicker
                        selectedDate={cExpiresAt}
                        onSelectDate={(d: string) => { setCExpiresAt(d); setShowExpPicker(false); }}
                      />
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  onPress={handleCreateChallenge}
                  disabled={cSaving || !cTitle.trim()}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16,
                    alignItems: "center", opacity: cSaving || !cTitle.trim() ? 0.5 : 1, marginBottom: 40,
                  }}
                >
                  {cSaving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Create Challenge</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </ScreenContainer>
        </Modal>
      </ScreenContainer>
    );
  }

  // ─── Challenge Detail View ───
  const questions = challengeQuestions.data ?? [];

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ marginTop: 8, marginBottom: 16 }}>
          <TouchableOpacity onPress={() => { setSelectedChallenge(null); setShowResults(false); }} activeOpacity={0.7} style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "600" }}>← Back to Challenges</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <Text style={{ fontSize: 36 }}>{selectedChallenge.prizeEmoji || "🎁"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>{selectedChallenge.title}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                <Text style={{ fontSize: 12, color: selectedChallenge.isActive === "yes" ? colors.success : colors.muted, fontWeight: "600" }}>
                  {selectedChallenge.isActive === "yes" ? "Active" : "Inactive"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Expires: {formatDate(selectedChallenge.expiresAt)}</Text>
              </View>
              {selectedChallenge.prizeName && (
                <Text style={{ fontSize: 12, color: "#D97706", fontWeight: "600", marginTop: 2 }}>🏆 Prize: {selectedChallenge.prizeName}</Text>
              )}
            </View>
          </View>

          {/* Action buttons */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            <TouchableOpacity onPress={startEditChallenge} activeOpacity={0.7}
              style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowResults(!showResults)} activeOpacity={0.7}
              style={{ flex: 1, backgroundColor: showResults ? colors.primary : colors.surface, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: showResults ? colors.primary : colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: showResults ? "#FFF" : colors.foreground }}>Results</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteChallenge(selectedChallenge.challengeId)} activeOpacity={0.7}
              style={{ flex: 1, backgroundColor: colors.error + "15", borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.error + "30" }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.error }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Results View */}
        {showResults && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Team Results</Text>
            {attemptSummary.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              getResultsData().map((d) => (
                <View key={d.employeeId} style={{
                  backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                  borderWidth: 1, borderColor: colors.border,
                  borderLeftWidth: 3,
                  borderLeftColor: d.status === "completed" ? colors.success : d.status === "failed" ? colors.error : colors.warning,
                }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{d.fullName}</Text>
                    <Text style={{
                      fontSize: 12, fontWeight: "700",
                      color: d.status === "completed" ? colors.success : d.status === "failed" ? colors.error : colors.warning,
                    }}>
                      {d.status === "completed" ? "🏆 Won!" : d.status === "failed" ? "❌ Failed" : `⏳ ${d.correctCount}/${d.totalQ}`}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Questions Section */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Questions ({questions.length})</Text>
          <TouchableOpacity
            onPress={() => { resetQuestionForm(); setShowCreateQuestion(true); }}
            activeOpacity={0.7}
            style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#FFF" }}>+ Add Question</Text>
          </TouchableOpacity>
        </View>

        {challengeQuestions.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : questions.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 30, gap: 8 }}>
            <Text style={{ fontSize: 14, color: colors.muted }}>No questions yet. Add your first question!</Text>
          </View>
        ) : (
          questions.map((q, idx) => (
            <View key={q.questionId} style={{
              backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{
                  width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary + "20",
                  justifyContent: "center", alignItems: "center",
                }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>{q.questionText}</Text>
                  {(["A", "B", "C", "D"] as const).map((opt) => {
                    const optText = opt === "A" ? q.optionA : opt === "B" ? q.optionB : opt === "C" ? q.optionC : q.optionD;
                    if (!optText) return null;
                    const isCorrect = q.correctAnswer === opt;
                    return (
                      <View key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: isCorrect ? colors.success : colors.muted }}>{opt}.</Text>
                        <Text style={{ fontSize: 12, color: isCorrect ? colors.success : colors.muted, fontWeight: isCorrect ? "700" : "400" }}>{optText}</Text>
                        {isCorrect && <Text style={{ fontSize: 10 }}>✓</Text>}
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <TouchableOpacity onPress={() => startEditQuestion(q)} activeOpacity={0.7}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary + "15" }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDeleteQuestion(q.questionId)} activeOpacity={0.7}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.error + "15" }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Edit Challenge Modal */}
      <Modal visible={showEditChallenge} animationType="slide" presentationStyle="pageSheet">
        <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <TouchableOpacity onPress={() => setShowEditChallenge(false)} activeOpacity={0.7}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Edit Challenge</Text>
                <View style={{ width: 60 }} />
              </View>

              <FieldInput label="Challenge Title" value={cTitle} onChangeText={setCTitle} placeholder="Challenge title" colors={colors} />
              <FieldInput label="Prize Name" value={cPrizeName} onChangeText={setCPrizeName} placeholder="e.g. Lunch On The Boss" colors={colors} />
              <FieldInput label="Prize Emoji" value={cPrizeEmoji} onChangeText={setCPrizeEmoji} placeholder="🍽️" colors={colors} />

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>Active</Text>
                <TouchableOpacity
                  onPress={() => setCIsActive(!cIsActive)}
                  activeOpacity={0.7}
                  style={{
                    width: 52, height: 30, borderRadius: 15,
                    backgroundColor: cIsActive ? colors.success : colors.border,
                    justifyContent: "center", paddingHorizontal: 2,
                  }}
                >
                  <View style={{
                    width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFF",
                    alignSelf: cIsActive ? "flex-end" : "flex-start",
                  }} />
                </TouchableOpacity>
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Expiration Date</Text>
                <TouchableOpacity
                  onPress={() => setShowExpPicker(!showExpPicker)}
                  activeOpacity={0.7}
                  style={{
                    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
                    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
                  }}
                >
                  <Text style={{ fontSize: 15, color: cExpiresAt ? colors.foreground : colors.muted }}>
                    {cExpiresAt ? formatDate(cExpiresAt) : "Tap to set expiration"}
                  </Text>
                </TouchableOpacity>
                {showExpPicker && (
                  <View style={{ marginTop: 8 }}>
                    <CalendarPicker
                      selectedDate={cExpiresAt}
                      onSelectDate={(d: string) => { setCExpiresAt(d); setShowExpPicker(false); }}
                    />
                  </View>
                )}
              </View>

              <TouchableOpacity
                onPress={handleUpdateChallenge}
                disabled={cSaving}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16,
                  alignItems: "center", opacity: cSaving ? 0.5 : 1, marginBottom: 40,
                }}
              >
                {cSaving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </ScreenContainer>
      </Modal>

      {/* Create/Edit Question Modal */}
      <Modal visible={showCreateQuestion} animationType="slide" presentationStyle="pageSheet">
        <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <TouchableOpacity onPress={() => { resetQuestionForm(); setShowCreateQuestion(false); }} activeOpacity={0.7}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>{editingQuestion ? "Edit Question" : "Add Question"}</Text>
                <View style={{ width: 60 }} />
              </View>

              <FieldInput label="Question" value={questionText} onChangeText={setQuestionText} placeholder="Enter the question" colors={colors} multiline />
              <FieldInput label="Option A" value={optionA} onChangeText={setOptionA} placeholder="First answer option" colors={colors} />
              <FieldInput label="Option B" value={optionB} onChangeText={setOptionB} placeholder="Second answer option" colors={colors} />
              <FieldInput label="Option C" value={optionC} onChangeText={setOptionC} placeholder="Third answer option" colors={colors} />
              <FieldInput label="Option D (optional)" value={optionD} onChangeText={setOptionD} placeholder="Fourth answer option" colors={colors} />

              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Correct Answer</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["A", "B", "C", "D"] as const).map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => setCorrectAnswer(opt)}
                      activeOpacity={0.7}
                      style={{
                        flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                        backgroundColor: correctAnswer === opt ? colors.success : colors.surface,
                        borderWidth: 1, borderColor: correctAnswer === opt ? colors.success : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: "700", color: correctAnswer === opt ? "#FFF" : colors.foreground }}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <FieldInput label="Explanation (shown when correct)" value={explanationCorrect} onChangeText={setExplanationCorrect} placeholder="Great job! Here's why..." colors={colors} multiline />
              <FieldInput label="Explanation (shown when incorrect)" value={explanationIncorrect} onChangeText={setExplanationIncorrect} placeholder="The correct answer was..." colors={colors} multiline />

              <TouchableOpacity
                onPress={editingQuestion ? handleUpdateQuestion : handleCreateQuestion}
                disabled={qSaving || !questionText.trim() || !optionA.trim() || !optionB.trim() || !optionC.trim()}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16,
                  alignItems: "center", opacity: qSaving ? 0.5 : 1, marginBottom: 40,
                }}
              >
                {qSaving ? <ActivityIndicator color="#FFF" /> : (
                  <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>{editingQuestion ? "Save Changes" : "Add Question"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </ScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}

function FieldInput({ label, value, onChangeText, placeholder, colors, multiline, keyboardType }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string; colors: any;
  multiline?: boolean; keyboardType?: any;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        returnKeyType={multiline ? "default" : "next"}
        style={{
          backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
          borderRadius: 10, paddingHorizontal: 14, paddingVertical: multiline ? 14 : 11,
          fontSize: 15, color: colors.foreground,
          minHeight: multiline ? 80 : undefined, textAlignVertical: multiline ? "top" : undefined,
        }}
      />
    </View>
  );
}
