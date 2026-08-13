import { eq, and, desc, or } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
// @ts-ignore

type DrizzleDb = ReturnType<typeof drizzle<mysql.Pool>>;
let _db: DrizzleDb | null = null;
let _pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      uri: process.env.DATABASE_URL!,
      connectionLimit: 10,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
    });
  }
  return _pool;
}

async function getDb() {
// @ts-ignore
// @ts-ignore
  if (!_db && process.env.DATABASE_URL) {
// @ts-ignore
    try { _db = drizzle(getPool()); } catch { _db = null; }
  }
  return _db;
}
import {
  customers,
  customerVehicles,
  customerAddresses,
  customerBookings,
  customerSessions,
  type InsertCustomer,
  type InsertCustomerVehicle,
  type InsertCustomerAddress,
  type InsertCustomerBooking,
} from "../drizzle/schema";

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "lwow_salt_2026").digest("hex");
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

// ─── Customers ───

export async function getCustomerByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(customers).where(eq(customers.email, email.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function getCustomerById(customerId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(customers).where(eq(customers.customerId, customerId)).limit(1);
  const c = rows[0];
  if (!c) return null;
  // Never return password hash
  const { passwordHash, ...safe } = c;
  return safe;
}

export async function createCustomer(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const customerId = generateId("cust");
  await db.insert(customers).values({
    customerId,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email.toLowerCase(),
    phone: data.phone ?? null,
    passwordHash: hashPassword(data.password),
  });
  const rows = await db.select().from(customers).where(eq(customers.customerId, customerId)).limit(1);
  return rows[0]!;
}

export async function verifyCustomerPassword(email: string, password: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    customerId: customers.customerId,
    firstName: customers.firstName,
    lastName: customers.lastName,
    email: customers.email,
    phone: customers.phone,
    passwordHash: customers.passwordHash,
  }).from(customers).where(eq(customers.email, email.toLowerCase())).limit(1);
  const customer = rows[0];
  if (!customer) return null;
  if (customer.passwordHash !== hashPassword(password)) return null;
  return customer;
}

// ─── Sessions ───

export async function createCustomerSession(customerId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.insert(customerSessions).values({ sessionToken: token, customerId, expiresAt });
  return token;
}

export async function getCustomerSession(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(customerSessions).where(eq(customerSessions.sessionToken, token)).limit(1);
  const session = rows[0];
  if (!session) return null;
  if (new Date() > session.expiresAt) {
    await db.delete(customerSessions).where(eq(customerSessions.sessionToken, token));
    return null;
  }
  return session;
}

export async function deleteCustomerSession(token: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(customerSessions).where(eq(customerSessions.sessionToken, token));
}

// ─── Vehicles ───

export async function getCustomerVehicles(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerVehicles)
    .where(eq(customerVehicles.customerId, customerId))
    .orderBy(desc(customerVehicles.isDefault), desc(customerVehicles.createdAt));
}

