import { describe, it, expect } from "vitest";

describe("OpenAI API key", () => {
  it("should have OPENAI_API_KEY set", () => {
    const key = process.env.OPENAI_API_KEY;
    expect(key).toBeDefined();
    expect(key!.startsWith("sk-")).toBe(true);
  });

  it("should be able to call OpenAI models list endpoint", async () => {
    const key = process.env.OPENAI_API_KEY!;
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data.data)).toBe(true);
  }, 20000);
});
