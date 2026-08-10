import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import path from "node:path";

const port = Number(process.env.EXPO_PORT ?? 8081);
const expoCli = path.join(process.cwd(), "node_modules", "expo", "bin", "cli");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drain(response) {
  if (!response.body) return;
  for await (const _chunk of Readable.fromWeb(response.body)) {
    // Drain the stream without retaining the bundle in memory.
  }
}

async function prewarmIosBundle() {
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    try {
      const manifestResponse = await fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          Accept: "application/expo+json",
          "Expo-Platform": "ios",
          "User-Agent": "Expo/2.32.0",
        },
      });

      if (!manifestResponse.ok) throw new Error(`manifest ${manifestResponse.status}`);
      const manifest = await manifestResponse.json();
      const launchAssetUrl = manifest?.launchAsset?.url;
      if (!launchAssetUrl) throw new Error("missing launch asset");

      const launchAsset = new URL(launchAssetUrl);
      const startedAt = Date.now();
      const bundleResponse = await fetch(`http://127.0.0.1:${port}${launchAsset.pathname}${launchAsset.search}`);
      if (!bundleResponse.ok) throw new Error(`bundle ${bundleResponse.status}`);
      await drain(bundleResponse);
      console.log(`[Expo warmup] Native iOS bundle ready in ${Date.now() - startedAt}ms.`);
      return;
    } catch (error) {
      if (attempt === 24) {
        console.warn("[Expo warmup] Native iOS bundle was not prewarmed; Metro remains available for on-demand bundling.");
        return;
      }
      await sleep(2500);
    }
  }
}

const metro = spawn(process.execPath, [expoCli, "start", "--port", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, EXPO_USE_METRO_WORKSPACE_ROOT: "1" },
  stdio: "inherit",
});

void prewarmIosBundle();

metro.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
