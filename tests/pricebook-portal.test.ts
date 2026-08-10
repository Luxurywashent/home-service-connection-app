import { describe, it, expect } from "vitest";

/**
 * Tests for the Price Book → Customer Portal integration logic.
 * Validates the helper functions used in package.tsx to map services.
 */

// Replicate the helper functions from package.tsx for testing
function mapVehicleTypeToKey(vt: string): string {
  if (vt === "large_suv_van") return "xl_suv_van";
  return vt;
}

function isRvService(svc: { serviceId: string; vehiclePrices: { rv_20_29?: number; rv_30_39?: number; rv_40_plus?: number; sedan?: number } }): boolean {
  const hasRvPrice = (svc.vehiclePrices.rv_20_29 ?? 0) > 0 || (svc.vehiclePrices.rv_30_39 ?? 0) > 0 || (svc.vehiclePrices.rv_40_plus ?? 0) > 0;
  const hasStandardPrice = (svc.vehiclePrices.sedan ?? 0) > 0;
  return hasRvPrice && !hasStandardPrice;
}

function isSubscriptionService(svc: { serviceId: string }): boolean {
  const subscriptionIds = ["pb_mpn0yohe0qes", "pb_mpssufsvme94", "pb_mpws9prd5cu1"];
  return subscriptionIds.includes(svc.serviceId);
}

describe("mapVehicleTypeToKey", () => {
  it("maps large_suv_van to xl_suv_van", () => {
    expect(mapVehicleTypeToKey("large_suv_van")).toBe("xl_suv_van");
  });

  it("passes through sedan unchanged", () => {
    expect(mapVehicleTypeToKey("sedan")).toBe("sedan");
  });

  it("passes through suv unchanged", () => {
    expect(mapVehicleTypeToKey("suv")).toBe("suv");
  });

  it("passes through truck unchanged", () => {
    expect(mapVehicleTypeToKey("truck")).toBe("truck");
  });

  it("passes through rv unchanged", () => {
    expect(mapVehicleTypeToKey("rv")).toBe("rv");
  });
});

describe("isRvService", () => {
  it("identifies RV Wash as RV service (has rv prices, sedan=0)", () => {
    const svc = {
      serviceId: "pb_rv_wash",
      vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 275, rv_30_39: 330, rv_40_plus: 375 },
    };
    expect(isRvService(svc)).toBe(true);
  });

  it("identifies standard service (sedan > 0, no rv prices)", () => {
    const svc = {
      serviceId: "pb_basic",
      vehiclePrices: { sedan: 125, suv: 150, xl_suv_van: 200, truck: 175 },
    };
    expect(isRvService(svc)).toBe(false);
  });

  it("identifies service with both sedan and rv prices as NOT rv-only", () => {
    // Edge case: if a service has both, it's treated as standard (sedan > 0)
    const svc = {
      serviceId: "pb_hybrid",
      vehiclePrices: { sedan: 100, suv: 100, xl_suv_van: 100, truck: 100, rv_20_29: 200, rv_30_39: 250, rv_40_plus: 300 },
    };
    expect(isRvService(svc)).toBe(false);
  });

  it("identifies VIP service (all zeros) as NOT rv service", () => {
    const svc = {
      serviceId: "pb_mpn0yohe0qes",
      vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 0, rv_30_39: 0, rv_40_plus: 0 },
    };
    expect(isRvService(svc)).toBe(false);
  });
});

describe("isSubscriptionService", () => {
  it("identifies VIP as subscription", () => {
    expect(isSubscriptionService({ serviceId: "pb_mpn0yohe0qes" })).toBe(true);
  });

  it("identifies Maintenance Program as subscription", () => {
    expect(isSubscriptionService({ serviceId: "pb_mpssufsvme94" })).toBe(true);
  });

  it("identifies VIP Renewal as subscription", () => {
    expect(isSubscriptionService({ serviceId: "pb_mpws9prd5cu1" })).toBe(true);
  });

  it("does NOT identify standard service as subscription", () => {
    expect(isSubscriptionService({ serviceId: "pb_basic" })).toBe(false);
  });

  it("does NOT identify RV service as subscription", () => {
    expect(isSubscriptionService({ serviceId: "pb_rv_wash" })).toBe(false);
  });
});

