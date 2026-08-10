import { getDb } from "../server/db";
import { interactiveModules, interactiveModuleFolders } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function assignModulesToFolders() {
  const db = await getDb();
  if (!db) { console.error("Failed to connect to database"); process.exit(1); }

  const folders = await db.select().from(interactiveModuleFolders);
  const modules = await db.select().from(interactiveModules);

  const vanFolder = folders.find((f: any) => f.name.toLowerCase().includes("van"));
  const extFolder = folders.find((f: any) => f.name.toLowerCase().includes("exterior"));
  const intFolder = folders.find((f: any) => f.name.toLowerCase().includes("interior"));

  console.log("Folder IDs:", { van: vanFolder?.id, exterior: extFolder?.id, interior: intFolder?.id });

  // Prefix → folder name mapping
  const prefixMap: Record<string, string> = {
    // Exterior
    "wheel-cleaning": "exterior",
    "tire-cleaning": "exterior",
    "wheel-well": "exterior",
    "exhaust-tips": "exterior",
    "door-jambs": "exterior",
    "bug-removal": "exterior",
    "tar-sap-removal": "exterior",
    "wash-process": "exterior",
    "drying": "exterior",
    "tire-dressing": "exterior",
    "engine-bay": "exterior",
    "engine-bay-dressing": "exterior",
    "bead-maker": "exterior",
    "paint-sealant": "exterior",
    "claybar": "exterior",
    "how-to-polish-paint": "exterior",
    "rain-x": "exterior",
    "exterior-windows": "exterior",
    "rubber-mat-cleaning": "exterior",
    // Interior
    "floor-mats": "interior",
    "vacuuming": "interior",
    "trash-removal": "interior",
    "headliner": "interior",
    "steering-wheel-dash": "interior",
    "door-panels": "interior",
    "console": "interior",
    "kick-plates": "interior",
    "pedal-cleaning": "interior",
    "cloth-seat-cleaning": "interior",
    "leather-cleaning": "interior",
    "leather-condition": "interior",
    "carpet-cleaning": "interior",
    "interior-windows": "interior",
    "interior-cleaning": "interior",
    "pet-hair-removal": "interior",
    "drill-brush": "interior",
    "ozone": "interior",
    "gas-cap": "interior",
    "vacuum": "interior",
    // Van
    "van-walk-around": "van",
    "how-to-start-generator": "van",
    "how-to-turn-on-air-compressor": "van",
    "how-to-turn-on-pressure-washer": "van",
    "how-to-turn-on-water-system": "van",
    "how-to-turn-on-vacuum": "van",
    "how-to-turn-on": "van",
    "troubleshooting-generator": "van",
    "troubleshooting-air-compressor": "van",
    "troubleshooting-pressure-washer": "van",
    "troubleshooting-vacuum": "van",
    "troubleshooting-water-system": "van",
    "truck-bed-sprayout": "van",
  };

  const folderIdMap: Record<string, string | null> = {
    exterior: extFolder?.id != null ? String(extFolder.id) : null,
    interior: intFolder?.id != null ? String(intFolder.id) : null,
    van: vanFolder?.id != null ? String(vanFolder.id) : null,
  };

  let updated = 0;
  let skipped = 0;

  for (const mod of modules as any[]) {
    const key: string = mod.moduleKey;
    // Find matching prefix
    const matchedPrefix = Object.keys(prefixMap).find((prefix) => key.startsWith(prefix));
    if (!matchedPrefix) {
      console.log(`  ⚠️  No mapping for: ${key}`);
      skipped++;
      continue;
    }
    const folderName = prefixMap[matchedPrefix];
    const folderId = folderIdMap[folderName];
    if (!folderId) {
      console.log(`  ⚠️  Folder "${folderName}" not found for: ${key}`);
      skipped++;
      continue;
    }
    await db.update(interactiveModules)
      .set({ folderId: folderId != null ? Number(folderId) : null } as any)
      .where(eq(interactiveModules.moduleKey, key));
    console.log(`  ✅ ${key} → ${folderName}`);
    updated++;
  }

  console.log(`\n✅ Done. Updated: ${updated}, Skipped: ${skipped}`);
}

assignModulesToFolders().catch(console.error);
