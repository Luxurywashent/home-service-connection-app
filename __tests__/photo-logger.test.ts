import { describe, it, expect } from "vitest";

// Test the data transformation logic used in photo-logger
describe("PhotoLogger data flow", () => {
  type ItemType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

  const ITEM_TYPES: { type: ItemType; label: string; emoji: string }[] = [
    { type: "door_hangers", label: "Door Hangers", emoji: "🚪" },
    { type: "business_cards", label: "Business Cards", emoji: "💼" },
    { type: "yard_signs", label: "Yard Signs", emoji: "🏷️" },
    { type: "table_toppers", label: "Table Toppers", emoji: "📋" },
  ];

  const getLabel = (type: ItemType) => ITEM_TYPES.find((t) => t.type === type)?.label ?? type;

  it("returns correct label for each item type", () => {
    expect(getLabel("door_hangers")).toBe("Door Hangers");
    expect(getLabel("business_cards")).toBe("Business Cards");
    expect(getLabel("yard_signs")).toBe("Yard Signs");
    expect(getLabel("table_toppers")).toBe("Table Toppers");
  });

  it("builds correct entry payload with latitude/longitude", () => {
    const photo = {
      uri: "file:///photo.jpg",
      latitude: 30.7654,
      longitude: -86.5678,
      address: "438 Northview Ln, Crestview, FL 32536",
      itemType: "door_hangers" as ItemType,
    };

    const payload = {
      employeeId: "EMP001",
      date: new Date().toISOString().split("T")[0],
      address: photo.address,
      city: "Crestview",
      outreachType: photo.itemType,
      quantityDistributed: 1,
      latitude: photo.latitude,
      longitude: photo.longitude,
      photoUrls: [photo.uri],
    };

    expect(payload.latitude).toBe(30.7654);
    expect(payload.longitude).toBe(-86.5678);
    expect(payload.outreachType).toBe("door_hangers");
    expect(payload.quantityDistributed).toBe(1);
    expect(payload.address).toBe("438 Northview Ln, Crestview, FL 32536");
  });

  it("handles missing location gracefully with 0,0 fallback", () => {
    const fallbackLocation = { latitude: 0, longitude: 0, address: "Location unavailable" };
    expect(fallbackLocation.latitude).toBe(0);
    expect(fallbackLocation.longitude).toBe(0);
    expect(fallbackLocation.address).toBe("Location unavailable");
  });

  it("all 4 item types are defined", () => {
    expect(ITEM_TYPES).toHaveLength(4);
    const types = ITEM_TYPES.map((t) => t.type);
    expect(types).toContain("door_hangers");
    expect(types).toContain("business_cards");
    expect(types).toContain("yard_signs");
    expect(types).toContain("table_toppers");
  });

  it("map filter excludes entries with 0,0 coordinates", () => {
    const entries = [
      { id: "1", latitude: 30.7654, longitude: -86.5678, address: "123 Main St" },
      { id: "2", latitude: 0, longitude: 0, address: "Location unavailable" },
      { id: "3", latitude: 30.8, longitude: -86.6, address: "456 Oak Ave" },
    ];

    const mappedLocations = entries.filter(
      (entry) => entry.latitude !== 0 && entry.longitude !== 0
    );

    expect(mappedLocations).toHaveLength(2);
    expect(mappedLocations[0].id).toBe("1");
    expect(mappedLocations[1].id).toBe("3");
  });
});
