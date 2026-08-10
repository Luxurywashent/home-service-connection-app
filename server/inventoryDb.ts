import { eq, and, desc, asc, sql, inArray, gte } from "drizzle-orm";
import { getDb } from "./db";
import {
  inventoryCategories, type InsertInventoryCategory,
  inventoryItems, type InsertInventoryItem,
  inventoryStock, type InsertInventoryStock,
  inventoryLocations, type InsertInventoryLocation,
  inventoryVans, type InsertInventoryVan,
  inventoryTransactions, type InsertInventoryTransaction,
} from "../drizzle/schema";
import { randomBytes } from "crypto";

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

// ─── Categories ───────────────────────────────────────────────────────────────
export async function getAllCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryCategories).orderBy(asc(inventoryCategories.sortOrder), asc(inventoryCategories.name));
}

export async function createCategory(name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const categoryId = genId("CAT");
  const maxOrder = await db.select({ m: sql<number>`MAX(sort_order)` }).from(inventoryCategories);
  const sortOrder = (maxOrder[0]?.m ?? 0) + 1;
  await db.insert(inventoryCategories).values({ categoryId, name, sortOrder });
  return categoryId;
}

export async function updateCategory(categoryId: string, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(inventoryCategories).set({ name }).where(eq(inventoryCategories.categoryId, categoryId));
}

export async function deleteCategory(categoryId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Delete items in this category first
  const items = await db.select({ itemId: inventoryItems.itemId }).from(inventoryItems).where(eq(inventoryItems.categoryId, categoryId));
  for (const item of items) {
    await db.delete(inventoryStock).where(eq(inventoryStock.itemId, item.itemId));
  }
  await db.delete(inventoryItems).where(eq(inventoryItems.categoryId, categoryId));
  await db.delete(inventoryCategories).where(eq(inventoryCategories.categoryId, categoryId));
}

// ─── Items ────────────────────────────────────────────────────────────────────
export async function getAllItems() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryItems).orderBy(asc(inventoryItems.name));
}

export async function getItemsByCategory(categoryId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryItems).where(eq(inventoryItems.categoryId, categoryId)).orderBy(asc(inventoryItems.name));
}

export async function createItem(categoryId: string, name: string, minThreshold = 0) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const itemId = genId("ITEM");
  await db.insert(inventoryItems).values({ itemId, categoryId, name, minThreshold });
  return itemId;
}

export async function updateItem(itemId: string, data: { name?: string; minThreshold?: number; categoryId?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.minThreshold !== undefined) set.minThreshold = data.minThreshold;
  if (data.categoryId !== undefined) set.categoryId = data.categoryId;
  if (Object.keys(set).length > 0) await db.update(inventoryItems).set(set).where(eq(inventoryItems.itemId, itemId));
}

export async function deleteItem(itemId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(inventoryStock).where(eq(inventoryStock.itemId, itemId));
  await db.delete(inventoryItems).where(eq(inventoryItems.itemId, itemId));
}

// ─── Locations (Blue Boxes) ───────────────────────────────────────────────────
export async function getAllLocations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.name));
}

export async function createLocation(name: string, city?: string, address?: string, gateCode?: string, boxCode?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const locationId = genId("LOC");
  await db.insert(inventoryLocations).values({ locationId, name, city: city ?? null, address: address ?? null, gateCode: gateCode ?? null, boxCode: boxCode ?? null });
  return locationId;
}

export async function updateLocation(locationId: string, data: { name?: string; city?: string; address?: string; gateCode?: string; boxCode?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.city !== undefined) set.city = data.city;
  if (data.address !== undefined) set.address = data.address;
  if (data.gateCode !== undefined) set.gateCode = data.gateCode;
  if (data.boxCode !== undefined) set.boxCode = data.boxCode;
  if (Object.keys(set).length > 0) await db.update(inventoryLocations).set(set).where(eq(inventoryLocations.locationId, locationId));
}

export async function deleteLocation(locationId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(inventoryVans).where(eq(inventoryVans.locationId, locationId));
  await db.delete(inventoryStock).where(and(eq(inventoryStock.locationType, "location"), eq(inventoryStock.locationId, locationId)));
  await db.delete(inventoryLocations).where(eq(inventoryLocations.locationId, locationId));
}

// ─── Vans ─────────────────────────────────────────────────────────────────────
export async function getAllVans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryVans).orderBy(asc(inventoryVans.name));
}

export async function getVansByLocation(locationId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryVans).where(eq(inventoryVans.locationId, locationId)).orderBy(asc(inventoryVans.name));
}

