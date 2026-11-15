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

  it("removes the shared personal-details Team Member ID row for every role, not other fields", () => {
    expect(profile).not.toContain('label="Team Member ID"');
    expect(profile).not.toContain("teamMemberDisplayId");
    for (const label of ["Full Name", "Email", "Role", "Phone", "Service Area", "Hire Date"]) {
      expect(profile).toContain(`<DetailCell label="${label}"`);
    }
    expect(profile).toContain('case "admin":');
    expect(profile).toContain('return "Company Admin";');
    expect(profile).toContain('case "detailer":');
    expect(profile).toContain('return "Technician";');
  });

  it("removes only the informational Company credentials title/body", () => {
    expect(profile).not.toMatch(/>Company credentials<\/Text>/);
    expect(profile).not.toContain("Your Company email and password are managed through Home Service Connection.");
    expect(profile).toContain("You can sign back in with your Company credentials anytime.");
    expect(profile).toContain("styles.securityCard");
    expect(profile).toContain("styles.securityTitle");
    expect(profile).toContain("Manage access to your Home Service Connection Company account");
  });

  it("preserves the existing PIN reset and sign-out actions and Company PIN gating", () => {
    expect(profile).toContain("trpc.employee.resetPin.useMutation()");
    expect(profile).toContain("handleResetPin");
    expect(profile).toContain("onSubmitEditing={handleResetPin}");
    expect(profile).toContain("onPress={handleResetPin}");
    expect(profile).toContain('{!isCompanySession && <View style={[styles.securityCard');
    expect(profile).toContain("!isCompanySession && showPinReset");
    expect(profile).toContain('await resetPinMutation.mutateAsync({ employeeId: employee?.employeeId ?? "", newPin });');
    expect(profile).toContain("Save New PIN");
    expect(profile).toContain("Sign out of this device");
    expect(profile).toContain("onPress={handleLogout}");
    expect(profile).toContain('Alert.alert("Sign Out", "Are you sure you want to sign out of this device?"');
    expect(profile).toContain("await Promise.all([logoutJobSync(), logout()]);");
    expect(profile).toContain('router.replace("/login");');
  });

  it("offers Company Team Members a confirmed self-deletion action without deleting Company records", () => {
    expect(profile).toContain('jobSyncSession?.portal === "company"');
    expect(profile).toContain("const token = jobSyncSession?.token;");
    expect(profile).toContain("if (!isCompanySession || !token)");
    expect(profile).toContain("Delete individual account");
    expect(profile).toContain("Final confirmation");
    expect(profile).toContain("Delete My Account");
    expect(profile).toContain("onPress={handleDeleteAccount}");
    expect(profile).toContain("disabled={deletingAccount}");
    expect(profile).toContain("await deleteJobSyncMobileAccount(token);");
    expect(profile).toMatch(/await deleteJobSyncMobileAccount\(token\);\s+await signOut\(\);/);
    expect(profile).toContain('Alert.alert("Account not deleted"');
    expect(profile).toContain("Shared Company records stay intact.");
  });

  it("uses only a distinct management-self setter with explicit ON/OFF controls", () => {
    expect(profile).toContain("PROFILE_FIELDWORK_LABEL");
    expect(profile).toContain("PROFILE_FIELDWORK_SELF_DESCRIPTION");
    expect(profile).toContain("UNKNOWN · not verified");
    expect(profile).toContain("ON · server TRUE");
    expect(profile).toContain("OFF · server verified");
    expect(profile).toContain("updateCompanyOwnFieldwork");
    expect(profile).toContain('"Turn ON your field-job override"');
    expect(profile).toContain('"Turn OFF your field-job override"');
    expect(profile).toContain("fieldworkWriteLock.current = true");
    expect(profile).toContain("refreshSession(expected");
    expect(profile).not.toContain("read-only");
    expect(profile).not.toContain("calendarEligibleOverride");
    expect(profile).not.toContain("updateCompanyMemberFieldwork");
    expect(profile).not.toContain("onValueChange");
    expect(profile).not.toContain("Switch");
  });

  it("refreshes signed status on focus/retry and invalidates stale or switched-Company evidence", () => {
    expect(profile).toContain("useFocusEffect");
    expect(profile).toContain("refreshCompanyProfileSession");
    expect(profile).toContain("currentProfileKey.current === requestKey");
    expect(profile).toContain("profileReadVersion.current === version");
    expect(profile).toContain("profileReadVersion.current += 1");
    expect(profile).toContain("setVerifiedSelf(null)");
    expect(profile).toContain("COMPANY_PROFILE_SESSION_MAX_AGE_MS");
    expect(profile).toContain('accessibilityLabel="Retry signed field-job status"');
    expect(profile).toContain("disabled={fieldworkLoading || fieldworkPending}");
  });

  it("makes the redesigned screen reachable as Settings for Company users", () => {
    const settingsRoute = '{ label: "Settings",      icon: "⚙️",  route: "/profile" }';

    expect(navigation).toContain(settingsRoute);
    expect(navigation).toContain('{ label: "Settings",       icon: "⚙️", route: "/profile" }');
    expect(navigation).toContain('{ label: "Settings",   icon: "⚙️", route: "/profile" }');
  });
});
