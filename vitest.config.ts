import { configDefaults, defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

const liveSmokeTests = [
  "tests/booking-email.test.ts",
  "tests/customer-portal.test.ts",
  "tests/ghl-webhook.test.ts",
  "tests/gmail-credentials.test.ts",
  "tests/openai-credentials.test.ts",
  "tests/stripe-key.test.ts",
  "tests/stripe-pk.test.ts",
  "tests/twilio-credentials.test.ts",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const runLiveSmokeTests = env.RUN_EXTERNAL_INTEGRATION_TESTS === "true";

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./"),
      },
    },
    test: {
      env: {
        ...env,
        TZ: "America/Chicago",
      },
      exclude: runLiveSmokeTests
        ? configDefaults.exclude
        : [...configDefaults.exclude, ...liveSmokeTests],
    },
  };
});
