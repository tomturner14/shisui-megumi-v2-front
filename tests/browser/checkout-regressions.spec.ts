import type { Page, Route } from "@playwright/test";
import { test, expect } from "./fixtures";
import { withD1 } from "./db";
import { localRequestURL } from "../e2e-safety";
const cartKey = "shisui-cart-v1",
  pendingKey = "shisui-pending-checkout-v1";
const original = { skuId: "carrot-500", sellerId: "seller-a", quantity: 1 };
async function prepare(page: Page) {
  await page.goto("/cart");
  await page.evaluate(
    ({ cartKey, original }) => {
      localStorage.setItem(cartKey, JSON.stringify([original]));
      window.dispatchEvent(new Event("shisui-cart"));
    },
    { cartKey, original },
  );
  await fillBuyer(page);
  await page
    .getByRole("button", { name: "最新の金額・申込み内容を確認" })
    .click();
  await expect(
    page.getByRole("heading", { name: "申込み前の最終確認" }),
  ).toBeVisible();
}
async function fillBuyer(page: Page, name = "架空の再送利用者") {
  await page.getByLabel("お名前", { exact: true }).fill(name);
  await page
    .getByLabel("メールアドレスまたは電話番号")
    .fill("retry@example.invalid");
  await page.getByRole("checkbox").check();
}
async function replaceCart(page: Page, items: (typeof original)[]) {
  const other = await page.context().newPage();
  await other.goto("/");
  await other.evaluate(
    ({ cartKey, items }) =>
      localStorage.setItem(cartKey, JSON.stringify(items)),
    { cartKey, items },
  );
  await other.close();
}
for (const [label, items] of [
  ["same-price different product", [{ ...original, skuId: "equal-a-190" }]],
  [
    "same-price different seller",
    [{ skuId: "equal-b-190", sellerId: "seller-b", quantity: 1 }],
  ],
  ["quantity change", [{ ...original, quantity: 2 }]],
  ["empty cart", []],
] as const) {
  test(`confirmation invalidated by another tab: ${label}`, async ({
    page,
  }) => {
    await prepare(page);
    let posts = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/orders")) posts++;
    });
    await replaceCart(page, [...items]);
    await expect(
      page.getByText(
        "カートが変更されました。申込み内容を確認し直してください。",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "この内容で申し込む", exact: true }),
    ).toBeDisabled();
    expect(posts).toBe(0);
    // The old displayed quote stays frozen, including after an equal-total substitution.
    await expect(page.getByText("にんじん 500g・1袋 × 1")).toBeVisible();
    await page
      .getByRole("button", { name: "内容を修正・金額を再確認" })
      .click();
    if (!items.length) {
      await expect(page.getByText("カートは空です。")).toBeVisible();
      return;
    }
    await page
      .getByRole("button", { name: "最新の金額・申込み内容を確認" })
      .click();
    await expect(
      page.getByRole("heading", { name: "申込み前の最終確認" }),
    ).toBeVisible();
    if (label.startsWith("same-price"))
      await expect(page.getByText("合計 190円（税込・JPY）")).toBeVisible();
    await page
      .getByRole("button", { name: "この内容で申し込む", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "申込みを受け付けました" }),
    ).toBeVisible();
    expect(posts).toBe(1);
  });
}
for (const reload of [false, true])
  test(`committed order with lost response: same key after ${reload ? "reload and corrected buyer" : "retry and cart change"}`, async ({
    page,
  }) => {
    await prepare(page);
    const sent: { key: string; body: string }[] = [];
    let storedReceipt: { orderId: string } | undefined;
    const loseResponse = async (route: Route) => {
      sent.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData()!,
      });
      localRequestURL(route.request().url(), new URL(page.url()).origin);
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(201);
      storedReceipt = await response.json();
      await route.abort("failed");
    };
    await page.route("**/api/orders", loseResponse, { times: 1 });
    await page
      .getByRole("button", { name: "この内容で申し込む", exact: true })
      .click();
    await expect(
      page.getByText("通信結果が不明です。", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "内容を修正・金額を再確認" }),
    ).toBeDisabled();
    const marker = await page.evaluate(
      (pendingKey) => sessionStorage.getItem(pendingKey),
      pendingKey,
    );
    expect(marker).not.toContain("架空の再送利用者");
    expect(marker).not.toContain("retry@example");
    expect(marker).not.toContain("buyer");
    await replaceCart(page, [{ ...original, skuId: "equal-a-190" }]);
    if (reload) {
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "前回の受付結果を確認" }),
      ).toBeVisible();
      await fillBuyer(page, "入力を間違えた架空利用者");
      await page.getByRole("button", { name: "元の申込み内容を確認" }).click();
      await page
        .getByRole("button", { name: "同じ内容で受付結果を確認" })
        .click();
      await expect(
        page.getByText("前回と同じ氏名・連絡先を入力してください。", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "内容を修正・金額を再確認" }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "前回の氏名・連絡先を入力し直す" })
        .click();
      await fillBuyer(page);
      await page.getByRole("button", { name: "元の申込み内容を確認" }).click();
    }
    page.on("request", (r) => {
      if (r.url().endsWith("/api/orders"))
        sent.push({ key: r.headers()["idempotency-key"], body: r.postData()! });
    });
    await page
      .getByRole("button", { name: "同じ内容で受付結果を確認" })
      .click();
    await expect(
      page.getByRole("heading", { name: "申込みを受け付けました" }),
    ).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    await expect(
      page.getByText(`受付番号：${storedReceipt!.orderId}`),
    ).toBeVisible();
    expect(
      await page.evaluate(
        (cartKey) => JSON.parse(localStorage.getItem(cartKey)!),
        cartKey,
      ),
    ).toEqual([{ ...original, skuId: "equal-a-190" }]);
    expect(
      await page.evaluate(
        (pendingKey) => sessionStorage.getItem(pendingKey),
        pendingKey,
      ),
    ).toBeNull();
    const saved = await withD1((db) =>
      db
        .prepare(
          `SELECT COUNT(*) orders,(SELECT COUNT(*) FROM order_items WHERE order_id=o.id) items,
 (SELECT COUNT(*) FROM inventory_reservations WHERE order_id=o.id) reservations FROM orders o WHERE idempotency_key=?`,
        )
        .bind(sent[0].key)
        .first(),
    );
    expect(saved).toEqual({ orders: 1, items: 1, reservations: 1 });
  });