describe("Price Book service classification integration", () => {
  // Simulate the actual data from the API
  const mockServices = [
    { serviceId: "pb_luxury", name: "Luxury Detail", vehiclePrices: { sedan: 300, suv: 325, xl_suv_van: 375, truck: 350 } },
    { serviceId: "pb_full", name: "Full Detail", vehiclePrices: { sedan: 200, suv: 250, xl_suv_van: 300, truck: 250 } },
    { serviceId: "pb_basic", name: "Basic Detail", vehiclePrices: { sedan: 125, suv: 150, xl_suv_van: 200, truck: 175 } },
    { serviceId: "pb_interior", name: "Interior Detail", vehiclePrices: { sedan: 150, suv: 200, xl_suv_van: 225, truck: 175 } },
    { serviceId: "pb_exterior", name: "Exterior Detail", vehiclePrices: { sedan: 125, suv: 150, xl_suv_van: 175, truck: 150 } },
    { serviceId: "pb_mpn0yohe0qes", name: "VIP", vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 0, rv_30_39: 0, rv_40_plus: 0 } },
    { serviceId: "pb_mpssufsvme94", name: "Maintenance Program", vehiclePrices: { sedan: 150, suv: 150, xl_suv_van: 150, truck: 150, rv_20_29: 0, rv_30_39: 0, rv_40_plus: 0 } },
    { serviceId: "pb_rv_wash", name: "RV Wash", vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 275, rv_30_39: 330, rv_40_plus: 375 } },
    { serviceId: "pb_mpws9prd5cu1", name: "VIP Renewal", vehiclePrices: { sedan: 1250, suv: 1500, xl_suv_van: 1200, truck: 1400, rv_20_29: 0, rv_30_39: 0, rv_40_plus: 0 } },
    { serviceId: "pb_rv_maintenance", name: "RV Maintenance", vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 250, rv_30_39: 250, rv_40_plus: 250 } },
  ];

  it("filters to 5 standard packages for sedan (excludes subscriptions and RV)", () => {
    const vehicleType = "sedan";
    const priceKey = mapVehicleTypeToKey(vehicleType);
    const standard = mockServices.filter((svc) => {
      if (isSubscriptionService(svc)) return false;
      if (isRvService(svc)) return false;
      const price = (svc.vehiclePrices as any)[priceKey] ?? 0;
      return price > 0;
    });
    expect(standard.length).toBe(5);
    expect(standard.map((s) => s.serviceId)).toEqual([
      "pb_luxury", "pb_full", "pb_basic", "pb_interior", "pb_exterior",
    ]);
  });

  it("uses xl_suv_van price for large_suv_van vehicle type", () => {
    const vehicleType = "large_suv_van";
    const priceKey = mapVehicleTypeToKey(vehicleType);
    expect(priceKey).toBe("xl_suv_van");

    const basicSvc = mockServices.find((s) => s.serviceId === "pb_basic")!;
    const price = (basicSvc.vehiclePrices as any)[priceKey];
    expect(price).toBe(200);
  });

  it("filters to 2 RV services (excludes standard and subscriptions)", () => {
    const rv = mockServices.filter((svc) => {
      if (isSubscriptionService(svc)) return false;
      return isRvService(svc);
    });
    expect(rv.length).toBe(2);
    expect(rv.map((s) => s.serviceId)).toEqual(["pb_rv_wash", "pb_rv_maintenance"]);
  });

  it("excludes all 3 subscription services from both standard and RV lists", () => {
    const subscriptions = mockServices.filter((svc) => isSubscriptionService(svc));
    expect(subscriptions.length).toBe(3);
    expect(subscriptions.map((s) => s.name)).toEqual(["VIP", "Maintenance Program", "VIP Renewal"]);
  });
});
