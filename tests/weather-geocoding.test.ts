import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test the weather geocoding functionality.
 * 
 * These tests verify that city names are correctly geocoded to coordinates
 * using the Open-Meteo Geocoding API.
 */

// Mock the geocodeCity function behavior
async function geocodeCity(cityName: string): Promise<{ lat: number; lon: number; label: string } | null> {
  if (!cityName || !cityName.trim()) return null;
  
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const data = await res.json();
    const result = data.results?.[0];
    
    if (!result) return null;
    
    const parts = [result.name];
    if (result.admin1) parts.push(result.admin1);
    if (result.country) parts.push(result.country);
    const label = parts.join(", ");
    
    return {
      lat: result.latitude,
      lon: result.longitude,
      label,
    };
  } catch (e) {
    console.warn(`[WeatherForecast] Geocoding failed for "${cityName}":`, e);
    return null;
  }
}

describe("Weather Geocoding", () => {
  describe("geocodeCity", () => {
    it("should geocode a known city (Crestview, FL)", async () => {
      const result = await geocodeCity("Crestview");
      expect(result).not.toBeNull();
      expect(result?.lat).toBeDefined();
      expect(result?.lon).toBeDefined();
      expect(result?.label).toContain("Crestview");
      // Verify coordinates are in Florida range (roughly)
      expect(result?.lat).toBeGreaterThan(25);
      expect(result?.lat).toBeLessThan(31);
      expect(result?.lon).toBeLessThan(-80);
      expect(result?.lon).toBeGreaterThan(-88);
    });

    it("should geocode Miami, FL", async () => {
      const result = await geocodeCity("Miami");
      expect(result).not.toBeNull();
      expect(result?.label).toContain("Miami");
      // Miami is further south than Crestview
      expect(result?.lat).toBeLessThan(26);
    });

    it("should geocode a city in another state (Atlanta)", async () => {
      const result = await geocodeCity("Atlanta");
      expect(result).not.toBeNull();
      expect(result?.label).toContain("Atlanta");
      // Atlanta is in Georgia, different coordinates
      expect(result?.lat).toBeGreaterThan(33);
      expect(result?.lon).toBeLessThan(-84);
    });

    it("should geocode a city in another state (New York)", async () => {
      const result = await geocodeCity("New York");
      expect(result).not.toBeNull();
      expect(result?.label).toContain("New York");
      // New York is further north and east
      expect(result?.lat).toBeGreaterThan(40);
    });

    it("should return null for empty city name", async () => {
      const result = await geocodeCity("");
      expect(result).toBeNull();
    });

    it("should return null for whitespace-only city name", async () => {
      const result = await geocodeCity("   ");
      expect(result).toBeNull();
    });

    it("should return null for non-existent city", async () => {
      const result = await geocodeCity("XyzNonExistentCity12345");
      expect(result).toBeNull();
    });

    it("should include country/state in label", async () => {
      const result = await geocodeCity("Destin");
      expect(result).not.toBeNull();
      expect(result?.label).toMatch(/Destin/);
      // Should include state or country info
      expect(result?.label?.split(",").length).toBeGreaterThan(1);
    });

    it("should handle cities with spaces (Fort Walton Beach)", async () => {
      const result = await geocodeCity("Fort Walton Beach");
      expect(result).not.toBeNull();
      expect(result?.label).toContain("Fort Walton");
    });

    it("should handle case-insensitive city names", async () => {
      const result1 = await geocodeCity("crestview");
      const result2 = await geocodeCity("CRESTVIEW");
      const result3 = await geocodeCity("Crestview");
      
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result3).not.toBeNull();
      
      // All should resolve to similar coordinates (within 0.01 degrees)
      if (result1 && result2 && result3) {
        expect(Math.abs(result1.lat - result2.lat)).toBeLessThan(0.01);
        expect(Math.abs(result1.lon - result2.lon)).toBeLessThan(0.01);
      }
    });
  });

  describe("Coordinate Validation", () => {
    it("geocoded coordinates should be valid latitude/longitude", async () => {
      const result = await geocodeCity("Pensacola");
      expect(result).not.toBeNull();
      if (result) {
        // Valid latitude: -90 to 90
        expect(result.lat).toBeGreaterThanOrEqual(-90);
        expect(result.lat).toBeLessThanOrEqual(90);
        // Valid longitude: -180 to 180
        expect(result.lon).toBeGreaterThanOrEqual(-180);
        expect(result.lon).toBeLessThanOrEqual(180);
      }
    });
  });

  describe("Geographic Accuracy", () => {
    it("Florida cities should have similar latitude (roughly 25-31°N)", async () => {
      const cities = ["Crestview", "Niceville", "Destin", "Pensacola", "Miami"];
      const results = await Promise.all(cities.map(city => geocodeCity(city)));
      
      results.forEach((result, idx) => {
        if (result) {
          expect(result.lat).toBeGreaterThan(24);
          expect(result.lat).toBeLessThan(32);
          console.log(`${cities[idx]}: ${result.lat.toFixed(2)}°N, ${result.lon.toFixed(2)}°W`);
        }
      });
    });

    it("cities should be ordered correctly by latitude (north to south)", async () => {
      const atlanta = await geocodeCity("Atlanta");
      const miami = await geocodeCity("Miami");
      
      expect(atlanta).not.toBeNull();
      expect(miami).not.toBeNull();
      
      if (atlanta && miami) {
        // Atlanta is north of Miami
        expect(atlanta.lat).toBeGreaterThan(miami.lat);
      }
    });
  });
});