export async function addCustomerVehicle(data: {
  customerId: string;
  year: string;
  make: string;
  model: string;
  vehicleType: "sedan" | "suv" | "large_suv_van" | "truck" | "rv";
  color?: string;
  rvClass?: string;
  rvLengthFt?: number;
  isDefault?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const vehicleId = generateId("veh");
  // If isDefault, clear others
  if (data.isDefault) {
    await db.update(customerVehicles).set({ isDefault: 0 }).where(eq(customerVehicles.customerId, data.customerId));
  }
  await db.insert(customerVehicles).values({
    vehicleId,
    customerId: data.customerId,
    year: data.year,
    make: data.make,
    model: data.model,
    vehicleType: data.vehicleType,
    color: data.color ?? null,
    rvClass: data.rvClass ?? null,
    rvLengthFt: data.rvLengthFt ?? null,
    isDefault: data.isDefault ? 1 : 0,
  });
  const rows = await db.select().from(customerVehicles).where(eq(customerVehicles.vehicleId, vehicleId)).limit(1);
  return rows[0]!;
}

export async function updateCustomerVehicle(
  vehicleId: string,
  customerId: string,
  data: Partial<{
    year: string;
    make: string;
    model: string;
    vehicleType: "sedan" | "suv" | "large_suv_van" | "truck" | "rv";
    color: string;
    rvClass: string;
    rvLengthFt: number;
    isDefault: boolean;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.isDefault) {
    await db.update(customerVehicles).set({ isDefault: 0 }).where(eq(customerVehicles.customerId, customerId));
  }
  const update: Record<string, any> = {};
  if (data.year !== undefined) update.year = data.year;
  if (data.make !== undefined) update.make = data.make;
  if (data.model !== undefined) update.model = data.model;
  if (data.vehicleType !== undefined) update.vehicleType = data.vehicleType;
  if (data.color !== undefined) update.color = data.color;
  if (data.rvClass !== undefined) update.rvClass = data.rvClass;
  if (data.rvLengthFt !== undefined) update.rvLengthFt = data.rvLengthFt;
  if (data.isDefault !== undefined) update.isDefault = data.isDefault ? 1 : 0;
  await db.update(customerVehicles).set(update).where(
    and(eq(customerVehicles.vehicleId, vehicleId), eq(customerVehicles.customerId, customerId))
  );
  return { success: true };
}

export async function deleteCustomerVehicle(vehicleId: string, customerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customerVehicles).where(
    and(eq(customerVehicles.vehicleId, vehicleId), eq(customerVehicles.customerId, customerId))
  );
  return { success: true };
}

// ─── Addresses ───

export async function getCustomerAddresses(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerAddresses)
    .where(eq(customerAddresses.customerId, customerId))
    .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt));
}

export async function addCustomerAddress(data: {
  customerId: string;
  label: string;
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  isDefault?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const addressId = generateId("addr");
  if (data.isDefault) {
    await db.update(customerAddresses).set({ isDefault: 0 }).where(eq(customerAddresses.customerId, data.customerId));
  }
  await db.insert(customerAddresses).values({
    addressId,
    customerId: data.customerId,
    label: data.label,
    street: data.street,
    unit: data.unit ?? null,
    city: data.city,
    state: data.state,
    zip: data.zip,
    isDefault: data.isDefault ? 1 : 0,
  });
  const rows = await db.select().from(customerAddresses).where(eq(customerAddresses.addressId, addressId)).limit(1);
  return rows[0]!;
}

export async function updateCustomerAddress(addressId: string, customerId: string, data: {
  label?: string;
  street?: string;
  unit?: string | null;
  city?: string;
  state?: string;
  zip?: string;
  isDefault?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.isDefault) {
    await db.update(customerAddresses).set({ isDefault: 0 }).where(eq(customerAddresses.customerId, customerId));
  }
  const updateSet: any = {};
  if (data.label !== undefined) updateSet.label = data.label;
  if (data.street !== undefined) updateSet.street = data.street;
  if (data.unit !== undefined) updateSet.unit = data.unit;
  if (data.city !== undefined) updateSet.city = data.city;
  if (data.state !== undefined) updateSet.state = data.state;
  if (data.zip !== undefined) updateSet.zip = data.zip;
  if (data.isDefault !== undefined) updateSet.isDefault = data.isDefault ? 1 : 0;
  if (Object.keys(updateSet).length > 0) {
    await db.update(customerAddresses).set(updateSet).where(
      and(eq(customerAddresses.addressId, addressId), eq(customerAddresses.customerId, customerId))
    );
  }
  const rows = await db.select().from(customerAddresses).where(eq(customerAddresses.addressId, addressId)).limit(1);
  return rows[0]!;
}

export async function deleteCustomerAddress(addressId: string, customerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customerAddresses).where(
    and(eq(customerAddresses.addressId, addressId), eq(customerAddresses.customerId, customerId))
  );
  return { success: true };
}

// ─── Bookings ───

