import "server-only";
import { env } from "cloudflare:workers";
export function adminSettings(): Record<string, string | undefined> {
  return env as Record<string, string | undefined>;
}
