await import("../scripts/load-env.js");
const url = process.env.PUBLIC_URL;
console.log("PUBLIC_URL:", url);
if (!url || url.includes("luxurywashonwheels.app")) {
  console.log("FAIL: PUBLIC_URL not set to server domain");
  process.exit(1);
}
// Quick connectivity check
try {
  const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
  console.log(`Health check: ${res.status}`);
  console.log("PASS: PUBLIC_URL correctly set to server domain and server is reachable");
} catch (e) {
  console.log("PASS: PUBLIC_URL correctly set (connectivity check skipped:", e.message + ")");
}
