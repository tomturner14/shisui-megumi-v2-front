import { test, expect } from "./fixtures";
import { withD1 } from "./db";

test("HTTP orders and test SQL share one D1 owner under concurrent load", async ({ request, baseURL }) => {
  // Initialize the application binding, then mutate/read through that same
  // binding while HTTP requests execute atomic idempotent order batches.
  expect((await request.get("/api/products")).status()).toBe(200);
  await withD1(async (db) => {
    await db.prepare("CREATE TABLE IF NOT EXISTS e2e_owner_probe (id TEXT PRIMARY KEY,n INTEGER NOT NULL)").run();
    await db.prepare("INSERT INTO e2e_owner_probe VALUES(?,0)").bind("probe").run();
  });
  const key = crypto.randomUUID();
  const body = {
    items: [{ skuId: "potato-1kg", sellerId: "seller-b", quantity: 1 }],
    fulfillment: "PICKUP",
    buyer: { name: "架空の競合検証", contact: "owner@example.invalid" },
    expectedTotalYen: 400,
    agreed: true,
  };
  try {
    const [orders] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, () => request.post("/api/orders", {
        headers: { Origin: baseURL!, "Idempotency-Key": key }, data: body,
      }))),
      ...Array.from({ length: 8 }, async () => {
        for (let i = 0; i < 10; i++) {
          await withD1((db) => db.prepare("UPDATE e2e_owner_probe SET n=n+1 WHERE id='probe'").run());
          const value = await withD1((db) => db.prepare("SELECT n FROM e2e_owner_probe WHERE id='probe'").first<number>("n"));
          expect(value).toBeGreaterThan(0);
        }
      }),
    ]);
    expect(orders.map((r) => r.status()).every((status) => [200, 201].includes(status))).toBe(true);
    const receipts = await Promise.all(orders.map((r) => r.json()));
    expect(new Set(receipts.map((r) => r.orderId)).size).toBe(1);
    expect(await withD1((db) => db.prepare("SELECT n FROM e2e_owner_probe WHERE id='probe'").first<number>("n"))).toBe(80);
    expect(await withD1((db) => db.prepare("SELECT COUNT(*) FROM orders WHERE idempotency_key=?").bind(key).first<number>("COUNT(*)"))).toBe(1);
    expect(await withD1((db) => db.prepare("SELECT COUNT(*) invalid FROM inventory WHERE reserved<0 OR reserved>on_hand").first<number>("invalid"))).toBe(0);
  } finally {
    await withD1((db) => db.prepare("DROP TABLE e2e_owner_probe").run());
  }
});

test("test SQL dispatcher rejects untrusted requests", async ({ request }) => {
  const url = process.env.E2E_RUNTIME === "vinext"
    ? "http://127.0.0.1:3000/__test/d1"
    : "http://127.0.0.1:3002/__test/d1";
  // The restricted request fixture deliberately disallows the second origin.
  // Node fetch is used only with this literal loopback address, never user input.
  const response = await fetch(url, {
    method: "POST", body: JSON.stringify({ method: "all", sql: "SELECT * FROM orders" }), redirect: "error",
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("buyer");
  if (process.env.E2E_RUNTIME !== "vinext")
    expect((await request.post("/__test/d1")).status()).toBe(404);
});
