import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import {
  submitOrder,
  quote,
  parseItems,
  OrderError,
} from "../src/lib/server/orders";
let db: D1Database,
  proxy: Awaited<ReturnType<typeof getPlatformProxy>>,
  path: string;
const buyer = { name: "架空の検証利用者", contact: "test@example.invalid" };
const item = (skuId = "carrot-500", quantity = 2, sellerId = "seller-a") => ({
  skuId,
  quantity,
  sellerId,
});
const body = (items = [item(), item("rice-2kg")], expectedTotalYen = 2780) => ({
  items,
  expectedTotalYen,
  fulfillment: "PICKUP",
  buyer,
  agreed: true,
});
const key = () => crypto.randomUUID();
async function counts() {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM orders) orders,
 (SELECT COUNT(*) FROM order_items) items,(SELECT COUNT(*) FROM inventory_reservations) reservations,
 (SELECT SUM(reserved) FROM inventory) reserved`,
    )
    .first();
}
async function reject(code: string, fn: () => Promise<unknown>) {
  await assert.rejects(
    fn,
    (e: unknown) => e instanceof OrderError && e.code === code,
  );
}
before(async () => {
  path = await mkdtemp(join(tmpdir(), "shisui-d1-"));
  const wrangler = join(process.cwd(), "node_modules/wrangler/bin/wrangler.js");
  // Actual Wrangler migrations + seed into isolated local D1, NOT a SQLite substitute.
  for (const args of [
    ["d1", "migrations", "apply", "DB", "--local", "--persist-to", path],
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      path,
      "--file",
      "scripts/seed.sql",
    ],
  ])
    execFileSync(process.execPath, [wrangler, ...args], {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: "pipe",
    });
  proxy = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: { path: join(path, "v3") },
    remoteBindings: false,
  });
  db = (proxy.env as { DB: D1Database }).DB;
});
after(async () => {
  await proxy?.dispose();
  if (path) await rm(path, { recursive: true, force: true });
});
test("D1: multiple SKU / multiple units / server price snapshots / PII-safe receipt", async () => {
  const result = await submitOrder(
    db,
    { ...body(), price: 1, totalYen: 1 },
    key(),
  );
  assert.equal(result.totalYen, 2780);
  assert.equal(result.status, "REQUESTED");
  assert(!JSON.stringify(result).includes(buyer.name));
  assert(!JSON.stringify(result).includes(buyer.contact));
  const rows = await db
    .prepare(
      "SELECT sku_id,unit_price_yen,quantity,subtotal_yen FROM order_items WHERE order_id=? ORDER BY sku_id",
    )
    .bind(result.orderId)
    .all();
  assert.deepEqual(rows.results, [
    {
      sku_id: "carrot-500",
      unit_price_yen: 190,
      quantity: 2,
      subtotal_yen: 380,
    },
    {
      sku_id: "rice-2kg",
      unit_price_yen: 1200,
      quantity: 2,
      subtotal_yen: 2400,
    },
  ]);
  const order = await db
    .prepare(
      "SELECT buyer_name,buyer_contact,payment_method,pickup_conditions FROM orders WHERE id=?",
    )
    .bind(result.orderId)
    .first();
  assert.equal(order?.buyer_name, buyer.name);
  assert.equal(order?.buyer_contact, buyer.contact);
  assert.equal(order?.payment_method, "CASH");
  assert.match(String(order?.pickup_conditions), /架空/);
});
test("D1: zero-change conditional UPDATE does not throw", async () => {
  const result = await db
    .prepare(
      "UPDATE inventory SET reserved=reserved+99 WHERE sku_id=? AND on_hand-reserved>=99",
    )
    .bind("carrot-1kg")
    .run();
  assert.equal(result.meta.changes, 0);
  assert.equal(result.success, true);
});
test("D1: one insufficient SKU rolls back header, earlier lines, and all reservations", async () => {
  const before = await counts();
  const stock = await db
    .prepare("SELECT * FROM inventory ORDER BY sku_id")
    .all();
  // Sorted carrot line is inserted first, rice fails after it has reserved inventory.
  await reject("OUT_OF_STOCK", () =>
    submitOrder(
      db,
      body([item("carrot-500", 1), item("rice-2kg", 99)], 118990),
      key(),
    ),
  );
  assert.deepEqual(await counts(), before);
  assert.deepEqual(
    (await db.prepare("SELECT * FROM inventory ORDER BY sku_id").all()).results,
    stock.results,
  );
});
test("D1: stale or forged total fails atomically and quote uses actual price", async () => {
  const before = await counts();
  await reject("PRICE_CHANGED", () =>
    submitOrder(db, body([item()], 1), key()),
  );
  assert.deepEqual(await counts(), before);
  const q = await quote(db, [item()], "PICKUP");
  assert.equal(q.totalYen, 380);
  // A price change after final confirmation must roll back the attempted order.
  await db
    .prepare("UPDATE skus SET price_yen=200 WHERE id=?")
    .bind("carrot-500")
    .run();
  await reject("PRICE_CHANGED", () =>
    submitOrder(db, body([item()], 380), key()),
  );
  assert.deepEqual(await counts(), before);
  await db
    .prepare("UPDATE skus SET price_yen=190 WHERE id=?")
    .bind("carrot-500")
    .run();
});
test("D1: idempotent retry, mismatch, and concurrent same-key submission", async () => {
  const k = key(),
    input = body([item("carrot-1kg", 1)], 350),
    before = await counts();
  const results = await Promise.all([
    submitOrder(db, input, k),
    submitOrder(db, input, k),
  ]);
  assert.deepEqual(results[0], results[1]);
  const again = await submitOrder(db, input, k);
  assert.deepEqual(again, results[0]);
  await reject("IDEMPOTENCY_CONFLICT", () =>
    submitOrder(db, body([item("carrot-1kg", 2)], 700), k),
  );
  await reject("IDEMPOTENCY_CONFLICT", () =>
    submitOrder(
      db,
      { ...input, buyer: { ...buyer, name: "別の架空利用者" } },
      k,
    ),
  );
  assert.equal(Number((await counts())?.orders), Number(before?.orders) + 1);
});
test("D1: concurrent orders cannot exceed stock or create double reservations", async () => {
  await db
    .prepare("UPDATE inventory SET on_hand=1 WHERE sku_id=?")
    .bind("potato-1kg")
    .run();
  const input = body([item("potato-1kg", 1, "seller-b")], 400),
    before = await counts();
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => submitOrder(db, input, key())),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const result of results)
    if (result.status === "rejected")
      assert.equal(result.reason.code, "OUT_OF_STOCK");
  assert.equal(Number((await counts())?.orders), Number(before?.orders) + 1);
  const inventory = await db
    .prepare("SELECT on_hand,reserved FROM inventory WHERE sku_id=?")
    .bind("potato-1kg")
    .first();
  assert.deepEqual(inventory, { on_hand: 1, reserved: 1 });
});
test("D1: invalid quantities / missing SKU / stopped product / stopped SKU / mixed sellers", async () => {
  const before = await counts();
  for (const quantity of [0, -1, 1.5, 100, "2", null])
    await reject("INVALID_REQUEST", () =>
      submitOrder(
        db,
        body([{ ...item(), quantity } as ReturnType<typeof item>], 190),
        key(),
      ),
    );
  for (const skuId of ["missing-sku", "stopped-1"])
    await reject("UNAVAILABLE_SKU", () =>
      submitOrder(db, body([item(skuId, 1)], 100), key()),
    );
  await db
    .prepare("UPDATE skus SET active=0 WHERE id=?")
    .bind("carrot-1kg")
    .run();
  await reject("UNAVAILABLE_SKU", () =>
    submitOrder(db, body([item("carrot-1kg", 1)], 350), key()),
  );
  await db
    .prepare("UPDATE skus SET active=1 WHERE id=?")
    .bind("carrot-1kg")
    .run();
  await reject("MIXED_SELLERS", () =>
    submitOrder(db, body([item(), item("potato-1kg", 1, "seller-b")]), key()),
  );
  // Forged seller ID still fails inside SQL even when browser declares only one seller.
  await reject("UNAVAILABLE_SKU", () =>
    submitOrder(
      db,
      body([item("carrot-500", 1), item("potato-1kg", 1, "seller-a")], 590),
      key(),
    ),
  );
  assert.deepEqual(await counts(), before);
  assert.throws(() => parseItems([item(), item()]));
});
test("D1: unquoted shipping cannot create an order or reserve stock", async () => {
  const before = await counts();
  await reject("REVIEW_REQUIRED", () =>
    submitOrder(db, { ...body(), fulfillment: "SHIPPING" }, key()),
  );
  await reject("REVIEW_REQUIRED", () => quote(db, [item()], "SHIPPING"));
  assert.deepEqual(await counts(), before);
});

test("D1: SQL constraints reject duplicate reservations and negative inventory", async () => {
  const row = await db
    .prepare(
      "SELECT order_id,sku_id,quantity FROM inventory_reservations LIMIT 1",
    )
    .first<{ order_id: string; sku_id: string; quantity: number }>();
  assert(row);
  const before = await counts();
  await assert.rejects(() =>
    db
      .prepare(
        "INSERT INTO inventory_reservations(order_id,sku_id,quantity) VALUES(?,?,?)",
      )
      .bind(row.order_id, row.sku_id, row.quantity)
      .run(),
  );
  await assert.rejects(() =>
    db
      .prepare("UPDATE inventory SET reserved=-1 WHERE sku_id=?")
      .bind(row.sku_id)
      .run(),
  );
  await assert.rejects(() =>
    db
      .prepare("UPDATE inventory SET on_hand=-1 WHERE sku_id=?")
      .bind(row.sku_id)
      .run(),
  );
  assert.deepEqual(await counts(), before);
});