export async function createVan(name: string, locationId: string, assignedEmployeeId?: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const vanId = genId("VAN");
  await db.insert(inventoryVans).values({ vanId, name, locationId, assignedEmployeeId: assignedEmployeeId ?? null });
  return vanId;
}

export async function updateVan(vanId: string, data: { name?: string; locationId?: string; assignedEmployeeId?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const set: Record<string, unknown> = {};
  if (data.name !== undefined) set.name = data.name;
  if (data.locationId !== undefined) set.locationId = data.locationId;
  if (data.assignedEmployeeId !== undefined) set.assignedEmployeeId = data.assignedEmployeeId;
  if (Object.keys(set).length > 0) await db.update(inventoryVans).set(set).where(eq(inventoryVans.vanId, vanId));
}

export async function deleteVan(vanId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(inventoryStock).where(and(eq(inventoryStock.locationType, "van"), eq(inventoryStock.locationId, vanId)));
  await db.delete(inventoryVans).where(eq(inventoryVans.vanId, vanId));
}

// ─── Stock ────────────────────────────────────────────────────────────────────
export async function getStock(locationType: "warehouse" | "location" | "van", locationId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryStock)
    .where(and(eq(inventoryStock.locationType, locationType), eq(inventoryStock.locationId, locationId)));
}

export async function getAllStock() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryStock);
}

async function upsertStock(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  itemId: string,
  locationType: "warehouse" | "location" | "van",
  locationId: string,
  delta: number,
  overwrite?: number,
) {
  const existing = await db.select().from(inventoryStock)
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.locationType, locationType), eq(inventoryStock.locationId, locationId)))
    .limit(1);

  if (existing.length > 0) {
    const newQty = overwrite !== undefined ? overwrite : Math.max(0, existing[0].quantity + delta);
    await db.update(inventoryStock).set({ quantity: newQty })
      .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.locationType, locationType), eq(inventoryStock.locationId, locationId)));
    return newQty;
  } else {
    const stockId = genId("STK");
    const qty = overwrite !== undefined ? overwrite : Math.max(0, delta);
    await db.insert(inventoryStock).values({ stockId, itemId, locationType, locationId, quantity: qty });
    return qty;
  }
}

// ─── Inventory Actions ────────────────────────────────────────────────────────
export async function addInventory(
  itemId: string, itemName: string,
  locationType: "warehouse" | "location" | "van", locationId: string, locationName: string,
  quantity: number, performedBy: string, note?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await upsertStock(db, itemId, locationType, locationId, quantity);
  await db.insert(inventoryTransactions).values({
    txId: genId("TX"), itemId, itemName, actionType: "add", quantity,
    locationType, locationId, locationName, note: note ?? null, performedBy,
  });
}

export async function removeInventory(
  itemId: string, itemName: string,
  locationType: "warehouse" | "location" | "van", locationId: string, locationName: string,
  quantity: number, performedBy: string, note?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await upsertStock(db, itemId, locationType, locationId, -quantity);
  await db.insert(inventoryTransactions).values({
    txId: genId("TX"), itemId, itemName, actionType: "remove", quantity,
    locationType, locationId, locationName, note: note ?? null, performedBy,
  });
}

export async function adjustInventory(
  itemId: string, itemName: string,
  locationType: "warehouse" | "location" | "van", locationId: string, locationName: string,
  newQuantity: number, performedBy: string, note?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await upsertStock(db, itemId, locationType, locationId, 0, newQuantity);
  await db.insert(inventoryTransactions).values({
    txId: genId("TX"), itemId, itemName, actionType: "adjust", quantity: newQuantity,
    locationType, locationId, locationName, note: note ?? null, performedBy,
  });
}

export async function transferInventory(
  itemId: string, itemName: string,
  fromType: "warehouse" | "location" | "van", fromId: string, fromName: string,
  toType: "warehouse" | "location" | "van", toId: string, toName: string,
  quantity: number, performedBy: string, note?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  // Check source has enough
  const src = await db.select().from(inventoryStock)
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.locationType, fromType), eq(inventoryStock.locationId, fromId)))
    .limit(1);
  const srcQty = src[0]?.quantity ?? 0;
  if (srcQty < quantity) throw new Error(`Insufficient stock: only ${srcQty} available`);

  await upsertStock(db, itemId, fromType, fromId, -quantity);
  await upsertStock(db, itemId, toType, toId, quantity);

  const txBase = { itemId, itemName, quantity, performedBy, note: note ?? null };
  await db.insert(inventoryTransactions).values([
    { ...txBase, txId: genId("TX"), actionType: "transfer_out" as const, locationType: fromType, locationId: fromId, locationName: fromName, relatedLocationId: toId, relatedLocationName: toName },
    { ...txBase, txId: genId("TX"), actionType: "transfer_in" as const, locationType: toType, locationId: toId, locationName: toName, relatedLocationId: fromId, relatedLocationName: fromName },
  ]);
}

