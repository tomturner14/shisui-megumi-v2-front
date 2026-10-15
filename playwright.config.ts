import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { localE2EBaseURL } from "./tests/e2e-safety";
const baseURL = localE2EBaseURL(process.env.E2E_BASE_URL);
const normalEntry = process.env.E2E_NORMAL_ENTRY === "1";
if (normalEntry && process.env.E2E_ADMIN_AUTH === "1")
  throw new Error("Normal entry must not use signed test fixtures");
if (
  process.env.E2E_ADMIN_AUTH === "1" &&
  (process.env.E2E_BASE_URL ||
    !["next-production", "vinext"].includes(process.env.E2E_RUNTIME ?? ""))
)
  throw new Error(
    "Signed admin browser fixture requires its own local production test process",
  );
export default defineConfig({
  testDir: "./tests/browser",
  globalTeardown: "./tests/fixtures/cleanup-access.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL,
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          "tsx scripts/prepare-browser-db.ts && " +
          (normalEntry ? "" : "tsx tests/fixtures/prepare-d1-bridge.ts && ") +
          (process.env.E2E_RUNTIME === "vinext"
            ? (normalEntry
                ? "wrangler dev --local --ip 127.0.0.1 --port 3000 --config dist/server/wrangler.json --persist-to .wrangler/e2e-state"
                : "tsx tests/fixtures/prepare-worker-access.ts && wrangler dev --local --ip 127.0.0.1 --port 3000 --config dist/server/test-only-wrangler.json --persist-to .wrangler/e2e-state")
            : (process.env.E2E_ADMIN_AUTH === "1"
                ? "tsx tests/fixtures/prepare-access.ts && "
                : "") +
              "node " +
              (normalEntry ? "" : "--import ./tests/fixtures/next-d1-bridge.mjs ") +
              (process.env.E2E_ADMIN_AUTH === "1"
                ? "--import ./tests/fixtures/access-fetch.mjs "
                : "") +
              "node_modules/next/dist/bin/next " +
              (process.env.E2E_RUNTIME === "next-production" ? "start" : "dev") +
              " --hostname 127.0.0.1 --port 3000"),
        env: {
          ...(process.env.E2E_ADMIN_AUTH === "1"
            ? {
                ACCESS_ISSUER: "https://local-validation.cloudflareaccess.com",
                ACCESS_AUD: "local-validation-only",
                ADMIN_SUBJECTS: "local-operator",
                ADMIN_ORIGIN: "http://127.0.0.1:3000",
              }
            : {}),
          SHISUI_D1_PERSIST_ROOT: ".wrangler/e2e-state",
          WRANGLER_SEND_METRICS: "false",
        },
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60000,
      },
});
