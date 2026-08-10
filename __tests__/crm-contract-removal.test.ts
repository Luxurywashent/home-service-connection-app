import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readProjectFile = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("home-service CRM contract removal", () => {
  it("does not expose VIP or loan contract routes through the app server", () => {
    const coreServer = readProjectFile("server/_core/index.ts");
    const routerRegistry = readProjectFile("server/routers.ts");
    const adminMenu = readProjectFile("components/ui/top-nav-menu.tsx");

    expect(coreServer).not.toContain('app.use("/api/vip"');
    expect(coreServer).not.toContain('"/sign-loan-contract/');
    expect(routerRegistry).not.toContain("loans: loanRouter");
    expect(adminMenu).not.toContain('route: "/admin-vip"');
    expect(adminMenu).not.toContain('route: "/admin-loans"');
  });

  it("removes the contract-only screens and server modules", () => {
    const removedFiles = [
      "app/(tabs)/admin-vip.tsx",
      "app/(tabs)/admin-loans.tsx",
      "app/(customer)/vip.tsx",
      "app/sign-loan/[loanId].tsx",
      "server/vipRouter.ts",
      "server/loanRouter.ts",
      "server/loanReminderScheduler.ts",
    ];

    for (const relativePath of removedFiles) {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
    }
  });

  it("retains inactive loan tables for archival safety", () => {
    const schema = readProjectFile("drizzle/schema.ts");

    expect(schema).toContain('mysqlTable("loan_contracts"');
    expect(schema).toContain('mysqlTable("loan_payment_schedules"');
    expect(schema).toContain('mysqlTable("loan_payments"');
    expect(schema).toContain('mysqlTable("loan_payment_reminders"');
  });
});