// ─── Location/Van Item Assignment ───────────────────────────────────────────
// Assigning an item to a location creates a stock row with qty=0 (if not already present).
// Unassigning removes the stock row entirely.
export async function assignItemToLocation(
  itemId: string,
  locationType: "location" | "van",
  locationId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await db.select().from(inventoryStock)
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.locationType, locationType), eq(inventoryStock.locationId, locationId)))
    .limit(1);
  if (existing.length === 0) {
    const stockId = genId("STK");
    await db.insert(inventoryStock).values({ stockId, itemId, locationType, locationId, quantity: 0 });
  }
}

export async function unassignItemFromLocation(
  itemId: string,
  locationType: "location" | "van",
  locationId: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(inventoryStock)
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.locationType, locationType), eq(inventoryStock.locationId, locationId)));
}

// ─── Transactions (audit log) ─────────────────────────────────────────────────
export async function getTransactions(limit = 100, itemId?: string) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select().from(inventoryTransactions).orderBy(desc(inventoryTransactions.createdAt)).limit(limit);
  if (itemId) return db.select().from(inventoryTransactions).where(eq(inventoryTransactions.itemId, itemId)).orderBy(desc(inventoryTransactions.createdAt)).limit(limit);
  return q;
}

export async function getTransactionsByLocation(locationType: "warehouse" | "location" | "van", locationId: string, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.locationType, locationType), eq(inventoryTransactions.locationId, locationId)))
    .orderBy(desc(inventoryTransactions.createdAt)).limit(limit);
}

// ─── Reporting ────────────────────────────────────────────────────────────────
export async function getStockWithDetails() {
  const db = await getDb();
  if (!db) return [];
  // Join stock with items and categories
  const stocks = await db.select().from(inventoryStock);
  const items = await db.select().from(inventoryItems);
  const cats = await db.select().from(inventoryCategories);
  const itemMap = new Map(items.map(i => [i.itemId, i]));
  const catMap = new Map(cats.map(c => [c.categoryId, c]));
  return stocks.map(s => {
    const item = itemMap.get(s.itemId);
    const cat = item ? catMap.get(item.categoryId) : undefined;
    return {
      ...s,
      itemName: item?.name ?? "Unknown",
      categoryId: item?.categoryId ?? "",
      categoryName: cat?.name ?? "Unknown",
      minThreshold: item?.minThreshold ?? 0,
      isLowStock: s.quantity <= (item?.minThreshold ?? 0) && (item?.minThreshold ?? 0) > 0,
    };
  });
}

export async function getLowStockItems() {
  const db = await getDb();
  if (!db) return [];
  const all = await getStockWithDetails();
  return all.filter(s => s.isLowStock);
}

export async function getUsageSummary(days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.select().from(inventoryTransactions)
    .where(and(
      inArray(inventoryTransactions.actionType, ["remove", "transfer_out"]),
      gte(inventoryTransactions.createdAt, since),
    ))
    .orderBy(desc(inventoryTransactions.createdAt));
}

// ─── Seed default categories & items ─────────────────────────────────────────
export async function seedDefaultInventory() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(inventoryCategories).limit(1);
  if (existing.length > 0) return; // already seeded

  const defaults = [
    { name: "Chemicals", items: ["All-Purpose Cleaner", "Tire Shine", "Glass Cleaner", "Degreaser", "Wax/Sealant"] },
    { name: "Towels", items: ["Microfiber Towels", "Drying Towels", "Applicator Pads"] },
    { name: "Uniforms", items: ["T-Shirts", "Polo Shirts", "Hats", "Jackets"] },
    { name: "Marketing Materials", items: ["Door Hangers", "Yard Signs", "Table Toppers", "Flyers"] },
    { name: "Business Cards", items: ["Standard Business Cards", "Referral Cards"] },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const { name, items } = defaults[i];
    const categoryId = genId("CAT");
    await db.insert(inventoryCategories).values({ categoryId, name, sortOrder: i + 1 });
    for (const itemName of items) {
      const itemId = genId("ITEM");
      await db.insert(inventoryItems).values({ itemId, categoryId, name: itemName, minThreshold: 5 });
    }
  }
}
