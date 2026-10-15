// Explicit local-only runner; never uses a remote binding or customer data in output.
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { expireRequestedOrders } from "../src/lib/server/order-lifecycle";
const proxy = await getPlatformProxy({
  configPath: "wrangler.jsonc",
  persist: { path: ".wrangler/state/v3" },
  remoteBindings: false,
});
try {
  const result = await expireRequestedOrders(
    (proxy.env as { DB: D1Database }).DB,
  );
  console.log(
    JSON.stringify({
      expired: result.expired.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    }),
  );
  if (result.failed.length) process.exitCode = 1;
} finally {
  await proxy.dispose();
}
