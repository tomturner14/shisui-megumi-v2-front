import { test, expect } from "./fixtures";
import { accessToken } from "../fixtures/access-fixture";
import { withD1 } from "./db";
import { localRequestURL } from "../e2e-safety";
const signed = process.env.E2E_ADMIN_AUTH === "1";
const buyer = {
  name: "架空の管理ブラウザ購入者",
  contact: "private-admin@example.invalid",
};
async function inventory(orderId: string) {
  return withD1((db) =>
    db
      .prepare(
        "SELECT sku_id,status FROM inventory_reservations WHERE order_id=? ORDER BY sku_id",
      )
      .bind(orderId)
      .all(),
  );
}
test("all admin parents, children and APIs fail closed without credentials; public catalog remains public", async ({
  request,
  page,
}) => {
  for (const path of [
    "/admin",
    "/admin/orders",
    "/admin/orders/missing",
    "/api/admin",
    "/api/admin/orders",
    "/api/admin/orders/missing",
  ]) {
    const r = await request.get(path);
    expect(signed ? [401] : [503]).toContain(r.status());
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect(await r.text()).not.toContain(buyer.contact);
  }
  const r = await request.post("/api/admin/orders/missing/transition", {
    data: { toStatus: "ACCEPTED", operationKey: crypto.randomUUID() },
  });
  expect(signed ? [401] : [503]).toContain(r.status());
  const spoof = await request.get("/api/admin/orders", {
    headers: {
      "Cf-Access-Authenticated-User-Email": "admin@example.invalid",
      "X-Admin": "true",
      Cookie: "admin=true; CF_Authorization=forged",
    },
  });
  expect(signed ? [401] : [503]).toContain(spoof.status());
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "商品一覧", exact: true }),
  ).toBeVisible();
});
test("signed but unauthorized user and invalid signature cannot read admin PII", async ({
  request,
}) => {
  test.skip(!signed, "Requires isolated signed-JWT Next harness");
  const token = await accessToken({ sub: "unlisted-operator" });
  const r = await request.get("/api/admin/orders", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
  expect(r.status()).toBe(403);
  const parts = (await accessToken()).split(".");
  parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  expect(
    (
      await request.get("/admin/orders", {
        headers: { "Cf-Access-Jwt-Assertion": parts.join(".") },
      })
    ).status(),
  ).toBe(401);
});
for (const action of ["ACCEPTED", "REJECTED", "CANCELLED"] as const) {
  test(`authorized operator confirms ${action}, sees audit identity and all SKU stock result`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    test.skip(!signed, "Requires isolated signed-JWT Next harness");
    const token = await accessToken();
    if (action === "REJECTED")
      await page.setViewportSize({ width: 1280, height: 900 });
    const response = await request.post("/api/orders", {
      headers: { Origin: baseURL!, "Idempotency-Key": crypto.randomUUID() },
      data: {
        items: [
          { skuId: "carrot-500", sellerId: "seller-a", quantity: 1 },
          { skuId: "rice-2kg", sellerId: "seller-a", quantity: 1 },
        ],
        fulfillment: "PICKUP",
        buyer,
        expectedTotalYen: 1390,
        agreed: true,
      },
    });
    expect(response.status()).toBe(201);
    const receipt = await response.json();
    await context.addCookies([
      {
        name: "CF_Authorization",
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const list = await request.get("/api/admin/orders", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(list.status()).toBe(200);
    expect(await list.text()).not.toContain(buyer.contact);
    expect(list.headers()["cache-control"]).toContain("no-store");
    const detailApi = await request.get(
      `/api/admin/orders/${receipt.orderId}`,
      { headers: { "Cf-Access-Jwt-Assertion": token } },
    );
    expect(detailApi.status()).toBe(200);
    expect(detailApi.headers()["cache-control"]).toContain("no-store");
    expect((await detailApi.json()).buyer_contact).toBe(buyer.contact);
    const html = await page.goto(`/admin/orders/${receipt.orderId}`);
    expect(html!.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByText(buyer.contact, { exact: true })).toBeVisible();
    const forged = await request.post(
      `/api/admin/orders/${receipt.orderId}/transition`,
      {
        headers: {
          Origin: baseURL!,
          "Cf-Access-Jwt-Assertion": token,
          "X-Admin-Action": "1",
        },
        data: {
          toStatus: "ACCEPTED",
          operationKey: crypto.randomUUID(),
          actorId: "forged-operator",
          nowMs: 0,
        },
      },
    );
    expect(forged.status()).toBe(400);
    const names = { ACCEPTED: "承諾", REJECTED: "拒否", CANCELLED: "取消" };
    await page
      .getByRole("button", { name: names[action], exact: true })
      .click();
    expect(
      (await inventory(receipt.orderId)).results.every(
        (r) => r.status === "HELD",
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "確認して実行" }).click();
    await expect(page.getByRole("status")).toContainText(
      `現在の状態：${action}`,
    );
    await expect(
      page.getByText("担当者：local-operator", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (action === "REJECTED")
      await page.screenshot({
        path: ".wrangler/admin-orders-preview.png",
        fullPage: true,
      });
    const snapshot = await inventory(receipt.orderId);
    expect(snapshot.results).toHaveLength(2);
    expect(
      snapshot.results.every(
        (r) => r.status === (action === "ACCEPTED" ? "HELD" : "RELEASED"),
      ),
    ).toBe(true);
    const events = await withD1((db) =>
      db
        .prepare(
          "SELECT actor_id,actor_category,operation_key FROM order_events WHERE order_id=?",
        )
        .bind(receipt.orderId)
        .all(),
    );
    expect(events.results).toHaveLength(1);
    expect(events.results[0].actor_id).toBe("local-operator");
    // An authenticated cookie alone cannot authorize a cross-origin mutation.
    for (const headers of [
      { Origin: "https://attacker.example.invalid", "X-Admin-Action": "1" },
      { Origin: baseURL! },
    ] as Record<string, string>[]) {
      const r = await request.post(
        `/api/admin/orders/${receipt.orderId}/transition`,
        {
          headers: { ...headers, "Cf-Access-Jwt-Assertion": token },
          data: { toStatus: "CANCELLED", operationKey: crypto.randomUUID() },
        },
      );
      expect(r.status()).toBe(403);
    }
    if (action === "ACCEPTED") {
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "確認して実行" }).click();
      await expect(page.getByRole("status")).toContainText(
        "現在の状態：CANCELLED",
      );
      expect(
        (await inventory(receipt.orderId)).results.every(
          (r) => r.status === "RELEASED",
        ),
      ).toBe(true);
    }
    await page.goto("/admin/orders?status=REQUESTED");
    await expect(
      page.getByRole("heading", { name: "運営用 注文一覧" }),
    ).toBeVisible();
    await expect(page.getByText(buyer.contact, { exact: true })).toHaveCount(0);
  });
}
test("uncertain admin response reuses operation key; double delivery records only one operator event", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.skip(!signed, "Requires isolated signed-JWT Next harness");
  const token = await accessToken();
  await context.addCookies([
    {
      name: "CF_Authorization",
      value: token,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const r = await request.post("/api/orders", {
    headers: { Origin: baseURL!, "Idempotency-Key": crypto.randomUUID() },
    data: {
      items: [{ skuId: "carrot-500", sellerId: "seller-a", quantity: 1 }],
      fulfillment: "PICKUP",
      buyer,
      expectedTotalYen: 190,
      agreed: true,
    },
  });
  expect(r.status()).toBe(201);
  const { orderId } = await r.json();
  await page.goto(`/admin/orders/${orderId}`);
  let sent = "";
  await page.route(
    "**/transition",
    async (route) => {
      localRequestURL(route.request().url(), new URL(page.url()).origin);
      sent = route.request().postData()!;
      expect((await route.fetch({ maxRedirects: 0 })).status()).toBe(200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "拒否", exact: true }).click();
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(page.getByRole("status")).toContainText("通信結果が不明");
  const retry = page.waitForRequest((r) => r.url().endsWith("/transition"));
  await page.getByRole("button", { name: "同じ操作の結果を確認" }).click();
  expect((await retry).postData()).toBe(sent);
  await expect(page.getByRole("status")).toContainText("現在の状態：REJECTED");
  expect(
    (await withD1((db) =>
      db
        .prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=?")
        .bind(orderId)
        .first(),
    ))!.n,
  ).toBe(1);
  await context.clearCookies();
  const denied = await page.reload();
  expect(denied!.status()).toBe(401);
  await expect(page.getByText(buyer.contact, { exact: true })).toHaveCount(0);
});
