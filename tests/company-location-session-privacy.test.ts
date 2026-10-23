import { describe, expect, it } from "vitest";

import {
  COMPANY_LOCATION_BACKGROUND_AUTHORIZATION_TTL_MS,
  companyLocationDisclosureStorageKey,
  createCompanyLocationBackgroundAuthorization,
  createCompanyLocationDisclosure,
  createCompanyLocationSessionScope,
  isCompanyLocationBackgroundAuthorizationValid,
  isCompanyLocationDisclosureForScope,
  sameCompanyLocationSessionScope,
} from "../lib/company-location-session-authorization";

const now = 1_700_000_000_000;
const technician = createCompanyLocationSessionScope({
  token: "technician-session-a",
  userId: 41,
  companyId: 9,
  role: "technician",
});

if (!technician) throw new Error("Expected test session scope");

describe("company location session privacy", () => {
  it("scopes disclosure storage and acceptance to the individual and company", () => {
    const differentUser = createCompanyLocationSessionScope({
      token: "technician-session-b",
      userId: 42,
      companyId: 9,
      role: "technician",
    });
    const differentCompany = createCompanyLocationSessionScope({
      token: "technician-session-c",
      userId: 41,
      companyId: 10,
      role: "technician",
    });
    if (!differentUser || !differentCompany) throw new Error("Expected test session scopes");

    const disclosure = createCompanyLocationDisclosure(technician, now);
    // Expo SecureStore rejects colons and other punctuation outside this set.
    expect(companyLocationDisclosureStorageKey(technician)).toMatch(/^[\w.-]+$/);
    expect(companyLocationDisclosureStorageKey(technician)).not.toBe(companyLocationDisclosureStorageKey(differentUser));
    expect(companyLocationDisclosureStorageKey(technician)).not.toBe(companyLocationDisclosureStorageKey(differentCompany));
    expect(isCompanyLocationDisclosureForScope(disclosure, technician)).toBe(true);
    expect(isCompanyLocationDisclosureForScope(disclosure, differentUser)).toBe(false);
    expect(isCompanyLocationDisclosureForScope(disclosure, differentCompany)).toBe(false);
  });

  it("binds durable background authorization to the bearer, session identity, role, clock state, and disclosure", () => {
    const disclosure = createCompanyLocationDisclosure(technician, now);
    const authorization = createCompanyLocationBackgroundAuthorization(technician, disclosure, now);
    if (!authorization) throw new Error("Expected a technician authorization");

    expect(authorization).toMatchObject({
      token: technician.token,
      userId: technician.userId,
      companyId: technician.companyId,
      role: "technician",
      clockedIn: true,
      disclosureAcceptedAt: disclosure.acceptedAt,
    });
    expect(authorization.expiresAt).toBe(now + COMPANY_LOCATION_BACKGROUND_AUTHORIZATION_TTL_MS);
    expect(isCompanyLocationBackgroundAuthorizationValid(authorization, technician, disclosure, now)).toBe(true);
  });

  it("rejects account switches, bearer changes, role changes, revoked disclosure, and expiry before native publishing", () => {
    const disclosure = createCompanyLocationDisclosure(technician, now);
    const authorization = createCompanyLocationBackgroundAuthorization(technician, disclosure, now);
    if (!authorization) throw new Error("Expected a technician authorization");

    const accountSwitch = createCompanyLocationSessionScope({
      token: technician.token,
      userId: 42,
      companyId: technician.companyId,
      role: "technician",
    });
    const tokenReplacement = createCompanyLocationSessionScope({
      ...technician,
      token: "new-account-bearer",
    });
    const roleChange = createCompanyLocationSessionScope({
      ...technician,
      role: "dispatcher",
    });
    const renewedDisclosure = createCompanyLocationDisclosure(technician, now + 1);
    if (!accountSwitch || !tokenReplacement || !roleChange) throw new Error("Expected test session scopes");

    expect(sameCompanyLocationSessionScope(technician, accountSwitch)).toBe(false);
    expect(isCompanyLocationBackgroundAuthorizationValid(authorization, accountSwitch, disclosure, now)).toBe(false);
    expect(isCompanyLocationBackgroundAuthorizationValid(authorization, tokenReplacement, disclosure, now)).toBe(false);
    expect(isCompanyLocationBackgroundAuthorizationValid(authorization, roleChange, disclosure, now)).toBe(false);
    expect(isCompanyLocationBackgroundAuthorizationValid(authorization, technician, renewedDisclosure, now)).toBe(false);
    expect(isCompanyLocationBackgroundAuthorizationValid(
      authorization,
      technician,
      disclosure,
      now + COMPANY_LOCATION_BACKGROUND_AUTHORIZATION_TTL_MS,
    )).toBe(false);
  });

  it("never creates a background authorization for a non-technician session", () => {
    const dispatcher = createCompanyLocationSessionScope({
      token: "dispatcher-token",
      userId: 41,
      companyId: 9,
      role: "dispatcher",
    });
    if (!dispatcher) throw new Error("Expected dispatcher scope");

    expect(createCompanyLocationBackgroundAuthorization(
      dispatcher,
      createCompanyLocationDisclosure(dispatcher, now),
      now,
    )).toBeNull();
  });
});
