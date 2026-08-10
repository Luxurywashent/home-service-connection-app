import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

let _db: ReturnType<typeof drizzle> | null = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch { _db = null; }
  }
  return _db;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FleetVan {
  id: string;
  name: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  plate?: string;
  color?: string;
  city?: string;
  odometer: number;
  fuel_percent: number;
  battery_voltage: number;
  dtc_count: number;
  recall_count: number;
  status: "active" | "parked" | "maintenance";
  last_location?: string;
  last_lat?: number;
  last_lng?: number;
  last_seen_at?: string;
  assigned_driver?: string;
  device_imei?: string;
  created_at: string;
  updated_at: string;
}

export interface FleetMaintenance {
  id: string;
  van_id: string;
  type: string;
  description?: string;
  service_date: string;
  odometer_at_service?: number;
  next_due_date?: string;
  next_due_odometer?: number;
  cost?: number;
  shop_name?: string;
  notes?: string;
  created_at: string;
}

export interface FleetFuelLog {
  id: string;
  van_id: string;
  log_date: string;
  gallons?: number;
  cost_per_gallon?: number;
  total_cost?: number;
  odometer?: number;
  station?: string;
  created_at: string;
}

export interface FleetAlert {
  id: string;
  van_id: string;
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
  is_read: boolean;
  created_at: string;
  van_name?: string;
  van_city?: string;
}

export interface FleetTrip {
  id: string;
  van_id: string;
  trip_date: string;
  start_address?: string;
  end_address?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  distance_miles?: number;
  status: string;
  created_at: string;
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Van CRUD ─────────────────────────────────────────────────────────────────

export async function listVans(city?: string): Promise<FleetVan[]> {
  const db = await getDb();
  if (!db) return [];
  let query: any;
  if (city && city !== "all") {
    query = await db.execute(sql`SELECT * FROM fleet_vans WHERE city = ${city} ORDER BY name ASC`);
  } else {
    query = await db.execute(sql`SELECT * FROM fleet_vans ORDER BY name ASC`);
  }
  return (query[0] as FleetVan[]) ?? [];
}

export async function getVan(id: string): Promise<FleetVan | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`SELECT * FROM fleet_vans WHERE id = ${id} LIMIT 1`);
  const rows = result[0] as unknown as FleetVan[];
  return rows[0] ?? null;
}

export async function createVan(data: {
  name: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  plate?: string;
  color?: string;
  city?: string;
  odometer?: number;
  assigned_driver?: string;
  device_imei?: string;
}): Promise<{ id: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = genId();
  await db.execute(sql`
    INSERT INTO fleet_vans (id, name, make, model, year, vin, plate, color, city, odometer, assigned_driver, device_imei)
    VALUES (${id}, ${data.name}, ${data.make ?? null}, ${data.model ?? null}, ${data.year ?? null},
            ${data.vin ?? null}, ${data.plate ?? null}, ${data.color ?? null}, ${data.city ?? null},
            ${data.odometer ?? 0}, ${data.assigned_driver ?? null}, ${data.device_imei ?? null})
  `);
  return { id };
}

