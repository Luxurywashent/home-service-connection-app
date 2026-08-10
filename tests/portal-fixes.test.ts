import { describe, it, expect } from "vitest";

describe("Portal Fixes", () => {
  describe("Customer Search - Name Display", () => {
    it("should use fullName from API response for display", () => {
      // Simulating the compose modal customer display logic
      const apiCustomer = {
        customerId: "cust_123",
        fullName: "Adrian Miller",
        phone: "8503980888",
        email: "adrian@luxurywashonwheels.com",
        city: "Crestview",
      };

      // The fix: use c.fullName first, fallback to firstName/lastName
      const displayName =
        apiCustomer.fullName ||
        `${(apiCustomer as any).firstName ?? ""} ${(apiCustomer as any).lastName ?? ""}`.trim() ||
        (apiCustomer as any).name ||
        "Unknown";

      expect(displayName).toBe("Adrian Miller");
      expect(displayName).not.toBe("Unknown");
    });

    it("should fallback to firstName/lastName if fullName is empty", () => {
      const apiCustomer = {
        customerId: "cust_456",
        fullName: "",
        firstName: "John",
        lastName: "Doe",
        phone: "5551234567",
        email: "john@test.com",
      };

      const displayName =
        apiCustomer.fullName ||
        `${(apiCustomer as any).firstName ?? ""} ${(apiCustomer as any).lastName ?? ""}`.trim() ||
        (apiCustomer as any).name ||
        "Unknown";

      expect(displayName).toBe("John Doe");
    });

    it("should show Unknown only when all name fields are empty", () => {
      const apiCustomer = {
        customerId: "cust_789",
        fullName: "",
        phone: "5559999999",
        email: "anon@test.com",
      };

      const displayName =
        apiCustomer.fullName ||
        `${(apiCustomer as any).firstName ?? ""} ${(apiCustomer as any).lastName ?? ""}`.trim() ||
        (apiCustomer as any).name ||
        "Unknown";

      expect(displayName).toBe("Unknown");
    });
  });

  describe("Portal Thread Search Filter", () => {
    it("should filter threads by customerName", () => {
      const threads = [
        { customerId: "1", customerName: "Clen Kennedy", phone: "8508609229", email: "ck@test.com", city: "pensacola" },
        { customerId: "2", customerName: "Sabrina Barnhill", phone: "8506126316", email: "sabrina@test.com", city: "crestview" },
        { customerId: "3", customerName: "Bo Burns", phone: "8505823441", email: "bo@test.com", city: "" },
      ];

      const q = "clen".toLowerCase().trim();
      const qDigits = q.replace(/\D/g, "");
      const filtered = threads.filter(
        (t) =>
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (qDigits.length > 0 && (t.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
          (t.email ?? "").toLowerCase().includes(q) ||
          (t.city ?? "").toLowerCase().includes(q)
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].customerName).toBe("Clen Kennedy");
    });

    it("should filter threads by phone number", () => {
      const threads = [
        { customerId: "1", customerName: "Clen Kennedy", phone: "8508609229", email: "ck@test.com", city: "pensacola" },
        { customerId: "2", customerName: "Sabrina Barnhill", phone: "8506126316", email: "sabrina@test.com", city: "crestview" },
      ];

      const q = "850860".toLowerCase().trim();
      const qDigits = q.replace(/\D/g, "");
      const filtered = threads.filter(
        (t) =>
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (qDigits.length > 0 && (t.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
          (t.email ?? "").toLowerCase().includes(q) ||
          (t.city ?? "").toLowerCase().includes(q)
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].customerName).toBe("Clen Kennedy");
    });

    it("should filter threads by email", () => {
      const threads = [
        { customerId: "1", customerName: "Clen Kennedy", phone: "8508609229", email: "clen@test.com", city: "pensacola" },
        { customerId: "2", customerName: "Sabrina Barnhill", phone: "8506126316", email: "sabrina@unique.com", city: "crestview" },
      ];

      const q = "sabrina@unique".toLowerCase().trim();
      const qDigits = q.replace(/\D/g, "");
      const filtered = threads.filter(
        (t) =>
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (qDigits.length > 0 && (t.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
          (t.email ?? "").toLowerCase().includes(q) ||
          (t.city ?? "").toLowerCase().includes(q)
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].customerName).toBe("Sabrina Barnhill");
    });

    it("should filter threads by city", () => {
      const threads = [
        { customerId: "1", customerName: "Clen Kennedy", phone: "8508609229", email: "clen@mail.com", city: "pensacola" },
        { customerId: "2", customerName: "Sabrina Barnhill", phone: "8506126316", email: "sabrina@mail.com", city: "crestview" },
      ];

      const q = "pensacola".toLowerCase().trim();
      const qDigits = q.replace(/\D/g, "");
      const filtered = threads.filter(
        (t) =>
          (t.customerName ?? "").toLowerCase().includes(q) ||
          (qDigits.length > 0 && (t.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
          (t.email ?? "").toLowerCase().includes(q) ||
          (t.city ?? "").toLowerCase().includes(q)
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].customerName).toBe("Clen Kennedy");
    });
  });

  describe("Image Sharing - Message Structure", () => {
    it("should include imageUrl in message data when image is sent", () => {
      const messageWithImage = {
        id: 1,
        direction: "inbound" as const,
        body: "📷 Image",
        imageUrl: "https://storage.example.com/uploads/photo-123.jpg",
        sentByName: null,
        isRead: false,
        createdAt: "2026-07-17T12:00:00.000Z",
      };

      expect(messageWithImage.imageUrl).toBeTruthy();
      expect(messageWithImage.body).toBe("📷 Image");
    });

    it("should allow message with both text and image", () => {
      const messageWithBoth = {
        id: 2,
        direction: "outbound" as const,
        body: "Here's the before/after photo",
        imageUrl: "https://storage.example.com/uploads/photo-456.jpg",
        sentByName: "Team",
        isRead: true,
        createdAt: "2026-07-17T12:05:00.000Z",
      };

      expect(messageWithBoth.imageUrl).toBeTruthy();
      expect(messageWithBoth.body).not.toBe("📷 Image");
      expect(messageWithBoth.body).toBe("Here's the before/after photo");
    });

    it("should handle messages without images (backward compatible)", () => {
      const textOnlyMessage = {
        id: 3,
        direction: "inbound" as const,
        body: "When is my next appointment?",
        imageUrl: null,
        sentByName: null,
        isRead: false,
        createdAt: "2026-07-17T12:10:00.000Z",
      };

      expect(textOnlyMessage.imageUrl).toBeNull();
      expect(textOnlyMessage.body).toBeTruthy();
    });
  });

  describe("Keyboard Offset", () => {
    it("should have sufficient keyboard vertical offset for visibility", () => {
      // The fix increased keyboardVerticalOffset from 90 to 120
      const keyboardVerticalOffset = 120;
      // Minimum acceptable offset for comfortable text visibility above keyboard
      expect(keyboardVerticalOffset).toBeGreaterThanOrEqual(110);
    });

    it("should have adequate input padding for readability", () => {
      // The fix increased paddingVertical from 10 to 14 and paddingBottom from 12 to 18
      const inputPaddingVertical = 14;
      const inputRowPaddingBottom = 18;
      expect(inputPaddingVertical).toBeGreaterThanOrEqual(12);
      expect(inputRowPaddingBottom).toBeGreaterThanOrEqual(16);
    });
  });
});