export async function createCustomerBooking(data: {
  customerId: string;
  vehicleId: string;
  vehicleType: "sedan" | "suv" | "large_suv_van" | "truck" | "rv";
  vehicleLabel?: string;
  packageId: string;
  packageName: string;
  addons?: string[];
  addressId?: string;
  addressLabel?: string;
  city?: string;
  scheduledDate: string;
  scheduledTime: string;
  subtotal: number;
  total: number;
  notes?: string;
  discountCode?: string;
  discountAmount?: number;
  depositAmount?: number;
  depositPaymentIntentId?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const bookingRef = generateId("bk");
  await db.insert(customerBookings).values({
    bookingRef,
    customerId: data.customerId,
    vehicleId: data.vehicleId,
    vehicleType: data.vehicleType,
    vehicleLabel: data.vehicleLabel ?? null,
    packageId: data.packageId,
    packageName: data.packageName,
    addons: data.addons ? JSON.stringify(data.addons) : null,
    addressId: data.addressId ?? null,
    addressLabel: data.addressLabel ?? null,
    city: data.city ?? null,
    scheduledDate: data.scheduledDate,
    scheduledTime: data.scheduledTime,
    subtotal: String(data.subtotal) as any,
    total: String(data.total) as any,
    notes: data.notes ?? null,
    discountCode: data.discountCode ?? null,
    discountAmount: data.discountAmount != null ? String(data.discountAmount) as any : null,
    depositAmount: data.depositAmount != null ? String(data.depositAmount) as any : null,
    depositPaymentIntentId: data.depositPaymentIntentId ?? null,
  });
  const rows = await db.select().from(customerBookings).where(eq(customerBookings.bookingRef, bookingRef)).limit(1);
  return rows[0]!;
}

export async function getCustomerBookings(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerBookings)
    .where(eq(customerBookings.customerId, customerId))
    .orderBy(desc(customerBookings.createdAt));
}

export async function getCustomerBookingByRef(bookingRef: string, customerId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(customerBookings).where(
    and(eq(customerBookings.bookingRef, bookingRef), eq(customerBookings.customerId, customerId))
  ).limit(1);
  return rows[0] ?? null;
}

export async function updateCustomerBookingStatus(
  bookingRef: string,
  status: "pending" | "confirmed" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customerBookings).set({ status }).where(eq(customerBookings.bookingRef, bookingRef));
  return { success: true };
}

export async function getCustomerBookingsByLocation(
  location: string,
  startDate: string,
  endDate: string,
  assignedEmployeeId?: string, // if provided, only return bookings assigned to this employee
) {
  const db = await getDb();
  if (!db) return [];

  // Normalize location slug to city name for matching
  const cityMap: Record<string, string[]> = {
    crestview:  ["crestview", "crest view"],
    niceville:  ["niceville", "nice ville"],
    destin:     ["destin"],
    fwb:        ["fort walton beach", "fort walton", "fwb", "fw beach"],
    pensacola:  ["pensacola"],
  };
  const aliases = cityMap[location.toLowerCase()] ?? [location.toLowerCase()];

  // Fetch all bookings with customer name via join
  const rows = await db.select({
    bookingRef: customerBookings.bookingRef,
    customerId: customerBookings.customerId,
    vehicleLabel: customerBookings.vehicleLabel,
    vehicleType: customerBookings.vehicleType,
    packageId: customerBookings.packageId,
    packageName: customerBookings.packageName,
    addons: customerBookings.addons,
    addressLabel: customerBookings.addressLabel,
    city: customerBookings.city,
    scheduledDate: customerBookings.scheduledDate,
    scheduledTime: customerBookings.scheduledTime,
    total: customerBookings.total,
    status: customerBookings.status,
    notes: customerBookings.notes,
    createdAt: customerBookings.createdAt,
    customerFirstName: customers.firstName,
    customerLastName: customers.lastName,
    customerEmail: customers.email,
    customerPhone: customers.phone,
    assignedEmployeeId: customerBookings.assignedEmployeeId,
  }).from(customerBookings)
    .leftJoin(customers, eq(customerBookings.customerId, customers.customerId))
    .orderBy(desc(customerBookings.scheduledDate));

  return rows.filter((b) => {
    if (!b.scheduledDate) return false;
    if (b.scheduledDate < startDate || b.scheduledDate > endDate) return false;
    // Exclude cancelled/abandoned/closed bookings from the detailer schedule
    if (b.status === "cancelled" || b.status as any === "abandoned" || b.status as any === "closed") return false;
    const cityLower = (b.city ?? "").toLowerCase();
    if (!aliases.some((alias) => cityLower.includes(alias))) return false;
    // If a specific employee filter is provided, only return their assigned bookings
    if (assignedEmployeeId) {
      return b.assignedEmployeeId === assignedEmployeeId;
    }
    return true;
  });
}

