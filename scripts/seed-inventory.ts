/**
 * Seed script: populates inventory categories and items for Luxury Wash On Wheels.
 * All quantities start at 0. Supplier notes are stored in category names where relevant.
 * Run: npx tsx scripts/seed-inventory.ts
 */
import "../scripts/load-env.js";
import { getDb } from "../server/db";
import { inventoryCategories, inventoryItems, inventoryStock } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

// ─── Inventory Definition ──────────────────────────────────────────────────────
// Each category has an optional supplier note and a list of item names.
const CATEGORIES: {
  name: string;
  supplierNote?: string;
  items: string[];
}[] = [
  // ── CHEMICALS ──────────────────────────────────────────────────────────────
  {
    name: "Chemicals",
    supplierNote: "Zach Chemical Guy: 813-647-4850 | Amazon: Billing@luxurywashonwheels.com / Luxurywash1. | Lowe's",
    items: [
      // Zach Chemical Guy
      "Bead Maker",
      "Brake Buster",
      "Acid",
      "Degreaser",
      "Glass Cleaner",
      "Interior Cleaner",
      "Soap",
      "Pink Dressing",
      "Tire Dressing",
      // Amazon
      "Paint Sealant",
      "Uno (Polish)",
      "Bug Off",
      "Hand Sanitizer",
      "LVP Leather Lotion",
      "Metal Polish",
      "Iron Remover",
      "Trim Dye",
      // Lowe's
      "Solvent",
      // Van-specific chemicals
      "White Dressing",
      "Alumabrite",
      "Sap Remover",
    ],
  },
  // ── MICROFIBERS / TOWELS ───────────────────────────────────────────────────
  {
    name: "Microfibers & Towels",
    supplierNote: "A&H Towels: 678-966-0022 | Amazon: Billing@luxurywashonwheels.com / Luxurywash1.",
    items: [
      // A&H Towels
      "Blue Drying Towels",
      "Orange/Red/Green Microfiber Towels Royal",
      "Blue/Green Wash Mitts",
      // Amazon
      "Purple Wax Towels",
      "Grey Drying Towels",
      "Premium Wash Mitts",
      "Clay Mitt",
      "Scrub Ninja",
      "Barrel Blade",
      "Bug Sponge Blue/Yellow",
      "Applicator Pads (Round/Square)",
      "Green Polish Pad",
      "Mitt On Stick Wash Mitt",
      "Aprons",
      "Tire Applicator Pad",
      // Van towel counts
      "Window Polishing Towels",
      "Window Cleaning Towels",
      "All Purpose Towels",
      "Dressing Towels",
      "Wax Towels",
      "Applicator Towels",
      "Drying Towels",
      "Royal Blue Towels",
    ],
  },
  // ── BRUSHES ────────────────────────────────────────────────────────────────
  {
    name: "Brushes",
    supplierNote: "Amazon: Billing@luxurywashonwheels.com / Luxurywash1.",
    items: [
      "Analon (Pet Hair)",
      "Black Handle Brush",
      "Leather Brush",
      "Detail Brushes",
      "Drill Brush",
      "Blue Detail Brush",
      "Green Wheel Brushes",
      "Tooth Brush",
      "Carpet Brush",
      "Tire Brush",
    ],
  },
  // ── EQUIPMENT ──────────────────────────────────────────────────────────────
  {
    name: "Equipment",
    supplierNote: "Amazon: Billing@luxurywashonwheels.com / Luxurywash1.",
    items: [
      "Fire Extinguisher",
      "Ozone Machine",
      "DA Buffer & Pad",
      "Extractor",
      "Pressure Washer Hose",
      "Pressure Washer Reel",
      "Vacuum Hose Reel (Cox)",
      "Air Hose Reel",
      "Pressure Washer Pump",
      "Generator",
      "Dressing Gun",
      "Air Compressor",
      "Water Tank",
    ],
  },
  // ── TOOLS ──────────────────────────────────────────────────────────────────
  {
    name: "Tools",
    supplierNote: "Amazon: Billing@luxurywashonwheels.com / Luxurywash1. | Lowe's | Vacumaid.com (order as guest)",
    items: [
      // Amazon
      "Barrel Blade",
      "Clock",
      "Crevice Tool (Vacuum)",
      "Buffer Holder",
      "Foam Cannon",
      "Button System",
      "Grit Guard",
      "TDS Meter",
      "Knee Pad",
      "Phone Mount",
      "Jumper Cables",
      "Garden Hose",
      "O-Ring Pick",
      "Plastic Razors",
      "O-Ring Kit",
      "Tornador",
      "Pressure Washer Gun",
      "Tire Dressing Applicator",
      // Lowe's
      "Platform Ladder",
      "Drill (Dewalt)",
      "Extension Pole",
      "Extension Cord",
      "Air Hose",
      "0000 Steel Wool",
      "Towel Bins",
      "Air/Water Filter",
      "Vacuum Elbow",
      "Plumbing & Clamps",
      "Pliers",
      "Screwdriver",
      // Vacumaid
      "Vacuum Bags",
      // Van tools
      "Vacuum Tools",
    ],
  },
  // ── PLASTICS / CONTAINERS ──────────────────────────────────────────────────
  {
    name: "Plastics & Containers",
    supplierNote: "US Plastics: Billing@luxurywashonwheels.com / Luxurywash1.",
    items: [
      "Gallon Bottles",
      "½ Gallon Bottles",
      "16 oz Bottles",
      "32 oz Bottles",
      "4 oz Bottles",
      "Triggers",
      "Spouts",
      "Lids",
    ],
  },
  // ── SUPPLIES / SAFETY ──────────────────────────────────────────────────────
  {
    name: "Supplies & Safety",
    supplierNote: "U-Line: Billing@luxurywashonwheels.com / Luxurywash1. | Harbor Freight | Pressure Washers Direct",
    items: [
      "5 Gal Buckets",
      "First Aid Kit",
      "Gloves",
      "Personal Item Bags",
      "Trash Bags",
      "SM Ziplock",
      "O-Rings",
      "5 Gal Wash Bucket",
      "5 Gal Wheel Bucket",
    ],
  },
  // ── WATER SYSTEM ──────────────────────────────────────────────────────────
  {
    name: "Water System",
    supplierNote: "Amazon: Billing@luxurywashonwheels.com / Luxurywash1.",
    items: [
      "Carbon Filter",
      "Sediment Filter",
      "55-60 Gal Water Tank",
    ],
  },
  // ── UNIFORMS ───────────────────────────────────────────────────────────────
  {
    name: "Uniforms",
    items: [],
  },
  // ── MARKETING MATERIALS ────────────────────────────────────────────────────
  {
    name: "Marketing Materials",
    items: [],
  },
  // ── BUSINESS CARDS ─────────────────────────────────────────────────────────
  {
    name: "Business Cards",
    items: [],
  },
];

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌ Could not connect to database");
    process.exit(1);
  }

  console.log("🔍 Checking existing categories...");
  const existing = await db.select({ name: inventoryCategories.name }).from(inventoryCategories);
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

  let catCreated = 0;
  let itemCreated = 0;

  for (const cat of CATEGORIES) {
    let categoryId: string;

    if (existingNames.has(cat.name.toLowerCase())) {
      // Fetch existing ID
      const rows = await db
        .select({ categoryId: inventoryCategories.categoryId })
        .from(inventoryCategories)
        .where(eq(inventoryCategories.name, cat.name))
        .limit(1);
      categoryId = rows[0].categoryId;
      console.log(`  ↩ Category exists: ${cat.name}`);
    } else {
      categoryId = genId("CAT");
      const maxOrder = await db.select({ m: sql<number>`MAX(sort_order)` }).from(inventoryCategories);
      const sortOrder = (maxOrder[0]?.m ?? 0) + 1;
      // Store supplier note in a description-like field via the name for now
      // (the schema stores only name; supplier info goes in a comment)
      await db.insert(inventoryCategories).values({ categoryId, name: cat.name, sortOrder });
      catCreated++;
      console.log(`  ✅ Created category: ${cat.name}`);
    }

    // Insert items that don't already exist
    const existingItems = await db
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(eq(inventoryItems.categoryId, categoryId));
    const existingItemNames = new Set(existingItems.map((i) => i.name.toLowerCase()));

    for (const itemName of cat.items) {
      if (existingItemNames.has(itemName.toLowerCase())) {
        console.log(`    ↩ Item exists: ${itemName}`);
        continue;
      }
      const itemId = genId("ITEM");
      await db.insert(inventoryItems).values({ itemId, categoryId, name: itemName, minThreshold: 0 });
      // Create a warehouse stock record at qty 0
      const stockId = genId("STK");
      await db.insert(inventoryStock).values({
        stockId,
        itemId,
        locationType: "warehouse",
        locationId: "WAREHOUSE",
        quantity: 0,
      });
      itemCreated++;
      console.log(`    ✅ Added item: ${itemName}`);
    }
  }

  console.log(`\n✅ Done! Created ${catCreated} categories and ${itemCreated} items.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
