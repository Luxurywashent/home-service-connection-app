import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { trainingModulesData, trainingToolsData, trainingStepsData } from "./training-seed-data";

describe("Training Module Data", () => {
  describe("Training Modules", () => {
    it("should have exactly 14 training modules", () => {
      expect(trainingModulesData).toHaveLength(14);
    });

    it("should have all required module fields", () => {
      trainingModulesData.forEach((module) => {
        expect(module).toHaveProperty("moduleId");
        expect(module).toHaveProperty("name");
        expect(module).toHaveProperty("description");
        expect(module).toHaveProperty("icon");
        expect(module).toHaveProperty("orderIndex");
      });
    });

    it("should have unique module IDs", () => {
      const ids = trainingModulesData.map((m) => m.moduleId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have sequential order indices", () => {
      const orders = trainingModulesData.map((m) => m.orderIndex).sort((a, b) => a - b);
      expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it("should have all modules named correctly", () => {
      const expectedNames = [
        "Engine Bay",
        "Wheels",
        "Tires",
        "Wheel Wells",
        "Exhaust Tips",
        "Door Jambs & Gas Cap",
        "Bug Removal",
        "Tar/Sap Removal",
        "Headliner",
        "Door Panels & Dash",
        "Cup Holders",
        "Final Blow & Wipe",
        "Window Cleaning",
        "Dressing",
      ];
      const actualNames = trainingModulesData.map((m) => m.name);
      expect(actualNames).toEqual(expectedNames);
    });
  });

  describe("Training Tools", () => {
    it("should have tools for each module", () => {
      const moduleIds = new Set(trainingModulesData.map((m) => m.moduleId));
      const toolModuleIds = new Set(trainingToolsData.map((t) => t.moduleId));
      expect(toolModuleIds).toEqual(moduleIds);
    });

    it("should have all required tool fields", () => {
      trainingToolsData.forEach((tool) => {
        expect(tool).toHaveProperty("toolId");
        expect(tool).toHaveProperty("moduleId");
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("orderIndex");
      });
    });

    it("should have unique tool IDs", () => {
      const ids = trainingToolsData.map((t) => t.toolId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have at least 2 tools per module", () => {
      const toolsByModule = new Map<string, number>();
      trainingToolsData.forEach((tool) => {
        toolsByModule.set(tool.moduleId, (toolsByModule.get(tool.moduleId) || 0) + 1);
      });
      toolsByModule.forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(2);
      });
    });

    it("should have sequential order indices within each module", () => {
      const toolsByModule = new Map<string, any[]>();
      trainingToolsData.forEach((tool) => {
        if (!toolsByModule.has(tool.moduleId)) {
          toolsByModule.set(tool.moduleId, []);
        }
        toolsByModule.get(tool.moduleId)!.push(tool);
      });

      toolsByModule.forEach((tools) => {
        const orders = tools.map((t) => t.orderIndex).sort((a, b) => a - b);
        expect(orders[0]).toBe(1);
        for (let i = 1; i < orders.length; i++) {
          expect(orders[i]).toBe(orders[i - 1] + 1);
        }
      });
    });
  });

  describe("Training Steps", () => {
    it("should have steps for each module", () => {
      const moduleIds = new Set(trainingModulesData.map((m) => m.moduleId));
      const stepModuleIds = new Set(trainingStepsData.map((s) => s.moduleId));
      expect(stepModuleIds).toEqual(moduleIds);
    });

    it("should have all required step fields", () => {
      trainingStepsData.forEach((step) => {
        expect(step).toHaveProperty("stepId");
        expect(step).toHaveProperty("moduleId");
        expect(step).toHaveProperty("orderIndex");
        expect(step).toHaveProperty("title");
        expect(step).toHaveProperty("description");
      });
    });

    it("should have unique step IDs", () => {
      const ids = trainingStepsData.map((s) => s.stepId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have at least 5 steps per module", () => {
      const stepsByModule = new Map<string, number>();
      trainingStepsData.forEach((step) => {
        stepsByModule.set(step.moduleId, (stepsByModule.get(step.moduleId) || 0) + 1);
      });
      stepsByModule.forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(5);
      });
    });

    it("should have sequential order indices within each module", () => {
      const stepsByModule = new Map<string, any[]>();
      trainingStepsData.forEach((step) => {
        if (!stepsByModule.has(step.moduleId)) {
          stepsByModule.set(step.moduleId, []);
        }
        stepsByModule.get(step.moduleId)!.push(step);
      });

      stepsByModule.forEach((steps) => {
        const orders = steps.map((s) => s.orderIndex).sort((a, b) => a - b);
        expect(orders[0]).toBe(1);
        for (let i = 1; i < orders.length; i++) {
          expect(orders[i]).toBe(orders[i - 1] + 1);
        }
      });
    });

    it("should have non-empty descriptions for all steps", () => {
      trainingStepsData.forEach((step) => {
        expect(step.description).toBeTruthy();
        expect(step.description.length).toBeGreaterThan(0);
      });
    });

    it("should have titles for all steps", () => {
      trainingStepsData.forEach((step) => {
        expect(step.title).toBeTruthy();
        expect(step.title.length).toBeGreaterThan(0);
      });
    });

    it("should have warnings for critical steps", () => {
      const stepsWithWarnings = trainingStepsData.filter((s) => s.warnings);
      expect(stepsWithWarnings.length).toBeGreaterThan(0);
    });

    it("should have tips for most steps", () => {
      const stepsWithTips = trainingStepsData.filter((s) => s.tips);
      expect(stepsWithTips.length).toBeGreaterThan(trainingStepsData.length * 0.5);
    });
  });

  describe("Data Consistency", () => {
    it("should have total of 70 steps across all modules", () => {
      expect(trainingStepsData).toHaveLength(70);
    });

    it("should have total of 43 tools across all modules", () => {
      expect(trainingToolsData).toHaveLength(43);
    });

    it("should have no orphaned tools (tools for non-existent modules)", () => {
      const moduleIds = new Set(trainingModulesData.map((m) => m.moduleId));
      trainingToolsData.forEach((tool) => {
        expect(moduleIds.has(tool.moduleId)).toBe(true);
      });
    });

    it("should have no orphaned steps (steps for non-existent modules)", () => {
      const moduleIds = new Set(trainingModulesData.map((m) => m.moduleId));
      trainingStepsData.forEach((step) => {
        expect(moduleIds.has(step.moduleId)).toBe(true);
      });
    });

    it("should have no duplicate IDs across all entities", () => {
      const allIds = [
        ...trainingModulesData.map((m) => m.moduleId),
        ...trainingToolsData.map((t) => t.toolId),
        ...trainingStepsData.map((s) => s.stepId),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe("Content Quality", () => {
    it("should have meaningful module descriptions", () => {
      trainingModulesData.forEach((module) => {
        expect(module.description).toBeTruthy();
        expect(module.description!.length).toBeGreaterThan(10);
      });
    });

    it("should have meaningful tool descriptions", () => {
      trainingToolsData.forEach((tool) => {
        expect(tool.description).toBeTruthy();
        expect(tool.description!.length).toBeGreaterThan(5);
      });
    });

    it("should have detailed step descriptions", () => {
      trainingStepsData.forEach((step) => {
        expect(step.description.length).toBeGreaterThan(20);
      });
    });

    it("should have realistic step titles", () => {
      const titles = trainingStepsData.map((s) => s.title);
      const uniqueTitles = new Set(titles);
      // Most titles should be unique (some modules might have similar steps)
      expect(uniqueTitles.size).toBeGreaterThan(trainingStepsData.length * 0.7);
    });
  });
});