// ─── Admin: Delete Customer ───
export async function deleteCustomer(customerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete related records first to avoid FK constraint errors
  await db.delete(customerSessions).where(eq(customerSessions.customerId, customerId));
  await db.delete(customerVehicles).where(eq(customerVehicles.customerId, customerId));
  await db.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
  // Note: customerBookings are kept for historical records
  await db.delete(customers).where(eq(customers.customerId, customerId));
  return { success: true };
}

// ─── Admin: Set Do Not Service flag ───
export async function setDoNotService(customerId: string, doNotService: boolean, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customers)
    .set({
      doNotService: doNotService ? 1 : 0,
      doNotServiceReason: doNotService ? (reason ?? null) : null,
    })
    .where(eq(customers.customerId, customerId));
  return { success: true };
}

// ─── Check if customer is on Do Not Service list ───
export async function isCustomerDoNotService(customerId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ doNotService: customers.doNotService })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .limit(1);
  return rows[0]?.doNotService === 1;
}

// ─── Save Expo Push Token ─────────────────────────────────────────────────────
export async function savePushToken(customerId: string, pushToken: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(customers).set({ pushToken }).where(eq(customers.customerId, customerId));
}

// ─── Update Customer Profile (email / phone) ──────────────────────────────────
export async function updateCustomerProfile(customerId: string, data: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  profilePhotoUrl?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Partial<{
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  }> = {};
  if (data.email !== undefined) updateSet.email = data.email.toLowerCase();
  if (data.phone !== undefined) updateSet.phone = data.phone || null;
  if (data.firstName !== undefined) updateSet.firstName = data.firstName;
  if (data.lastName !== undefined) updateSet.lastName = data.lastName;
  if (data.profilePhotoUrl !== undefined) updateSet.profilePhotoUrl = data.profilePhotoUrl ?? null;
  if (Object.keys(updateSet).length === 0) return { success: true };
  await db.update(customers).set(updateSet).where(eq(customers.customerId, customerId));
  return { success: true };
}

// ─── Update Customer City (only sets if not already populated) ─────────────────
export async function updateCustomerCity(customerId: string, city: string) {
  const db = await getDb();
  if (!db || !city) return;
  // Only overwrite if city is currently empty/null
  const existing = await db.select({ city: customers.city }).from(customers).where(eq(customers.customerId, customerId)).limit(1);
  if (existing[0]?.city) return; // already has a city, don't overwrite
  await db.update(customers).set({ city }).where(eq(customers.customerId, customerId));
}

// ─── Get Customer by Phone (normalized last 10 digits) ───────────────────────
export async function getCustomerByPhone(phone: string) {
  const db = await getDb();
  if (!db) return null;
  const norm = phone.replace(/\D/g, "").slice(-10);
  if (!norm) return null;
  const rows = await db.select().from(customers).limit(200);
  return rows.find((c) => c.phone && c.phone.replace(/\D/g, "").slice(-10) === norm) ?? null;
}

// ─── Send Expo Push Notification to a customer ───────────────────────────────
export async function sendCustomerPushNotification(customerId: string, title: string, body: string, data?: Record<string, string>) {
  try {
    const customer = await getCustomerById(customerId);
    if (!customer?.pushToken) return;
    const token = customer.pushToken;
    if (!token.startsWith("ExponentPushToken[") && !token.startsWith("ExpoPushToken[")) return;
    const payload: Record<string, any> = { to: token, title, body, sound: "default" };
    if (data) payload.data = data;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "gzip, deflate" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[push] Failed to send customer push notification:", e);
  }
}