export async function updateVan(id: string, data: {
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  plate?: string;
  color?: string;
  city?: string;
  odometer?: number;
  fuel_percent?: number;
  battery_voltage?: number;
  dtc_count?: number;
  recall_count?: number;
  status?: "active" | "parked" | "maintenance";
  last_location?: string;
  last_lat?: number;
  last_lng?: number;
  last_seen_at?: string;
  assigned_driver?: string;
  device_imei?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Build update using individual field checks to keep type safety
  if (data.name !== undefined) await db.execute(sql`UPDATE fleet_vans SET name = ${data.name} WHERE id = ${id}`);
  if (data.make !== undefined) await db.execute(sql`UPDATE fleet_vans SET make = ${data.make} WHERE id = ${id}`);
  if (data.model !== undefined) await db.execute(sql`UPDATE fleet_vans SET model = ${data.model} WHERE id = ${id}`);
  if (data.year !== undefined) await db.execute(sql`UPDATE fleet_vans SET year = ${data.year} WHERE id = ${id}`);
  if (data.vin !== undefined) await db.execute(sql`UPDATE fleet_vans SET vin = ${data.vin} WHERE id = ${id}`);
  if (data.plate !== undefined) await db.execute(sql`UPDATE fleet_vans SET plate = ${data.plate} WHERE id = ${id}`);
  if (data.color !== undefined) await db.execute(sql`UPDATE fleet_vans SET color = ${data.color} WHERE id = ${id}`);
  if (data.city !== undefined) await db.execute(sql`UPDATE fleet_vans SET city = ${data.city} WHERE id = ${id}`);
  if (data.odometer !== undefined) await db.execute(sql`UPDATE fleet_vans SET odometer = ${data.odometer} WHERE id = ${id}`);
  if (data.fuel_percent !== undefined) await db.execute(sql`UPDATE fleet_vans SET fuel_percent = ${data.fuel_percent} WHERE id = ${id}`);
  if (data.battery_voltage !== undefined) await db.execute(sql`UPDATE fleet_vans SET battery_voltage = ${data.battery_voltage} WHERE id = ${id}`);
  if (data.dtc_count !== undefined) await db.execute(sql`UPDATE fleet_vans SET dtc_count = ${data.dtc_count} WHERE id = ${id}`);
  if (data.recall_count !== undefined) await db.execute(sql`UPDATE fleet_vans SET recall_count = ${data.recall_count} WHERE id = ${id}`);
  if (data.status !== undefined) await db.execute(sql`UPDATE fleet_vans SET status = ${data.status} WHERE id = ${id}`);
  if (data.last_location !== undefined) await db.execute(sql`UPDATE fleet_vans SET last_location = ${data.last_location} WHERE id = ${id}`);
  if (data.last_lat !== undefined) await db.execute(sql`UPDATE fleet_vans SET last_lat = ${data.last_lat} WHERE id = ${id}`);
  if (data.last_lng !== undefined) await db.execute(sql`UPDATE fleet_vans SET last_lng = ${data.last_lng} WHERE id = ${id}`);
  if (data.last_seen_at !== undefined) await db.execute(sql`UPDATE fleet_vans SET last_seen_at = ${data.last_seen_at} WHERE id = ${id}`);
  if (data.assigned_driver !== undefined) await db.execute(sql`UPDATE fleet_vans SET assigned_driver = ${data.assigned_driver} WHERE id = ${id}`);
  if (data.device_imei !== undefined) await db.execute(sql`UPDATE fleet_vans SET device_imei = ${data.device_imei} WHERE id = ${id}`);
}

export async function deleteVan(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`DELETE FROM fleet_vans WHERE id = ${id}`);
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export async function listMaintenance(vanId: string): Promise<FleetMaintenance[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT * FROM fleet_maintenance WHERE van_id = ${vanId} ORDER BY service_date DESC
  `);
  return (result[0] as unknown as FleetMaintenance[]) ?? [];
}

export async function addMaintenance(data: {
  van_id: string;
  type: string;
  description?: string;
  service_date: string;
  odometer_at_service?: number;
  next_due_date?: string;
  next_due_odometer?: number;
  cost?: number;
  shop_name?: string;
  notes?: string;
  proof_image_url?: string;
}): Promise<{ id: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = genId();
  await db.execute(sql`
    INSERT INTO fleet_maintenance (id, van_id, type, description, service_date, odometer_at_service, next_due_date, next_due_odometer, cost, shop_name, notes, proof_image_url)
    VALUES (${id}, ${data.van_id}, ${data.type}, ${data.description ?? null}, ${data.service_date},
            ${data.odometer_at_service ?? null}, ${data.next_due_date ?? null}, ${data.next_due_odometer ?? null},
            ${data.cost ?? null}, ${data.shop_name ?? null}, ${data.notes ?? null}, ${data.proof_image_url ?? null})
  `);
  return { id };
}

export async function deleteMaintenance(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`DELETE FROM fleet_maintenance WHERE id = ${id}`);
}

// ─── Fuel Logs ────────────────────────────────────────────────────────────────

export async function listFuelLogs(vanId: string): Promise<FleetFuelLog[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT * FROM fleet_fuel_logs WHERE van_id = ${vanId} ORDER BY log_date DESC
  `);
  return (result[0] as unknown as FleetFuelLog[]) ?? [];
}

