import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { submitOrder } from "../src/lib/server/orders";
import {
  transitionOrder,
  expireRequestedOrders,
  LifecycleError,
  type TransitionStatus,
} from "../src/lib/server/order-lifecycle";
let path: string,
  config: string,
  db: D1Database,
  proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let beforeMigration: unknown, afterMigration: unknown;
const epoch = Date.UTC(2026, 9, 15),
  buyer = {
    name: "架空のライフサイクル利用者",
    contact: "lifecycle@example.invalid",
  };
const input = {
  items: [
    { skuId: "carrot-500", sellerId: "seller-a", quantity: 2 },
    { skuId: "rice-2kg", sellerId: "seller-a", quantity: 2 },
  ],
  fulfillment: "PICKUP",
  expectedTotalYen: 2780,
  buyer,
  agreed: true,
};
const key = () => crypto.randomUUID();
let tick = 0;
function cli(args: string[]) {
  execFileSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/wrangler/bin/wrangler.js"),
      ...args,
      "--config",
      config,
      "--local",
      "--persist-to",
      path,
    ],
    { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "pipe" },
  );
}
async function snapshot() {
  return {
    orders: (
      await db
        .prepare(
          `SELECT id,idempotency_key,request_hash,seller_id,status,fulfillment,payment_method,buyer_name,buyer_contact,pickup_conditions,expected_total_yen,total_yen,currency,created_at FROM orders ORDER BY id`,
        )
        .all()
    ).results,
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
          "SELECT order_id,sku_id,quantity,status FROM inventory_reservations ORDER BY order_id,sku_id",
        )
        .all()
    ).results,
  };
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
          `SELECT i.sku_id FROM inventory i WHERE i.reserved<0 OR i.reserved>i.on_hand OR i.reserved !=
 (SELECT COALESCE(SUM(quantity),0) FROM inventory_reservations r WHERE r.sku_id=i.sku_id AND r.status='HELD')`,
        )
        .all()
    ).results,
    [],
  );
  assert.deepEqual(
    (
      await db
        .prepare(
          `SELECT o.id FROM orders o JOIN inventory_reservations r ON r.order_id=o.id WHERE
 (o.status IN ('REQUESTED','ACCEPTED') AND r.status!='HELD') OR (o.status IN ('REJECTED','CANCELLED','EXPIRED') AND r.status!='RELEASED')`,
        )
        .all()
    ).results,
    [],
  );
}
async function create() {
  const nowMs = epoch + ++tick * 1000000,
    k = key();
  return {
    ...(await submitOrder(db, input, k, { nowMs, requestTtlMinutes: 1 })),
    key: k,
    nowMs,
    deadline: nowMs + 60000,
  };
}
async function move(
  orderId: string,
  toStatus: TransitionStatus,
  nowMs: number,
  operationKey = key(),
) {
  return transitionOrder(db, {
    orderId,
    toStatus,
    nowMs,
    operationKey,
    actorCategory: toStatus === "EXPIRED" ? "SYSTEM" : "OPERATOR",
  });
}
async function reject(code: string, fn: () => Promise<unknown>) {
  await assert.rejects(
    fn,
    (e) => e instanceof LifecycleError && e.code === code,
  );
}
async function reservationStates(orderId: string) {
  return (
    await db
      .prepare(
        "SELECT sku_id,quantity,status,released_at_ms FROM inventory_reservations WHERE order_id=? ORDER BY sku_id",
      )
      .bind(orderId)
      .all()
  ).results;
}
before(async () => {
  path = await mkdtemp(join(tmpdir(), "shisui-lifecycle-"));
  await mkdir(join(path, "migrations"));
  await copyFile(
    "migrations/0001_catalog_orders.sql",
    join(path, "migrations/0001_catalog_orders.sql"),
  );
  config = join(path, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "lifecycle-test",
      compatibility_date: "2026-10-14",
      d1_databases: [
        {
          binding: "DB",
          database_name: "lifecycle-test",
          database_id: "00000000-0000-0000-0000-000000000001",
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
  proxy = await getPlatformProxy({
    configPath: config,
    persist: { path: join(path, "v3") },
    remoteBindings: false,
  });
  db = (proxy.env as { DB: D1Database }).DB;
  const legacyCanonical = JSON.stringify({
    items: input.items.map((i) => ({ ...i, quantity: 1 })),
    fulfillment: "PICKUP",
    name: buyer.name,
    contact: buyer.contact,
    expectedTotalYen: 1390,
    agreed: true,
  });
  const legacyHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(legacyCanonical),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  // Genuine old-schema orders, with all four old states and their existing snapshots.
  for (const [id, status] of [
    ["legacy-request", "REQUESTED"],
    ["legacy-accept", "ACCEPTED"],
    ["legacy-cancel", "CANCELLED"],
    ["legacy-complete", "COMPLETED"],
  ]) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO orders(id,idempotency_key,request_hash,seller_id,status,fulfillment,payment_method,buyer_name,buyer_contact,pickup_conditions,expected_total_yen,created_at)
    VALUES(?,?,?,'seller-a','REQUESTED','PICKUP','CASH',?,?,'架空の旧条件',1390,'2000-01-01T00:00:00.000Z')`,
        )
        .bind(id, `legacy-key-${id}`, legacyHash, buyer.name, buyer.contact),
      db
        .prepare(
          "INSERT INTO order_items(order_id,sku_id,product_name,sku_label,unit_price_yen,quantity) VALUES(?,'carrot-500','にんじん','500g・1袋',190,1)",
        )
        .bind(id),
      db
        .prepare(
          "INSERT INTO order_items(order_id,sku_id,product_name,sku_label,unit_price_yen,quantity) VALUES(?,'rice-2kg','お米','2kg・1袋',1200,1)",
        )
        .bind(id),
      db.prepare("UPDATE orders SET total_yen=1390 WHERE id=?").bind(id),
    ]);
    if (status !== "REQUESTED")
      await db
        .prepare("UPDATE orders SET status=? WHERE id=?")
        .bind(status, id)
        .run();
    if (status === "CANCELLED" || status === "COMPLETED") {
      await db
        .prepare("UPDATE inventory_reservations SET status=? WHERE order_id=?")
        .bind(status === "CANCELLED" ? "RELEASED" : "CONSUMED", id)
        .run();
      await db
        .prepare(
          `UPDATE inventory SET reserved=reserved-1,on_hand=on_hand-? WHERE sku_id IN ('carrot-500','rice-2kg')`,
        )
        .bind(status === "COMPLETED" ? 1 : 0)
        .run();
    }
  }
  beforeMigration = await snapshot();
  await proxy.dispose();
  await copyFile(
    "migrations/0002_order_lifecycle.sql",
    join(path, "migrations/0002_order_lifecycle.sql"),
  );
  cli(["d1", "migrations", "apply", "DB"]);
  proxy = await getPlatformProxy({
    configPath: config,
    persist: { path: join(path, "v3") },
    remoteBindings: false,
  });
  db = (proxy.env as { DB: D1Database }).DB;
  afterMigration = await snapshot();
});
after(async () => {
  await proxy?.dispose();
  if (path) await rm(path, { recursive: true, force: true });
});
test("D1 migration: populated old schema preserves every row, snapshot, FK, index, trigger and reservation", async () => {
  assert.deepEqual(afterMigration, beforeMigration);
  await invariant();
  assert.equal(
    (await db.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>())
      ?.foreign_keys,
    1,
  );
  const rows = await db
    .prepare("SELECT requested_at_ms,expires_at_ms,last_event_id FROM orders")
    .all();
  for (const row of rows.results)
    assert.deepEqual(row, {
      requested_at_ms: null,
      expires_at_ms: null,
      last_event_id: null,
    });
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('trigger','index')",
      )
      .all<{ name: string }>()
  ).results.map((r) => r.name);
  for (const name of [
    "orders_seller_status",
    "validate_order_item",
    "reserve_order_item",
    "validate_reservation",
    "hold_inventory",
    "validate_order_total",
  ])
    assert(names.includes(name));
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM order_events")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  for (const [id, status] of [
    ["legacy-request", "REQUESTED"],
    ["legacy-accept", "ACCEPTED"],
    ["legacy-cancel", "CANCELLED"],
    ["legacy-complete", "COMPLETED"],
  ]) {
    const replay = await submitOrder(
      db,
      {
        ...input,
        items: input.items.map((i) => ({ ...i, quantity: 1 })),
        expectedTotalYen: 1390,
      },
      `legacy-key-${id}`,
    );
    assert.equal(replay.orderId, id);
    assert.equal(replay.status, status);
  }
  // Raise only synthetic fixture capacity for subsequent independent lifecycle scenarios.
  await db.prepare("UPDATE inventory SET on_hand=1000").run();
});
test("D1 legacy deadlines: no invented expiry or acceptance; explicit rejection can still release", async () => {
  const result = await expireRequestedOrders(db, { nowMs: epoch });
  assert.deepEqual(result, { expired: [], skipped: [], failed: [] });
  await reject("DEADLINE_REQUIRED", () =>
    move("legacy-request", "ACCEPTED", epoch),
  );
  await move("legacy-request", "REJECTED", epoch);
  await invariant();
  await reject("TRANSITION_NOT_ALLOWED", () =>
    move("legacy-complete", "CANCELLED", epoch),
  );
});
test("D1 configurable new deadline and invalid deadline configuration", async () => {
  const k = key(),
    nowMs = epoch;
  const order = await submitOrder(db, input, k, {
    nowMs,
    requestTtlMinutes: 120,
  });
  const saved = await db
    .prepare("SELECT requested_at_ms,expires_at_ms FROM orders WHERE id=?")
    .bind(order.orderId)
    .first();
  assert.deepEqual(saved, {
    requested_at_ms: nowMs,
    expires_at_ms: nowMs + 7200000,
  });
  await move(order.orderId, "CANCELLED", nowMs);
  await assert.rejects(() =>
    submitOrder(db, input, key(), { nowMs, requestTtlMinutes: 0 }),
  );
});
for (const status of ["REJECTED", "CANCELLED", "EXPIRED"] as const)
  test(`D1 ${status}: all SKU releases and audit are atomic, idempotent, and accurate`, async () => {
    const order = await create(),
      before = (await db
        .prepare("SELECT SUM(reserved) n FROM inventory")
        .first<{ n: number }>())!.n;
    const when = status === "EXPIRED" ? order.deadline : order.nowMs + 1,
      op = key();
    const availabilityBefore = await db
      .prepare(
        "SELECT sku_id,on_hand,reserved,on_hand-reserved available FROM inventory WHERE sku_id IN ('carrot-500','rice-2kg') ORDER BY sku_id",
      )
      .all<{
        sku_id: string;
        on_hand: number;
        reserved: number;
        available: number;
      }>();
    const first = await move(order.orderId, status, when, op);
    assert.equal(first.applied, true);
    const again = await move(order.orderId, status, when + 1, op);
    assert.equal(again.applied, false);
    assert.equal(again.eventId, first.eventId);
    await reject("TRANSITION_NOT_ALLOWED", () =>
      move(order.orderId, status, when + 2),
    );
    assert.equal(
      (await db
        .prepare("SELECT SUM(reserved) n FROM inventory")
        .first<{ n: number }>())!.n,
      before - 4,
    );
    const availabilityAfter = await db
      .prepare(
        "SELECT sku_id,on_hand,reserved,on_hand-reserved available FROM inventory WHERE sku_id IN ('carrot-500','rice-2kg') ORDER BY sku_id",
      )
      .all();
    assert.deepEqual(
      availabilityAfter.results,
      availabilityBefore.results.map((row) => ({
        ...row,
        reserved: row.reserved - 2,
        available: row.available + 2,
      })),
    );
    for (const r of await reservationStates(order.orderId)) {
      assert.equal(r.status, "RELEASED");
      assert.equal(r.quantity, 2);
      assert.equal(r.released_at_ms, when);
    }
    const event = await db
      .prepare(
        "SELECT operation,actor_category,from_status,to_status,occurred_at_ms FROM order_events WHERE order_id=?",
      )
      .bind(order.orderId)
      .all();
    assert.equal(event.results.length, 1);
    assert.equal(event.results[0].from_status, "REQUESTED");
    assert.equal(event.results[0].to_status, status);
    assert(!JSON.stringify(event).includes(buyer.contact));
    const zero = await db
      .prepare(
        "UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='HELD'",
      )
      .bind(order.orderId)
      .run();
    assert.equal(zero.meta.changes, 0);
    assert.equal(zero.success, true);
    const replay = await submitOrder(db, input, order.key);
    assert.equal(replay.orderId, order.orderId);
    assert.equal(replay.status, status);
    await invariant();
  });
test("D1 ACCEPTED: keep holds, never expire using request deadline, permit pre-payment/pre-handover cancellation", async () => {
  const order = await create(),
    before = await reservationStates(order.orderId);
  await move(order.orderId, "ACCEPTED", order.deadline - 1);
  assert.deepEqual(await reservationStates(order.orderId), before);
  assert(
    !(
      await expireRequestedOrders(db, { nowMs: order.deadline + 1 })
    ).expired.includes(order.orderId),
  );
  assert.equal((await submitOrder(db, input, order.key)).status, "ACCEPTED");
  await move(order.orderId, "CANCELLED", order.deadline + 2);
  assert.equal((await submitOrder(db, input, order.key)).status, "CANCELLED");
  await invariant();
});
test("D1 accepted cancellation blocked after either payment or handover is recorded", async () => {
  for (const column of ["cash_received_at_ms", "handover_recorded_at_ms"]) {
    const order = await create();
    await move(order.orderId, "ACCEPTED", order.nowMs + 1);
    await db
      .prepare(`UPDATE orders SET ${column}=? WHERE id=?`)
      .bind(order.nowMs + 2, order.orderId)
      .run();
    await reject("CANCELLATION_BLOCKED", () =>
      move(order.orderId, "CANCELLED", order.nowMs + 3),
    );
    await assert.rejects(() =>
      db
        .prepare(`UPDATE orders SET ${column}=NULL WHERE id=?`)
        .bind(order.orderId)
        .run(),
    );
  }
  await invariant();
});
test("D1 deadline boundaries: before, exactly at, after; cron is not required to reject late acceptance", async () => {
  for (const delta of [-1, 0, 1]) {
    const order = await create();
    if (delta < 0) {
      await reject("NOT_DUE", () =>
        move(order.orderId, "EXPIRED", order.deadline + delta),
      );
      await move(order.orderId, "ACCEPTED", order.deadline + delta);
      await move(order.orderId, "CANCELLED", order.deadline + 2);
    } else {
      await reject("DEADLINE_PASSED", () =>
        move(order.orderId, "ACCEPTED", order.deadline + delta),
      );
      await move(order.orderId, "EXPIRED", order.deadline + delta);
    }
  }
  await invariant();
});
test("D1 concurrent acceptance/expiry: exactly one transition wins and inventory stays coherent", async () => {
  for (let n = 0; n < 6; n++) {
    const order = await create();
    const results = await Promise.allSettled([
      move(order.orderId, "ACCEPTED", order.deadline - 1),
      move(order.orderId, "EXPIRED", order.deadline),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const status = (await db
      .prepare("SELECT status FROM orders WHERE id=?")
      .bind(order.orderId)
      .first<{ status: string }>())!.status;
    assert(["ACCEPTED", "EXPIRED"].includes(status));
    assert.equal(
      (await db
        .prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=?")
        .bind(order.orderId)
        .first<{ n: number }>())!.n,
      1,
    );
    if (status === "ACCEPTED")
      await move(order.orderId, "CANCELLED", order.deadline + 1);
    await invariant();
  }
});
test("D1 audit operation keys: concurrent retries once, mismatched action rejected, current state returned", async () => {
  const order = await create(),
    op = key();
  const results = await Promise.all([
    move(order.orderId, "ACCEPTED", order.nowMs + 1, op),
    move(order.orderId, "ACCEPTED", order.nowMs + 1, op),
  ]);
  assert.equal(results.filter((r) => r.applied).length, 1);
  assert.equal(results[0].eventId, results[1].eventId);
  await reject("OPERATION_CONFLICT", () =>
    move(order.orderId, "REJECTED", order.nowMs + 2, op),
  );
  await move(order.orderId, "CANCELLED", order.nowMs + 3);
  assert.equal(
    (await move(order.orderId, "ACCEPTED", order.nowMs + 4, op)).status,
    "CANCELLED",
  );
  await invariant();
});
test("D1 forbidden transitions, untracked updates and standalone releases are rejected", async () => {
  const order = await create();
  await assert.rejects(() =>
    db
      .prepare("UPDATE orders SET status='CANCELLED' WHERE id=?")
      .bind(order.orderId)
      .run(),
  );
  await assert.rejects(() =>
    db
      .prepare(
        "UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=?",
      )
      .bind(order.orderId)
      .run(),
  );
  await assert.rejects(() =>
    db
      .prepare("UPDATE inventory SET reserved=reserved-1 WHERE sku_id=?")
      .bind("carrot-500")
      .run(),
  );
  await reject("ORDER_NOT_FOUND", () =>
    move("missing-order", "ACCEPTED", order.nowMs),
  );
  await move(order.orderId, "REJECTED", order.nowMs + 1);
  for (const target of [
    "ACCEPTED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
  ] as const)
    await reject("TRANSITION_NOT_ALLOWED", () =>
      move(order.orderId, target, order.nowMs + 2),
    );
  await assert.rejects(() =>
    db
      .prepare("UPDATE order_events SET to_status='ACCEPTED' WHERE order_id=?")
      .bind(order.orderId)
      .run(),
  );
  await invariant();
});
test("D1 partial release SQL failure rolls back state, ALL SKU holds, inventory and audit; retry succeeds", async () => {
  const order = await create(),
    before = await snapshot(),
    events = (await db.prepare("SELECT * FROM order_events ORDER BY id").all())
      .results;
  await db
    .prepare(
      `CREATE TRIGGER lifecycle_test_failure BEFORE UPDATE OF status ON inventory_reservations
 WHEN OLD.order_id='${order.orderId}' AND OLD.sku_id='rice-2kg' BEGIN SELECT RAISE(ABORT,'TEST_RELEASE_FAILURE'); END`,
    )
    .run();
  const op = key();
  await reject("LIFECYCLE_FAILED", () =>
    move(order.orderId, "CANCELLED", order.nowMs + 1, op),
  );
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(
    (await db.prepare("SELECT * FROM order_events ORDER BY id").all()).results,
    events,
  );
  await db.prepare("DROP TRIGGER lifecycle_test_failure").run();
  await move(order.orderId, "CANCELLED", order.nowMs + 1, op);
  await invariant();
});
test("D1 expiry sweep: bounded batches, replay-safe, one failure cannot roll back other orders", async () => {
  const orders = [];
  for (let n = 0; n < 12; n++) orders.push(await create());
  const failed = orders[0];
  await db
    .prepare(
      `CREATE TRIGGER lifecycle_test_sweep_failure BEFORE UPDATE OF status ON inventory_reservations
 WHEN OLD.order_id='${failed.orderId}' BEGIN SELECT RAISE(ABORT,'TEST_SWEEP_FAILURE'); END`,
    )
    .run();
  const nowMs = orders.at(-1)!.deadline;
  const first = await expireRequestedOrders(db, { nowMs });
  assert.equal(first.expired.length, 9);
  assert.deepEqual(first.failed, [
    { orderId: failed.orderId, code: "LIFECYCLE_FAILED" },
  ]);
  await db.prepare("DROP TRIGGER lifecycle_test_sweep_failure").run();
  const second = await expireRequestedOrders(db, { nowMs });
  assert.equal(second.expired.length, 3);
  assert.deepEqual(await expireRequestedOrders(db, { nowMs }), {
    expired: [],
    skipped: [],
    failed: [],
  });
  await invariant();
});

test("D1 repeated seed preserves existing reserved stock and lifecycle snapshots", async () => {
  const before = await snapshot();
  cli([
    "d1",
    "execute",
    "DB",
    "--file",
    join(process.cwd(), "scripts/seed.sql"),
  ]);
  assert.deepEqual(await snapshot(), before);
  await invariant();
});
test("D1 migration refuses inconsistent legacy holds without discarding data or old schema", async () => {
  const isolated = await mkdtemp(join(tmpdir(), "shisui-bad-legacy-")),
    migrations = join(isolated, "migrations"),
    configPath = join(isolated, "wrangler.json");
  let instance: Awaited<ReturnType<typeof getPlatformProxy>> | undefined;
  const run = (args: string[]) =>
    execFileSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/wrangler/bin/wrangler.js"),
        ...args,
        "--config",
        configPath,
        "--local",
        "--persist-to",
        isolated,
      ],
      {
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: "pipe",
      },
    );
  try {
    await mkdir(migrations);
    await copyFile(
      "migrations/0001_catalog_orders.sql",
      join(migrations, "0001_catalog_orders.sql"),
    );
    await writeFile(
      configPath,
      JSON.stringify({
        name: "bad-legacy-test",
        compatibility_date: "2026-10-14",
        d1_databases: [
          {
            binding: "DB",
            database_name: "bad-legacy-test",
            database_id: "00000000-0000-0000-0000-000000000002",
            remote: false,
            migrations_dir: migrations,
          },
        ],
      }),
    );
    run(["d1", "migrations", "apply", "DB"]);
    run([
      "d1",
      "execute",
      "DB",
      "--file",
      join(process.cwd(), "scripts/seed.sql"),
    ]);
    run([
      "d1",
      "execute",
      "DB",
      "--command",
      "UPDATE inventory SET reserved=1 WHERE sku_id='carrot-500'",
    ]);
    await copyFile(
      "migrations/0002_order_lifecycle.sql",
      join(migrations, "0002_order_lifecycle.sql"),
    );
    assert.throws(() => run(["d1", "migrations", "apply", "DB"]));
    instance = await getPlatformProxy({
      configPath,
      persist: { path: join(isolated, "v3") },
      remoteBindings: false,
    });
    const oldDB = (instance.env as { DB: D1Database }).DB;
    assert.equal(
      (
        await oldDB
          .prepare("SELECT reserved FROM inventory WHERE sku_id='carrot-500'")
          .first<{ reserved: number }>()
      )?.reserved,
      1,
    );
    const columns = (
      await oldDB.prepare("PRAGMA table_info(orders)").all<{ name: string }>()
    ).results.map((r) => r.name);
    assert(!columns.includes("expires_at_ms"));
    assert.deepEqual(
      (await oldDB.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    assert.equal(
      (
        await oldDB
          .prepare(
            "SELECT COUNT(*) n FROM sqlite_master WHERE name='validate_order_item'",
          )
          .first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    await instance?.dispose();
    await rm(isolated, { recursive: true, force: true });
  }
});

test("D1 unsupported completion and caller classifications cannot change state", async () => {
  const order = await create();
  await reject("INVALID_COMMAND", () =>
    transitionOrder(db, {
      orderId: order.orderId,
      toStatus: "COMPLETED" as TransitionStatus,
      operationKey: key(),
      actorCategory: "OPERATOR",
      nowMs: order.nowMs,
    }),
  );
  await reject("INVALID_COMMAND", () =>
    transitionOrder(db, {
      orderId: order.orderId,
      toStatus: "ACCEPTED",
      operationKey: key(),
      actorCategory: "SYSTEM",
      nowMs: order.nowMs,
    }),
  );
  await move(order.orderId, "CANCELLED", order.nowMs + 1);
  await invariant();
});
