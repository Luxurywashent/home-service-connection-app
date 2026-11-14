import { describe, expect, it } from "vitest";
import config from "../app.config";
import eas from "../eas.json";

describe("Home Service Connection store identities", () => {
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
