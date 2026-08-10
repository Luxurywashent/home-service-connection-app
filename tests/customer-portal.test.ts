import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://127.0.0.1:3000/api/trpc";

async function trpcMutation(path: string, input: unknown) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.json.message);
  return data.result.data.json;
}

async function trpcQuery(path: string, input: unknown) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const res = await fetch(`${BASE}/${path}?input=${encoded}`);
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.json.message);
  return data.result.data.json;
}

const testEmail = `test_${Date.now()}@luxurywash.test`;
let sessionToken = "";
let customerId = "";
let vehicleId = "";
let addressId = "";

describe("Customer Portal — Signup & Auth", () => {
  it("should sign up a new customer", async () => {
    const result = await trpcMutation("customer.signup", {
      firstName: "Test",
      lastName: "Customer",
      email: testEmail,
      phone: "8501234567",
      password: "test123",
    });
    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
    expect(result.customer.email).toBe(testEmail);
    sessionToken = result.token;
    customerId = result.customer.customerId;
  });

  it("should reject duplicate email signup", async () => {
    const result = await trpcMutation("customer.signup", {
      firstName: "Test",
      lastName: "Customer",
      email: testEmail,
      password: "test123",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
  });

  it("should login with correct credentials", async () => {
    const result = await trpcMutation("customer.login", {
      email: testEmail,
      password: "test123",
    });
    expect(result.success).toBe(true);
    expect(result.token).toBeTruthy();
    sessionToken = result.token;
  });

  it("should reject wrong password", async () => {
    const result = await trpcMutation("customer.login", {
      email: testEmail,
      password: "wrongpassword",
    });
    expect(result.success).toBe(false);
  });

  it("should get customer profile via session token", async () => {
    const result = await trpcQuery("customer.me", { token: sessionToken });
    expect(result).toBeTruthy();
    expect(result.email).toBe(testEmail);
    expect(result.firstName).toBe("Test");
  });
});

describe("Customer Portal — Vehicles", () => {
  it("should add a vehicle", async () => {
    const result = await trpcMutation("customer.addVehicle", {
      token: sessionToken,
      year: "2022",
      make: "Toyota",
      model: "Camry",
      vehicleType: "sedan",
      color: "Silver",
      isDefault: true,
    });
    expect(result.vehicleId).toBeTruthy();
    vehicleId = result.vehicleId;
  });

  it("should list vehicles", async () => {
    const result = await trpcQuery("customer.listVehicles", { token: sessionToken });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].make).toBe("Toyota");
  });

  it("should update a vehicle", async () => {
    const result = await trpcMutation("customer.updateVehicle", {
      token: sessionToken,
      vehicleId,
      color: "Black",
    });
    expect(result.success).toBe(true);
  });
});

describe("Customer Portal — Addresses", () => {
  it("should add an address", async () => {
    const result = await trpcMutation("customer.addAddress", {
      token: sessionToken,
      label: "Home",
      street: "123 Main St",
      city: "Crestview",
      state: "FL",
      zip: "32536",
      isDefault: true,
    });
    expect(result.addressId).toBeTruthy();
    addressId = result.addressId;
  });

  it("should list addresses", async () => {
    const result = await trpcQuery("customer.listAddresses", { token: sessionToken });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].city).toBe("Crestview");
  });
});

describe("Customer Portal — Bookings", () => {
  it("should create a booking", async () => {
    const result = await trpcMutation("customer.createBooking", {
      token: sessionToken,
      vehicleId,
      vehicleType: "sedan",
      vehicleLabel: "2022 Toyota Camry",
      packageId: "full_detail",
      packageName: "Full Detail",
      addons: ["rain_x", "clay_bar"],
      addressId,
      addressLabel: "123 Main St, Crestview FL 32536",
      city: "Crestview",
      scheduledDate: "2026-05-05",
      scheduledTime: "8:00am - 12:00pm",
      subtotal: 325,
      total: 325,
    });
    expect(result.bookingRef).toBeTruthy();
    expect(result.status).toBe("pending");
  });

  it("should list bookings", async () => {
    const result = await trpcQuery("customer.listBookings", { token: sessionToken });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].packageName).toBe("Full Detail");
  });
});
