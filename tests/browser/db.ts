import type { D1Database } from "@cloudflare/workers-types";
import { readFile } from "node:fs/promises";

// All browser SQL uses the application's existing D1 binding. Opening a second
// workerd against its SQLite files can fail with SQLITE_BUSY during teardown.
// These bridges exist only in the explicit test preload/generated Worker entry.
export async function withD1<T>(run: (db: D1Database) => Promise<T>): Promise<T> {
  if (process.env.E2E_BASE_URL)
    throw new Error("Direct browser SQL requires the harness-owned local server");
  const token = await readFile(".wrangler/e2e-db-token", "utf8");
  const port = process.env.E2E_RUNTIME === "vinext" ? 3000 : 3002;
  async function execute(payload: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${port}/__test/d1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Test D1 operation failed (${response.status})`);
    return response.json();
  }
  const prepare = (sql: string, values: unknown[] = []) => ({
    sql,
    values,
    bind: (...bound: unknown[]) => prepare(sql, bound),
    run: () => execute({ method: "run", sql, values }),
    all: () => execute({ method: "all", sql, values }),
    first: (column?: string) => execute({ method: "first", sql, values, column }),
  });
  const db = {
    prepare,
    batch: (statements: { sql: string; values: unknown[] }[]) =>
      execute({ method: "batch", statements }),
  } as unknown as D1Database;
  return run(db);
}
