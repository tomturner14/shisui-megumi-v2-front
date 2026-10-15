import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
function setup() {
  // Only the dedicated browser-test DB is reset; the developer's local DB is preserved.
  const state = join(process.cwd(), ".wrangler/e2e-state");
  rmSync(state, { recursive: true, force: true });
  for (const args of [
    ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--file",
      "scripts/seed.sql",
    ],
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--file",
      "tests/fixtures/equal-price.sql",
    ],
  ])
    execFileSync(
      process.execPath,
      [join(process.cwd(), "node_modules/wrangler/bin/wrangler.js"), ...args],
      {
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: "pipe",
      },
    );
}

setup();
