import { test, expect } from "./fixtures";
test("mobile shopping, edit, cross-seller preservation, confirmation and D1 receipt", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/products");
  await expect(
    page.getByRole("heading", { name: "地元の旬を、少しずつ。" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/products-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "にんじん", exact: true }),
    })
    .click();
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await expect(
    page.getByRole("link", { name: "カート 4", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "商品一覧へ戻る" }).click();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "お米", exact: true }) })
    .click();
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await page.getByRole("link", { name: "商品一覧へ戻る" }).click();
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "じゃがいも", exact: true }),
    })
    .click();
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "別の生産者" }),
  ).toContainText("別の生産者");
  await page.getByRole("link", { name: "カートを確認する" }).click();
  await page
    .getByRole("button", { name: "carrot-500を減らす", exact: true })
    .click();
  await expect(page.getByLabel("carrot-500の数量")).toHaveText("3");
  await page
    .getByRole("button", { name: "carrot-500を増やす", exact: true })
    .click();
  await expect(page.getByLabel("carrot-500の数量")).toHaveText("4");
  await page.getByRole("button", { name: "削除", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "にんじん", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "商品を追加する" }).click();
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "にんじん", exact: true }),
    })
    .click();
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await page.getByRole("link", { name: "カートを確認する" }).click();
  await page.getByLabel("お名前", { exact: true }).fill("架空のブラウザ利用者");
  await page
    .getByLabel("メールアドレスまたは電話番号")
    .fill("browser@example.invalid");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "最新の金額・申込み内容を確認" })
    .click();
  await expect(
    page.getByRole("heading", { name: "申込み前の最終確認" }),
  ).toBeVisible();
  await expect(page.getByText("合計 2,780円（税込・JPY）")).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem("shisui-cart-v1"),
  );
  expect(stored).not.toContain("架空のブラウザ利用者");
  expect(stored).not.toContain("browser@");
  expect(stored).not.toContain("price");
  await page.screenshot({
    path: "test-results/confirm-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "この内容で申し込む" }).click();
  await expect(
    page.getByRole("heading", { name: "申込みを受け付けました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "まだ購入確定ではありません" }),
  ).toBeVisible();
  await expect(page.getByText("税込商品合計：2,780円")).toBeVisible();
  await page.screenshot({
    path: "test-results/receipt-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => localStorage.getItem("shisui-cart-v1")),
  ).toBe("[]");
  expect(errors).toEqual([]);
});
test("HTTP API validation, idempotency, price and shipping safeguards, privacy", async ({
  request,
}) => {
  const origin = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000")
    .origin;
  const headers = { "Content-Type": "application/json", Origin: origin };
  const items = [{ skuId: "carrot-1kg", sellerId: "seller-a", quantity: 1 }];
  const q = await request.post("/api/quote", {
    headers,
    data: { items, fulfillment: "PICKUP", price: 1 },
  });
  expect(q.status()).toBe(200);
  expect((await q.json()).totalYen).toBe(350);
  const k = crypto.randomUUID(),
    payload = {
      items,
      fulfillment: "PICKUP",
      expectedTotalYen: 350,
      buyer: { name: "架空API利用者", contact: "api@example.invalid" },
      agreed: true,
      price: 1,
    };
  const submit = () =>
    request.post("/api/orders", {
      headers: { ...headers, "Idempotency-Key": k },
      data: payload,
    });
  const first = await submit();
  expect(first.status()).toBe(201);
  const receipt = await first.json();
  expect(receipt.totalYen).toBe(350);
  expect(await (await submit()).json()).toEqual(receipt);
  const mismatch = await request.post("/api/orders", {
    headers: { ...headers, "Idempotency-Key": k },
    data: { ...payload, expectedTotalYen: 1 },
  });
  expect(mismatch.status()).toBe(409);
  const shipping = await request.post("/api/orders", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { ...payload, fulfillment: "SHIPPING" },
  });
  expect(shipping.status()).toBe(422);
  expect((await shipping.json()).code).toBe("REVIEW_REQUIRED");
  const badOrigin = await request.post("/api/orders", {
    headers: {
      ...headers,
      Origin: "https://example.invalid",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: payload,
  });
  expect(badOrigin.status()).toBe(403);
  for (const quantity of [0, -1, 1.5, 100]) {
    const r = await request.post("/api/orders", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { ...payload, items: [{ ...items[0], quantity }] },
    });
    expect(r.status()).toBe(400);
  }
  const stopped = await request.post("/api/orders", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      ...payload,
      items: [{ skuId: "stopped-1", sellerId: "seller-a", quantity: 1 }],
    },
  });
  expect(stopped.status()).toBe(400);
  const price = await request.post("/api/orders", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { ...payload, expectedTotalYen: 1 },
  });
  expect(price.status()).toBe(409);
  expect((await price.json()).code).toBe("PRICE_CHANGED");
  const badJson = await request.post("/api/orders", { headers, data: "{" });
  expect(badJson.status()).toBe(400);
  const large = await request.post("/api/orders", {
    headers,
    data: { padding: "x".repeat(17000) },
  });
  expect(large.status()).toBe(413);
  for (const route of [
    "/api/orders",
    `/api/orders/${receipt.orderId}`,
    "/api/admin/orders",
  ]) {
    const r = await request.get(route);
    expect(
      route.startsWith("/api/admin/") ? [401, 403, 503] : [404, 405],
    ).toContain(r.status());
    expect(await r.text()).not.toContain("api@example.invalid");
  }
  const products = await request.get("/api/products");
  expect(products.status()).toBe(200);
  const text = await products.text();
  expect(text).not.toContain("buyer");
  expect(text).not.toContain("api@example.invalid");
  expect(JSON.stringify(receipt)).not.toContain("架空API");
});
