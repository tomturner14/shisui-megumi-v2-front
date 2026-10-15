import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/e2e-db-token", randomBytes(32).toString("hex"), {
  mode: 0o600,
});
