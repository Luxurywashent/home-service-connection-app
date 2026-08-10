/**
 * Unit tests for findOrCreateManualCustomer dedup logic.
 *
 * These tests mock the database layer so they run without a real DB connection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the drizzle DB so tests run without a real connection ────────────────
const mockRows: any[] = [];
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mockRows) }),
        limit: () => Promise.resolve(mockRows),
      }),
    }),
    insert: () => ({ values: mockInsert }),
    update: () => ({ set: () => ({ where: mockUpdate }) }),
  })),
}));

// Provide a fake DATABASE_URL so getDb() doesn't bail out
process.env.DATABASE_URL = "mysql://fake:fake@localhost/fake";

// ── Import after mocks are set up ─────────────────────────────────────────────
import { findOrCreateManualCustomer } from "./customerDb";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCustomer(overrides: Partial<{ customerId: string; email: string; phone: string | null }> = {}) {
  return {
    customerId: overrides.customerId ?? "cust_existing",
    firstName: "Jane",
    lastName: "Doe",
    email: overrides.email ?? "jane@example.com",
    phone: overrides.phone ?? "8505551234",
    passwordHash: "hash",
    pushToken: null,
    profilePhotoUrl: null,
    doNotService: 0,
    doNotServiceReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("findOrCreateManualCustomer", () => {
  beforeEach(() => {
    mockRows.length = 0;
    mockInsert.mockReset();
    mockUpdate.mockReset();
    mockInsert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it("returns null when neither email nor phone is provided", async () => {
    const result = await findOrCreateManualCustomer({});
    expect(result).toBeNull();
  });

  it("returns existing customerId when email matches", async () => {
    mockRows.push(makeCustomer({ customerId: "cust_abc", email: "jane@example.com" }));
    const result = await findOrCreateManualCustomer({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "8505551234",
    });
    expect(result).toBe("cust_abc");
    // Should NOT insert a new row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("is case-insensitive for email matching", async () => {
    mockRows.push(makeCustomer({ customerId: "cust_abc", email: "jane@example.com" }));
    const result = await findOrCreateManualCustomer({
      customerEmail: "JANE@EXAMPLE.COM",
    });
    expect(result).toBe("cust_abc");
  });

  it("creates a new customer when no match is found", async () => {
    // No existing rows — mockRows is empty
    let capturedId: string | null = null;
    mockInsert.mockImplementation((vals: any) => {
      capturedId = vals.customerId;
      mockRows.push(makeCustomer({ customerId: vals.customerId, email: vals.email }));
      return Promise.resolve(undefined);
    });

    const result = await findOrCreateManualCustomer({
      customerName: "New Customer",
      customerEmail: "new@example.com",
      customerPhone: "8505559999",
    });
    expect(result).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("does not create a duplicate when called twice with the same email", async () => {
    // First call — no existing customer
    mockInsert.mockImplementationOnce((vals: any) => {
      mockRows.push(makeCustomer({ customerId: vals.customerId, email: vals.email }));
      return Promise.resolve(undefined);
    });

    const id1 = await findOrCreateManualCustomer({
      customerEmail: "dup@example.com",
      customerPhone: "8501111111",
    });

    // Second call — same email, customer now exists in mockRows
    const id2 = await findOrCreateManualCustomer({
      customerEmail: "dup@example.com",
      customerPhone: "8501111111",
    });

    expect(id1).toBeTruthy();
    expect(id2).toBe(id1); // same customer, no duplicate
    expect(mockInsert).toHaveBeenCalledTimes(1); // only one INSERT
  });
});
