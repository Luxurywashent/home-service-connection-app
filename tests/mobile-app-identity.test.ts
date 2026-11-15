import { describe, expect, it } from "vitest";
import config from "../app.config";
import eas from "../eas.json";

describe("Home Service Connection store identities", () => {
  it("uses a new marketing version after the approved 1.0.0 train closed", () => {
    expect(config.ios?.version).toBe("1.0.1");
    expect(config.version).toBe("1.0.0");
    // Native/runtime configuration is unchanged by this marketing-version repair.
    expect(config.runtimeVersion).toBe("1.0.0");
    expect(eas.build.testflight.extends).toBe("production");
    expect(eas.build.production.autoIncrement).toBe(true);
  });

  it("matches the existing Google Play package name independently of iOS", () => {
    expect(config.android?.package).toBe("com.homeserviceconnected");
    expect(config.android?.package).not.toBe(config.ios?.bundleIdentifier);
  });

  it("preserves the existing App Store and Expo project identities", () => {
    expect(config.ios?.bundleIdentifier).toBe("com.homeserviceconnection.mobile");
    expect(config.owner).toBe("lilmerge4");
    expect(config.slug).toBe("home-service-connection");
    expect(config.extra?.eas?.projectId).toBe("e6614385-618a-460d-a650-06ae63b97563");
    expect(config.scheme).toBe("homeserviceconnection");
  });

  it("preserves the required Company backend and remote auto-increment settings", () => {
    expect(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL).toBe("https://jobwash-veysiubh.manus.space");
    expect(eas.build.production.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL).toBe("https://jobwash-veysiubh.manus.space");
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.build.production.credentialsSource).toBe("remote");
  });
});
