import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { localE2EBaseURL } from "./tests/e2e-safety";
const baseURL = localE2EBaseURL(process.env.E2E_BASE_URL);
export default defineConfig({
  testDir: "./tests/browser",
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
          process.env.E2E_RUNTIME === "vinext"
            ? "tsx scripts/prepare-browser-db.ts && wrangler dev --local --ip 127.0.0.1 --port 3000 --config dist/server/wrangler.json --persist-to .wrangler/e2e-state"
            : process.env.E2E_RUNTIME === "next-production"
              ? "tsx scripts/prepare-browser-db.ts && npm run start -- --hostname 127.0.0.1 --port 3000"
              : "tsx scripts/prepare-browser-db.ts && npm run dev -- --hostname 127.0.0.1 --port 3000",
        env: {
          SHISUI_D1_PERSIST_ROOT: ".wrangler/e2e-state",
          WRANGLER_SEND_METRICS: "false",
        },
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60000,
      },
});
