import "server-only";
import { env } from "cloudflare:workers";
import type { D1Database } from "@cloudflare/workers-types";
export async function getDB(): Promise<D1Database> {
  return (env as unknown as { DB: D1Database }).DB;
}
