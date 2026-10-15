import { test, expect } from "./fixtures";
import { withD1 } from "./db";
import { localRequestURL } from "../e2e-safety";
const cartKey = "shisui-cart-v1";
for (const status of [
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "ACCEPTED",
] as const) {
  test(`lost response recovery shows current ${status} without reviving order`, async ({
    page,
  }) => {
    await page.goto("/cart");
    await page.evaluate((cartKey) => {
      localStorage.setItem(
        cartKey,
        JSON.stringify([
          { skuId: "carrot-500", sellerId: "seller-a", quantity: 1 },
        ]),
      );
      window.dispatchEvent(new Event("shisui-cart"));
    }, cartKey);
    await page
      .getByLabel("お名前", { exact: true })
      .fill("架空の状態確認利用者");
    await page
      .getByLabel("メールアドレスまたは電話番号")
      .fill("status@example.invalid");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "最新の金額・申込み内容を確認" })
      .click();
    let orderId = "",
      idempotencyKey = "";
    await page.route(
      "**/api/orders",
      async (route) => {
        localRequestURL(route.request().url(), new URL(page.url()).origin);
        idempotencyKey = route.request().headers()["idempotency-key"];
        const response = await route.fetch({ maxRedirects: 0 });
        expect(response.status()).toBe(201);
        orderId = (await response.json()).orderId;
        // The internal test harness drives the same audited SQL transition; no management HTTP API exists.
        await withD1(async (db) => {
          const row = await db
            .prepare("SELECT expires_at_ms FROM orders WHERE id=?")
            .bind(orderId)
            .first<{ expires_at_ms: number }>();
          await db
            .prepare(
              `INSERT INTO order_events(id,operation_key,order_id,operation,actor_category,from_status,to_status,occurred_at_ms)
     VALUES(?,?,?,?,?,'REQUESTED',?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              crypto.randomUUID(),
              orderId,
              {
                EXPIRED: "EXPIRE",
                REJECTED: "REJECT",
                CANCELLED: "CANCEL",
                ACCEPTED: "ACCEPT",
              }[status],
              status === "EXPIRED" ? "SYSTEM" : "OPERATOR",
              status,
              status === "EXPIRED" ? row!.expires_at_ms : Date.now(),
            )
            .run();
        });
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "この内容で申し込む", exact: true })
      .click();
    await expect(
      page.getByText("通信結果が不明です。", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "同じ内容で受付結果を確認" })
      .click();
    await expect(
      page.getByRole("heading", { name: "申込みの現在の状態" }),
    ).toBeVisible();
    await expect(
      page.getByText(`状態：${status}`, { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "まだ購入確定ではありません" }),
    ).toHaveCount(0);
    const saved = await withD1((db) =>
      db
        .prepare(
          `SELECT o.status,COUNT(*) orders,
   (SELECT COUNT(*) FROM inventory_reservations r WHERE r.order_id=o.id AND r.status='HELD') held
   FROM orders o WHERE idempotency_key=?`,
        )
        .bind(idempotencyKey)
        .first(),
    );
    expect(saved).toEqual({
      status,
      orders: 1,
      held: status === "ACCEPTED" ? 1 : 0,
    });
    if (status === "EXPIRED") {
      await expect(
        page.getByText("この申込みは終了しています。", { exact: false }),
      ).toBeVisible();
      await withD1((db) =>
        db.prepare("UPDATE skus SET price_yen=200 WHERE id='carrot-500'").run(),
      );
      await page.getByRole("link", { name: "商品一覧へ戻る" }).click();
      await page
        .getByRole("link")
        .filter({
          has: page.getByRole("heading", { name: "にんじん", exact: true }),
        })
        .click();
      await page.getByRole("button", { name: "カートに入れる" }).click();
      await page.getByRole("link", { name: "カートを確認する" }).click();
      await page
        .getByLabel("お名前", { exact: true })
        .fill("架空の状態確認利用者");
      await page
        .getByLabel("メールアドレスまたは電話番号")
        .fill("status@example.invalid");
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "最新の金額・申込み内容を確認" })
        .click();
      await expect(page.getByText("合計 200円（税込・JPY）")).toBeVisible();
      const responsePromise = page.waitForResponse((r) =>
        r.url().endsWith("/api/orders"),
      );
      await page
        .getByRole("button", { name: "この内容で申し込む", exact: true })
        .click();
      const response = await responsePromise;
      const receipt = await response.json();
      expect(receipt.orderId).not.toBe(orderId);
      expect(receipt.status).toBe("REQUESTED");
      expect(response.request().headers()["idempotency-key"]).not.toBe(
        idempotencyKey,
      );
      await withD1((db) =>
        db.prepare("UPDATE skus SET price_yen=190 WHERE id='carrot-500'").run(),
      );
    }
  });
}
test("unauthenticated HTTP requests cannot transition an existing order", async ({
  request,
  baseURL,
}) => {
  const body = {
    items: [{ skuId: "carrot-1kg", sellerId: "seller-a", quantity: 1 }],
    fulfillment: "PICKUP",
    buyer: { name: "架空HTTP検証", contact: "http@example.invalid" },
    expectedTotalYen: 350,
    agreed: true,
  };
  const response = await request.post("/api/orders", {
    headers: { Origin: baseURL!, "Idempotency-Key": crypto.randomUUID() },
    data: body,
  });
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  for (const path of [
    `/api/orders/${receipt.orderId}/accept`,
    `/api/orders/${receipt.orderId}/cancel`,
    "/api/admin/orders",
    "/api/orders/expire",
  ]) {
    const r = await request.post(path, {
      data: { orderId: receipt.orderId, status: "CANCELLED" },
    });
    expect([404, 405]).toContain(r.status());
  }
  for (const method of ["put", "patch", "delete"] as const) {
    const r = await request[method]("/api/orders", {
      data: { orderId: receipt.orderId, status: "CANCELLED" },
    });
    expect(r.status()).toBe(405);
  }
  const saved = await withD1((db) =>
    db
      .prepare(
        "SELECT status,(SELECT COUNT(*) FROM order_events WHERE order_id=orders.id) events FROM orders WHERE id=?",
      )
      .bind(receipt.orderId)
      .first(),
  );
  expect(saved).toEqual({ status: "REQUESTED", events: 0 });
});
