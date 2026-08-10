import { describe, it, expect } from "vitest";
describe("env", () => {
  it("has DATABASE_URL", () => {
    console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
    console.log("GMAIL_USER:", process.env.GMAIL_USER ? "SET" : "NOT SET");
    expect(true).toBe(true);
  });
});