test("definite rejection permits a fresh quote and key, never persists PII", async ({
  page,
}) => {
  await prepare(page);
  const keys: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/orders"))
      keys.push(r.headers()["idempotency-key"]);
  });
  await withD1((db) =>
    db
      .prepare("UPDATE skus SET price_yen=200 WHERE id=?")
      .bind("carrot-500")
      .run(),
  );
  await page
    .getByRole("button", { name: "この内容で申し込む", exact: true })
    .click();
  await expect(
    page.getByText("価格が変更されました。最新の金額で確認し直してください。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "内容を修正・金額を再確認" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      (pendingKey) => sessionStorage.getItem(pendingKey),
      pendingKey,
    ),
  ).toBeNull();
  await withD1((db) =>
    db
      .prepare("UPDATE skus SET price_yen=190 WHERE id=?")
      .bind("carrot-500")
      .run(),
  );
  await page.getByRole("button", { name: "内容を修正・金額を再確認" }).click();
  await page
    .getByRole("button", { name: "最新の金額・申込み内容を確認" })
    .click();
  await page
    .getByRole("button", { name: "この内容で申し込む", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "申込みを受け付けました" }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  const counts = await withD1((db) =>
    db
      .prepare(
        "SELECT idempotency_key,COUNT(*) orders FROM orders WHERE idempotency_key IN (?,?) GROUP BY idempotency_key",
      )
      .bind(...keys)
      .all(),
  );
  expect(counts.results).toEqual([{ idempotency_key: keys[1], orders: 1 }]);
});
test("corrupt recovery information blocks a new order", async ({ page }) => {
  await page.goto("/cart");
  await page.evaluate(
    (pendingKey) => sessionStorage.setItem(pendingKey, "{"),
    pendingKey,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "受付結果の確認が必要です" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この内容で申し込む", exact: true }),
  ).toHaveCount(0);
});
test("test fixtures reject public API destinations before making requests", async ({
  request,
  page,
}) => {
  let attempted = 0;
  await page.route("https://example.invalid/**", async (route) => {
    attempted++;
    await route.abort();
  });
  await expect(async () =>
    request.post("https://example.invalid/api/orders", { data: {} }),
  ).rejects.toThrow("outside the local test origin");
  expect(attempted).toBe(0);
});
