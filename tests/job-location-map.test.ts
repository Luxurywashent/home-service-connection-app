import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createJobStreetViewHtml, formatJobMapAddress, parseStreetViewStatus } from "../lib/job-street-view";

function source(path: string) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

function runDocument(options: { geocode?: string; panorama?: string; native?: boolean } = {}) {
  const statuses: string[] = [];
  const elements: Record<string, any> = { map: { style: {} }, pano: { style: {} } };
  let lookup = "";
  let script: any;
  let panoramaOptions: any;
  let timer: (() => void) | undefined;
  const context: any = {
    setTimeout: (fn: () => void) => { timer = fn; return 1; }, clearTimeout: () => {},
    document: { getElementById: (id: string) => elements[id], createElement: () => ({}), head: { appendChild: (value: any) => { script = value; } } },
    window: { parent: { postMessage: (data: any) => statuses.push(data.status) } },
    google: { maps: {
      Geocoder: class { geocode({ address }: { address: string }, done: Function) { lookup = address; done(options.geocode === "ZERO_RESULTS" ? [] : [{ geometry: { location: { lat: 1, lng: 2 } } }], options.geocode || "OK"); } },
      Map: class { setStreetView() {} },
      StreetViewService: class { getPanorama(_: any, done: Function) { done({ location: { pano: "existing-pano", latLng: { lat: 1, lng: 2 } } }, options.panorama || "OK"); } },
      StreetViewPanorama: class { constructor(_: any, opts: any) { panoramaOptions = opts; } addListener() {} },
      geometry: { spherical: { computeHeading: () => 45 } },
    } },
  };
  if (options.native) context.window.ReactNativeWebView = { postMessage: (data: string) => statuses.push(JSON.parse(data).status) };
  const html = createJobStreetViewHtml("212 Lustan Drive, Crestview, FL", "test-public-key");
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1], context);
  return { context, statuses, script, get lookup() { return lookup; }, get panoramaOptions() { return panoramaOptions; }, timeout: () => timer?.() };
}

describe("Job detail Street View", () => {
  it("keeps the available city, state and postal code in the query", () => {
    expect(formatJobMapAddress({ addressLine1: " 212 Lustan Drive ", city: "Crestview", region: "FL", postalCode: "32536" })).toBe("212 Lustan Drive, Crestview, FL, 32536");
    expect(formatJobMapAddress({ addressLine1: "212 Lustan Drive, Crestview", city: "Crestview" })).toBe("212 Lustan Drive, Crestview");
    expect(formatJobMapAddress({ addressLine1: "Main St" })).toBe("Main St");
    expect(formatJobMapAddress({ city: null })).toBe("");
  });

  it("uses the shared full-address preview in both Company and technician schedules", () => {
    for (const path of ["app/(tabs)/admin-schedule.tsx", "app/(tabs)/schedule.tsx"]) {
      const text = source(path);
      expect(text).toContain('import { JobLocationMap } from "@/components/job-location-map";');
      expect(text).toContain("<JobLocationMap address={formatJobMapAddress(");
      expect(text).toContain("addressCity: job.city");
      expect(text).toContain("addressRegion: job.region");
      expect(text).not.toContain("maps.googleapis.com/maps/api/streetview");
    }
    expect(source("components/job-location-map.tsx")).not.toContain("Location.geocodeAsync");
  });

  it("loads interactive Google Street View and reports ready through the native bridge", () => {
    const doc = runDocument({ native: true });
    expect(doc.script.src).toContain("https://maps.googleapis.com/maps/api/js?");
    doc.context.window.initJobStreetView();
    expect(doc.lookup).toBe("212 Lustan Drive, Crestview, FL");
    expect(doc.panoramaOptions.pano).toBe("existing-pano");
    expect(doc.panoramaOptions.pov.heading).toBe(45);
    expect(doc.statuses).toEqual(["loading", "ready"]);
  });

  it("falls back to the location map when Google has no panorama", () => {
    const doc = runDocument({ panorama: "ZERO_RESULTS" });
    doc.context.window.initJobStreetView();
    expect(doc.statuses).toEqual(["loading", "map"]);
    expect(doc.panoramaOptions).toBeUndefined();
  });

  it("reports address lookup failure rather than leaving a blank preview", () => {
    const doc = runDocument({ geocode: "ZERO_RESULTS" });
    doc.context.window.initJobStreetView();
    expect(doc.statuses).toEqual(["loading", "error"]);
  });

  it("handles loading timeout, script failure and API authentication failure", () => {
    for (const action of ["timeout", "script", "auth"] as const) {
      const doc = runDocument();
      if (action === "timeout") doc.timeout();
      if (action === "script") doc.script.onerror();
      if (action === "auth") doc.context.window.gm_authFailure();
      expect(doc.statuses).toEqual(["loading", "error"]);
    }
  });

  it("treats addresses as data and rejects unrelated or malformed bridge messages", () => {
    const html = createJobStreetViewHtml('</script><img src=x onerror=alert(1)>', "test-key");
    expect(html).not.toContain('</script><img');
    expect(html).toContain("\\u003c/script\\u003e");
    expect(parseStreetViewStatus('{"type":"hsc-street-view","status":"ready"}')).toBe("ready");
    expect(parseStreetViewStatus({ type: "other", status: "ready" })).toBeNull();
    expect(parseStreetViewStatus({ type: "hsc-street-view", status: "unexpected" })).toBeNull();
    expect(parseStreetViewStatus("broken")).toBeNull();
  });

  it("keeps retry, missing-configuration feedback and a full-address Google Maps link", () => {
    const text = source("components/job-location-map.tsx");
    expect(text).toContain("Retry Street View");
    expect(text).toContain("Street View is not configured for this app build.");
    expect(text).toContain("https://www.google.com/maps/search/?api=1");
    expect(text).toContain("encodeURIComponent(address)");
    expect(source("components/street-view-renderer.native.tsx")).toContain('from "react-native-webview"');
    expect(source("components/street-view-renderer.tsx")).toContain("event.source !== frame.current?.contentWindow");
  });
});
