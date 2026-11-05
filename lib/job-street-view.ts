export type StreetViewStatus = "loading" | "ready" | "map" | "error";

export type JobAddressFields = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

/** Preserve available address context without inventing a city, state, or ZIP. */
export function formatJobMapAddress(fields: JobAddressFields): string {
  const parts: string[] = [];
  for (const value of [fields.addressLine1, fields.addressLine2, fields.city, fields.region, fields.postalCode]) {
    const part = value?.trim().replace(/\s+/g, " ");
    if (!part) continue;
    const normalized = part.toLocaleLowerCase();
    if (parts.some((existing) => existing.toLocaleLowerCase().split(/,\s*/).includes(normalized))) continue;
    parts.push(part);
  }
  return parts.join(", ");
}

export function parseStreetViewStatus(message: unknown): StreetViewStatus | null {
  try {
    const data = typeof message === "string" ? JSON.parse(message) : message;
    if (!data || typeof data !== "object" || data.type !== "hsc-street-view") return null;
    return ["loading", "ready", "map", "error"].includes(data.status) ? data.status : null;
  } catch {
    return null;
  }
}

function scriptValue(value: string) {
  // Addresses are data, never executable HTML, even when they contain </script>.
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Same Google Geocoder -> StreetViewService -> panorama flow as the web job header. */
export function createJobStreetViewHtml(address: string, apiKey: string): string {
  const scriptUrl = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
    key: apiKey,
    v: "weekly",
    libraries: "geometry",
    loading: "async",
    callback: "initJobStreetView",
  })}`;
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body,#map,#pano{height:100%;width:100%;margin:0;background:#0C1B32}#map,#pano{position:absolute;inset:0}#pano{display:none}</style>
</head><body><div id="map"></div><div id="pano"></div><script>
(function () {
  var address = ${scriptValue(address)};
  var resolved = false;
  var timeout = setTimeout(function () { report("error"); }, 25000);
  function report(status) {
    if (status !== "loading") { clearTimeout(timeout); resolved = true; }
    var message = { type: "hsc-street-view", status: status };
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage(message, "*");
  }
  window.gm_authFailure = function () { report("error"); };
  window.initJobStreetView = function () {
    try {
      new google.maps.Geocoder().geocode({ address: address }, function (results, status) {
        if (status !== "OK" || !results || !results[0]) { report("error"); return; }
        var location = results[0].geometry.location;
        var map = new google.maps.Map(document.getElementById("map"), {
          center: location, zoom: 17, mapTypeId: "hybrid", disableDefaultUI: true,
          zoomControl: true, streetViewControl: true, gestureHandling: "greedy"
        });
        new google.maps.StreetViewService().getPanorama({ location: location, radius: 80 }, function (data, svStatus) {
          if (svStatus !== "OK" || !data || !data.location) { report("map"); return; }
          var panoElement = document.getElementById("pano");
          panoElement.style.display = "block";
          var panorama = new google.maps.StreetViewPanorama(panoElement, {
            pano: data.location.pano, position: data.location.latLng,
            pov: { heading: google.maps.geometry.spherical.computeHeading(data.location.latLng, location), pitch: 0 },
            zoom: 0, addressControl: false, fullscreenControl: true, linksControl: true,
            panControl: true, zoomControl: true, motionTracking: false, motionTrackingControl: false
          });
          panorama.addListener("status_changed", function () {
            if (panorama.getStatus() === "OK") report("ready");
            else { panoElement.style.display = "none"; report("map"); }
          });
          map.setStreetView(panorama);
          report("ready");
        });
      });
    } catch (_) { report("error"); }
  };
  report("loading");
  var script = document.createElement("script");
  script.src = ${scriptValue(scriptUrl)};
  script.async = true;
  script.onerror = function () { report("error"); };
  document.head.appendChild(script);
})();
</script></body></html>`;
}
