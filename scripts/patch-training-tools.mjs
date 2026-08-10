/**
 * Patches all training screens to insert the Tools & Products phase
 * between the video gate and the first step.
 *
 * The pattern in every screen is:
 *   if (!moduleVideoWatched && moduleVideoUrl) { ... InteractiveVideoGate ... }
 *   return ( <ScreenContainer> ... )
 *
 * We add:
 *   const [toolsViewed, setToolsViewed] = useState(false);
 *
 * And insert after the video gate block:
 *   if (moduleVideoWatched && !toolsViewed) { ... ModuleToolsScreen ... }
 */

import fs from "fs";
import path from "path";

const TRAINING_DIR = "/home/ubuntu/team-luxury-wash/app/training";

// Map: watchKey prefix → moduleKey (used in DB)
const MODULE_KEY_MAP = {
  "wheel-cleaning": "wheel-cleaning",
  "tire-cleaning": "tire-cleaning",
  "engine-bay": "engine-bay",
  "floor-mats": "floor-mats",
  "bead-maker": "bead-maker",
  "bug-removal": "bug-removal",
  "door-jambs": "door-jambs",
  "drying": "drying",
  "exhaust-tips": "exhaust-tips",
  "exterior-wash": "exterior-wash",
  "interior-cleaning": "interior-cleaning",
  "paint-sealant": "paint-sealant",
  "tar-sap-removal": "tar-sap-removal",
  "wash-process": "wash-process",
  "wheel-well": "wheel-well",
};

const files = fs.readdirSync(TRAINING_DIR).filter(f => f.endsWith(".tsx") && !f.startsWith("_") && f !== "index.tsx" && !f.includes("["));

let patched = 0;
let skipped = 0;

for (const file of files) {
  const slug = file.replace(".tsx", "");
  const moduleKey = MODULE_KEY_MAP[slug];
  if (!moduleKey) { console.log(`SKIP (no moduleKey): ${file}`); skipped++; continue; }

  const filePath = path.join(TRAINING_DIR, file);
  let src = fs.readFileSync(filePath, "utf8");

  // Skip if already patched
  if (src.includes("ModuleToolsScreen") || src.includes("toolsViewed")) {
    console.log(`SKIP (already patched): ${file}`);
    skipped++;
    continue;
  }

  // 1. Add import for ModuleToolsScreen after the InteractiveVideoGate import
  src = src.replace(
    `import { InteractiveVideoGate } from "@/components/interactive-video-gate";`,
    `import { InteractiveVideoGate } from "@/components/interactive-video-gate";\nimport { ModuleToolsScreen } from "@/components/module-tools-screen";`
  );

  // 2. Add toolsViewed state after moduleVideoWatched state
  src = src.replace(
    `const [moduleVideoWatched, setModuleVideoWatched] = useState(false);`,
    `const [moduleVideoWatched, setModuleVideoWatched] = useState(false);\n  const [toolsViewed, setToolsViewed] = useState(false);`
  );

  // 3. Find the title from the InteractiveVideoGate to use in ModuleToolsScreen
  const titleMatch = src.match(/title=\{"([^"]+)"\}/);
  const moduleTitle = titleMatch ? titleMatch[1] : slug;

  // 4. Insert the tools screen block after the video gate closing brace
  // Pattern: the video gate block ends with:
  //   );
  //   }
  //
  //   return (
  // We insert between the closing } of the video gate and the return (
  const videoGateEnd = `  }\n\n  return (`;
  const toolsBlock = `  }\n\n  // ── Tools & Products Screen ──────────────────────────────────────────────────\n  if (moduleVideoWatched && !toolsViewed) {\n    return (\n      <ScreenContainer edges={["left", "right"]}>\n        <ModuleToolsScreen\n          moduleKey={"${moduleKey}"}\n          moduleName={"${moduleTitle}"}\n          onContinue={() => { setToolsViewed(true); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}\n          onExit={() => { setModuleVideoWatched(false); }}\n        />\n      </ScreenContainer>\n    );\n  }\n\n  return (`;

  if (!src.includes(videoGateEnd)) {
    console.log(`SKIP (pattern not found): ${file}`);
    skipped++;
    continue;
  }

  src = src.replace(videoGateEnd, toolsBlock);

  fs.writeFileSync(filePath, src, "utf8");
  console.log(`PATCHED: ${file}`);
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped.`);
