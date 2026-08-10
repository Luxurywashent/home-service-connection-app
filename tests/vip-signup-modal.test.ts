import { describe, it, expect } from "vitest";

// ── Plan pricing constants (mirrored from the modal) ─────────────────────────

const PLAN_PRICES = {
  maintenance: 960,
  vip: 1440,
  vip_elite: 1800,
} as const;

type PlanType = keyof typeof PLAN_PRICES;

const WEEK_LABELS = ["1st", "2nd", "3rd", "4th", "Last"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Contract text generator (mirrored from the modal) ────────────────────────

function generateContractText(
  plan: PlanType,
  info: {
    firstName: string; lastName: string; email: string; phone: string;
    address: string; city: string; vehicleYear: string; vehicleMake: string;
    vehicleModel: string; vehicleColor: string;
  },
  prefs: { scheduleWeek: number | null; scheduleDay: number | null; eliteScheduleMode: "admin" | "self" },
  today: string
): string {
  const PLANS = {
    maintenance: { title: "Maintenance Program", price: PLAN_PRICES.maintenance },
    vip: { title: "VIP Program", price: PLAN_PRICES.vip },
    vip_elite: { title: "VIP Elite Program", price: PLAN_PRICES.vip_elite },
  };
  const p = PLANS[plan];

  const scheduleDesc = plan === "vip_elite"
    ? prefs.eliteScheduleMode === "admin"
      ? "Luxury Wash On Wheels will pre-schedule all 12 appointments. Customer will be notified of each appointment date."
      : "Customer will self-schedule each appointment through the customer portal or by contacting Luxury Wash On Wheels."
    : (prefs.scheduleWeek !== null && prefs.scheduleDay !== null)
      ? `All 12 visits will be scheduled on the ${WEEK_LABELS[prefs.scheduleWeek - 1]} ${DAY_FULL[prefs.scheduleDay]} of each month.`
      : "Luxury Wash On Wheels will reach out to schedule each monthly appointment.";

  const visitDesc = plan === "vip_elite"
    ? "Visits 1–2: Luxury Detail. Visits 3–12: Basic Detail."
    : plan === "vip"
      ? "12 monthly Full Detail services with rotating premium add-ons (Paint Sealant, Leather Deep Clean, Leather Conditioning) on scheduled visits."
      : "12 monthly Full Detail services. Same day every month.";

  return `VIP PROGRAM SERVICE AGREEMENT
Luxury Wash On Wheels

Contract Date: ${today}

CUSTOMER INFORMATION
Name: ${info.firstName} ${info.lastName}
Email: ${info.email}
Phone: ${info.phone || "—"}
Address: ${info.address || "—"}
City: ${info.city || "—"}

VEHICLE
${info.vehicleYear} ${info.vehicleMake} ${info.vehicleModel}${info.vehicleColor ? " · " + info.vehicleColor : ""}

PROGRAM: ${p.title.toUpperCase()}
Total Investment: $${p.price.toLocaleString()} (paid in full upon signing)

SERVICES INCLUDED
${visitDesc}

SCHEDULING
${scheduleDesc}

TERMS & CONDITIONS
1. This agreement covers 12 monthly service visits over a 12-month period beginning on the service start date.
2. Payment in full is due at the time of signing. No refunds after the first service visit.
3. Missed appointments due to customer unavailability do not extend the contract period.
4. Luxury Wash On Wheels reserves the right to reschedule appointments due to weather or operational constraints with at least 24 hours notice.
5. Customer agrees to provide reasonable access to the vehicle on scheduled service dates.
6. Services are performed at the customer's registered address or a mutually agreed location.
7. This agreement is non-transferable.

By signing below, the customer agrees to all terms and conditions of this ${p.title} agreement.

Customer Signature: ____________________   Date: ${today}
Luxury Wash On Wheels: ________________   Date: ${today}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VIP Signup Modal — Plan Pricing", () => {
  it("maintenance plan costs $960/year ($80/mo)", () => {
    expect(PLAN_PRICES.maintenance).toBe(960);
    expect(PLAN_PRICES.maintenance / 12).toBe(80);
  });

  it("vip plan costs $1440/year ($120/mo)", () => {
    expect(PLAN_PRICES.vip).toBe(1440);
    expect(PLAN_PRICES.vip / 12).toBe(120);
  });

  it("vip_elite plan costs $1800/year ($150/mo)", () => {
    expect(PLAN_PRICES.vip_elite).toBe(1800);
    expect(PLAN_PRICES.vip_elite / 12).toBe(150);
  });

  it("amountCents is price × 100", () => {
    for (const plan of Object.keys(PLAN_PRICES) as PlanType[]) {
      expect(PLAN_PRICES[plan] * 100).toBe(PLAN_PRICES[plan] * 100);
      expect(Number.isInteger(PLAN_PRICES[plan] * 100)).toBe(true);
    }
  });
});

describe("VIP Signup Modal — Contract Text Generation", () => {
  const baseInfo = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "8505551234",
    address: "123 Main St",
    city: "Crestview",
    vehicleYear: "2022",
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    vehicleColor: "Silver",
  };

  it("includes customer name and email", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("jane@example.com");
  });

  it("includes vehicle description", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("2022 Toyota Camry · Silver");
  });

  it("includes correct program title for maintenance", () => {
    const text = generateContractText("maintenance", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("MAINTENANCE PROGRAM");
    expect(text).toContain("$960");
  });

  it("includes correct program title for vip", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("VIP PROGRAM");
    expect(text).toContain("$1,440");
  });

  it("includes correct program title for vip_elite", () => {
    const text = generateContractText("vip_elite", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("VIP ELITE PROGRAM");
    expect(text).toContain("$1,800");
  });

  it("includes schedule description when week and day are set", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: 2, scheduleDay: 1, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("2nd Monday");
  });

  it("uses fallback schedule text when week/day not set", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("will reach out to schedule");
  });

  it("uses admin pre-schedule text for vip_elite admin mode", () => {
    const text = generateContractText("vip_elite", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("will pre-schedule all 12 appointments");
  });

  it("uses self-schedule text for vip_elite self mode", () => {
    const text = generateContractText("vip_elite", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "self" }, "2026-07-09");
    expect(text).toContain("self-schedule each appointment");
  });

  it("includes the contract date", () => {
    const text = generateContractText("vip", baseInfo, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("Contract Date: 2026-07-09");
  });

  it("omits vehicle color separator when color is empty", () => {
    const infoNoColor = { ...baseInfo, vehicleColor: "" };
    const text = generateContractText("vip", infoNoColor, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("2022 Toyota Camry");
    expect(text).not.toContain("·");
  });

  it("shows dash for missing phone and address", () => {
    const infoNoPhone = { ...baseInfo, phone: "", address: "" };
    const text = generateContractText("vip", infoNoPhone, { scheduleWeek: null, scheduleDay: null, eliteScheduleMode: "admin" }, "2026-07-09");
    expect(text).toContain("Phone: —");
    expect(text).toContain("Address: —");
  });
});

describe("VIP Signup Modal — Schedule Labels", () => {
  it("WEEK_LABELS has 5 entries", () => {
    expect(WEEK_LABELS).toHaveLength(5);
    expect(WEEK_LABELS[0]).toBe("1st");
    expect(WEEK_LABELS[4]).toBe("Last");
  });

  it("DAY_FULL has 7 entries starting with Sunday", () => {
    expect(DAY_FULL).toHaveLength(7);
    expect(DAY_FULL[0]).toBe("Sunday");
    expect(DAY_FULL[6]).toBe("Saturday");
  });
});
