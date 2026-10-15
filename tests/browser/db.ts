import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { join } from "node:path";
export async function withD1<T>(
  run: (db: D1Database) => Promise<T>,
): Promise<T> {
  const proxy = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: { path: join(process.cwd(), ".wrangler/e2e-state/v3") },
    remoteBindings: false,
  });
  try {
    return await run((proxy.env as { DB: D1Database }).DB);
  } finally {
    await proxy.dispose();
  }
}
