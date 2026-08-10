"use client";
import { useState, useRef, useEffect } from "react";
import {
  ScrollView, Text, View, Pressable, TextInput, ActivityIndicator,
  Alert, Modal, Platform, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { getApiBaseUrl } from "@/constants/oauth";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";

// ── Module config for emoji/color display ─────────────────────────────────────
const MODULE_CONFIG: Record<string, { emoji: string; color: string }> = {
  TM_WELCOME:  { emoji: "⭐", color: "#F59E0B" },
  TM_SAFETY:   { emoji: "🛡️", color: "#EF4444" },
  TM_EXTERIOR: { emoji: "🚗", color: "#3B82F6" },
  TM_INTERIOR: { emoji: "💺", color: "#8B5CF6" },
  TM_CUSTOMER: { emoji: "🤝", color: "#10B981" },
  TM_APP:      { emoji: "📱", color: "#0EA5E9" },
};
const DEFAULT_CFG = { emoji: "📚", color: "#6B7280" };

type AdminTab = "progress" | "interactive" | "folders" | "quiz" | "modules";
type AnswerKey = "A" | "B" | "C" | "D";

interface QuizQuestion {
  id: number;
  questionId: string;
  moduleId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: AnswerKey;
  orderIndex: number;
}

function SectionHeader({ title, color }: { title: string; color?: string }) {
  const colors = useColors();
  return (
    <Text style={{ fontSize: 13, fontWeight: "700", color: color || colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 }}>
      {title}
    </Text>
  );
}

// ── Quiz Question Editor ──────────────────────────────────────────────────────
function QuizQuestionEditor({ moduleId, moduleName, onClose }: { moduleId: string; moduleName: string; onClose: () => void }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const moduleQuery = trpc.training.getModuleById.useQuery({ moduleId }, { staleTime: 30 * 1000 });
  const questionsQuery = trpc.training.getQuizQuestions.useQuery({ moduleId }, { staleTime: 2 * 60 * 1000 });
  const questions = (questionsQuery.data || []) as QuizQuestion[];
  const addMutation = trpc.training.addQuizQuestion.useMutation({ onSuccess: () => { utils.training.getQuizQuestions.invalidate(); resetForm(); } });
  const deleteMutation = trpc.training.deleteQuizQuestion.useMutation({ onSuccess: () => utils.training.getQuizQuestions.invalidate() });
  const updateMutation = trpc.training.updateQuizQuestion.useMutation({ onSuccess: () => { utils.training.getQuizQuestions.invalidate(); setEditingQuestion(null); } });
  const updateModuleMutation = trpc.training.updateModule.useMutation({ onSuccess: () => { utils.training.getAllModules.invalidate(); utils.training.getModuleById.invalidate({ moduleId }); Alert.alert("Saved", "Quiz title updated."); } });

  const mod = moduleQuery.data as any;
  const [quizTitle, setQuizTitle] = useState(mod?.quizTitle || "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null>(null);
  const [editForm, setEditForm] = useState({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "A" as AnswerKey });

  const startEditQuestion = (q: QuizQuestion) => {
    setEditingQuestion(q);
    setEditForm({ questionText: q.questionText, optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD, correctAnswer: q.correctAnswer });
  };

  const handleSaveEdit = () => {
    if (!editingQuestion) return;
    if (!editForm.questionText.trim() || !editForm.optionA.trim() || !editForm.optionB.trim() || !editForm.optionC.trim() || !editForm.optionD.trim()) {
      Alert.alert("Missing Fields", "Please fill in all fields.");
      return;
    }
    updateMutation.mutate({ questionId: editingQuestion.questionId, ...editForm });
  };

  const [form, setForm] = useState({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "A" as AnswerKey });
  const resetForm = () => setForm({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "A" });

  const handleAdd = () => {
    if (!form.questionText.trim() || !form.optionA.trim() || !form.optionB.trim() || !form.optionC.trim() || !form.optionD.trim()) {
      Alert.alert("Missing Fields", "Please fill in all fields before adding a question.");
      return;
    }
    addMutation.mutate({ moduleId, ...form, orderIndex: questions.length + 1 });
  };

  const handleDelete = (questionId: string) => {
    Alert.alert("Delete Question", "Are you sure you want to delete this question?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate({ questionId }) },
    ]);
  };

  const handleSaveTitle = () => {
    updateModuleMutation.mutate({ moduleId, quizTitle: quizTitle.trim() || null });
    setEditingTitle(false);
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 8,
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Quiz Questions</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{moduleName}</Text>
        </View>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Quiz Title Editor */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
          <SectionHeader title="Quiz Title" />
          {editingTitle ? (
            <View style={{ gap: 8 }}>
              <TextInput
                style={inputStyle}
                placeholder={`e.g. ${moduleName} Knowledge Check`}
                placeholderTextColor={colors.muted}
                value={quizTitle}
                onChangeText={setQuizTitle}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => setEditingTitle(false)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}>
                  <Text style={{ fontWeight: "600", color: colors.foreground }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveTitle} disabled={updateModuleMutation.isPending} style={({ pressed }) => ({ flex: 2, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 })}>
                  {updateModuleMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontWeight: "700", color: "#fff" }}>Save Title</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => { setQuizTitle(mod?.quizTitle || ""); setEditingTitle(true); }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ fontSize: 14, color: mod?.quizTitle ? colors.foreground : colors.muted, flex: 1 }}>
                {mod?.quizTitle || `${moduleName} Quiz (default)`}
              </Text>
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>Edit</Text>
            </Pressable>
          )}
        </View>

        {questionsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : questions.length === 0 ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center", marginBottom: 16 }}>
            <Text style={{ fontSize: 14, color: colors.muted }}>No questions yet. Add one below.</Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginBottom: 16 }}>
            {questions.map((q, i) => {
              const isEditing = editingQuestion?.questionId === q.questionId;
              return (
                <View key={q.questionId} style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: isEditing ? colors.primary : colors.border }}>
                  {isEditing ? (
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary, marginBottom: 4 }}>EDITING QUESTION {i + 1}</Text>
                      <TextInput style={[inputStyle, { minHeight: 56 }]} placeholder="Question text..." placeholderTextColor={colors.muted} value={editForm.questionText} onChangeText={(t) => setEditForm((f) => ({ ...f, questionText: t }))} multiline />
                      {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
                        <TextInput key={key} style={inputStyle} placeholder={`Option ${key}`} placeholderTextColor={colors.muted} value={editForm[`option${key}` as keyof typeof editForm] as string} onChangeText={(t) => setEditForm((f) => ({ ...f, [`option${key}`]: t }))} />
                      ))}
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginTop: 4, marginBottom: 4 }}>CORRECT ANSWER</Text>
                      <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                        {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
                          <Pressable key={key} onPress={() => setEditForm((f) => ({ ...f, correctAnswer: key }))} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: editForm.correctAnswer === key ? "#22C55E" : colors.background, borderWidth: 1.5, borderColor: editForm.correctAnswer === key ? "#22C55E" : colors.border, opacity: pressed ? 0.8 : 1 })}>
                            <Text style={{ fontWeight: "700", fontSize: 14, color: editForm.correctAnswer === key ? "#fff" : colors.foreground }}>{key}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable onPress={() => setEditingQuestion(null)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}>
                          <Text style={{ fontWeight: "600", color: colors.foreground }}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={handleSaveEdit} disabled={updateMutation.isPending} style={({ pressed }) => ({ flex: 2, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 })}>
                          {updateMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontWeight: "700", color: "#fff" }}>Save Changes</Text>}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, flex: 1, lineHeight: 18 }}>
                          {i + 1}. {q.questionText}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Pressable onPress={() => startEditQuestion(q)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                            <Text style={{ fontSize: 16 }}>✏️</Text>
                          </Pressable>
                          <Pressable onPress={() => handleDelete(q.questionId)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                            <Text style={{ fontSize: 16, color: "#EF4444" }}>🗑️</Text>
                          </Pressable>
                        </View>
                      </View>
                      <View style={{ marginTop: 8, gap: 2 }}>
                        {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
                          <Text key={key} style={{ fontSize: 12, color: key === q.correctAnswer ? "#16A34A" : colors.muted, fontWeight: key === q.correctAnswer ? "700" : "400" }}>
                            {key === q.correctAnswer ? "✓ " : "  "}{key}: {q[`option${key}` as keyof QuizQuestion] as string}
                          </Text>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 24 }}>
          <SectionHeader title="Add New Question" />
          <TextInput
            style={[inputStyle, { minHeight: 60 }]}
            placeholder="Question text..."
            placeholderTextColor={colors.muted}
            value={form.questionText}
            onChangeText={(t) => setForm((f) => ({ ...f, questionText: t }))}
            multiline
          />
          {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
            <TextInput
              key={key}
              style={inputStyle}
              placeholder={`Option ${key}`}
              placeholderTextColor={colors.muted}
              value={form[`option${key}` as keyof typeof form] as string}
              onChangeText={(t) => setForm((f) => ({ ...f, [`option${key}`]: t }))}
            />
          ))}
          <SectionHeader title="Correct Answer" />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
              <Pressable
                key={key}
                onPress={() => setForm((f) => ({ ...f, correctAnswer: key }))}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                  backgroundColor: form.correctAnswer === key ? "#22C55E" : colors.background,
                  borderWidth: 1.5, borderColor: form.correctAnswer === key ? "#22C55E" : colors.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontWeight: "700", fontSize: 14, color: form.correctAnswer === key ? "#fff" : colors.foreground }}>{key}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={handleAdd}
            disabled={addMutation.isPending}
            style={({ pressed }) => ({
              backgroundColor: "#22C55E", paddingVertical: 14, borderRadius: 12,
              alignItems: "center", opacity: pressed ? 0.85 : 1,
            })}
          >
            {addMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>+ Add Question</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Step Editor for a standard module ────────────────────────────────────────
function StepEditor({ moduleId, moduleName, onClose }: { moduleId: string; moduleName: string; onClose: () => void }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const stepsQuery = trpc.training.getStepsForModule.useQuery({ moduleId }, { staleTime: 30 * 1000 });
  const steps: any[] = stepsQuery.data || [];

  const addStepMutation = trpc.training.addStep.useMutation({
    onSuccess: () => { utils.training.getStepsForModule.invalidate({ moduleId }); setShowAddForm(false); resetAddForm(); },
    onError: () => Alert.alert("Error", "Failed to add step."),
  });
  const deleteStepMutation = trpc.training.deleteStep.useMutation({
    onSuccess: () => utils.training.getStepsForModule.invalidate({ moduleId }),
    onError: () => Alert.alert("Error", "Failed to delete step."),
  });
  const updateStepMutation = trpc.training.updateStep.useMutation({
    onSuccess: () => { utils.training.getStepsForModule.invalidate({ moduleId }); setEditingStep(null); Alert.alert("Saved", "Step updated."); },
    onError: () => Alert.alert("Error", "Failed to save step."),
  });
  const reorderMutation = trpc.training.reorderSteps.useMutation({
    onSuccess: () => utils.training.getStepsForModule.invalidate({ moduleId }),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStep, setEditingStep] = useState<any | null>(null);
  const [addForm, setAddForm] = useState({ title: "", description: "", tips: "", warnings: "" });
  const resetAddForm = () => setAddForm({ title: "", description: "", tips: "", warnings: "" });

  const [editForm, setEditForm] = useState({ title: "", description: "", tips: "", warnings: "" });

  const handleDeleteStep = (stepId: string, stepTitle: string) => {
    Alert.alert("Delete Step", `Delete "${stepTitle}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteStepMutation.mutate({ stepId }) },
    ]);
  };

  const handleEditStep = (step: any) => {
    setEditingStep(step);
    setEditForm({ title: step.title, description: step.description, tips: step.tips || "", warnings: step.warnings || "" });
  };

  const handleSaveEdit = () => {
    if (!editingStep) return;
    updateStepMutation.mutate({
      stepId: editingStep.stepId,
      title: editForm.title.trim() || undefined,
      description: editForm.description.trim() || undefined,
      tips: editForm.tips.trim() || null,
      warnings: editForm.warnings.trim() || null,
    });
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newSteps = [...steps];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newSteps.length) return;
    [newSteps[index], newSteps[swapIndex]] = [newSteps[swapIndex], newSteps[index]];
    reorderMutation.mutate({ orderedStepIds: newSteps.map((s) => s.stepId) });
  };

  const inputStyle = {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 8,
  };

  if (editingStep) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Edit Step</Text>
          <Pressable onPress={() => setEditingStep(null)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <SectionHeader title="Step Title" />
          <TextInput style={inputStyle} value={editForm.title} onChangeText={(t) => setEditForm((f) => ({ ...f, title: t }))} placeholder="Step title..." placeholderTextColor={colors.muted} />
          <SectionHeader title="Step Instruction" />
          <TextInput style={[inputStyle, { minHeight: 80 }]} value={editForm.description} onChangeText={(t) => setEditForm((f) => ({ ...f, description: t }))} placeholder="Describe what the team member should do..." placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Pro Tip (optional)" />
          <TextInput style={inputStyle} value={editForm.tips} onChangeText={(t) => setEditForm((f) => ({ ...f, tips: t }))} placeholder="💡 Pro tip..." placeholderTextColor={colors.muted} />
          <SectionHeader title="Warning (optional)" />
          <TextInput style={inputStyle} value={editForm.warnings} onChangeText={(t) => setEditForm((f) => ({ ...f, warnings: t }))} placeholder="⚠️ Warning..." placeholderTextColor={colors.muted} />
          <Pressable
            onPress={handleSaveEdit}
            disabled={updateStepMutation.isPending}
            style={({ pressed }) => ({ backgroundColor: "#22C55E", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 8, marginBottom: 32, opacity: pressed || updateStepMutation.isPending ? 0.8 : 1 })}
          >
            {updateStepMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save Step</Text>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Edit Steps</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{moduleName} · {steps.length} steps</Text>
        </View>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 18 }}>
          Tap a step to edit its content. Use ↑↓ arrows to reorder. Tap 🗑️ to delete.
        </Text>
        {stepsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : (
          <View style={{ gap: 8, marginBottom: 16 }}>
            {steps.map((step: any, index: number) => (
              <View key={step.stepId} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                <View style={{ padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${DEFAULT_CFG.color}20`, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: DEFAULT_CFG.color }}>{index + 1}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 1 }} numberOfLines={1}>{step.title}</Text>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <Pressable onPress={() => moveStep(index, "up")} disabled={index === 0} style={({ pressed }) => ({ opacity: pressed || index === 0 ? 0.4 : 1, padding: 4 })}>
                      <Text style={{ fontSize: 14 }}>↑</Text>
                    </Pressable>
                    <Pressable onPress={() => moveStep(index, "down")} disabled={index === steps.length - 1} style={({ pressed }) => ({ opacity: pressed || index === steps.length - 1 ? 0.4 : 1, padding: 4 })}>
                      <Text style={{ fontSize: 14 }}>↓</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Pressable onPress={() => handleEditStep(step)} style={({ pressed }) => ({ flex: 1, paddingVertical: 9, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>✏️ Edit</Text>
                  </Pressable>
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <Pressable onPress={() => handleDeleteStep(step.stepId, step.title)} style={({ pressed }) => ({ flex: 1, paddingVertical: 9, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#EF4444" }}>🗑️ Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Add Step Form */}
        {showAddForm ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 24 }}>
            <SectionHeader title="New Step" />
            <TextInput style={inputStyle} value={addForm.title} onChangeText={(t) => setAddForm((f) => ({ ...f, title: t }))} placeholder="Step title (required)..." placeholderTextColor={colors.muted} />
            <TextInput style={[inputStyle, { minHeight: 80 }]} value={addForm.description} onChangeText={(t) => setAddForm((f) => ({ ...f, description: t }))} placeholder="Step instruction (required)..." placeholderTextColor={colors.muted} multiline />
            <TextInput style={inputStyle} value={addForm.tips} onChangeText={(t) => setAddForm((f) => ({ ...f, tips: t }))} placeholder="💡 Pro tip (optional)..." placeholderTextColor={colors.muted} />
            <TextInput style={inputStyle} value={addForm.warnings} onChangeText={(t) => setAddForm((f) => ({ ...f, warnings: t }))} placeholder="⚠️ Warning (optional)..." placeholderTextColor={colors.muted} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Pressable onPress={() => { setShowAddForm(false); resetAddForm(); }} style={({ pressed }) => ({ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ fontWeight: "600", color: colors.foreground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!addForm.title.trim() || !addForm.description.trim()) { Alert.alert("Required", "Title and instruction are required."); return; }
                  addStepMutation.mutate({ moduleId, title: addForm.title.trim(), description: addForm.description.trim(), tips: addForm.tips.trim() || null, warnings: addForm.warnings.trim() || null, orderIndex: steps.length });
                }}
                disabled={addStepMutation.isPending}
                style={({ pressed }) => ({ flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#22C55E", opacity: pressed || addStepMutation.isPending ? 0.8 : 1 })}
              >
                {addStepMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Add Step</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowAddForm(true)}
            style={({ pressed }) => ({ backgroundColor: colors.surface, paddingVertical: 14, borderRadius: 12, alignItems: "center", borderWidth: 1.5, borderColor: colors.primary, borderStyle: "dashed", marginBottom: 24, opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>+ Add New Step</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ── Default steps for all 15 interactive modules ─────────────────────────────
type DefaultChoice = { id: string; label: string };
type DefaultStep = {
  id: string;
  title: string;
  instruction?: string;
  area?: string;
  question?: string;
  choices?: DefaultChoice[];
  correctId?: string;
  wrongExplanation?: string;
  correctExplanation?: string;
  proTip?: string;
};

const INTERACTIVE_STEPS_MAP: Record<string, DefaultStep[]> = {
  "engine-bay": [
    { id: "step1", title: "Step 1 — Open the Hood & Assess", instruction: "Pop the hood and prop it open. Before applying any chemical, take a moment to assess the engine bay — identify any exposed electrical components, the battery, alternator, and fuse box.", area: "🔧 Engine Bay — Assessment", question: "Before applying any chemical to the engine bay, what should you do first?", choices: [{ id: "assess", label: "Assess & Identify Electrical Parts" }, { id: "spray", label: "Spray Degreaser Immediately" }, { id: "rinse", label: "Rinse with Water First" }], correctId: "assess", wrongExplanation: "❌ Wrong! You must assess the engine bay first — identify electrical components before applying any chemicals.", correctExplanation: "✅ Correct! Always assess the engine bay first — identify electrical components, battery, and fuse box before applying any chemicals.", proTip: "💡 Pro Tip: Take a photo of the engine bay before cleaning — this helps you remember where everything goes and protects you if a client claims damage." },
    { id: "step2", title: "Step 2 — Apply Degreaser", instruction: "Spray Degreaser generously across the entire engine bay — cover all plastic covers, rubber hoses, metal surfaces, and the firewall. Avoid direct spray on the battery terminals and alternator.", area: "🔧 Engine Bay — Degreaser", question: "Which chemical do you use to clean the engine bay?", choices: [{ id: "degreaser", label: "Degreaser" }, { id: "brakeBuster", label: "Brake Buster" }, { id: "bugOff", label: "Bug Off" }], correctId: "degreaser", wrongExplanation: "❌ Wrong! Brake Buster is for wheels and tires. Bug Off is for bugs. Degreaser is the correct product for engine bays.", correctExplanation: "✅ Correct! Degreaser is the right product for engine bays — it cuts through grease, oil, and road grime.", proTip: "💡 Pro Tip: Let the degreaser dwell for 60-90 seconds before agitating — this gives it time to break down the grease and makes scrubbing much easier." },
    { id: "step3", title: "Step 3 — Agitate with Detail Brush", instruction: "Use the Detail Brush to agitate all the crevices, around hoses, and on plastic covers. The Detail Brush gets into tight spaces that larger brushes can't reach.", area: "🔧 Engine Bay — Agitation", question: "Which brush do you use to agitate the engine bay crevices?", choices: [{ id: "detailBrush", label: "Detail Brush" }, { id: "tireBrush", label: "Tire Brush" }, { id: "greenBrush", label: "Green Brush" }], correctId: "detailBrush", wrongExplanation: "❌ Wrong! The Tire Brush and Green Brush are too large for engine bay crevices. The Detail Brush is the right tool.", correctExplanation: "✅ Correct! The Detail Brush is used for engine bay crevices — its small size lets it reach around hoses, brackets, and tight spaces.", proTip: "💡 Pro Tip: Use the Detail Brush in circular motions on plastic covers — this lifts embedded grime without scratching the plastic." },
    { id: "step4", title: "Step 4 — Agitate with Barrel Blade", instruction: "Use the Barrel Blade brush on larger flat surfaces like the top of the engine cover and firewall. Its wider head covers more area quickly.", area: "🔧 Engine Bay — Large Surfaces", question: "Which brush do you use for larger flat surfaces in the engine bay?", choices: [{ id: "barrelBlade", label: "Barrel Blade" }, { id: "detailBrush", label: "Detail Brush" }, { id: "greenBrush", label: "Green Brush" }], correctId: "barrelBlade", wrongExplanation: "❌ Wrong! The Detail Brush is for tight crevices. The Green Brush is for wheels. The Barrel Blade covers large flat surfaces.", correctExplanation: "✅ Correct! The Barrel Blade is used for larger flat surfaces in the engine bay — its wide head covers the engine cover and firewall quickly.", proTip: "💡 Pro Tip: Use overlapping strokes with the Barrel Blade to ensure full coverage — don't rush this step." },
    { id: "step5", title: "Step 5 — Wipe Painted & Plastic Surfaces", instruction: "After agitating, wipe down all the painted and plastic surfaces with the correct towel to remove loosened grime.", area: "🔧 Engine Bay — Wipe Down", question: "Which towel do you use to wipe down engine bay surfaces?", choices: [{ id: "allPurpose", label: "All-Purpose Microfiber" }, { id: "whiteDress", label: "White Dressing Towel" }, { id: "barrelBlade", label: "Barrel Blade" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! White Dressing Towel is for applying dressing at the end. The Barrel Blade is a brush, not a towel.", correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to wipe down all surfaces after agitation.", proTip: "💡 Pro Tip: Fold the towel into quarters to maximize clean surfaces. Flip to a fresh side when one side gets too dirty." },
    { id: "step6", title: "Step 6 — Pressure Wash Clean", instruction: "Rinse all the degreaser and loosened grime out of the engine bay. Be careful around electrical components.", area: "🔧 Engine Bay — Rinse", question: "What areas do you need to be CAREFUL around when pressure washing the engine bay?", choices: [{ id: "electrical", label: "Electrical Components" }, { id: "plastic", label: "Plastic Covers" }, { id: "hoses", label: "Rubber Hoses" }], correctId: "electrical", wrongExplanation: "❌ Wrong! While you should be careful around all components, electrical components (alternator, fuse box, sensors) are the most critical to protect.", correctExplanation: "✅ Correct! Always be careful around electrical components — avoid direct high-pressure spray on the alternator, fuse box, and sensors.", proTip: "💡 Pro Tip: Use a low-pressure rinse around electrical areas. A quick wipe with a dry towel immediately after rinsing helps prevent water spots." },
    { id: "step7", title: "Step 7 — Apply White Dressing", instruction: "After the engine bay is clean and dry, apply an even coat of White Dressing to all plastic surfaces to restore their appearance.", area: "🔧 Engine Bay — Finish", question: "Which product do you apply to plastics as the FINAL step in the engine bay?", choices: [{ id: "degreaser", label: "Degreaser" }, { id: "brakeBuster", label: "Brake Buster" }, { id: "whiteDress", label: "White Dressing" }], correctId: "whiteDress", wrongExplanation: "❌ Wrong! Degreaser and Brake Buster are cleaning products, not finishing products. White Dressing is the final step.", correctExplanation: "✅ Correct! White Dressing is applied to all plastics as the final step — it restores color and protects against UV fading.", proTip: "💡 Pro Tip: Apply White Dressing with an even spray — don't over-apply. Wipe off any excess with the All-Purpose Towel for a clean, matte finish." },
  ],
  "wheel-cleaning": [
    { id: "step1", title: "Step 1 — Apply Chemical to Back of Wheel", question: "Which chemical do you spray on the back of the wheel?", choices: [{ id: "brakeBuster", label: "Brake Buster" }, { id: "degreaser", label: "Degreaser" }, { id: "tireBrush", label: "Tire Brush" }], correctId: "brakeBuster" },
    { id: "step2", title: "Step 2 — Agitate the Wheel Barrel", question: "Which tool do you use to agitate the back of the wheel?", choices: [{ id: "washMitt", label: "Wash Mitt" }, { id: "barrelBlade", label: "Barrel Blade" }, { id: "detailBrush", label: "Detail Brush" }], correctId: "barrelBlade" },
    { id: "step3", title: "Step 3 — Spray & Scrub the Wheel Face", question: "Which brush do you use to scrub the front face of the wheel?", choices: [{ id: "barrelBlade", label: "Barrel Blade" }, { id: "detailBrush", label: "Detail Brush" }, { id: "greenBrush", label: "Green Brush" }], correctId: "greenBrush" },
    { id: "step4", title: "Step 4 — Clean the Lug Nuts", question: "Which tool do you use to clean the lug nuts?", choices: [{ id: "greenBrush", label: "Green Brush" }, { id: "detailBrush", label: "Detail Brush" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "detailBrush" },
    { id: "step5", title: "Step 5 — Rinse the Wheel", question: "After scrubbing the wheel, what do you do next?", choices: [{ id: "rinse", label: "Pressure Rinse" }, { id: "dryTowel", label: "Dry with Towel" }, { id: "moreBrush", label: "Scrub Again" }], correctId: "rinse" },
    { id: "step6", title: "Step 6 — Dry & Apply Tire Dressing", question: "What do you apply to the tire after cleaning?", choices: [{ id: "tireDress", label: "Tire Dressing" }, { id: "whiteDress", label: "White Dressing" }, { id: "brakeBuster", label: "Brake Buster" }], correctId: "tireDress" },
  ],
  "tire-cleaning": [
    { id: "step1", title: "Step 1 — Apply Brake Buster to Tire", instruction: "Spray Brake Buster on the tire sidewall and let it dwell for 30-60 seconds.", area: "🔘 Tire Cleaning", question: "Which chemical do you apply to the tire sidewall?", choices: [{ id: "brakeBuster", label: "Brake Buster" }, { id: "degreaser", label: "Degreaser" }, { id: "allPurpose", label: "All-Purpose Towel" }], correctId: "brakeBuster", wrongExplanation: "❌ Wrong! Degreaser is for engine bays and jambs. Brake Buster is the correct product for tires.", correctExplanation: "✅ Correct! Brake Buster is applied to tires — it breaks down brake dust, road grime, and old dressing.", proTip: "💡 Pro Tip: Apply Brake Buster to a wet tire for best results — it activates better with moisture." },
    { id: "step2", title: "Step 2 — Scrub with Tire Brush", instruction: "Use the Tire Brush to aggressively scrub the tire sidewall in a circular motion.", area: "🔘 Tire Scrubbing", question: "Which tool do you use to scrub the tire sidewall?", choices: [{ id: "barrelBlade", label: "Barrel Blade" }, { id: "tireBrush", label: "Tire Brush" }, { id: "detailBrush", label: "Detail Brush" }], correctId: "tireBrush", wrongExplanation: "❌ Wrong! The Barrel Blade is for wheel barrels. The Detail Brush is too small for tire sidewalls. Use the Tire Brush.", correctExplanation: "✅ Correct! The Tire Brush has stiff bristles designed to aggressively scrub tire sidewalls and get into the lettering.", proTip: "💡 Pro Tip: Scrub in a circular motion around the entire tire. Pay extra attention to the raised lettering — grime loves to hide there." },
    { id: "step3", title: "Step 3 — Rinse the Tire", instruction: "After scrubbing, pressure wash the tire thoroughly to remove all the Brake Buster, loosened grime, and old dressing.", area: "🔘 Tire Rinse", question: "After scrubbing the tire, what is the next step?", choices: [{ id: "rinse", label: "Pressure Wash Rinse" }, { id: "dryTowel", label: "Dry with Towel" }, { id: "moreBrush", label: "Scrub Again" }], correctId: "rinse", wrongExplanation: "❌ Wrong! You must rinse all the chemical and loosened grime off before drying or applying dressing.", correctExplanation: "✅ Correct! Always rinse thoroughly after scrubbing to remove all chemical residue and loosened grime.", proTip: "💡 Pro Tip: Rinse from the top of the tire down. Make sure no Brake Buster residue remains — it can prevent tire dressing from bonding properly." },
  ],
  "wheel-well": [
    { id: "step1", title: "Step 1 — Spray Degreaser in Wheel Well", instruction: "Spray degreaser generously inside the wheel well, covering all plastic and metal surfaces.", area: "🛞 Wheel Well", question: "Which chemical do you use in the wheel well?", choices: [{ id: "brakeBuster", label: "Brake Buster" }, { id: "degreaser", label: "Degreaser" }, { id: "allPurpose", label: "All-Purpose Towel" }], correctId: "degreaser", wrongExplanation: "❌ Wrong! Brake Buster is for wheels and tires only. The wheel well needs Degreaser.", correctExplanation: "✅ Correct! Degreaser is used in the wheel well — it cuts through road grime, tar, and grease.", proTip: "💡 Pro Tip: Spray degreaser from the top of the wheel well down. Let it dwell 30-60 seconds before scrubbing." },
    { id: "step2", title: "Step 2 — Scrub the Wheel Well", instruction: "Use the Wheel Well Brush to scrub all surfaces inside the wheel well.", area: "🛞 Wheel Well Scrubbing", question: "Which tool do you use to scrub the wheel well?", choices: [{ id: "barrelBlade", label: "Barrel Blade" }, { id: "wheelWellBrush", label: "Wheel Well Brush" }, { id: "greenBrush", label: "Green Brush" }], correctId: "wheelWellBrush", wrongExplanation: "❌ Wrong! The Barrel Blade is for wheel barrels. The Green Brush is for wheel faces. Use the Wheel Well Brush.", correctExplanation: "✅ Correct! The Wheel Well Brush is large enough to cover the wheel well surfaces quickly.", proTip: "💡 Pro Tip: Scrub in circular motions and work from top to bottom so loosened grime falls down and out." },
    { id: "step3", title: "Step 3 — Rinse the Wheel Well", instruction: "After scrubbing, pressure wash the wheel well thoroughly.", area: "🛞 Wheel Well Rinse", question: "What direction do you rinse the wheel well?", choices: [{ id: "topDown", label: "Top to Bottom" }, { id: "bottomUp", label: "Bottom to Top" }, { id: "circular", label: "Circular" }], correctId: "topDown", wrongExplanation: "❌ Wrong! Rinsing bottom to top pushes dirty water back up onto already-clean areas.", correctExplanation: "✅ Correct! Always rinse top to bottom — gravity helps flush the loosened grime and degreaser down and out.", proTip: "💡 Pro Tip: After rinsing, wipe the visible plastic lip of the wheel well with an All-Purpose Towel." },
    { id: "step4", title: "Step 4 — Wipe Down the Wheel Well Lip", instruction: "After rinsing, use the All-Purpose Microfiber to wipe down the visible plastic lip.", area: "🛞 Wheel Well Wipe", question: "Which towel do you use to wipe the wheel well lip?", choices: [{ id: "allPurpose", label: "All-Purpose Microfiber" }, { id: "brakeBuster", label: "Brake Buster" }, { id: "barrelBlade", label: "Barrel Blade" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! Brake Buster is a chemical, not a towel. The Barrel Blade is a brush.", correctExplanation: "✅ Correct! The All-Purpose Microfiber is used to wipe down the wheel well lip after rinsing.", proTip: "💡 Pro Tip: Keep a dedicated All-Purpose Towel for wheel wells — don't use the same towel you'd use on painted surfaces." },
  ],
  "exhaust-tips": [
    { id: "step1", title: "Step 1 — Apply Degreaser to Exhaust Tips", instruction: "Spray degreaser on the exhaust tips to break down carbon buildup, soot, and road grime.", area: "💨 Exhaust Tips", question: "Which chemical do you apply first to exhaust tips?", choices: [{ id: "brakeBuster", label: "Brake Buster" }, { id: "degreaser", label: "Degreaser" }, { id: "allPurpose", label: "All-Purpose Towel" }], correctId: "degreaser", wrongExplanation: "❌ Wrong! Brake Buster is for wheels and tires. Exhaust tips need Degreaser.", correctExplanation: "✅ Correct! Degreaser is the first product applied to exhaust tips — it breaks down carbon, soot, and road grime.", proTip: "💡 Pro Tip: Spray degreaser inside the exhaust tip as well as outside." },
    { id: "step2", title: "Step 2 — Scrub with Steel Wool", instruction: "Use steel wool to scrub the exhaust tip in circular motions.", area: "💨 Exhaust Tips — Scrubbing", question: "Which tool do you use to scrub exhaust tips?", choices: [{ id: "greenBrush", label: "Green Brush" }, { id: "steelWool", label: "Steel Wool" }, { id: "detailBrush", label: "Detail Brush" }], correctId: "steelWool", wrongExplanation: "❌ Wrong! Brushes can't remove stubborn carbon deposits from exhaust tips. Steel Wool is the correct tool.", correctExplanation: "✅ Correct! Steel Wool removes carbon deposits and oxidation from exhaust tips.", proTip: "💡 Pro Tip: Use fine-grade steel wool (0000 grade) to avoid scratching. Work in circular motions with light pressure." },
    { id: "step3", title: "Step 3 — Rinse the Exhaust Tips", instruction: "After scrubbing, rinse the exhaust tips thoroughly with pressure water.", area: "💨 Exhaust Tips — Rinse", question: "After scrubbing exhaust tips, what do you do next?", choices: [{ id: "rinse", label: "Pressure Rinse" }, { id: "dryTowel", label: "Dry with Towel" }, { id: "moreWool", label: "More Steel Wool" }], correctId: "rinse", wrongExplanation: "❌ Wrong! You must rinse off all the chemical and loosened carbon before drying.", correctExplanation: "✅ Correct! Rinse thoroughly after scrubbing to flush all the degreaser and carbon deposits away.", proTip: "💡 Pro Tip: Rinse inside the tip too — carbon and degreaser residue inside will bake on and become harder to remove next time." },
    { id: "step4", title: "Step 4 — Dry and Polish with All-Purpose Towel", instruction: "After rinsing, immediately dry the exhaust tips with the All-Purpose Microfiber towel.", area: "💨 Exhaust Tips — Polish", question: "Which towel do you use to dry and polish the exhaust tips?", choices: [{ id: "allPurpose", label: "All-Purpose Microfiber" }, { id: "brakeBuster", label: "Brake Buster" }, { id: "barrelBlade", label: "Barrel Blade" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! Brake Buster is a chemical. The Barrel Blade is a brush. Use the All-Purpose Microfiber.", correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to dry and buff the exhaust tips to a shine.", proTip: "💡 Pro Tip: Dry exhaust tips immediately after rinsing — water spots on chrome tips are very visible and hard to remove once dry." },
  ],
  "exterior-wash": [
    { id: "step1", title: "Step 1 — Pre-Rinse the Entire Vehicle", instruction: "Before applying any soap, pre-rinse the entire vehicle from top to bottom.", area: "🚗 Exterior — Pre-Rinse", question: "What direction do you rinse the vehicle?", choices: [{ id: "topDown", label: "Top to Bottom" }, { id: "bottomUp", label: "Bottom to Top" }, { id: "sides", label: "Side to Side" }], correctId: "topDown", wrongExplanation: "❌ Wrong! Rinsing bottom to top pushes dirty water onto already-rinsed areas.", correctExplanation: "✅ Correct! Always rinse top to bottom — gravity carries the dirty water down and off the vehicle.", proTip: "💡 Pro Tip: Pre-rinse removes 80% of loose dirt. The cleaner the surface before you touch it, the less chance of scratching the paint." },
    { id: "step2", title: "Step 2 — Two-Bucket Wash Method", instruction: "Fill one bucket with soapy water and one bucket with clean rinse water.", area: "🚗 Exterior — Wash Setup", question: "How many buckets do you use for the exterior wash?", choices: [{ id: "one", label: "1 Bucket" }, { id: "two", label: "2 Buckets" }, { id: "three", label: "3 Buckets" }], correctId: "two", wrongExplanation: "❌ Wrong! Using one bucket means you're putting dirty water back on the paint. Always use two buckets.", correctExplanation: "✅ Correct! Two buckets — one soapy, one clean rinse. This is the standard safe wash method that prevents swirl marks.", proTip: "💡 Pro Tip: Use a Grit Guard insert in the rinse bucket. It traps dirt at the bottom so it doesn't get picked back up by the mitt." },
    { id: "step3", title: "Step 3 — Wash with the Mitt", instruction: "Use the wash mitt to wash the vehicle in straight lines from top to bottom.", area: "🚗 Exterior — Washing", question: "Which tool do you use to wash the vehicle exterior?", choices: [{ id: "greenBrush", label: "Green Brush" }, { id: "washMitt", label: "Wash Mitt" }, { id: "tireBrush", label: "Tire Brush" }], correctId: "washMitt", wrongExplanation: "❌ Wrong! Never use a brush on painted surfaces — it will scratch the paint.", correctExplanation: "✅ Correct! The Wash Mitt is the only tool safe for painted surfaces.", proTip: "💡 Pro Tip: Wash in straight lines, not circles. Circular motions create swirl marks that are visible in direct sunlight." },
    { id: "step4", title: "Step 4 — Rinse from Top to Bottom", instruction: "After washing each section, rinse thoroughly from top to bottom.", area: "🚗 Exterior — Final Rinse", question: "What direction do you rinse after washing?", choices: [{ id: "topDown", label: "Top to Bottom" }, { id: "bottomUp", label: "Bottom to Top" }, { id: "random", label: "Any Direction" }], correctId: "topDown", wrongExplanation: "❌ Wrong! Always rinse top to bottom.", correctExplanation: "✅ Correct! Rinse top to bottom on every pass.", proTip: "💡 Pro Tip: Do a final sheet rinse — hold the hose flat and let water sheet off the paint." },
    { id: "step5", title: "Step 5 — Dry with All-Purpose Microfiber", instruction: "Immediately after rinsing, dry the vehicle with the All-Purpose Microfiber towel.", area: "🚗 Exterior — Drying", question: "Which towel do you use to dry the exterior paint?", choices: [{ id: "allPurpose", label: "All-Purpose Microfiber" }, { id: "brakeBuster", label: "Brake Buster" }, { id: "detailBrush", label: "Detail Brush" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! Brake Buster is a chemical. The Detail Brush is a brush.", correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to dry the exterior paint.", proTip: "💡 Pro Tip: Use a large waffle-weave microfiber for drying — it holds more water and reduces the number of passes needed." },
  ],
  "door-jambs": [
    { id: "step1", title: "Step 1 — Open Driver's Side & Apply Degreaser", instruction: "Open the driver's side door fully. Spray the door jamb down with Degreaser.", area: "🚪 Door Jambs — Driver's Side", question: "Which chemical do you spray on the door jambs?", choices: [{ id: "brakeBuster", label: "Brake Buster" }, { id: "degreaser", label: "Degreaser" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "degreaser", wrongExplanation: "❌ Wrong! Brake Buster is for wheels and tires. Door jambs need Degreaser.", correctExplanation: "✅ Correct! Degreaser is the right product for door jambs — it cuts through the road grime and grease.", proTip: "💡 Pro Tip: Spray degreaser into all the rubber seals and crevices, not just the flat surfaces." },
    { id: "step2", title: "Step 2 — Wipe & Agitate with Towel and Detail Brush", instruction: "Use the All-Purpose Towel to wipe down the jamb surfaces and the Detail Brush to get into all the cracks.", area: "🚪 Door Jambs — Agitation", question: "Which TWO tools do you use to clean the door jambs?", choices: [{ id: "allPurpose", label: "All-Purpose Towel" }, { id: "greenBrush", label: "Green Brush" }, { id: "detailBrush", label: "Detail Brush" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! The Green Brush is too large and stiff for door jambs.", correctExplanation: "✅ Correct! The All-Purpose Towel wipes flat surfaces while the Detail Brush gets into tight cracks and seams.", proTip: "💡 Pro Tip: Use the Detail Brush around the door latch and striker plate — these areas collect the most grime." },
    { id: "step3", title: "Step 3 — Pressure Wash the Jambs", instruction: "After wiping, pressure wash the door jambs to flush out all the loosened dirt and degreaser.", area: "🚪 Door Jambs — Rinse", question: "Which direction do you angle the pressure washer when rinsing door jambs?", choices: [{ id: "away", label: "Away from Interior" }, { id: "inside", label: "Into the Interior" }, { id: "down", label: "Straight Down" }], correctId: "away", wrongExplanation: "❌ Wrong! NEVER point the pressure washer into the interior.", correctExplanation: "✅ Correct! Always angle the pressure washer AWAY from the interior to prevent water from getting inside the vehicle.", proTip: "💡 Pro Tip: Use medium pressure for jambs — high pressure can force water past seals and into the door cavity." },
    { id: "step4", title: "Step 4 — Repeat Passenger Side & Trunk", instruction: "Open the passenger side door and repeat steps 2 and 3. Then open the trunk or rear door and repeat.", area: "🚪 Door Jambs — All Sides", question: "After cleaning the driver's side, what do you clean next?", choices: [{ id: "passenger", label: "Passenger Side + Trunk" }, { id: "hood", label: "Hood Only" }, { id: "wheels", label: "Wheels" }], correctId: "passenger", wrongExplanation: "❌ Wrong! You must clean ALL door jambs — driver's side, passenger side, and trunk/rear door.", correctExplanation: "✅ Correct! After the driver's side, move to the passenger side, then the trunk/rear door.", proTip: "💡 Pro Tip: The gas cap area is often forgotten — open it and wipe around the fuel door opening." },
  ],
  "bug-removal": [
    { id: "step1", title: "Step 1 — Pre-Rinse the Front End", instruction: "Before applying any chemical, pressure wash the entire front end of the vehicle.", area: "🐛 Bug Removal — Front End", question: "What do you do FIRST before applying Bug Off?", choices: [{ id: "prerinse", label: "Pressure Wash First" }, { id: "bugOff", label: "Spray Bug Off First" }, { id: "scrub", label: "Scrub with Mitt" }], correctId: "prerinse", wrongExplanation: "❌ Wrong! Never apply Bug Off to a dry surface — always pre-rinse first.", correctExplanation: "✅ Correct! Pre-rinse the front end first to remove loose bugs and soften the remaining ones.", proTip: "💡 Pro Tip: Include the mirrors and windshield in your pre-rinse — bugs collect there too." },
    { id: "step2", title: "Step 2 — Apply Bug Off Chemical", instruction: "Spray the entire front end down with Bug Off chemical. DO NOT let it dry in the sun.", area: "🐛 Bug Removal — Chemical", question: "What is the CRITICAL warning when applying Bug Off?", choices: [{ id: "nodry", label: "Don't Let It Dry in Sun" }, { id: "nowater", label: "Don't Rinse After" }, { id: "noscrub", label: "Don't Scrub Hood" }], correctId: "nodry", wrongExplanation: "❌ Wrong! The most critical warning is DO NOT let Bug Off dry in the sun.", correctExplanation: "✅ Correct! Bug Off must NOT dry in the sun — it will bake onto the paint and create a residue.", proTip: "💡 Pro Tip: On hot sunny days, work the front end in sections — spray, agitate, and rinse one section before moving to the next." },
    { id: "step3", title: "Step 3 — Agitate with Bug Sponge (NOT on Hood)", instruction: "Using a Bug Sponge, gently agitate bugs on the front bumper, headlights, and lower areas. IMPORTANT: DO NOT scrub the hood.", area: "🐛 Bug Removal — Agitation", question: "Which area should you NOT scrub with the Bug Sponge?", choices: [{ id: "hood", label: "Hood Paint" }, { id: "bumper", label: "Front Bumper" }, { id: "lights", label: "Headlights" }], correctId: "hood", wrongExplanation: "❌ Wrong! The front bumper and headlights can be agitated. The hood paint is the surface you must NOT scrub.", correctExplanation: "✅ Correct! DO NOT scrub the hood with the Bug Sponge — it can scratch the clear coat.", proTip: "💡 Pro Tip: Use light pressure with the Bug Sponge — let the chemical do the work." },
    { id: "step4", title: "Step 4 — Final Pressure Rinse", instruction: "After agitating, pressure wash the entire front end again thoroughly.", area: "🐛 Bug Removal — Final Rinse", question: "When rinsing the windshield, how do you approach it?", choices: [{ id: "split", label: "Split Into 2 Sections" }, { id: "single", label: "One Pass Top to Bottom" }, { id: "skip", label: "Skip — Cleaned Inside" }], correctId: "split", wrongExplanation: "❌ Wrong! The windshield should be split into two sections for a thorough rinse.", correctExplanation: "✅ Correct! Split the windshield into two pieces when rinsing — this ensures you cover the full surface.", proTip: "💡 Pro Tip: After rinsing, check the windshield from the driver's perspective — bug residue at eye level is a safety hazard." },
  ],
  "tar-sap-removal": [
    { id: "step1", title: "Step 1 — Identify: Tar vs. Tree Sap", instruction: "Before treating, identify what you're dealing with. TAR is black, sticky, usually on lower panels. TREE SAP is clear/amber, sticky, found anywhere.", area: "🔍 Tar/Sap — Identification", question: "Where is tar contamination most commonly found on a vehicle?", choices: [{ id: "lower", label: "Lower Panels" }, { id: "roof", label: "Roof & Hood" }, { id: "glass", label: "Glass Only" }], correctId: "lower", wrongExplanation: "❌ Wrong! Tar comes from road spray and is most commonly found on lower panels, rocker panels, and wheel wells.", correctExplanation: "✅ Correct! Tar is road spray contamination — most commonly found on lower body panels, rockers, and wheel wells.", proTip: "💡 Pro Tip: Tree sap can be anywhere — check the roof, hood, and trunk lid if the vehicle was parked under trees." },
    { id: "step2", title: "Step 2 — Apply Tar & Sap Remover", instruction: "Spray Tar & Sap Remover directly on the affected area. Let it dwell for 30-60 seconds.", area: "🔍 Tar/Sap — Chemical", question: "Which product removes tar and tree sap?", choices: [{ id: "tarSap", label: "Tar & Sap Remover" }, { id: "degreaser", label: "Degreaser" }, { id: "bugOff", label: "Bug Off" }], correctId: "tarSap", wrongExplanation: "❌ Wrong! Degreaser and Bug Off won't dissolve tar or sap effectively.", correctExplanation: "✅ Correct! Tar & Sap Remover is the specialized product designed to dissolve these contaminants.", proTip: "💡 Pro Tip: For heavy tar, apply a second coat after wiping the first — layering the product is more effective than one heavy application." },
    { id: "step3", title: "Step 3 — Wipe Off with Microfiber", instruction: "After dwell time, wipe off the dissolved tar or sap with a clean microfiber towel.", area: "🔍 Tar/Sap — Removal", question: "What do you use to wipe off the dissolved tar or sap?", choices: [{ id: "microfiber", label: "Clean Microfiber" }, { id: "greenBrush", label: "Green Brush" }, { id: "steelWool", label: "Steel Wool" }], correctId: "microfiber", wrongExplanation: "❌ Wrong! Never use a brush or steel wool on paint — it will scratch. Use a clean microfiber towel.", correctExplanation: "✅ Correct! A clean microfiber towel is used to wipe off dissolved tar or sap without scratching the paint.", proTip: "💡 Pro Tip: Use a dedicated microfiber for tar/sap removal — the residue is hard to wash out and can contaminate other towels." },
  ],
  "wash-process": [
    { id: "step1", title: "Step 1 — Rinse Vehicle Top to Bottom", instruction: "Start by rinsing the entire vehicle from the top down with the pressure washer.", area: "🚗 Wash Process — Pre-Rinse", question: "Which direction do you rinse the vehicle first?", choices: [{ id: "topDown", label: "Top to Bottom" }, { id: "bottomUp", label: "Bottom to Top" }, { id: "sides", label: "Side to Side" }], correctId: "topDown", wrongExplanation: "❌ Wrong! Always rinse top to bottom — gravity pulls dirty water down and off the vehicle.", correctExplanation: "✅ Correct! Always rinse top to bottom. This ensures dirty water flows down and off the vehicle.", proTip: "💡 Pro Tip: Start at the roof and work down systematically — roof, windshield, hood, then sides and rear." },
    { id: "step2", title: "Step 2 — Apply Foam & Wash the Top", instruction: "Apply foam to the hood, windshield, and top of the vehicle. Use your wash mitt to remove dirt.", area: "🚗 Wash Process — Top Section", question: "Which tool do you use to wash the vehicle's painted surfaces?", choices: [{ id: "washMitt", label: "Wash Mitt" }, { id: "tireBrush", label: "Tire Brush" }, { id: "greenBrush", label: "Green Brush" }], correctId: "washMitt", wrongExplanation: "❌ Wrong! Never use a brush on painted surfaces — it will scratch the clear coat.", correctExplanation: "✅ Correct! The Wash Mitt is the only tool safe for painted surfaces.", proTip: "💡 Pro Tip: Clean your wash mitt in the bucket after every panel — this removes trapped dirt." },
    { id: "step3", title: "Step 3 — Wash Shade Side & Front Bumper", instruction: "Apply foam to the shade side and front bumper. Work section by section.", area: "🚗 Wash Process — Shade Side", question: "After washing each section, what do you rinse with?", choices: [{ id: "spotFree", label: "Spot-Free Water" }, { id: "tapWater", label: "Regular Tap Water" }, { id: "noRinse", label: "No Rinse Needed" }], correctId: "spotFree", wrongExplanation: "❌ Wrong! Regular tap water contains minerals that leave water spots on paint.", correctExplanation: "✅ Correct! Always rinse with spot-free water — it has no minerals, so it won't leave water spots.", proTip: "💡 Pro Tip: Don't let soap sit on the paint in direct sun — it will dry and leave streaks." },
    { id: "step4", title: "Step 4 — Wash Sun Side & Rear", instruction: "Apply foam to the sun side and rear of the vehicle. Always return the mitt to the bucket.", area: "🚗 Wash Process — Sun Side & Rear", question: "Where do you put the wash mitt when not using it?", choices: [{ id: "bucket", label: "In the Wash Bucket" }, { id: "ground", label: "On the Ground" }, { id: "hood", label: "On the Hood" }], correctId: "bucket", wrongExplanation: "❌ Wrong! Setting the mitt on the ground or hood picks up grit and debris that will scratch the paint.", correctExplanation: "✅ Correct! Always return the mitt to the wash bucket — this keeps it clean.", proTip: "💡 Pro Tip: After washing the rear, do a final check of the lower portions and any remaining bugs." },
    { id: "step5", title: "Step 5 — Double Check: Bugs & Lower Panels", instruction: "After washing, do a final inspection of the lower portions of the vehicle and check for any remaining bugs.", area: "🚗 Wash Process — Final Check", question: "What two areas do you double-check after the wash?", choices: [{ id: "bugsLower", label: "Bugs & Lower Panels" }, { id: "roof", label: "Roof & Windows" }, { id: "wheels", label: "Wheels Only" }], correctId: "bugsLower", wrongExplanation: "❌ Wrong! The roof and wheels are handled in other steps. The final wash check focuses on bugs and lower panels.", correctExplanation: "✅ Correct! Always double-check bugs (especially on the front end) and lower panels.", proTip: "💡 Pro Tip: Walk around the vehicle at eye level after washing — you'll catch missed spots that are invisible from above." },
  ],
  "drying": [
    { id: "step1", title: "Step 1 — Blow Out Water from Crevices", instruction: "Before towel drying, use the blower to force water out of all crevices — door handles, side mirrors, trim gaps.", area: "💨 Drying — Blower First", question: "What do you do BEFORE towel drying the vehicle?", choices: [{ id: "blower", label: "Blow Out Crevices First" }, { id: "towel", label: "Start Towel Drying" }, { id: "chamois", label: "Use a Chamois" }], correctId: "blower", wrongExplanation: "❌ Wrong! If you towel dry first, water trapped in crevices will drip onto your clean panels.", correctExplanation: "✅ Correct! Always blow out crevices first — this prevents water from dripping onto already-dried panels.", proTip: "💡 Pro Tip: Blow out the door handles, side mirrors, and around the windshield — these are the biggest drip offenders." },
    { id: "step2", title: "Step 2 — Dry with All-Purpose Microfiber", instruction: "Use the All-Purpose Microfiber towel to dry the vehicle from top to bottom.", area: "💨 Drying — Towel", question: "Which direction do you dry the vehicle?", choices: [{ id: "topDown", label: "Top to Bottom" }, { id: "bottomUp", label: "Bottom to Top" }, { id: "random", label: "Any Direction" }], correctId: "topDown", wrongExplanation: "❌ Wrong! Always dry top to bottom — water flows down, so you should follow gravity.", correctExplanation: "✅ Correct! Dry top to bottom — this ensures you're always working on clean, dry surfaces.", proTip: "💡 Pro Tip: Use a large waffle-weave microfiber for drying — it holds more water and reduces the number of passes needed." },
  ],
  "floor-mats": [
    { id: "step1", title: "Step 1 — Remove All Floor Mats", instruction: "Remove ALL floor mats from the vehicle before washing them.", area: "🪣 Floor Mats — Removal", question: "What do you do with floor mats before washing them?", choices: [{ id: "remove", label: "Remove & Shake Out" }, { id: "inPlace", label: "Wash In Place" }, { id: "vacuum", label: "Vacuum Only" }], correctId: "remove", wrongExplanation: "❌ Wrong! Never wash floor mats while they're in the vehicle — water will soak the carpet underneath.", correctExplanation: "✅ Correct! Always remove floor mats and shake them out before washing.", proTip: "💡 Pro Tip: Count the mats when you remove them — some vehicles have 4 or 5 mats. Make sure you return ALL of them when done." },
    { id: "step2", title: "Step 2 — Apply Chemical & Scrub", instruction: "Spray All-Purpose Cleaner on the floor mats and scrub with the Green Brush.", area: "🪣 Floor Mats — Scrubbing", question: "Which brush do you use to scrub floor mats?", choices: [{ id: "greenBrush", label: "Green Brush" }, { id: "detailBrush", label: "Detail Brush" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "greenBrush", wrongExplanation: "❌ Wrong! The Detail Brush is too small. The Wash Mitt is for paint. The Green Brush is the right tool for floor mats.", correctExplanation: "✅ Correct! The Green Brush is used to scrub floor mats — its stiff bristles lift embedded dirt from the fibers.", proTip: "💡 Pro Tip: Scrub in straight lines on rubber mats and circular motions on carpet mats for best results." },
    { id: "step3", title: "Step 3 — Rinse & Hang to Dry", instruction: "After scrubbing, pressure rinse the floor mats thoroughly. Hang them to dry before reinstalling.", area: "🪣 Floor Mats — Rinse", question: "After rinsing floor mats, what do you do before reinstalling them?", choices: [{ id: "hang", label: "Hang to Dry" }, { id: "reinstall", label: "Reinstall Immediately" }, { id: "vacuum", label: "Vacuum Them" }], correctId: "hang", wrongExplanation: "❌ Wrong! Reinstalling wet mats soaks the carpet underneath and creates mold and mildew.", correctExplanation: "✅ Correct! Always hang floor mats to dry before reinstalling — wet mats will soak the carpet.", proTip: "💡 Pro Tip: Hang mats over the door or a nearby fence while you finish the rest of the detail — they'll be dry by the time you're done." },
  ],
  "bead-maker": [
    { id: "step1", title: "Step 1 — Apply Bead Maker to Wet Paint", instruction: "After drying, apply Bead Maker to the entire painted surface.", area: "✨ Bead Maker — Application", question: "When can you apply Bead Maker to the vehicle?", choices: [{ id: "wetDry", label: "Wet OR Dry Surface" }, { id: "dryOnly", label: "Dry Surface Only" }, { id: "wetOnly", label: "Wet Surface Only" }], correctId: "wetDry", wrongExplanation: "❌ Wrong! Bead Maker is versatile — it can be applied to both wet and dry surfaces.", correctExplanation: "✅ Correct! Bead Maker can be applied to wet OR dry surfaces — this is one of its key advantages.", proTip: "💡 Pro Tip: Apply Bead Maker in the shade when possible — direct sunlight causes it to dry too quickly." },
    { id: "step2", title: "Step 2 — Spread with All-Purpose Microfiber", instruction: "Use the All-Purpose Microfiber towel to spread the Bead Maker evenly across each panel.", area: "✨ Bead Maker — Spreading", question: "Which towel do you use to spread Bead Maker?", choices: [{ id: "allPurpose", label: "All-Purpose Microfiber" }, { id: "greenBrush", label: "Green Brush" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "allPurpose", wrongExplanation: "❌ Wrong! Never use a brush or wash mitt to apply Bead Maker.", correctExplanation: "✅ Correct! The All-Purpose Microfiber towel is used to spread Bead Maker.", proTip: "💡 Pro Tip: Use light, overlapping strokes when spreading Bead Maker — this ensures even coverage." },
    { id: "step3", title: "Step 3 — Buff to a Shine", instruction: "After spreading, use a clean, dry All-Purpose Microfiber towel to buff the Bead Maker to a shine.", area: "✨ Bead Maker — Buffing", question: "What motion do you use when buffing Bead Maker to a shine?", choices: [{ id: "circular", label: "Circular Motions" }, { id: "straight", label: "Straight Lines Only" }, { id: "noMotion", label: "Just Wipe Once" }], correctId: "circular", wrongExplanation: "❌ Wrong! For the final buff, use circular motions.", correctExplanation: "✅ Correct! Use circular motions for the final buff — this evenly distributes the Bead Maker.", proTip: "💡 Pro Tip: Use a separate clean towel for buffing — the towel used to spread the product is already saturated." },
    { id: "step4", title: "Step 4 — Apply to ALL Painted Surfaces", instruction: "Apply Bead Maker to ALL painted surfaces — hood, roof, trunk, all four doors, front and rear bumpers, and fenders.", area: "✨ Bead Maker — Coverage", question: "Which surfaces do you apply Bead Maker to?", choices: [{ id: "all", label: "All Painted Surfaces" }, { id: "top", label: "Top Panels Only" }, { id: "hood", label: "Hood & Trunk Only" }], correctId: "all", wrongExplanation: "❌ Wrong! Bead Maker must be applied to ALL painted surfaces.", correctExplanation: "✅ Correct! Apply Bead Maker to ALL painted surfaces — every panel needs protection.", proTip: "💡 Pro Tip: Don't forget the door jambs — apply a light coat of Bead Maker to the painted surfaces inside the door jambs too." },
  ],
  "paint-sealant": [
    { id: "step1", title: "Step 1 — Apply Paint Sealant to Applicator", instruction: "Apply a small amount of Paint Sealant to the foam applicator pad.", area: "🛡️ Paint Sealant — Application", question: "How much Paint Sealant do you apply per panel?", choices: [{ id: "peaSize", label: "Pea-Sized Amount" }, { id: "heavy", label: "Heavy Coat" }, { id: "spray", label: "Spray Directly on Car" }], correctId: "peaSize", wrongExplanation: "❌ Wrong! More product doesn't mean better protection — a pea-sized amount per panel is all you need.", correctExplanation: "✅ Correct! A pea-sized amount per panel is all you need. Thin, even coats are more effective.", proTip: "💡 Pro Tip: Apply to the applicator pad, not directly to the car — this gives you better control." },
    { id: "step2", title: "Step 2 — Apply in Straight Lines", instruction: "Apply Paint Sealant in straight, overlapping lines — not circular motions.", area: "🛡️ Paint Sealant — Technique", question: "What motion do you use when APPLYING Paint Sealant?", choices: [{ id: "straight", label: "Straight Lines" }, { id: "circular", label: "Circular Motions" }, { id: "random", label: "Any Direction" }], correctId: "straight", wrongExplanation: "❌ Wrong! Use straight, overlapping lines when applying — circular motions can create uneven coverage.", correctExplanation: "✅ Correct! Apply in straight, overlapping lines for even coverage.", proTip: "💡 Pro Tip: Overlap each pass by 50% — this ensures no gaps in coverage." },
    { id: "step3", title: "Step 3 — Let It Haze (2-3 Minutes)", instruction: "After applying to a panel, let the Paint Sealant haze for 2-3 minutes.", area: "🛡️ Paint Sealant — Dwell Time", question: "How long do you let Paint Sealant haze before buffing?", choices: [{ id: "2to3min", label: "2-3 Minutes" }, { id: "30sec", label: "30 Seconds" }, { id: "10min", label: "10+ Minutes" }], correctId: "2to3min", wrongExplanation: "❌ Wrong! 30 seconds isn't enough. 10+ minutes means it may harden.", correctExplanation: "✅ Correct! Let Paint Sealant haze for 2-3 minutes — you'll see it turn slightly cloudy.", proTip: "💡 Pro Tip: Work one panel at a time — apply to one panel, move to the next, then come back to buff the first." },
    { id: "step4", title: "Step 4 — Buff Off with Clean Microfiber", instruction: "Use a clean, dry All-Purpose Microfiber towel to buff the Paint Sealant off.", area: "🛡️ Paint Sealant — Buffing", question: "What do you use to buff off Paint Sealant?", choices: [{ id: "cleanMicro", label: "Clean Dry Microfiber" }, { id: "washMitt", label: "Wash Mitt" }, { id: "greenBrush", label: "Green Brush" }], correctId: "cleanMicro", wrongExplanation: "❌ Wrong! Never use a wash mitt or brush to buff sealant — they can scratch the paint.", correctExplanation: "✅ Correct! A clean, dry All-Purpose Microfiber towel is the only tool for buffing Paint Sealant.", proTip: "💡 Pro Tip: Flip your microfiber towel frequently while buffing — once one side is saturated, it won't buff effectively." },
  ],
  "interior-cleaning": [
    { id: "step1", title: "Step 1 — Vacuum the Interior", instruction: "Start by vacuuming the entire interior — seats, carpet, floor mats, and trunk.", area: "🧹 Interior — Vacuum", question: "What is the FIRST step in the interior cleaning process?", choices: [{ id: "vacuum", label: "Vacuum First" }, { id: "wipe", label: "Wipe Surfaces First" }, { id: "windows", label: "Clean Windows First" }], correctId: "vacuum", wrongExplanation: "❌ Wrong! Always vacuum first — wiping surfaces before vacuuming just moves dust around.", correctExplanation: "✅ Correct! Vacuum first — this removes loose debris before you start wiping surfaces.", proTip: "💡 Pro Tip: Use the crevice tool for seat seams and between the center console and seats — these areas trap the most debris." },
    { id: "step2", title: "Step 2 — Blow Out Vents & Crevices", instruction: "Use the blower to force debris out of vents, crevices, and tight spaces.", area: "💨 Interior — Blow Out", question: "What tool do you use to clean vents and crevices?", choices: [{ id: "blower", label: "Blower" }, { id: "detailBrush", label: "Detail Brush Only" }, { id: "vacuum", label: "Vacuum Hose" }], correctId: "blower", wrongExplanation: "❌ Wrong! The blower is the most effective tool for forcing debris out of vents and tight spaces.", correctExplanation: "✅ Correct! The blower forces debris out of vents and crevices that the vacuum can't reach.", proTip: "💡 Pro Tip: After blowing out, vacuum again to pick up the debris the blower dislodged." },
    { id: "step3", title: "Step 3 — Wipe Dashboard & Console", instruction: "Spray All-Purpose Cleaner on the towel and wipe the dashboard, center console, and door panels.", area: "🧹 Interior — Dashboard", question: "How do you apply cleaner to the dashboard?", choices: [{ id: "onTowel", label: "Spray on Towel First" }, { id: "onDash", label: "Spray on Dashboard" }, { id: "noSpray", label: "Use Dry Towel" }], correctId: "onTowel", wrongExplanation: "❌ Wrong! Spraying directly on the dashboard can overspray onto electronics and screens.", correctExplanation: "✅ Correct! Spray on the towel first — this gives you controlled application and prevents overspray.", proTip: "💡 Pro Tip: Use the Detail Brush to clean around buttons and knobs before wiping with the towel." },
    { id: "step4", title: "Step 4 — Clean Cup Holders & Compartments", instruction: "Use the Detail Brush with All-Purpose Cleaner to scrub cup holders and storage compartments.", area: "🧹 Interior — Cup Holders", question: "Which tool do you use to clean cup holders?", choices: [{ id: "detailBrush", label: "Detail Brush" }, { id: "greenBrush", label: "Green Brush" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "detailBrush", wrongExplanation: "❌ Wrong! The Green Brush is too large for cup holders. The Wash Mitt is for exterior paint.", correctExplanation: "✅ Correct! The Detail Brush fits perfectly in cup holders and storage compartments.", proTip: "💡 Pro Tip: Line cup holders with a damp towel after cleaning — this makes future cleaning much easier." },
    { id: "step5", title: "Step 5 — Clean Kick Plates", instruction: "Clean the kick plates at the bottom of each door opening with All-Purpose Cleaner and the All-Purpose Towel.", area: "🚪 Interior — Kick Plates", question: "What are kick plates and where are they located?", choices: [{ id: "doorBottom", label: "Bottom of Door Openings" }, { id: "pedals", label: "Foot Pedals" }, { id: "doorHandle", label: "Door Handles" }], correctId: "doorBottom", wrongExplanation: "❌ Wrong! Kick plates are the strips at the bottom of each door opening — not the pedals or door handles.", correctExplanation: "✅ Correct! Kick plates are the strips at the bottom of each door opening — they take a lot of abuse from feet.", proTip: "💡 Pro Tip: For stubborn scuffs, use a slightly damp Detail Brush with All-Purpose Cleaner." },
    { id: "step6", title: "Step 6 — Clean Cloth Seats", instruction: "For CLOTH seats: Spray All-Purpose Cleaner on the seat, agitate with the Green Brush in straight lines, then wipe clean.", area: "💺 Interior — Cloth Seats", question: "Which brush do you use to agitate cloth seats?", choices: [{ id: "greenBrush", label: "Green Brush" }, { id: "detailBrush", label: "Detail Brush" }, { id: "washMitt", label: "Wash Mitt" }], correctId: "greenBrush", wrongExplanation: "❌ Wrong! The Detail Brush is too small for seats. The Wash Mitt is for exterior paint.", correctExplanation: "✅ Correct! The Green Brush is used to agitate cloth seats — its stiff bristles lift embedded dirt.", proTip: "💡 Pro Tip: Work in straight lines on cloth seats — circular motions can cause the fabric to pill." },
    { id: "step7", title: "Step 7 — Clean Leather Seats", instruction: "For LEATHER seats: Spray All-Purpose Cleaner on the All-Purpose Towel (NOT directly on leather). Then apply Leather Conditioner.", area: "💺 Interior — Leather Seats", question: "How do you apply cleaner to leather seats?", choices: [{ id: "onTowel", label: "Spray on Towel First" }, { id: "onLeather", label: "Spray on Leather" }, { id: "noClean", label: "Just Condition It" }], correctId: "onTowel", wrongExplanation: "❌ Wrong! Never spray directly on leather — too much moisture can damage the leather.", correctExplanation: "✅ Correct! Spray cleaner on the towel first, then wipe leather — this prevents over-saturation.", proTip: "💡 Pro Tip: After cleaning, always apply Leather Conditioner — leather dries out and cracks without conditioning." },
    { id: "step8", title: "Step 8 — Clean Carpet", instruction: "Spray All-Purpose Cleaner on the carpet and agitate with the Green Brush. For stubborn stains, let it dwell for 60 seconds.", area: "🏠 Interior — Carpet", question: "For stubborn carpet stains, how long do you let the cleaner dwell?", choices: [{ id: "60sec", label: "60 Seconds" }, { id: "5sec", label: "5 Seconds" }, { id: "5min", label: "5 Minutes" }], correctId: "60sec", wrongExplanation: "❌ Wrong! 5 seconds isn't enough dwell time. 5 minutes may cause the product to dry.", correctExplanation: "✅ Correct! Let All-Purpose Cleaner dwell for 60 seconds on stubborn carpet stains.", proTip: "💡 Pro Tip: After cleaning carpet, do a final vacuum pass — this lifts the carpet fibers back up." },
    { id: "step9", title: "Step 9 — Final Blow Out & Wipe Down", instruction: "Use the blower to blow out any remaining debris from vents, crevices, and tight spaces. Then do a final wipe-down.", area: "💨 Interior — Final Blow & Wipe", question: "What is the purpose of the final blow-out?", choices: [{ id: "debris", label: "Remove Debris from Crevices" }, { id: "dry", label: "Dry the Carpet" }, { id: "smell", label: "Freshen the Air" }], correctId: "debris", wrongExplanation: "❌ Wrong! The blower is used to remove debris from vents and crevices — not to dry carpet or freshen air.", correctExplanation: "✅ Correct! The final blow-out removes debris from vents, crevices, and tight spaces.", proTip: "💡 Pro Tip: After blowing out, do one final vacuum pass to pick up everything the blower dislodged." },
    { id: "step10", title: "Step 10 — Clean Interior Windows", instruction: "Spray Glass Cleaner on the All-Purpose Towel and wipe all interior glass.", area: "🪟 Interior — Windows", question: "How do you apply glass cleaner to interior windows?", choices: [{ id: "onTowel", label: "Spray on Towel First" }, { id: "onGlass", label: "Spray on Glass" }, { id: "noSpray", label: "Use Dry Towel Only" }], correctId: "onTowel", wrongExplanation: "❌ Wrong! Spraying directly on interior glass can overspray onto the headliner or dashboard.", correctExplanation: "✅ Correct! Spray glass cleaner on the towel first — this prevents overspray onto the headliner and dashboard.", proTip: "💡 Pro Tip: Use two towels for windows — one to clean, one to buff. The buffing towel removes streaks." },
    { id: "step11", title: "Step 11 — Apply Interior Dressing", instruction: "Apply Interior Dressing to all plastic and vinyl surfaces — dashboard, door panels, center console, and trim.", area: "✨ Interior — Dressing", question: "Which surfaces do you apply Interior Dressing to?", choices: [{ id: "plasticVinyl", label: "Plastic & Vinyl Surfaces" }, { id: "seats", label: "Seats & Carpet" }, { id: "windows", label: "Windows & Glass" }], correctId: "plasticVinyl", wrongExplanation: "❌ Wrong! Interior Dressing is for plastic and vinyl surfaces only — never apply it to seats, carpet, or glass.", correctExplanation: "✅ Correct! Interior Dressing is applied to plastic and vinyl surfaces — dashboard, door panels, console, and trim.", proTip: "💡 Pro Tip: Use a MATTE dressing, not a glossy one — glossy dressing on the dashboard creates glare that can be a safety hazard." },
  ],
};

// ── Interactive Module Step Editor ────────────────────────────────────────────
// ── Interactive Module Step Editor ────────────────────────────────────────────
type EditorTab = "card" | "tools" | "steps";
type ToolCategory = "tool" | "chemical" | "towel";

function InteractiveModuleEditor({ mod, onClose }: { mod: any; onClose: () => void }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const [editorTab, setEditorTab] = useState<EditorTab>("card");

  // ── Module card metadata editing ──────────────────────────────────────────
  const updateModuleMutation = trpc.training.updateInteractiveModule.useMutation({
    onSuccess: () => { utils.training.getAllInteractiveModules.invalidate(); Alert.alert("Saved", "Module card updated."); },
    onError: () => Alert.alert("Error", "Failed to save module card."),
  });
  const [title, setTitle] = useState(mod?.title || "");
  const [subtitle, setSubtitle] = useState(mod?.subtitle || "");
  const [emoji, setEmoji] = useState(mod?.emoji || "");
  const [moduleVideoUrl, setModuleVideoUrl] = useState("");
  const moduleKey = mod?.moduleKey || "";
  const defaultSteps: DefaultStep[] = INTERACTIVE_STEPS_MAP[moduleKey] || [];
  const overridesQuery = trpc.training.getInteractiveOverrides.useQuery(
    { moduleId: moduleKey },
    { staleTime: 0, enabled: !!moduleKey }
  );
  const overrides: any[] = (overridesQuery.data || []).filter((o: any) => !o.isDeleted);
  const deletedStepIndices: number[] = (overridesQuery.data || []).filter((o: any) => o.isDeleted).map((o: any) => o.stepIndex);
  useEffect(() => {
    if (overridesQuery.isFetched) {
      const videoOverride = overrides.find((o) => o.stepIndex === -1);
      setModuleVideoUrl(videoOverride?.videoUrl ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridesQuery.isFetched]);
  const upsertMutation = trpc.training.upsertInteractiveOverride.useMutation({
    onSuccess: () => { overridesQuery.refetch(); Alert.alert("Saved", "Step saved successfully."); },
    onError: () => Alert.alert("Error", "Failed to save step."),
  });

  // ── Legacy step override editing ──────────────────────────────────────────
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [stepTitle, setStepTitle] = useState("");
  const [stepInstruction, setStepInstruction] = useState("");
  const [stepArea, setStepArea] = useState("");
  const [stepQuestion, setStepQuestion] = useState("");
  const [stepProTip, setStepProTip] = useState("");
  const [stepWrongExpl, setStepWrongExpl] = useState("");
  const [stepCorrectExpl, setStepCorrectExpl] = useState("");
  const [choiceLabels, setChoiceLabels] = useState<string[]>([]);
  const [correctChoiceIndex, setCorrectChoiceIndex] = useState<number>(0);
  const [stepVehicleImageUrl, setStepVehicleImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const uploadImageMutation = trpc.training.uploadTrainingImage.useMutation();

  // ── Tools/Chemicals/Towels ────────────────────────────────────────────────
  const toolsQuery = trpc.training.getModuleTools.useQuery(
    { moduleKey },
    { staleTime: 0, enabled: !!moduleKey && editorTab === "tools" }
  );
  const tools: any[] = toolsQuery.data || [];
  const addToolMutation = trpc.training.addModuleTool.useMutation({
    onSuccess: () => { toolsQuery.refetch(); setShowAddTool(false); resetToolForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateToolMutation = trpc.training.updateModuleTool.useMutation({
    onSuccess: () => { toolsQuery.refetch(); setEditingTool(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteToolMutation = trpc.training.deleteModuleTool.useMutation({
    onSuccess: () => toolsQuery.refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const [showAddTool, setShowAddTool] = useState(false);
  const [toolCategory, setToolCategory] = useState<ToolCategory>("tool");
  const [toolName, setToolName] = useState("");
  const [toolPhotoUrl, setToolPhotoUrl] = useState("");
  const [editingTool, setEditingTool] = useState<any | null>(null);
  const [editToolName, setEditToolName] = useState("");
  const [editToolPhotoUrl, setEditToolPhotoUrl] = useState("");
  const resetToolForm = () => { setToolName(""); setToolPhotoUrl(""); setToolCategory("tool"); };

  // ── DB Steps (new) ────────────────────────────────────────────────────────
  const dbStepsQuery = trpc.training.getInteractiveSteps.useQuery(
    { moduleKey },
    { staleTime: 0, enabled: !!moduleKey && editorTab === "steps" }
  );
  const dbSteps: any[] = dbStepsQuery.data || [];
  const addStepMutation = trpc.training.addInteractiveStep.useMutation({
    onSuccess: () => { dbStepsQuery.refetch(); setShowAddStep(false); resetStepForm(); Alert.alert("Added", "Step added."); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateStepMutation = trpc.training.updateInteractiveStep.useMutation({
    onSuccess: () => { dbStepsQuery.refetch(); setEditingDbStep(null); Alert.alert("Saved", "Step updated."); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteStepMutation = trpc.training.deleteInteractiveStep.useMutation({
    onSuccess: () => dbStepsQuery.refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteBuiltInStepMutation = trpc.training.deleteBuiltInStep.useMutation({
    onSuccess: () => overridesQuery.refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const restoreBuiltInStepMutation = trpc.training.restoreBuiltInStep.useMutation({
    onSuccess: () => overridesQuery.refetch(),
    onError: (e) => Alert.alert("Error", e.message),
  });
  const reorderStepsMutation = trpc.training.reorderInteractiveSteps.useMutation({
    onSuccess: () => dbStepsQuery.refetch(),
  });
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingDbStep, setEditingDbStep] = useState<any | null>(null);
  // Add/Edit step form fields
  const [sTitle, setSTitle] = useState("");
  const [sInstruction, setSInstruction] = useState("");
  const [sArea, setSArea] = useState("");
  const [sQuestion, setSQuestion] = useState("");
  const [sChoices, setSChoices] = useState([
    { id: "A", label: "" },
    { id: "B", label: "" },
    { id: "C", label: "" },
  ]);
  const [sCorrectId, setSCorrectId] = useState("A");
  const [sWrongExpl, setSWrongExpl] = useState("");
  const [sCorrectExpl, setSCorrectExpl] = useState("");
  const [sProTip, setSProTip] = useState("");
  const [sVehicleImageUrl, setSVehicleImageUrl] = useState<string | null>(null);
  const [sPhotoUploading, setSPhotoUploading] = useState(false);
  const resetStepForm = () => {
    setSTitle(""); setSInstruction(""); setSArea(""); setSQuestion("");
    setSChoices([{ id: "A", label: "" }, { id: "B", label: "" }, { id: "C", label: "" }]);
    setSCorrectId("A"); setSWrongExpl(""); setSCorrectExpl(""); setSProTip(""); setSVehicleImageUrl(null);
  };
  const openEditStep = (step: any) => {
    setSTitle(step.title || "");
    setSInstruction(step.instruction || "");
    setSArea(step.area || "");
    setSQuestion(step.question || "");
    const rawChoices = Array.isArray(step.choices) && step.choices.length > 0
      ? step.choices
      : [{ id: "A", label: "" }, { id: "B", label: "" }, { id: "C", label: "" }];
    // Ensure every choice has a string label to prevent .trim() of undefined crashes
    // Some older steps use {id, text} format instead of {id, label} — handle both
    const parsedChoices = rawChoices.map((c: any) => ({ id: c.id ?? "A", label: c.label ?? c.text ?? "" }));
    setSChoices(parsedChoices);
    setSCorrectId(step.correctId || parsedChoices[0]?.id || "A");
    setSWrongExpl(step.wrongExplanation || "");
    setSCorrectExpl(step.correctExplanation || "");
    setSProTip(step.proTip || "");
    setSVehicleImageUrl(step.vehicleImageUrl || null);
    setEditingDbStep(step);
  };
  const moveDbStep = (index: number, direction: "up" | "down") => {
    const arr = [...dbSteps];
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[index], arr[swapIdx]] = [arr[swapIdx], arr[index]];
    reorderStepsMutation.mutate({ orderedStepIds: arr.map((s) => s.stepId) });
  };

  const openStepEditor = (stepIndex: number) => {
    const def = defaultSteps[stepIndex];
    const override = overrides.find((o) => o.stepIndex === stepIndex);
    let parsedChoiceLabels: any[] | null = null;
    let parsedCorrectId: string | null = null;
    let parsedWrongExpl: string | null = null;
    let parsedCorrectExpl: string | null = null;
    if (override?.choiceLabels) {
      try {
        const parsed = JSON.parse(override.choiceLabels);
        if (Array.isArray(parsed)) {
          parsedChoiceLabels = parsed.filter((c: any) => !c._meta);
          const meta = parsed.find((c: any) => c._meta);
          if (meta) {
            parsedCorrectId = meta.correctId || null;
            parsedWrongExpl = meta.wrongExplanation || null;
            parsedCorrectExpl = meta.correctExplanation || null;
          }
        }
      } catch { /* ignore */ }
    }
    const initLabels = (def?.choices || []).map((c) => {
      const overrideChoice = parsedChoiceLabels?.find((o: any) => o.id === c.id);
      return overrideChoice?.label ?? c.label;
    });
    const effectiveCorrectId = parsedCorrectId || def?.correctId || "";
    const correctIdx = (def?.choices || []).findIndex((c) => c.id === effectiveCorrectId);
    setStepTitle(override?.title || def?.title || "");
    setStepInstruction(override?.instruction || def?.instruction || "");
    setStepArea(override?.area || def?.area || "");
    setStepQuestion(override?.question || def?.question || "");
    setStepProTip(override?.proTip || def?.proTip || "");
    setStepWrongExpl(parsedWrongExpl || def?.wrongExplanation || "");
    setStepCorrectExpl(parsedCorrectExpl || def?.correctExplanation || "");
    setChoiceLabels(initLabels);
    setCorrectChoiceIndex(correctIdx >= 0 ? correctIdx : 0);
    setStepVehicleImageUrl(override?.vehicleImageUrl || (def as any)?.vehicleImageUrl || null);
    setEditingStepIndex(stepIndex);
  };
  const handleSaveStep = () => {
    if (editingStepIndex === null) return;
    const def = defaultSteps[editingStepIndex];
    const choices = def?.choices || [];
    const choiceLabelsArr: any[] = choices.map((c, i) => ({ id: c.id, label: choiceLabels[i] ?? c.label }));
    const correctId = choices[correctChoiceIndex]?.id || def?.correctId || "";
    choiceLabelsArr.push({ _meta: true, correctId, wrongExplanation: stepWrongExpl.trim() || undefined, correctExplanation: stepCorrectExpl.trim() || undefined });
    upsertMutation.mutate({
      moduleId: moduleKey, stepIndex: editingStepIndex,
      title: stepTitle.trim() || null, instruction: stepInstruction.trim() || null,
      area: stepArea.trim() || null, question: stepQuestion.trim() || null,
      proTip: stepProTip.trim() || null, choiceLabels: JSON.stringify(choiceLabelsArr),
      vehicleImageUrl: stepVehicleImageUrl || null,
    });
  };
  const handleSaveModuleCard = () => {
    if (!title.trim()) { Alert.alert("Required", "Title is required."); return; }
    updateModuleMutation.mutate({ moduleKey, title: title.trim(), subtitle: subtitle.trim() || undefined, emoji: emoji.trim() || undefined });
    upsertMutation.mutate({ moduleId: moduleKey, stepIndex: -1, videoUrl: moduleVideoUrl.trim() || null });
  };

  const inputStyle = {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 8,
  };

  // ── Legacy step edit panel ────────────────────────────────────────────────
  if (editingStepIndex !== null) {
    const def = defaultSteps[editingStepIndex];
    const choices = def?.choices || [];
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }} numberOfLines={1}>
            Step {editingStepIndex + 1} of {defaultSteps.length}
          </Text>
          <Pressable onPress={() => setEditingStepIndex(null)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Steps</Text>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Step image picker */}
          <SectionHeader title="Step Photo" />
          <View style={{ marginBottom: 12 }}>
            {stepVehicleImageUrl ? (
              <View style={{ position: "relative", marginBottom: 8 }}>
                <Image source={{ uri: stepVehicleImageUrl }} style={{ width: "100%", height: 160, borderRadius: 10, backgroundColor: colors.surface }} resizeMode="cover" />
                <Pressable onPress={() => setStepVehicleImageUrl(null)} style={({ pressed }) => ({ position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✕ Remove</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ height: 80, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>No custom photo set — default illustration shown</Text>
              </View>
            )}
            <Pressable
              onPress={async () => {
                const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!perm.granted) { Alert.alert("Permission needed", "Allow photo library access to upload a step photo."); return; }
                const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, base64: true, allowsEditing: true, aspect: [16, 9] });
                if (result.canceled || !result.assets?.[0]) return;
                const asset = result.assets[0];
                if (!asset.base64) { Alert.alert("Error", "Could not read image data."); return; }
                setImageUploading(true);
                try {
                  const res = await uploadImageMutation.mutateAsync({ base64: asset.base64, mimeType: asset.mimeType || "image/jpeg", moduleId: moduleKey, stepIndex: editingStepIndex! });
                  setStepVehicleImageUrl(res.url);
                  // Auto-save the photo URL immediately so it's not lost if user closes without pressing Save Step
                  upsertMutation.mutate({ moduleId: moduleKey, stepIndex: editingStepIndex!, vehicleImageUrl: res.url });
                } catch { Alert.alert("Upload Failed", "Could not upload the image. Please try again."); }
                finally { setImageUploading(false); }
              }}
              disabled={imageUploading}
              style={({ pressed }) => ({ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: pressed || imageUploading ? 0.7 : 1 })}
            >
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{imageUploading ? "Uploading…" : "📷 Upload Step Photo"}</Text>
            </Pressable>
          </View>
          <SectionHeader title="Step Title" />
          <TextInput style={inputStyle} value={stepTitle} onChangeText={setStepTitle} placeholder={def?.title || "Step title"} placeholderTextColor={colors.muted} />
          <SectionHeader title="Instruction" />
          <TextInput style={[inputStyle, { minHeight: 80 }]} value={stepInstruction} onChangeText={setStepInstruction} placeholder={def?.instruction || "Instruction text"} placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Area Label" />
          <TextInput style={inputStyle} value={stepArea} onChangeText={setStepArea} placeholder={def?.area || "e.g. 🔧 Engine Bay — Step"} placeholderTextColor={colors.muted} />
          <SectionHeader title="Challenge Question" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={stepQuestion} onChangeText={setStepQuestion} placeholder={def?.question || "Challenge question"} placeholderTextColor={colors.muted} multiline />
          {choices.length > 0 && (
            <>
              <SectionHeader title="Answer Options" />
              {choices.map((c, i) => (
                <View key={c.id} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>Option {i + 1} (id: {c.id})</Text>
                  <TextInput style={inputStyle} value={choiceLabels[i] ?? c.label} onChangeText={(val) => { const next = [...choiceLabels]; next[i] = val; setChoiceLabels(next); }} placeholder={c.label} placeholderTextColor={colors.muted} />
                </View>
              ))}
              <SectionHeader title="Correct Answer" />
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {choices.map((c, i) => (
                  <Pressable key={c.id} onPress={() => setCorrectChoiceIndex(i)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: correctChoiceIndex === i ? "#22C55E" : colors.surface, borderWidth: 2, borderColor: correctChoiceIndex === i ? "#22C55E" : colors.border, opacity: pressed ? 0.8 : 1 })}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: correctChoiceIndex === i ? "#fff" : colors.foreground }}>Option {i + 1}</Text>
                    <Text style={{ fontSize: 10, color: correctChoiceIndex === i ? "#d1fae5" : colors.muted, marginTop: 2 }} numberOfLines={1}>{choiceLabels[i] ?? c.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <SectionHeader title="Wrong Answer Explanation" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={stepWrongExpl} onChangeText={setStepWrongExpl} placeholder={def?.wrongExplanation || "❌ Wrong! ..."} placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Correct Answer Explanation" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={stepCorrectExpl} onChangeText={setStepCorrectExpl} placeholder={def?.correctExplanation || "✅ Correct! ..."} placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Pro Tip" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={stepProTip} onChangeText={setStepProTip} placeholder={def?.proTip || "💡 Pro Tip: ..."} placeholderTextColor={colors.muted} multiline />
          <Pressable onPress={handleSaveStep} disabled={upsertMutation.isPending} style={({ pressed }) => ({ backgroundColor: "#22C55E", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 8, opacity: pressed || upsertMutation.isPending ? 0.8 : 1 })}>
            {upsertMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save Step</Text>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── DB Step add/edit panel ────────────────────────────────────────────────
  if (editingDbStep !== null || showAddStep) {
    const isEditing = editingDbStep !== null;
    const panelTitle = isEditing ? `Edit Step` : "Add Step";
    const handleSaveDbStep = () => {
      try {
        if (!sTitle.trim()) { Alert.alert("Required", "Step title is required."); return; }
        if (!sInstruction.trim()) { Alert.alert("Required", "Instruction is required."); return; }
        const validChoices = sChoices.filter((c) => (c.label ?? "").trim());
        // Only include vehicleImageUrl if it's a valid non-empty string
        const vehicleImageUrl = sVehicleImageUrl && sVehicleImageUrl.startsWith('http') ? sVehicleImageUrl : undefined;
        const payload = {
          title: (sTitle ?? "").trim(),
          instruction: (sInstruction ?? "").trim(),
          area: (sArea ?? "").trim() || undefined,
          question: (sQuestion ?? "").trim() || undefined,
          choices: validChoices.length > 0 ? validChoices : undefined,
          correctId: sCorrectId || undefined,
          wrongExplanation: (sWrongExpl ?? "").trim() || undefined,
          correctExplanation: (sCorrectExpl ?? "").trim() || undefined,
          proTip: (sProTip ?? "").trim() || undefined,
          vehicleImageUrl,
        };
        if (isEditing) {
          updateStepMutation.mutate({ stepId: editingDbStep.stepId, ...payload });
        } else {
          addStepMutation.mutate({ moduleKey, ...payload });
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to save step.");
      }
    };
    const isPending = addStepMutation.isPending || updateStepMutation.isPending;
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>{panelTitle}</Text>
          <Pressable onPress={() => { setEditingDbStep(null); setShowAddStep(false); resetStepForm(); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Steps</Text>
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <SectionHeader title="Step Photo" />
          <View style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
            {sVehicleImageUrl ? (
              <Image source={{ uri: sVehicleImageUrl }} style={{ width: "100%", height: 160 }} resizeMode="cover" />
            ) : (
              <View style={{ height: 80, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>No custom photo set — default illustration shown</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={async () => {
              try {
                const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!perm.granted) { Alert.alert("Permission required", "Please allow photo library access to upload a step photo."); return; }
                const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.8 });
                if (!result.canceled && result.assets[0]) {
                  setSPhotoUploading(true);
                  const asset = result.assets[0];
                  const formData = new FormData();
                  formData.append("file", { uri: asset.uri, name: "step-photo.jpg", type: "image/jpeg" } as any);
                  const apiBase = getApiBaseUrl();
                  const resp = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData });
                  const json = await resp.json();
                  if (json.url) setSVehicleImageUrl(json.url);
                  else Alert.alert("Upload failed", json.error || "Unknown error");
                }
              } catch (e: any) { Alert.alert("Error", e.message); }
              finally { setSPhotoUploading(false); }
            }}
            disabled={sPhotoUploading}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 16, opacity: pressed || sPhotoUploading ? 0.7 : 1 })}
          >
            {sPhotoUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ fontSize: 16 }}>📷</Text>}
            <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>{sPhotoUploading ? "Uploading..." : sVehicleImageUrl ? "Change Step Photo" : "Upload Step Photo"}</Text>
          </Pressable>
          <SectionHeader title="Step Title *" />
          <TextInput style={inputStyle} value={sTitle} onChangeText={setSTitle} placeholder="e.g. Apply Degreaser" placeholderTextColor={colors.muted} returnKeyType="next" />
          <SectionHeader title="Instruction *" />
          <TextInput style={[inputStyle, { minHeight: 80 }]} value={sInstruction} onChangeText={setSInstruction} placeholder="Describe what the team member should do..." placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Area Label" />
          <TextInput style={inputStyle} value={sArea} onChangeText={setSArea} placeholder="e.g. 🔧 Engine Bay — Step" placeholderTextColor={colors.muted} />
          <SectionHeader title="Challenge Question" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={sQuestion} onChangeText={setSQuestion} placeholder="What should you do first?" placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Answer Choices" />
          {sChoices.map((c, i) => (
            <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: sCorrectId === c.id ? "#22C55E20" : colors.surface, borderWidth: 1.5, borderColor: sCorrectId === c.id ? "#22C55E" : colors.border, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: sCorrectId === c.id ? "#22C55E" : colors.muted }}>{c.id}</Text>
              </View>
              <TextInput
                style={[inputStyle, { flex: 1, marginBottom: 0 }]}
                value={c.label}
                onChangeText={(val) => { const next = [...sChoices]; next[i] = { ...next[i], label: val }; setSChoices(next); }}
                placeholder={`Option ${c.id}`}
                placeholderTextColor={colors.muted}
              />
              <Pressable onPress={() => setSCorrectId(c.id)} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: sCorrectId === c.id ? "#22C55E" : colors.surface, borderWidth: 1, borderColor: sCorrectId === c.id ? "#22C55E" : colors.border, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: sCorrectId === c.id ? "#fff" : colors.muted }}>✓</Text>
              </Pressable>
            </View>
          ))}
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 12 }}>Tap ✓ to mark the correct answer.</Text>
          <SectionHeader title="Wrong Answer Explanation" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={sWrongExpl} onChangeText={setSWrongExpl} placeholder="❌ Wrong! Explain why..." placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Correct Answer Explanation" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={sCorrectExpl} onChangeText={setSCorrectExpl} placeholder="✅ Correct! Explain why..." placeholderTextColor={colors.muted} multiline />
          <SectionHeader title="Pro Tip" />
          <TextInput style={[inputStyle, { minHeight: 60 }]} value={sProTip} onChangeText={setSProTip} placeholder="💡 Pro Tip: ..." placeholderTextColor={colors.muted} multiline />
          <Pressable onPress={handleSaveDbStep} disabled={isPending} style={({ pressed }) => ({ backgroundColor: "#22C55E", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 8, opacity: pressed || isPending ? 0.8 : 1 })}>
            {isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{isEditing ? "Save Changes" : "Add Step"}</Text>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Main tabbed view ──────────────────────────────────────────────────────
  const EDITOR_TABS: { key: EditorTab; label: string }[] = [
    { key: "card", label: "Card" },
    { key: "tools", label: "Tools" },
    { key: "steps", label: "Steps" },
  ];

  const toolsByCategory = (cat: ToolCategory) => tools.filter((t) => t.category === cat);
  const CATEGORY_CONFIG: Record<ToolCategory, { label: string; emoji: string; color: string }> = {
    tool:     { label: "Tools",     emoji: "🔧", color: "#3B82F6" },
    chemical: { label: "Chemicals", emoji: "🧴", color: "#F59E0B" },
    towel:    { label: "Towels",    emoji: "🧻", color: "#8B5CF6" },
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }} numberOfLines={1}>{mod?.title || "Module"}</Text>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
        {EDITOR_TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setEditorTab(t.key)}
            style={({ pressed }) => ({
              flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center",
              backgroundColor: editorTab === t.key ? colors.primary : "transparent",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: editorTab === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Card Tab ── */}
      {editorTab === "card" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 16 }}>
            <SectionHeader title="Display Title" />
            <TextInput style={inputStyle} value={title} onChangeText={setTitle} placeholder="e.g. Engine Bay" placeholderTextColor={colors.muted} />
            <SectionHeader title="Subtitle" />
            <TextInput style={inputStyle} value={subtitle} onChangeText={setSubtitle} placeholder="e.g. Step 1 — Exterior" placeholderTextColor={colors.muted} />
            <SectionHeader title="Emoji Icon" />
            <TextInput style={inputStyle} value={emoji} onChangeText={setEmoji} placeholder="e.g. 🔧" placeholderTextColor={colors.muted} />
            <SectionHeader title="Intro Video URL" />
            <TextInput style={inputStyle} value={moduleVideoUrl} onChangeText={setModuleVideoUrl} placeholder="https://www.loom.com/share/..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Pressable onPress={handleSaveModuleCard} disabled={updateModuleMutation.isPending} style={({ pressed }) => ({ backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: "center", opacity: pressed || updateModuleMutation.isPending ? 0.8 : 1 })}>
              {updateModuleMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Save Card</Text>}
            </Pressable>
          </View>
          {/* Legacy default steps list */}
          {defaultSteps.length > 0 && (
            <>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Built-in Challenge Steps ({defaultSteps.length})
              </Text>
              <View style={{ gap: 8 }}>
                {defaultSteps.map((step, i) => {
                  const override = overrides.find((o: any) => o.stepIndex === i);
                  const hasOverride = !!override;
                  const isDeleted = deletedStepIndices.includes(i);
                  if (isDeleted) {
                    // Show a greyed-out "deleted" row with a restore button
                    return (
                      <View key={step.id} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, opacity: 0.45 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border + "40", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.muted }}>{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, textDecorationLine: "line-through" }} numberOfLines={1}>{step.title}</Text>
                          <Text style={{ fontSize: 11, color: colors.error ?? "#EF4444", marginTop: 2 }}>🗑 Deleted</Text>
                        </View>
                        <Pressable
                          onPress={() => Alert.alert("Restore Step", `Restore "${step.title}"?`, [
                            { text: "Cancel", style: "cancel" },
                            { text: "Restore", onPress: () => restoreBuiltInStepMutation.mutate({ moduleId: moduleKey, stepIndex: i }) },
                          ])}
                          style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#22C55E20", opacity: pressed ? 0.7 : 1 })}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#22C55E" }}>Restore</Text>
                        </Pressable>
                      </View>
                    );
                  }
                  return (
                    <View key={step.id} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: hasOverride ? "#22C55E60" : colors.border, flexDirection: "row", alignItems: "center" }}>
                      <Pressable onPress={() => openStepEditor(i)} style={({ pressed }) => ({ flex: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.8 : 1 })}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: hasOverride ? "#22C55E20" : colors.border + "40", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 13, fontWeight: "800", color: hasOverride ? "#22C55E" : colors.muted }}>{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{override?.title || step.title}</Text>
                          <Text style={{ fontSize: 11, color: hasOverride ? "#22C55E" : colors.muted, marginTop: 2 }}>{hasOverride ? "✓ Customized" : "Default content"}</Text>
                        </View>
                        <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => Alert.alert("Delete Step", `Remove "${override?.title || step.title}" from this module?\n\nYou can restore it later.`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteBuiltInStepMutation.mutate({ moduleId: moduleKey, stepIndex: i }) },
                        ])}
                        style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 14, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text style={{ fontSize: 18, color: "#EF4444" }}>🗑</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              {overridesQuery.isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Tools Tab ── */}
      {editorTab === "tools" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Category filter */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {(["tool", "chemical", "towel"] as ToolCategory[]).map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              return (
                <Pressable
                  key={cat}
                  onPress={() => setToolCategory(cat)}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
                    backgroundColor: toolCategory === cat ? cfg.color + "20" : colors.surface,
                    borderWidth: 1.5, borderColor: toolCategory === cat ? cfg.color : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontSize: 16 }}>{cfg.emoji}</Text>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: toolCategory === cat ? cfg.color : colors.muted, marginTop: 2 }}>{cfg.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Add button */}
          <Pressable
            onPress={() => { setShowAddTool(true); }}
            style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginBottom: 14, opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ Add {CATEGORY_CONFIG[toolCategory].label.slice(0, -1)}</Text>
          </Pressable>

          {/* Tools list for selected category */}
          {toolsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : (
            <View style={{ gap: 8 }}>
              {toolsByCategory(toolCategory).length === 0 ? (
                <View style={{ padding: 24, alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 24, marginBottom: 8 }}>{CATEGORY_CONFIG[toolCategory].emoji}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>No {CATEGORY_CONFIG[toolCategory].label.toLowerCase()} added yet.</Text>
                </View>
              ) : (
                toolsByCategory(toolCategory).map((tool) => (
                  <View key={tool.id} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    {tool.photoUrl ? (
                      <Image source={{ uri: tool.photoUrl }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.border }} resizeMode="cover" />
                    ) : (
                      <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: CATEGORY_CONFIG[toolCategory].color + "20", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 22 }}>{CATEGORY_CONFIG[toolCategory].emoji}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{tool.name}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{CATEGORY_CONFIG[toolCategory].label.slice(0, -1)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        onPress={() => { setEditToolName(tool.name); setEditToolPhotoUrl(tool.photoUrl || ""); setEditingTool(tool); }}
                        style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary + "20", opacity: pressed ? 0.7 : 1 })}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => Alert.alert("Delete", `Remove "${tool.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteToolMutation.mutate({ id: tool.id }) }])}
                        style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.error + "20", opacity: pressed ? 0.7 : 1 })}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>Del</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Add Tool Modal */}
          <Modal visible={showAddTool} transparent animationType="slide" onRequestClose={() => { setShowAddTool(false); resetToolForm(); }}>
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground, marginBottom: 16 }}>Add {CATEGORY_CONFIG[toolCategory].label.slice(0, -1)}</Text>
                <SectionHeader title="Name *" />
                <TextInput style={inputStyle} value={toolName} onChangeText={setToolName} placeholder={`e.g. ${toolCategory === "tool" ? "Detail Brush" : toolCategory === "chemical" ? "All-Purpose Cleaner" : "Microfiber Towel"}`} placeholderTextColor={colors.muted} returnKeyType="next" />
                <SectionHeader title="Photo URL (optional)" />
                <TextInput style={inputStyle} value={toolPhotoUrl} onChangeText={setToolPhotoUrl} placeholder="https://..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" />
                <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => { setShowAddTool(false); resetToolForm(); }} style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!toolName.trim()) { Alert.alert("Required", "Name is required."); return; }
                      addToolMutation.mutate({ moduleKey, name: toolName.trim(), photoUrl: toolPhotoUrl.trim() || undefined, category: toolCategory });
                    }}
                    disabled={addToolMutation.isPending}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: pressed || addToolMutation.isPending ? 0.7 : 1 })}
                  >
                    {addToolMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Add</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/* Edit Tool Modal */}
          <Modal visible={editingTool !== null} transparent animationType="slide" onRequestClose={() => setEditingTool(null)}>
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground, marginBottom: 16 }}>Edit {editingTool ? CATEGORY_CONFIG[editingTool.category as ToolCategory]?.label.slice(0, -1) : ""}</Text>
                <SectionHeader title="Name *" />
                <TextInput style={inputStyle} value={editToolName} onChangeText={setEditToolName} placeholder="Name" placeholderTextColor={colors.muted} returnKeyType="next" />
                <SectionHeader title="Photo URL (optional)" />
                <TextInput style={inputStyle} value={editToolPhotoUrl} onChangeText={setEditToolPhotoUrl} placeholder="https://..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" />
                <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => setEditingTool(null)} style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!editToolName.trim()) { Alert.alert("Required", "Name is required."); return; }
                      updateToolMutation.mutate({ id: editingTool.id, name: editToolName.trim(), photoUrl: editToolPhotoUrl.trim() || null });
                    }}
                    disabled={updateToolMutation.isPending}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: pressed || updateToolMutation.isPending ? 0.7 : 1 })}
                  >
                    {updateToolMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Save</Text>}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}

      {/* ── Steps Tab ── */}
      {editorTab === "steps" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <Pressable
            onPress={() => { resetStepForm(); setShowAddStep(true); }}
            style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginBottom: 14, opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ Add Step</Text>
          </Pressable>
          {dbStepsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : dbSteps.length === 0 ? (
            <View style={{ padding: 24, alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>📋</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>No steps yet</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>Add steps to build this module's training flow.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {dbSteps.map((step, index) => (
                <View key={step.stepId} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                  <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.primary }}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{step.title}</Text>
                      {step.area ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{step.area}</Text> : null}
                    </View>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      <Pressable onPress={() => moveDbStep(index, "up")} disabled={index === 0} style={({ pressed }) => ({ opacity: pressed || index === 0 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↑</Text>
                      </Pressable>
                      <Pressable onPress={() => moveDbStep(index, "down")} disabled={index === dbSteps.length - 1} style={({ pressed }) => ({ opacity: pressed || index === dbSteps.length - 1 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↓</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Pressable onPress={() => openEditStep(step)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1, borderRightWidth: 1, borderRightColor: colors.border })}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>✏️ Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => Alert.alert("Delete Step", `Remove "${step.title}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteStepMutation.mutate({ stepId: step.stepId }) }])}
                      style={({ pressed }) => ({ paddingHorizontal: 20, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>🗑️ Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Module Editor (name, description, video, quiz title) ──────────────────────
function ModuleEditor({ module, onClose, onDeleted }: { module: any; onClose: () => void; onDeleted: () => void }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const updateMutation = trpc.training.updateModule.useMutation({
    onSuccess: () => { utils.training.getAllModules.invalidate(); Alert.alert("Saved", "Module updated."); },
    onError: () => Alert.alert("Error", "Failed to save."),
  });
  const deleteMutation = trpc.training.deleteModule.useMutation({
    onSuccess: () => { utils.training.getAllModules.invalidate(); onDeleted(); },
    onError: () => Alert.alert("Error", "Failed to delete module."),
  });

  const [name, setName] = useState(module.name || "");
  const [description, setDescription] = useState(module.description || "");
  const [videoUrl, setVideoUrl] = useState(module.videoUrl || "");
  const [quizTitle, setQuizTitle] = useState(module.quizTitle || "");

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Required", "Module name is required."); return; }
    updateMutation.mutate({
      moduleId: module.moduleId,
      name: name.trim(),
      description: description.trim() || undefined,
      videoUrl: videoUrl.trim() || null,
      quizTitle: quizTitle.trim() || null,
    });
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Module",
      `Delete "${module.name}"? This will permanently remove all steps, quiz questions, and team member progress for this module.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate({ moduleId: module.moduleId }) },
      ]
    );
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 8,
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>Edit Module</Text>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <SectionHeader title="Module Name" />
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Exterior Wash" placeholderTextColor={colors.muted} />
        <SectionHeader title="Description (optional)" />
        <TextInput style={[inputStyle, { minHeight: 60 }]} value={description} onChangeText={setDescription} placeholder="Brief description of this module..." placeholderTextColor={colors.muted} multiline />
        <SectionHeader title="Intro Video URL (optional)" />
        <TextInput style={inputStyle} value={videoUrl} onChangeText={setVideoUrl} placeholder="https://www.loom.com/share/..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 12 }}>Paste a Loom or YouTube URL. This video plays as the module introduction before any steps.</Text>
        <SectionHeader title="Quiz Title (optional)" />
        <TextInput style={inputStyle} value={quizTitle} onChangeText={setQuizTitle} placeholder={`e.g. ${name || "Module"} Knowledge Check`} placeholderTextColor={colors.muted} />
        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 16 }}>Custom title shown at the top of the quiz. Defaults to module name if left blank.</Text>

        <Pressable
          onPress={handleSave}
          disabled={updateMutation.isPending}
          style={({ pressed }) => ({ backgroundColor: "#22C55E", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12, opacity: pressed || updateMutation.isPending ? 0.8 : 1 })}
        >
          {updateMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save Changes</Text>}
        </Pressable>

        <Pressable
          onPress={handleDelete}
          disabled={deleteMutation.isPending}
          style={({ pressed }) => ({ backgroundColor: "#FEE2E2", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 32, opacity: pressed || deleteMutation.isPending ? 0.8 : 1 })}
        >
          {deleteMutation.isPending ? <ActivityIndicator color="#DC2626" /> : <Text style={{ color: "#DC2626", fontWeight: "700", fontSize: 15 }}>🗑️ Delete Module</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── Add Module Form ───────────────────────────────────────────────────────────
function AddModuleForm({ onClose, onCreated }: { onClose: () => void; onCreated: (moduleId: string) => void }) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const createMutation = trpc.training.createModule.useMutation({
    onSuccess: (data) => { utils.training.getAllModules.invalidate(); onCreated(data.moduleId); },
    onError: () => Alert.alert("Error", "Failed to create module."),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [quizTitle, setQuizTitle] = useState("");

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Required", "Module name is required."); return; }
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      videoUrl: videoUrl.trim() || null,
      quizTitle: quizTitle.trim() || null,
    });
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 8,
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.foreground }}>New Module</Text>
        <Pressable onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>← Back</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <SectionHeader title="Module Name *" />
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Paint Decontamination" placeholderTextColor={colors.muted} autoFocus />
        <SectionHeader title="Description (optional)" />
        <TextInput style={[inputStyle, { minHeight: 60 }]} value={description} onChangeText={setDescription} placeholder="Brief description..." placeholderTextColor={colors.muted} multiline />
        <SectionHeader title="Intro Video URL (optional)" />
        <TextInput style={inputStyle} value={videoUrl} onChangeText={setVideoUrl} placeholder="https://www.loom.com/share/..." placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
        <SectionHeader title="Quiz Title (optional)" />
        <TextInput style={inputStyle} value={quizTitle} onChangeText={setQuizTitle} placeholder={`e.g. ${name || "Module"} Knowledge Check`} placeholderTextColor={colors.muted} />
        <Pressable
          onPress={handleCreate}
          disabled={createMutation.isPending}
          style={({ pressed }) => ({ backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 8, marginBottom: 32, opacity: pressed || createMutation.isPending ? 0.8 : 1 })}
        >
          {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Create Module</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ── Main Admin Training Screen ────────────────────────────────────────────────
export default function AdminTrainingScreen() {
  const colors = useColors();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>("progress");
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editingStepsModuleId, setEditingStepsModuleId] = useState<string | null>(null);
  const [showAddModule, setShowAddModule] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [editingInteractiveKey, setEditingInteractiveKey] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [newEmoji, setNewEmoji] = useState("📋");

  // ── Folder state ──────────────────────────────────────────────────────────
  const [showAddFolderModal, setShowAddFolderModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<any | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderEmoji, setFolderEmoji] = useState("📁");
  const [assigningModule, setAssigningModule] = useState<any | null>(null);

  const foldersQuery = trpc.training.getFolders.useQuery(undefined, { staleTime: 60 * 1000 });
  const folders: any[] = (foldersQuery.data || []) as any[];

  const createFolderMutation = trpc.training.createFolder.useMutation({
    onSuccess: () => { foldersQuery.refetch(); setShowAddFolderModal(false); setFolderName(""); setFolderEmoji("📁"); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const updateFolderMutation = trpc.training.updateFolder.useMutation({
    onSuccess: () => { foldersQuery.refetch(); setEditingFolder(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteFolderMutation = trpc.training.deleteFolder.useMutation({
    onSuccess: () => { foldersQuery.refetch(); interactiveQuery.refetch(); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const assignModuleMutation = trpc.training.assignModuleToFolder.useMutation({
    onSuccess: () => { foldersQuery.refetch(); interactiveQuery.refetch(); setAssigningModule(null); },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const reorderFoldersMutation = trpc.training.reorderFolders.useMutation({
    onSuccess: () => foldersQuery.refetch(),
  });

  const moveFolder = (index: number, direction: "up" | "down") => {
    const newFolders = [...folders];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newFolders.length) return;
    [newFolders[index], newFolders[swapIndex]] = [newFolders[swapIndex], newFolders[index]];
    reorderFoldersMutation.mutate(newFolders.map((f, idx) => ({ id: f.id, orderIndex: idx })));
  };

  const progressQuery = trpc.training.getAllEmployeesProgress.useQuery(undefined, { staleTime: 60 * 1000 });
  const modulesQuery = trpc.training.getAllModules.useQuery(undefined, { staleTime: 5 * 60 * 1000, refetchOnMount: false });
  const interactiveQuery = trpc.training.getAllInteractiveModules.useQuery(undefined, { staleTime: 5 * 60 * 1000, refetchOnMount: false });
  const reorderMutation = trpc.training.reorderModules.useMutation({
    onSuccess: () => modulesQuery.refetch(),
  });
  const reorderInteractiveMutation = trpc.training.reorderInteractiveModules.useMutation({
    onSuccess: () => interactiveQuery.refetch(),
  });
  const resetMutation = trpc.training.resetEmployeeProgress.useMutation({
    onSuccess: () => progressQuery.refetch(),
  });
  const createInteractiveMutation = trpc.training.createInteractiveModule.useMutation({
    onSuccess: () => {
      interactiveQuery.refetch();
      setShowAddModal(false);
      setNewTitle("");
      setNewSubtitle("");
      setNewEmoji("📋");
      Alert.alert("Added", "New interactive module created.");
    },
    onError: (e) => Alert.alert("Error", e.message),
  });
  const deleteInteractiveMutation = trpc.training.deleteInteractiveModule.useMutation({
    onSuccess: () => { interactiveQuery.refetch(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const progressData = progressQuery.data || [];
  const modules: any[] = (modulesQuery.data || []) as any[];
  const interactiveMods: any[] = (interactiveQuery.data || []) as any[];

  const handleResetProgress = (employeeId: string, moduleId: string, employeeName: string, moduleName: string) => {
    Alert.alert(
      "Reset Progress",
      `Reset ${employeeName}'s progress for "${moduleName}"? This will also delete their quiz attempts for this module.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: () => resetMutation.mutate({ employeeId, moduleId }) },
      ]
    );
  };

  const moveModule = (index: number, direction: "up" | "down") => {
    const newModules = [...modules];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newModules.length) return;
    [newModules[index], newModules[swapIndex]] = [newModules[swapIndex], newModules[index]];
    reorderMutation.mutate({ orderedIds: newModules.map((m) => m.moduleId) });
  };

  const moveInteractiveModule = (index: number, direction: "up" | "down") => {
    const arr = [...interactiveMods];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= arr.length) return;
    [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
    reorderInteractiveMutation.mutate({ orderedKeys: arr.map((m) => m.moduleKey) });
  };

  // ── Sub-views ──────────────────────────────────────────────────────────────
  if (editingInteractiveKey) {
    const mod = interactiveMods.find((m) => m.moduleKey === editingInteractiveKey);
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Training Admin</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
          <InteractiveModuleEditor mod={mod} onClose={() => setEditingInteractiveKey(null)} />
        </View>
      </ScreenContainer>
    );
  }

  if (showAddModule) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Training Admin</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
          <AddModuleForm
            onClose={() => setShowAddModule(false)}
            onCreated={(moduleId) => { setShowAddModule(false); setEditingStepsModuleId(moduleId); }}
          />
        </View>
      </ScreenContainer>
    );
  }

  if (editingModuleId) {
    const mod = modules.find((m) => m.moduleId === editingModuleId);
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Training Admin</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
          <ModuleEditor
            module={mod}
            onClose={() => setEditingModuleId(null)}
            onDeleted={() => setEditingModuleId(null)}
          />
        </View>
      </ScreenContainer>
    );
  }

  if (editingStepsModuleId) {
    const mod = modules.find((m) => m.moduleId === editingStepsModuleId);
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Training Admin</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
          <StepEditor
            moduleId={editingStepsModuleId}
            moduleName={mod?.name || editingStepsModuleId}
            onClose={() => setEditingStepsModuleId(null)}
          />
        </View>
      </ScreenContainer>
    );
  }

  if (selectedModuleId) {
    const mod = modules.find((m: any) => m.moduleId === selectedModuleId);
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>Training Admin</Text>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <QuizQuestionEditor moduleId={selectedModuleId} moduleName={mod?.name || selectedModuleId} onClose={() => setSelectedModuleId(null)} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>Training Admin</Text>
          {/* Preview as Detailer button */}
          <Pressable
            onPress={() => router.push("/training")}
            style={({ pressed }) => ({
              backgroundColor: "#FEF3C7",
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderWidth: 1,
              borderColor: "#F59E0B",
              opacity: pressed ? 0.8 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            })}
          >
            <Text style={{ fontSize: 12 }}>👁</Text>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#92400E" }}>Preview</Text>
          </Pressable>
        </View>
        {/* Tab bar */}
        <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
          {([
            { key: "progress", label: "Progress" },
            { key: "interactive", label: "Interactive" },
            { key: "folders",  label: "Folders" },
            { key: "quiz",     label: "Quiz" },
          ] as { key: AdminTab; label: string }[]).map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setActiveTab(key)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 8,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: activeTab === key ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: activeTab === key ? colors.primary : colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: activeTab === key ? "#fff" : colors.foreground }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Team Progress Tab ── */}
      {activeTab === "progress" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {progressQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : progressData.length === 0 ? (
            <View style={{ alignItems: "center", marginTop: 40 }}>
              <Text style={{ fontSize: 14, color: colors.muted }}>No progress data yet.</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {(progressData as any[]).map((emp) => {
                const isExpanded = expandedEmployee === emp.employeeId;
                const pct = emp.progressPercent;
                const hasReached50 = emp.hasReached50 || pct >= 50;
                const quizScores: any[] = emp.quizScores || [];
                return (
                  <View key={emp.employeeId} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: hasReached50 ? "#22C55E" : colors.border, overflow: "hidden" }}>
                    <Pressable
                      onPress={() => setExpandedEmployee(isExpanded ? null : emp.employeeId)}
                      style={({ pressed }) => ({ padding: 14, opacity: pressed ? 0.85 : 1 })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hasReached50 ? "#D1FAE5" : `${colors.primary}20`, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 16, fontWeight: "800", color: hasReached50 ? "#16A34A" : colors.primary }}>
                            {emp.fullName?.charAt(0) || "?"}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.fullName}</Text>
                            {hasReached50 && (
                              <View style={{ backgroundColor: "#D1FAE5", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: "800", color: "#16A34A" }}>✓ DAY 1 READY</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 12, color: colors.muted }}>{emp.city} · {emp.completedModules}/{emp.totalModules} interactives</Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          <Text style={{ fontSize: 16, fontWeight: "800", color: pct === 100 ? "#22C55E" : pct >= 50 ? colors.primary : colors.muted }}>
                            {pct}%
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.muted }}>{isExpanded ? "▲" : "▼"}</Text>
                        </View>
                      </View>
                      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 10, overflow: "hidden" }}>
                        <View style={{ height: "100%", width: `${pct}%`, backgroundColor: pct === 100 ? "#22C55E" : pct >= 50 ? "#22C55E" : colors.primary, borderRadius: 2 }} />
                      </View>
                      {!hasReached50 && (
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                          {Math.max(0, Math.ceil(emp.totalModules * 0.5) - emp.completedModules)} more module{Math.max(0, Math.ceil(emp.totalModules * 0.5) - emp.completedModules) !== 1 ? "s" : ""} to unlock first day
                        </Text>
                      )}
                    </Pressable>
                    {isExpanded && (
                      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 8 }}>
                        {/* Quiz Scores Section */}
                        {quizScores.length > 0 && (
                          <View style={{ marginBottom: 8 }}>
                            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Quiz Scores</Text>
                            {quizScores.map((qs: any) => (
                              <View key={qs.moduleId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: qs.passed ? "#F0FDF4" : colors.background, borderRadius: 10, borderWidth: 1, borderColor: qs.passed ? "#22C55E" : colors.border, marginBottom: 6 }}>
                                <Text style={{ fontSize: 16 }}>{qs.passed ? "🏆" : "📝"}</Text>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{qs.quizTitle}</Text>
                                  <Text style={{ fontSize: 11, color: colors.muted }}>
                                    {qs.attempts > 0 ? `${qs.attempts} attempt${qs.attempts !== 1 ? "s" : ""}` : "Not taken"}
                                  </Text>
                                </View>
                                {qs.bestScore !== null ? (
                                  <View style={{ alignItems: "center" }}>
                                    <Text style={{ fontSize: 16, fontWeight: "900", color: qs.passed ? "#16A34A" : "#EF4444" }}>{qs.bestScore}%</Text>
                                    <Text style={{ fontSize: 10, fontWeight: "700", color: qs.passed ? "#16A34A" : "#EF4444" }}>{qs.passed ? "PASS" : "FAIL"}</Text>
                                  </View>
                                ) : (
                                  <Text style={{ fontSize: 11, color: colors.muted }}>—</Text>
                                )}
                              </View>
                            ))}
                          </View>
                        )}
                        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Module Progress</Text>
                        {(emp.moduleProgress || []).map((mod: any) => {
                          const cfg = MODULE_CONFIG[mod.moduleId] || DEFAULT_CFG;
                          return (
                            <View key={mod.moduleId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                              <Text style={{ fontSize: 18 }}>{cfg.emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{mod.moduleName}</Text>
                                <Text style={{ fontSize: 11, color: colors.muted }}>
                                  {mod.isCompleted ? "✓ Completed" : "Not completed"}
                                  {mod.bestScore !== null ? ` · Best quiz: ${mod.bestScore}%` : ""}
                                  {mod.attempts > 0 ? ` · ${mod.attempts} attempt${mod.attempts > 1 ? "s" : ""}` : ""}
                                </Text>
                              </View>
                              {mod.isCompleted && (
                                <Pressable
                                  onPress={() => handleResetProgress(emp.employeeId, mod.moduleId, emp.fullName, mod.moduleName)}
                                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                                >
                                  <Text style={{ fontSize: 11, color: "#EF4444", fontWeight: "600" }}>Reset</Text>
                                </Pressable>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Modules Tab (add/remove/reorder/edit steps) ── */}
      {activeTab === "modules" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 14, lineHeight: 20 }}>
            Manage training modules — add new modules, edit content, reorder with ↑↓, or delete. Use ✏️ to edit module details and 📋 to manage steps.
          </Text>
          {modulesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ gap: 10, marginBottom: 16 }}>
              {modules.map((mod: any, index: number) => {
                const cfg = MODULE_CONFIG[mod.moduleId] || DEFAULT_CFG;
                return (
                  <View key={mod.moduleId} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                    <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `${cfg.color}20`, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 22 }}>{cfg.emoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{mod.name}</Text>
                        <Text style={{ fontSize: 11, color: mod.videoUrl ? "#16A34A" : colors.muted, marginTop: 2 }}>
                          {mod.videoUrl ? "🎬 Intro video" : "No intro video"}{mod.quizTitle ? ` · Quiz: "${mod.quizTitle}"` : ""}
                        </Text>
                      </View>
                      {/* Reorder arrows */}
                      <View style={{ flexDirection: "row", gap: 2 }}>
                        <Pressable onPress={() => moveModule(index, "up")} disabled={index === 0} style={({ pressed }) => ({ opacity: pressed || index === 0 ? 0.3 : 1, padding: 6 })}>
                          <Text style={{ fontSize: 16 }}>↑</Text>
                        </Pressable>
                        <Pressable onPress={() => moveModule(index, "down")} disabled={index === modules.length - 1} style={({ pressed }) => ({ opacity: pressed || index === modules.length - 1 ? 0.3 : 1, padding: 6 })}>
                          <Text style={{ fontSize: 16 }}>↓</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Pressable onPress={() => setEditingModuleId(mod.moduleId)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>✏️ Edit</Text>
                      </Pressable>
                      <View style={{ width: 1, backgroundColor: colors.border }} />
                      <Pressable onPress={() => setEditingStepsModuleId(mod.moduleId)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: "#8B5CF6" }}>📋 Steps</Text>
                      </Pressable>
                      <View style={{ width: 1, backgroundColor: colors.border }} />
                      <Pressable onPress={() => setSelectedModuleId(mod.moduleId)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: "#0EA5E9" }}>📝 Quiz</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {/* Add Module button */}
          <Pressable
            onPress={() => setShowAddModule(true)}
            style={({ pressed }) => ({ backgroundColor: colors.surface, paddingVertical: 16, borderRadius: 14, alignItems: "center", borderWidth: 2, borderColor: colors.primary, borderStyle: "dashed", opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.primary }}>+ Add New Module</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ── Interactive Modules Tab ── */}
      {activeTab === "interactive" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 20, flex: 1 }}>
              Add, edit, reorder, or remove interactive training modules.
            </Text>
            <Pressable
              onPress={() => setShowAddModal(true)}
              style={({ pressed }) => ({
                backgroundColor: colors.primary,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 8,
                marginLeft: 10,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Add</Text>
            </Pressable>
          </View>
          {interactiveQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ gap: 10 }}>
              {interactiveMods.map((mod: any, index: number) => (
                <View key={mod.moduleKey} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: mod.color + "40", overflow: "hidden" }}>
                  <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: mod.bgColor, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>{mod.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{mod.title}</Text>
                      <Text style={{ fontSize: 11, color: mod.color, fontWeight: "600", marginTop: 2 }}>{mod.subtitle}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>🎯 {mod.stepCount} interactive challenges</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      <Pressable onPress={() => moveInteractiveModule(index, "up")} disabled={index === 0} style={({ pressed }) => ({ opacity: pressed || index === 0 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↑</Text>
                      </Pressable>
                      <Pressable onPress={() => moveInteractiveModule(index, "down")} disabled={index === interactiveMods.length - 1} style={({ pressed }) => ({ opacity: pressed || index === interactiveMods.length - 1 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↓</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Pressable onPress={() => setEditingInteractiveKey(mod.moduleKey)} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1, borderRightWidth: 1, borderRightColor: colors.border })}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>✏️ Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setAssigningModule(mod)}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1, borderRightWidth: 1, borderRightColor: colors.border })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: "#F59E0B" }}>📁 Folder</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          "Delete Module",
                          `Remove "${mod.title}" from interactive training? This cannot be undone.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteInteractiveMutation.mutate({ moduleKey: mod.moduleKey }) },
                          ]
                        );
                      }}
                      style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>🗑️ Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── Add Module Modal ── */}
          <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 18 }}>New Interactive Module</Text>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>TITLE *</Text>
                <TextInput
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="e.g. Door Jambs"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }}
                  returnKeyType="next"
                />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>SUBTITLE (optional)</Text>
                <TextInput
                  value={newSubtitle}
                  onChangeText={setNewSubtitle}
                  placeholder="e.g. Step 7 — Exterior"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }}
                  returnKeyType="next"
                />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>EMOJI</Text>
                <TextInput
                  value={newEmoji}
                  onChangeText={setNewEmoji}
                  placeholder="📋"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, fontSize: 22, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 20, width: 80 }}
                  returnKeyType="done"
                />
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => { setShowAddModal(false); setNewTitle(""); setNewSubtitle(""); setNewEmoji("📋"); }}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!newTitle.trim()) { Alert.alert("Required", "Please enter a module title."); return; }
                      createInteractiveMutation.mutate({ title: newTitle.trim(), subtitle: newSubtitle.trim(), emoji: newEmoji.trim() || "📋" });
                    }}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: pressed || createInteractiveMutation.isPending ? 0.7 : 1 })}
                  >
                    {createInteractiveMutation.isPending ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Add Module</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}

      {/* ── Folders Tab ── */}
      {activeTab === "folders" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Header row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 20, flex: 1 }}>
              Create folders to organise modules. Assign modules from the Interactive tab or tap Assign below.
            </Text>
            <Pressable
              onPress={() => { setFolderName(""); setFolderEmoji("📁"); setShowAddFolderModal(true); }}
              style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10, opacity: pressed ? 0.8 : 1 })}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ New Folder</Text>
            </Pressable>
          </View>

          {foldersQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : folders.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
              <Text style={{ fontSize: 32 }}>📁</Text>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>No folders yet</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>Tap "+ New Folder" to create your first folder.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {folders.map((folder: any, index: number) => (
                <View key={folder.id} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                  <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary + "20", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 24 }}>{folder.emoji || "📁"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{folder.name}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{(folder.modules || []).length} modules</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      <Pressable onPress={() => moveFolder(index, "up")} disabled={index === 0} style={({ pressed }) => ({ opacity: pressed || index === 0 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↑</Text>
                      </Pressable>
                      <Pressable onPress={() => moveFolder(index, "down")} disabled={index === folders.length - 1} style={({ pressed }) => ({ opacity: pressed || index === folders.length - 1 ? 0.3 : 1, padding: 6 })}>
                        <Text style={{ fontSize: 16 }}>↓</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Pressable
                      onPress={() => { setEditingFolder(folder); setFolderName(folder.name); setFolderEmoji(folder.emoji || "📁"); }}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1, borderRightWidth: 1, borderRightColor: colors.border })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>✏️ Rename</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => Alert.alert("Delete Folder", `Delete "${folder.name}"? Modules inside will be unassigned but not deleted.`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteFolderMutation.mutate({ id: folder.id }) },
                      ])}
                      style={({ pressed }) => ({ paddingHorizontal: 20, paddingVertical: 10, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>🗑️ Delete</Text>
                    </Pressable>
                  </View>
                  {(folder.modules || []).length > 0 && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 10, gap: 6 }}>
                      {(folder.modules || []).map((mod: any) => (
                        <View key={mod.moduleKey} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.background, borderRadius: 8, padding: 8 }}>
                          <Text style={{ fontSize: 16 }}>{mod.emoji || "📋"}</Text>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1 }} numberOfLines={1}>{mod.title}</Text>
                          <Pressable
                            onPress={() => setAssigningModule(mod)}
                            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border })}
                          >
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>Move</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Unassigned modules */}
          {(() => {
            const assignedKeys = new Set(folders.flatMap((f: any) => (f.modules || []).map((m: any) => m.moduleKey)));
            const interactiveMods2: any[] = (interactiveQuery.data || []) as any[];
            const unassigned = interactiveMods2.filter((m: any) => !assignedKeys.has(m.moduleKey));
            if (unassigned.length === 0) return null;
            return (
              <View style={{ marginTop: 20 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Unassigned ({unassigned.length})</Text>
                <View style={{ gap: 8 }}>
                  {unassigned.map((mod: any) => (
                    <View key={mod.moduleKey} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 20 }}>{mod.emoji || "📋"}</Text>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 1 }} numberOfLines={1}>{mod.title}</Text>
                      <Pressable
                        onPress={() => setAssigningModule(mod)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary + "20", borderWidth: 1, borderColor: colors.primary + "40" })}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>📁 Assign</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* Create / Edit Folder Modal */}
          <Modal visible={showAddFolderModal || editingFolder !== null} transparent animationType="slide" onRequestClose={() => { setShowAddFolderModal(false); setEditingFolder(null); }}>
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 18 }}>
                  {editingFolder ? "Edit Folder" : "New Folder"}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>FOLDER NAME</Text>
                <TextInput
                  value={folderName}
                  onChangeText={setFolderName}
                  placeholder="e.g. Exterior"
                  placeholderTextColor={colors.muted}
                  autoFocus
                  style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }}
                />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>EMOJI</Text>
                <TextInput
                  value={folderEmoji}
                  onChangeText={setFolderEmoji}
                  placeholder="📁"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.background, borderRadius: 10, padding: 12, fontSize: 22, color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 20, width: 80 }}
                />
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => { setShowAddFolderModal(false); setEditingFolder(null); }}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!folderName.trim()) { Alert.alert("Required", "Please enter a folder name."); return; }
                      if (editingFolder) {
                        updateFolderMutation.mutate({ id: editingFolder.id, name: folderName.trim(), emoji: folderEmoji.trim() || "📁" });
                      } else {
                        createFolderMutation.mutate({ name: folderName.trim(), emoji: folderEmoji.trim() || "📁" });
                      }
                    }}
                    style={({ pressed }) => ({ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", opacity: pressed || createFolderMutation.isPending || updateFolderMutation.isPending ? 0.7 : 1 })}
                  >
                    {(createFolderMutation.isPending || updateFolderMutation.isPending) ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{editingFolder ? "Save" : "Create Folder"}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/* Assign Module to Folder Modal */}
          <Modal visible={assigningModule !== null} transparent animationType="slide" onRequestClose={() => setAssigningModule(null)}>
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>Move to Folder</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 18 }}>{assigningModule?.title}</Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  <View style={{ gap: 8 }}>
                    {folders.map((folder: any) => (
                      <Pressable
                        key={folder.id}
                        onPress={() => assignModuleMutation.mutate({ moduleKey: assigningModule.moduleKey, folderId: folder.id })}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 })}
                      >
                        <Text style={{ fontSize: 22 }}>{folder.emoji || "📁"}</Text>
                        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, flex: 1 }}>{folder.name}</Text>
                        <Text style={{ fontSize: 12, color: colors.muted }}>{(folder.modules || []).length} modules</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => assignModuleMutation.mutate({ moduleKey: assigningModule.moduleKey, folderId: null })}
                      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 })}
                    >
                      <Text style={{ fontSize: 22 }}>🚫</Text>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted, flex: 1 }}>Remove from folder</Text>
                    </Pressable>
                  </View>
                </ScrollView>
                <Pressable
                  onPress={() => setAssigningModule(null)}
                  style={({ pressed }) => ({ marginTop: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}

      {/* ── Quiz Tab ── */}
      {activeTab === "quiz" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 14, lineHeight: 20 }}>
            Select a module to manage its quiz questions and title.
          </Text>
          {modulesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ gap: 10 }}>
              {modules.map((mod: any) => {
                const cfg = MODULE_CONFIG[mod.moduleId] || DEFAULT_CFG;
                return (
                  <Pressable
                    key={mod.moduleId}
                    onPress={() => setSelectedModuleId(mod.moduleId)}
                    style={({ pressed }) => ({
                      backgroundColor: colors.surface,
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: colors.border,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `${cfg.color}20`, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 22 }}>{cfg.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{mod.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                        {mod.quizTitle ? `Quiz: "${mod.quizTitle}"` : "Default quiz title"}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
