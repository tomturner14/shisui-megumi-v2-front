import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
// Next.js uses the same local Wrangler/Miniflare D1 database as vinext.
// Kept out of the Workers bundle by the explicit Vite alias.
// Share across server bundles and development reloads: one workerd owns the
// local SQLite files for this Node process.
const local = globalThis as typeof globalThis & {
  __shisuiLocalD1?: Promise<
    Awaited<ReturnType<typeof import("wrangler").getPlatformProxy>>
  >;
};
export async function getDB(): Promise<D1Database> {
  const { getPlatformProxy } = await import("wrangler");
  local.__shisuiLocalD1 ??= getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: {
      path: `${process.env.SHISUI_D1_PERSIST_ROOT ?? ".wrangler/state"}/v3`,
    },
    remoteBindings: false,
  });
  const proxy = await local.__shisuiLocalD1;
  return (proxy.env as { DB: D1Database }).DB;
}