// ─── Find-or-create a customer from a manually-entered job ───────────────────
//
// Dedup strategy (in priority order):
//   1. Match by email (normalised, case-insensitive)
//   2. Match by phone (last 10 digits, digits-only comparison)
//   3. Create a new record
//
// For admin-created customers we set a random placeholder password hash so the
// row is valid.  The customer can later claim the account via "Forgot Password".
//
// Returns the customerId of the found or newly-created customer.
export async function findOrCreateManualCustomer(data: {
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const { customerName, customerEmail, customerPhone } = data;
  const emailNorm = customerEmail ? customerEmail.trim().toLowerCase() : null;
  const phoneNorm = customerPhone ? customerPhone.replace(/\D/g, "").slice(-10) : null;

  // Must have at least one identifier to link/create a customer
  if (!emailNorm && !phoneNorm) return null;

  // ── 1. Try to find by email first (most reliable dedup key) ──────────────
  if (emailNorm) {
    const rows = await db.select().from(customers)
      .where(eq(customers.email, emailNorm))
      .limit(1);
    if (rows[0]) {
      const existing = rows[0];
      // Opportunistically fill in phone if it was missing
      if (phoneNorm && !existing.phone) {
        await db.update(customers)
          .set({ phone: customerPhone! })
          .where(eq(customers.customerId, existing.customerId));
      }
      return existing.customerId;
    }
  }

  // ── 2. Try to find by phone (digits-only last-10 match) ──────────────────
  if (phoneNorm) {
    // Fetch a bounded set and compare normalised digits
    const allRows = await db.select().from(customers).limit(5000);
    const match = allRows.find(
      (c) => c.phone && c.phone.replace(/\D/g, "").slice(-10) === phoneNorm
    );
    if (match) {
      // Opportunistically fill in email if it was missing
      if (emailNorm && !match.email) {
        try {
          await db.update(customers)
            .set({ email: emailNorm })
            .where(eq(customers.customerId, match.customerId));
        } catch { /* ignore unique constraint violation — another row already has this email */ }
      }
      return match.customerId;
    }
  }

  // ── 3. Create a new customer record ──────────────────────────────────────
  // Parse first/last name from the full name string
  const nameParts = (customerName ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || "(Manual)";

  // Use a random placeholder password — the customer can reset it later
  const placeholderHash = createHash("sha256")
    .update(`manual_${randomBytes(16).toString("hex")}`)
    .digest("hex");

  // We need a valid unique email — if none provided, generate a placeholder
  const emailForInsert = emailNorm ?? `manual_${Date.now()}_${randomBytes(4).toString("hex")}@noemail.lwow`;

  const customerId = generateId("cust");
  try {
    await db.insert(customers).values({
      customerId,
      firstName,
      lastName,
      email: emailForInsert,
      phone: customerPhone ?? null,
      passwordHash: placeholderHash,
    });
    return customerId;
  } catch (e: any) {
    // Race condition: another request inserted the same email between our SELECT and INSERT
    if (emailNorm && (e?.code === "ER_DUP_ENTRY" || String(e).includes("Duplicate"))) {
      const retry = await db.select().from(customers)
        .where(eq(customers.email, emailNorm))
        .limit(1);
      return retry[0]?.customerId ?? null;
    }
    console.error("[findOrCreateManualCustomer] insert failed:", e);
    return null;
  }
}

/** Sync admin-applied discount and total back to the customer portal booking row.
 * Called whenever an admin edits discountAmount or totalPrice on a portal-originated job.
 */
export async function updateCustomerBookingPricing(
  bookingRef: string,
  data: { discountCode?: string | null; discountAmount?: string | null; total?: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.discountCode !== undefined) updateSet.discountCode = data.discountCode;
  if (data.discountAmount !== undefined) updateSet.discountAmount = data.discountAmount;
  if (data.total !== undefined) updateSet.total = data.total;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(customerBookings).set(updateSet as any).where(eq(customerBookings.bookingRef, bookingRef));
}

/** Record payment info on a customer portal booking and mark it as completed.
 * Called when admin/detailer collects payment (any method) for a portal-booked job.
 */
export async function savePortalBookingPayment(
  bookingRef: string,
  data: {
    paymentMethod: string;
    paymentIntentId?: string | null;
    paymentTotal: string;
    paymentPaidAt: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(customerBookings).set({
    paymentMethod: data.paymentMethod,
    paymentIntentId: data.paymentIntentId ?? null,
    paymentTotal: data.paymentTotal,
    paymentPaidAt: data.paymentPaidAt,
    status: "completed",
  } as any).where(eq(customerBookings.bookingRef, bookingRef));
}

// ─── Password Reset / Portal Access Setup ─────────────────────────────────────

export async function setCustomerPassword(customerId: string, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const hash = hashPassword(newPassword);
  await db.update(customers).set({ passwordHash: hash }).where(eq(customers.customerId, customerId));
}

export async function getCustomerPasswordStatus(email: string): Promise<{ exists: boolean; hasPassword: boolean; customerId: string | null; firstName: string | null }> {
  const db = await getDb();
  if (!db) return { exists: false, hasPassword: false, customerId: null, firstName: null };
  const rows = await db.select({
    customerId: customers.customerId,
    firstName: customers.firstName,
    passwordHash: customers.passwordHash,
  }).from(customers).where(eq(customers.email, email.toLowerCase())).limit(1);
  if (rows.length === 0) return { exists: false, hasPassword: false, customerId: null, firstName: null };
  const row = rows[0];
  return {
    exists: true,
    hasPassword: !!(row.passwordHash && row.passwordHash.length > 0),
    customerId: row.customerId,
    firstName: row.firstName ?? null,
  };
}

/** Store a short-lived password reset / portal-setup token in the DB */
export async function createPasswordResetToken(customerId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  // Reuse customer_sessions table with a special prefix so we can identify reset tokens
  await db.insert(customerSessions).values({
    sessionToken: `RESET_${token}`,
    customerId,
    expiresAt,
  });
  return token;
}

/** Validate a reset token and return the customerId if valid */
export async function validatePasswordResetToken(token: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const { gt } = await import("drizzle-orm");
  const rows = await db.select({
    customerId: customerSessions.customerId,
    expiresAt: customerSessions.expiresAt,
  }).from(customerSessions)
    .where(eq(customerSessions.sessionToken, `RESET_${token}`))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (new Date(row.expiresAt) < new Date()) return null; // expired
  return row.customerId;
}

/** Consume (delete) a reset token after use */
export async function consumePasswordResetToken(token: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(customerSessions).where(eq(customerSessions.sessionToken, `RESET_${token}`));
}

// ─── Guest Booking Lookup (no auth required) ───
export async function getGuestBookingByEmailAndRef(_email: string, bookingRef: string) {
  const db = await getDb();
  if (!db) return null;
  
  // Find the booking by reference
  const rows = await db.select({
    bookingRef: customerBookings.bookingRef,
    customerId: customerBookings.customerId,
    vehicleLabel: customerBookings.vehicleLabel,
    vehicleType: customerBookings.vehicleType,
    packageId: customerBookings.packageId,
    packageName: customerBookings.packageName,
    addons: customerBookings.addons,
    addressLabel: customerBookings.addressLabel,
    city: customerBookings.city,
    scheduledDate: customerBookings.scheduledDate,
    scheduledTime: customerBookings.scheduledTime,
    subtotal: customerBookings.subtotal,
    total: customerBookings.total,
    status: customerBookings.status,
    notes: customerBookings.notes,
    createdAt: customerBookings.createdAt,
    customerFirstName: customers.firstName,
    customerLastName: customers.lastName,
    customerEmail: customers.email,
    customerPhone: customers.phone,
  }).from(customerBookings)
    .leftJoin(customers, eq(customerBookings.customerId, customers.customerId))
    .where(
      eq(customerBookings.bookingRef, bookingRef)
    )
    .limit(1);
  
  return rows[0] ?? null;
}
