import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
// Next.js uses the same local Wrangler/Miniflare D1 database as vinext.
// Kept out of the Workers bundle by the explicit Vite alias.
let localProxy:
  | Promise<Awaited<ReturnType<typeof import("wrangler").getPlatformProxy>>>
  | undefined;
export async function getDB(): Promise<D1Database> {
  const { getPlatformProxy } = await import("wrangler");
  localProxy ??= getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: {
      path: `${process.env.SHISUI_D1_PERSIST_ROOT ?? ".wrangler/state"}/v3`,
    },
    remoteBindings: false,
  });
  const proxy = await localProxy;
  return (proxy.env as { DB: D1Database }).DB;
}