export async function addFuelLog(data: {
  van_id: string;
  log_date: string;
  gallons?: number;
  cost_per_gallon?: number;
  total_cost?: number;
  odometer?: number;
  station?: string;
}): Promise<{ id: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = genId();
  await db.execute(sql`
    INSERT INTO fleet_fuel_logs (id, van_id, log_date, gallons, cost_per_gallon, total_cost, odometer, station)
    VALUES (${id}, ${data.van_id}, ${data.log_date}, ${data.gallons ?? null},
            ${data.cost_per_gallon ?? null}, ${data.total_cost ?? null},
            ${data.odometer ?? null}, ${data.station ?? null})
  `);
  return { id };
}

export async function deleteFuelLog(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`DELETE FROM fleet_fuel_logs WHERE id = ${id}`);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function listAlerts(city?: string, vanId?: string): Promise<FleetAlert[]> {
  const db = await getDb();
  if (!db) return [];
  let result: any;
  if (vanId) {
    result = await db.execute(sql`
      SELECT a.*, v.name AS van_name, v.city AS van_city
      FROM fleet_alerts a JOIN fleet_vans v ON a.van_id = v.id
      WHERE a.van_id = ${vanId}
      ORDER BY a.is_read ASC, a.created_at DESC
    `);
  } else if (city && city !== "all") {
    result = await db.execute(sql`
      SELECT a.*, v.name AS van_name, v.city AS van_city
      FROM fleet_alerts a JOIN fleet_vans v ON a.van_id = v.id
      WHERE v.city = ${city}
      ORDER BY a.is_read ASC, a.created_at DESC
    `);
  } else {
    result = await db.execute(sql`
      SELECT a.*, v.name AS van_name, v.city AS van_city
      FROM fleet_alerts a JOIN fleet_vans v ON a.van_id = v.id
      ORDER BY a.is_read ASC, a.created_at DESC
    `);
  }
  return ((result[0] as any[]) ?? []).map((r) => ({ ...r, is_read: !!r.is_read }));
}

export async function markAlertRead(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`UPDATE fleet_alerts SET is_read = 1 WHERE id = ${id}`);
}

export async function createAlert(data: {
  van_id: string;
  type: string;
  message: string;
  severity?: "info" | "warning" | "critical";
}): Promise<{ id: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = genId();
  await db.execute(sql`
    INSERT INTO fleet_alerts (id, van_id, type, message, severity)
    VALUES (${id}, ${data.van_id}, ${data.type}, ${data.message}, ${data.severity ?? "info"})
  `);
  return { id };
}

// ─── Trips ────────────────────────────────────────────────────────────────────

export async function listTrips(vanId: string, startDate?: string, endDate?: string): Promise<FleetTrip[]> {
  const db = await getDb();
  if (!db) return [];
  let result: any;
  if (startDate && endDate) {
    result = await db.execute(sql`
      SELECT * FROM fleet_trips WHERE van_id = ${vanId} AND trip_date >= ${startDate} AND trip_date <= ${endDate}
      ORDER BY trip_date DESC, start_time DESC
    `);
  } else if (startDate) {
    result = await db.execute(sql`
      SELECT * FROM fleet_trips WHERE van_id = ${vanId} AND trip_date >= ${startDate}
      ORDER BY trip_date DESC, start_time DESC
    `);
  } else {
    result = await db.execute(sql`
      SELECT * FROM fleet_trips WHERE van_id = ${vanId}
      ORDER BY trip_date DESC, start_time DESC LIMIT 50
    `);
  }
  return (result[0] as unknown as FleetTrip[]) ?? [];
}

export async function addTrip(data: {
  van_id: string;
  trip_date: string;
  start_address?: string;
  end_address?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  distance_miles?: number;
}): Promise<{ id: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const id = genId();
  await db.execute(sql`
    INSERT INTO fleet_trips (id, van_id, trip_date, start_address, end_address, start_time, end_time, duration_minutes, distance_miles)
    VALUES (${id}, ${data.van_id}, ${data.trip_date}, ${data.start_address ?? null}, ${data.end_address ?? null},
            ${data.start_time ?? null}, ${data.end_time ?? null},
            ${data.duration_minutes ?? null}, ${data.distance_miles ?? null})
  `);
  return { id };
}

// ─── Repair Equipment ─────────────────────────────────────────────────────────

