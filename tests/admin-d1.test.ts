import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { submitOrder } from "../src/lib/server/orders";
import { expireRequestedOrders } from "../src/lib/server/order-lifecycle";
import {
  operateAdminOrder,
  listAdminOrders,
  getAdminOrder,
} from "../src/lib/server/admin-orders";
let path: string,
  config: string,
  db: D1Database,
  proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let oldSnapshot: unknown, newSnapshot: unknown, legacy: string;
const input = {
  items: [
    { skuId: "carrot-500", sellerId: "seller-a", quantity: 2 },
    { skuId: "rice-2kg", sellerId: "seller-a", quantity: 2 },
  ],
  fulfillment: "PICKUP",
  expectedTotalYen: 2780,
  buyer: { name: "架空管理検証", contact: "admin-test@example.invalid" },
  agreed: true,
};
const key = () => crypto.randomUUID();
const command = (toStatus: string, operationKey = key()) => ({
  toStatus,
  operationKey,
});
async function create(nowMs = Date.now()) {
  return submitOrder(db, input, key(), { nowMs, requestTtlMinutes: 60 });
}
async function snap() {
  return {
    orders: (await db.prepare("SELECT * FROM orders ORDER BY id").all())
      .results,
    items: (
      await db
        .prepare("SELECT * FROM order_items ORDER BY order_id,sku_id")
        .all()
    ).results,
    inventory: (
      await db.prepare("SELECT * FROM inventory ORDER BY sku_id").all()
    ).results,
    reservations: (
      await db
        .prepare(
          "SELECT * FROM inventory_reservations ORDER BY order_id,sku_id",
        )
        .all()
    ).results,
    events: (
      await db
        .prepare(
          "SELECT id,operation_key,order_id,operation,actor_category,from_status,to_status,occurred_at_ms FROM order_events ORDER BY id",
        )
        .all()
    ).results,
    schema: (
      await db
        .prepare(
          "SELECT type,name,sql FROM sqlite_schema WHERE type IN ('trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
    ).results,
  };
}
function cli(args: string[]) {
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      ...args,
      "--config",
      config,
      "--local",
      "--persist-to",
      path,
    ],
    { stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
}
async function open() {
  proxy = await getPlatformProxy({
    configPath: config,
    persist: { path: join(path, "v3") },
    remoteBindings: false,
  });
  db = (proxy.env as { DB: D1Database }).DB;
}
async function invariant() {
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    [],
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          "SELECT sku_id FROM inventory i WHERE reserved<0 OR reserved>on_hand OR reserved!=(SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations r WHERE r.sku_id=i.sku_id AND r.status='HELD')",
        )
        .all()
    ).results,
    [],
  );
}
before(async () => {
  path = await mkdtemp(join(tmpdir(), "shisui-admin-d1-"));
  config = join(path, "wrangler.json");
  await mkdir(join(path, "migrations"));
  for (const file of ["0001_catalog_orders.sql", "0002_order_lifecycle.sql"])
    await copyFile(`migrations/${file}`, join(path, "migrations", file));
  await writeFile(
    config,
    JSON.stringify({
      name: "admin-local-test",
      compatibility_date: "2026-10-14",
      d1_databases: [
        {
          binding: "DB",
          database_name: "admin-local-test",
          database_id: "00000000-0000-0000-0000-000000000003",
          remote: false,
          migrations_dir: join(path, "migrations"),
        },
      ],
    }),
  );
  cli(["d1", "migrations", "apply", "DB"]);
  cli([
    "d1",
    "execute",
    "DB",
    "--file",
    join(process.cwd(), "scripts/seed.sql"),
  ]);
  await open();
  await db.prepare("UPDATE inventory SET on_hand=1000").run();
  const o = await create();
  legacy = o.orderId;
  await db
    .prepare(
      "INSERT INTO order_events(id,operation_key,order_id,operation,actor_category,from_status,to_status,occurred_at_ms) VALUES(?,?,?,'REJECT','OPERATOR','REQUESTED','REJECTED',?)",
    )
    .bind(key(), key(), legacy, Date.now())
    .run();
  oldSnapshot = await snap();
  await proxy.dispose();
  await copyFile(
    "migrations/0003_operator_audit.sql",
    join(path, "migrations/0003_operator_audit.sql"),
  );
  cli(["d1", "migrations", "apply", "DB"]);
  await open();
  const state = await snap();
  newSnapshot = {
    ...state,
    schema: state.schema.filter(
      (s) =>
        !["order_events_actor", "orders_admin_created"].includes(
          String(s.name),
        ),
    ),
  };
});
after(async () => {
  await proxy?.dispose();
  if (path) await rm(path, { recursive: true, force: true });
});
test("0003 preserves populated orders, all lines/holds, old events, constraints/indexes/triggers and FKs", async () => {
  assert.deepEqual(newSnapshot, oldSnapshot);
  assert.equal(
    (await db
      .prepare("SELECT actor_id FROM order_events WHERE order_id=?")
      .bind(legacy)
      .first())!.actor_id,
    null,
  );
  await invariant();
});
test("admin list omits buyer PII, filters/limits pages; authorized detail retains snapshots and legacy provenance", async () => {
  const list = await listAdminOrders(
    db,
    new URLSearchParams("status=REJECTED"),
  );
  assert.ok(list.orders.length);
  assert.ok(!JSON.stringify(list).includes(input.buyer.contact));
  assert.ok(!JSON.stringify(list).includes("buyer_"));
  assert.equal((await getAdminOrder(db, legacy)).buyer_name, input.buyer.name);
  assert.equal((await getAdminOrder(db, legacy)).events[0].actor_id, null);
  await assert.rejects(() =>
    listAdminOrders(db, new URLSearchParams("page=-1")),
  );
});
test("accept/reject/cancel store verified actor, timestamps and operation keys; all SKU release once", async () => {
  for (const target of ["ACCEPTED", "REJECTED", "CANCELLED"]) {
    const o = await create(),
      c = command(target);
    const first = await operateAdminOrder(db, o.orderId, c, "operator-one");
    assert.equal(first.status, target);
    const replay = await operateAdminOrder(db, o.orderId, c, "operator-one");
    assert.equal(replay.applied, false);
    const detail = await getAdminOrder(db, o.orderId);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0].actor_id, "operator-one");
    assert.equal(detail.events[0].operation_key, c.operationKey);
    assert.equal(detail.events[0].from_status, "REQUESTED");
    assert.ok(!JSON.stringify(detail.events).includes(input.buyer.contact));
    assert.equal(
      (await db
        .prepare(
          "SELECT COUNT(*) n FROM inventory_reservations WHERE order_id=? AND status=?",
        )
        .bind(o.orderId, target === "ACCEPTED" ? "HELD" : "RELEASED")
        .first())!.n,
      2,
    );
    await assert.rejects(() =>
      operateAdminOrder(db, o.orderId, c, "operator-two"),
    );
    if (target === "ACCEPTED")
      await operateAdminOrder(
        db,
        o.orderId,
        command("CANCELLED"),
        "operator-two",
      );
    await invariant();
  }
});
test("different operator concurrent decisions have one winner; same-key concurrent replay is identical", async () => {
  let o = await create();
  let results = await Promise.allSettled([
    operateAdminOrder(db, o.orderId, command("ACCEPTED"), "operator-one"),
    operateAdminOrder(db, o.orderId, command("REJECTED"), "operator-two"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getAdminOrder(db, o.orderId)).events.length, 1);
  o = await create();
  const c = command("CANCELLED");
  results = await Promise.allSettled([
    operateAdminOrder(db, o.orderId, c, "operator-one"),
    operateAdminOrder(db, o.orderId, c, "operator-one"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal((await getAdminOrder(db, o.orderId)).events.length, 1);
  await invariant();
});
test("deadline racing, paid/handover cancellation and invalid client-declared actor/time/status are rejected", async () => {
  const o = await create(Date.now() - 3600000);
  const result = await Promise.allSettled([
    operateAdminOrder(db, o.orderId, command("ACCEPTED"), "operator-one"),
    expireRequestedOrders(db),
  ]);
  assert.equal(result[0].status, "rejected");
  assert.equal((await getAdminOrder(db, o.orderId)).status, "EXPIRED");
  for (const marker of ["cash_received_at_ms", "handover_recorded_at_ms"]) {
    const n = await create();
    await operateAdminOrder(db, n.orderId, command("ACCEPTED"), "operator-one");
    await db
      .prepare(`UPDATE orders SET ${marker}=? WHERE id=?`)
      .bind(Date.now(), n.orderId)
      .run();
    await assert.rejects(() =>
      operateAdminOrder(db, n.orderId, command("CANCELLED"), "operator-one"),
    );
  }
  for (const body of [
    { ...command("ACCEPTED"), actorId: "forged" },
    { ...command("ACCEPTED"), nowMs: 0 },
    command("COMPLETED"),
    command("EXPIRED"),
  ])
    await assert.rejects(() =>
      operateAdminOrder(db, o.orderId, body, "operator-one"),
    );
  await invariant();
});
test("injected second SKU SQL error rolls back status, actor audit and every release", async () => {
  const o = await create(),
    before = await snap();
  await db
    .prepare(
      `CREATE TRIGGER admin_test_failure BEFORE UPDATE ON inventory_reservations WHEN OLD.order_id='${o.orderId}' AND OLD.sku_id='rice-2kg' BEGIN SELECT RAISE(ABORT,'ADMIN_TEST_FAILURE'); END`,
    )
    .run();
  await assert.rejects(() =>
    operateAdminOrder(db, o.orderId, command("REJECTED"), "operator-one"),
  );
  await db.prepare("DROP TRIGGER admin_test_failure").run();
  assert.deepEqual(await snap(), before);
  await invariant();
});

test("list pagination bounds return disjoint limited pages after multiple requests", async () => {
  for (let i = 0; i < 21; i++) await create();
  const first = await listAdminOrders(
    db,
    new URLSearchParams("status=REQUESTED&page=1"),
  );
  const second = await listAdminOrders(
    db,
    new URLSearchParams("status=REQUESTED&page=2"),
  );
  assert.equal(first.orders.length, 20);
  assert.equal(first.hasNext, true);
  assert.ok(second.orders.length > 0);
  assert.ok(first.orders.every((o) => o.status === "REQUESTED"));
  assert.ok(
    !second.orders.some((o) => first.orders.some((p) => p.id === o.id)),
  );
  await assert.rejects(() =>
    listAdminOrders(db, new URLSearchParams("page=1001")),
  );
  await invariant();
});
