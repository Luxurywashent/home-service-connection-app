import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Loads interactive step overrides from the DB for a given module.
 * Returns a function `applyOverrides(steps)` that merges DB overrides
 * onto the hardcoded default steps array.
 *
 * Also applies choiceLabels overrides: stored as JSON string of
 * [{ id, label }] array, merged onto each step's choices array.
 *
 * Usage:
 *   const { applyOverrides } = useStepOverrides("engine-bay");
 *   const steps = applyOverrides(DEFAULT_STEPS);
 */
export function useStepOverrides(moduleId: string) {
  const query = trpc.training.getInteractiveOverrides.useQuery(
    { moduleId },
    { staleTime: 30 * 1000 }
  );

  const overrides: any[] = query.data || [];

  const applyOverrides = useMemo(() => {
    return <T extends {
      title?: string;
      instruction?: string;
      area?: string;
      question?: string;
      proTip?: string;
      choices?: Array<{ id: string; label: string; image?: string }>;
      correctId?: string;
      wrongExplanation?: string;
      correctExplanation?: string;
    }>(steps: T[]): T[] => {
      if (overrides.length === 0) return steps;
      return steps.map((step, i) => {
        const override = overrides.find((o) => o.stepIndex === i);
        if (!override) return step;

        // Parse choiceLabels JSON if present: [{ id, label, correctId?, wrongExplanation?, correctExplanation? }]
        let choiceOverrides: any[] | null = null;
        if (override.choiceLabels) {
          try {
            choiceOverrides = JSON.parse(override.choiceLabels);
          } catch {
            choiceOverrides = null;
          }
        }

        // Merge choices if override present
        let mergedChoices = step.choices;
        let mergedCorrectId = step.correctId;
        let mergedWrongExplanation = step.wrongExplanation;
        let mergedCorrectExplanation = step.correctExplanation;

        if (choiceOverrides && Array.isArray(choiceOverrides)) {
          // Update labels for matching choice IDs
          if (step.choices && choiceOverrides.length > 0) {
            mergedChoices = step.choices.map((c) => {
              const co = choiceOverrides!.find((o) => o.id === c.id);
              return co ? { ...c, label: co.label ?? c.label } : c;
            });
          }
          // Check for correctId, wrongExplanation, correctExplanation in the override payload
          const meta = choiceOverrides.find((o) => o._meta);
          if (meta) {
            if (meta.correctId) mergedCorrectId = meta.correctId;
            if (meta.wrongExplanation) mergedWrongExplanation = meta.wrongExplanation;
            if (meta.correctExplanation) mergedCorrectExplanation = meta.correctExplanation;
          }
        }

        return {
          ...step,
          ...(override.title       ? { title: override.title }             : {}),
          ...(override.instruction ? { instruction: override.instruction } : {}),
          ...(override.area        ? { area: override.area }               : {}),
          ...(override.question    ? { question: override.question }       : {}),
          ...(override.proTip      ? { proTip: override.proTip }           : {}),
          ...(override.vehicleImageUrl ? { vehicleImageUrl: override.vehicleImageUrl } : {}),
          ...(override.videoUrl ? { videoUrl: override.videoUrl } : {}),
          ...(mergedChoices !== step.choices ? { choices: mergedChoices } : {}),
          ...(mergedCorrectId !== step.correctId ? { correctId: mergedCorrectId } : {}),
          ...(mergedWrongExplanation !== step.wrongExplanation ? { wrongExplanation: mergedWrongExplanation } : {}),
          ...(mergedCorrectExplanation !== step.correctExplanation ? { correctExplanation: mergedCorrectExplanation } : {}),
        };
      });
    };
  }, [overrides]);

  // Module-level video URL: stored at stepIndex -1 by convention
  const moduleVideoOverride = overrides.find((o) => o.stepIndex === -1);
  const moduleVideoUrl: string | null = moduleVideoOverride?.videoUrl ?? null;

  return { applyOverrides, isLoading: query.isLoading, moduleVideoUrl };
}
