import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("account settings layout", () => {
  const profile = readProjectSource("app/(tabs)/profile.tsx");
  const navigation = readProjectSource("components/ui/top-nav-menu.tsx");

  it("organizes account settings into Account, Work, and Security sections", () => {
    expect(profile).toContain('id: "account"');
    expect(profile).toContain('id: "work"');
    expect(profile).toContain('id: "security"');
    expect(profile).toContain("Account Settings");
    expect(profile).toContain("Personal Details");
    expect(profile).toContain("Work Assignment");
    expect(profile).toContain("Change PIN");
  });

  it("preserves the existing PIN reset and sign-out actions", () => {
    expect(profile).toContain("trpc.employee.resetPin.useMutation()");
    expect(profile).toContain("handleResetPin");
    expect(profile).toContain("handleLogout");
    expect(profile).toContain("Save New PIN");
    expect(profile).toContain("Sign out of this device");
  });

  it("makes the redesigned screen reachable as Settings for Company users", () => {
    const settingsRoute = '{ label: "Settings",      icon: "⚙️",  route: "/profile" }';

    expect(navigation).toContain(settingsRoute);
    expect(navigation).toContain('{ label: "Settings",       icon: "⚙️", route: "/profile" }');
    expect(navigation).toContain('{ label: "Settings",   icon: "⚙️", route: "/profile" }');
  });
});