export interface RepairEquipmentRow {
  equipmentId: string;
  name: string;
  category?: string;
  subIssues: string[];
  isActive: boolean;
  sortOrder: number;
}

export async function listRepairEquipment(): Promise<RepairEquipmentRow[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT equipment_id, name, category, sub_issues, is_active, sort_order
    FROM repair_equipment WHERE is_active = 1 ORDER BY sort_order ASC, name ASC
  `);
  return ((result[0] as unknown as any[]) ?? []).map((r) => ({
    equipmentId: r.equipment_id,
    name: r.name,
    category: r.category ?? undefined,
    subIssues: r.sub_issues ? JSON.parse(r.sub_issues) : [],
    isActive: !!r.is_active,
    sortOrder: r.sort_order ?? 0,
  }));
}

export async function addRepairEquipment(data: {
  name: string;
  category?: string;
  subIssues?: string[];
}): Promise<{ equipmentId: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const equipmentId = genId();
  const subIssuesJson = JSON.stringify(data.subIssues ?? []);
  await db.execute(sql`
    INSERT INTO repair_equipment (equipment_id, name, category, sub_issues)
    VALUES (${equipmentId}, ${data.name}, ${data.category ?? null}, ${subIssuesJson})
  `);
  return { equipmentId };
}

export async function updateRepairEquipment(data: {
  equipmentId: string;
  name?: string;
  category?: string;
  subIssues?: string[];
  isActive?: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (data.name !== undefined) await db.execute(sql`UPDATE repair_equipment SET name = ${data.name} WHERE equipment_id = ${data.equipmentId}`);
  if (data.category !== undefined) await db.execute(sql`UPDATE repair_equipment SET category = ${data.category} WHERE equipment_id = ${data.equipmentId}`);
  if (data.subIssues !== undefined) await db.execute(sql`UPDATE repair_equipment SET sub_issues = ${JSON.stringify(data.subIssues)} WHERE equipment_id = ${data.equipmentId}`);
  if (data.isActive !== undefined) await db.execute(sql`UPDATE repair_equipment SET is_active = ${data.isActive ? 1 : 0} WHERE equipment_id = ${data.equipmentId}`);
}

export async function deleteRepairEquipment(equipmentId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`UPDATE repair_equipment SET is_active = 0 WHERE equipment_id = ${equipmentId}`);
}

// ─── Repair Orders ────────────────────────────────────────────────────────────

export interface RepairOrderRow {
  repairId: string;
  vanId: string;
  vanName?: string;
  employeeId: string;
  employeeName?: string;
  equipmentId: string;
  equipmentName: string;
  subIssue?: string;
  notes?: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "medium" | "high";
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listRepairOrders(filter: {
  status?: "open" | "in_progress" | "resolved" | "all";
  vanId?: string;
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<RepairOrderRow[]> {
  const db = await getDb();
  if (!db) return [];
  const statusFilter = filter.status && filter.status !== "all" ? filter.status : null;
  // Build conditions
  const parts: string[] = [];
  if (filter.vanId) parts.push(`van_id = '${filter.vanId.replace(/'/g, "''")}' `);
  if (filter.employeeId) parts.push(`employee_id = '${filter.employeeId.replace(/'/g, "''")}' `);
  if (statusFilter) parts.push(`status = '${statusFilter}' `);
  if (filter.dateFrom) parts.push(`DATE(created_at) >= '${filter.dateFrom}' `);
  if (filter.dateTo) parts.push(`DATE(created_at) <= '${filter.dateTo}' `);
  const where = parts.length > 0 ? `WHERE ${parts.join("AND ")}` : "";
  const rawSql = `SELECT * FROM repair_orders ${where} ORDER BY created_at DESC LIMIT 500`;
  const result = await db.execute(sql.raw(rawSql));
  return ((result[0] as unknown as any[]) ?? []).map((r) => ({
    repairId: r.repair_id,
    vanId: r.van_id,
    vanName: r.van_name ?? undefined,
    employeeId: r.employee_id,
    employeeName: r.employee_name ?? undefined,
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name,
    subIssue: r.sub_issue ?? undefined,
    notes: r.notes ?? undefined,
    status: r.status,
    priority: r.priority,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : undefined,
    resolvedBy: r.resolved_by ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function countOpenRepairs(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(sql`SELECT COUNT(*) as cnt FROM repair_orders WHERE status IN ('open','in_progress')`);
  const rows = result[0] as unknown as any[];
  return Number(rows[0]?.cnt ?? 0);
}

export async function createRepairOrder(data: {
  vanId: string;
  vanName?: string;
  employeeId: string;
  employeeName?: string;
  equipmentId: string;
  equipmentName: string;
  subIssue?: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
}): Promise<{ repairId: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const repairId = genId();
  await db.execute(sql`
    INSERT INTO repair_orders (repair_id, van_id, van_name, employee_id, employee_name, equipment_id, equipment_name, sub_issue, notes, priority)
    VALUES (${repairId}, ${data.vanId}, ${data.vanName ?? null}, ${data.employeeId}, ${data.employeeName ?? null},
            ${data.equipmentId}, ${data.equipmentName}, ${data.subIssue ?? null}, ${data.notes ?? null}, ${data.priority ?? "medium"})
  `);
  return { repairId };
}

export async function updateRepairStatus(data: {
  repairId: string;
  status: "open" | "in_progress" | "resolved";
  resolvedBy?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (data.status === "resolved") {
    await db.execute(sql`
      UPDATE repair_orders SET status = ${data.status}, resolved_at = NOW(), resolved_by = ${data.resolvedBy ?? null}
      WHERE repair_id = ${data.repairId}
    `);
  } else {
    await db.execute(sql`UPDATE repair_orders SET status = ${data.status} WHERE repair_id = ${data.repairId}`);
  }
}

// ─── Van Assignment ───────────────────────────────────────────────────────────

export interface VanAssignment {
  employeeId: string;
  vanId: string;
  vanName?: string;
  shift: "shift1" | "shift2";
  assignedAt: string;
  assignedBy?: string;
}

function mapVanAssignment(r: any): VanAssignment {
  return {
    employeeId: r.employee_id,
    vanId: r.van_id,
    vanName: r.van_name ?? undefined,
    shift: (r.shift ?? "shift1") as "shift1" | "shift2",
    assignedAt: new Date(r.assigned_at).toISOString(),
    assignedBy: r.assigned_by ?? undefined,
  };
}

/** Get the van assignment for a single employee */
export async function getVanAssignment(employeeId: string): Promise<VanAssignment | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`SELECT * FROM employee_van_assignments WHERE employee_id = ${employeeId} LIMIT 1`);
  const rows = result[0] as unknown as any[];
  return rows[0] ? mapVanAssignment(rows[0]) : null;
}

/** Get all assignments for a van (up to 2: shift1 + shift2) */
export async function getVanAssignments(vanId: string): Promise<VanAssignment[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`SELECT * FROM employee_van_assignments WHERE van_id = ${vanId} ORDER BY shift ASC`);
  return ((result[0] as unknown as any[]) ?? []).map(mapVanAssignment);
}

/** Get all assignments across all vans */
export async function getAllVanAssignments(): Promise<VanAssignment[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`SELECT * FROM employee_van_assignments ORDER BY van_id, shift ASC`);
  return ((result[0] as unknown as any[]) ?? []).map(mapVanAssignment);
}

/** Assign an employee to a van+shift slot. Removes any prior assignment for that employee first. */
export async function setVanAssignment(data: {
  employeeId: string;
  vanId: string;
  vanName?: string;
  shift: "shift1" | "shift2";
  assignedBy?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Remove any existing assignment for this employee (can't be on 2 vans)
  await db.execute(sql`DELETE FROM employee_van_assignments WHERE employee_id = ${data.employeeId}`);
  // Insert into the new slot (replace if van+shift slot already taken)
  await db.execute(sql`
    INSERT INTO employee_van_assignments (employee_id, van_id, van_name, shift, assigned_by)
    VALUES (${data.employeeId}, ${data.vanId}, ${data.vanName ?? null}, ${data.shift}, ${data.assignedBy ?? null})
    ON DUPLICATE KEY UPDATE employee_id = ${data.employeeId}, van_name = ${data.vanName ?? null}, assigned_by = ${data.assignedBy ?? null}, assigned_at = NOW()
  `);
}

export async function removeVanAssignment(employeeId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`DELETE FROM employee_van_assignments WHERE employee_id = ${employeeId}`);
}
