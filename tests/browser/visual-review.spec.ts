import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { accessToken } from "../fixtures/access-fixture";
import { withD1 } from "./db";
import { localRequestURL } from "../e2e-safety";
const capture = process.env.VISUAL_REVIEW === "1";
const output = ".wrangler/visual-review";
const buyer = {
  name: "架空の画面確認購入者",
  contact: "visual-review@example.invalid",
};
async function snapshot(page: Page, name: string, state: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => button.getBoundingClientRect().height),
  );
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(
    /BEGIN.*PRIVATE KEY|CF_Authorization|Cf-Access-Jwt|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\./,
  );
  for (const email of text.match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+/g) ?? [])
    expect(email.endsWith(".invalid")).toBe(true);
  if (!capture) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: `${output}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const manifestPath = `${output}/manifest.json`;
  let rows: unknown[] = [];
  try {
    rows = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {}
  // Explicit allowlist only: never serialize testInfo, requests, headers, storage or authentication.
  rows.push({
    file: `${name}.png`,
    path: new URL(page.url()).pathname,
    state,
    width: page.viewportSize()!.width,
    height: page.viewportSize()!.height,
    fixture:
      "scripts/seed.sql; 架空の画面確認購入者; visual-review@example.invalid",
    runtime: process.env.E2E_RUNTIME,
    capturedAt: new Date().toISOString(),
  });
  await writeFile(manifestPath, JSON.stringify(rows, null, 2) + "\n");
}
async function fillBuyer(page: Page) {
  await page.getByLabel("お名前", { exact: true }).fill(buyer.name);
  await page.getByLabel("メールアドレスまたは電話番号").fill(buyer.contact);
  await page.getByRole("checkbox").check();
}
async function addCarrot(page: Page) {
  await page.goto("/products/carrot");
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "カートに入れる", exact: true })
    .click();
}
test("visual review: actual purchase screens keep seller, multiple SKUs, confirmed total and REQUESTED consistent", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "地元の旬",
  );
  await snapshot(page, "01-home-mobile", "公開トップ");
  await page.getByRole("link", { name: "商品一覧を見る" }).click();
  await expect(
    page.getByRole("heading", { name: "商品一覧", exact: true }),
  ).toBeVisible();
  await snapshot(page, "02-products-mobile", "公開D1商品一覧");
  await page.setViewportSize({ width: 1280, height: 900 });
  await snapshot(page, "03-products-desktop", "公開D1商品一覧");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/products/carrot");
  await expect(
    page.getByRole("heading", { level: 1, name: "にんじん" }),
  ).toBeVisible();
  await snapshot(page, "04-product-mobile", "にんじん・SKU選択・数量入力");
  await addCarrot(page);
  await page.goto("/products/rice");
  await page
    .getByRole("button", { name: "カートに入れる", exact: true })
    .click();
  await page.getByRole("link", { name: "カートを確認する" }).click();
  await expect(page.getByLabel("carrot-500の数量")).toHaveText("2");
  await expect(page.getByLabel("rice-2kgの数量")).toHaveText("1");
  await fillBuyer(page);
  await snapshot(
    page,
    "05-cart-mobile",
    "同じ売主・2 SKU・3点・参考合計1580円",
  );
  await page
    .getByRole("button", { name: "最新の金額・申込み内容を確認" })
    .click();
  await expect(
    page.getByRole("heading", { name: "申込み前の最終確認" }),
  ).toBeVisible();
  await expect(page.getByText("合計 1,580円（税込・JPY）")).toBeVisible();
  await expect(
    page.getByText("売主・代金受取人・引渡担当者：検証農園A（架空）"),
  ).toBeVisible();
  await snapshot(
    page,
    "06-confirm-mobile",
    "サーバー再見積1580円・現地受取・現金払い・申込み前",
  );
  const responsePromise = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/orders" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "この内容で申し込む", exact: true })
    .click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  expect(receipt.status).toBe("REQUESTED");
  expect(receipt.totalYen).toBe(1580);
  await expect(
    page.getByRole("heading", { name: "まだ購入確定ではありません" }),
  ).toBeVisible();
  await snapshot(
    page,
    "07-requested-mobile",
    "REQUESTED・受付のみ、購入確定ではない",
  );
  const saved = await withD1((db) =>
    db
      .prepare(
        "SELECT status,total_yen,(SELECT SUM(quantity) FROM order_items WHERE order_id=orders.id) units,(SELECT COUNT(*) FROM order_items WHERE order_id=orders.id) skus FROM orders WHERE id=?",
      )
      .bind(receipt.orderId)
      .first(),
  );
  expect(saved).toEqual({
    status: "REQUESTED",
    total_yen: 1580,
    units: 3,
    skus: 2,
  });
});
test("visual review: signed operator list, confirmation, ACCEPTED and REJECTED audit screens", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ADMIN_AUTH !== "1",
    "Requires signed local authentication fixture",
  );
  await context.addCookies([
    {
      name: "CF_Authorization",
      value: await accessToken(),
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  async function create() {
    const r = await request.post("/api/orders", {
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
    expect(r.status()).toBe(201);
    return (await r.json()).orderId as string;
  }
  const id = await create();
  await page.goto("/admin/orders?status=REQUESTED");
  await expect(
    page.getByRole("heading", { name: "運営用 注文一覧" }),
  ).toBeVisible();
  await expect(page.getByText(buyer.contact, { exact: true })).toHaveCount(0);
  await snapshot(
    page,
    "08-admin-list-mobile",
    "認証済み・REQUESTED絞り込み・連絡先なし",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await snapshot(
    page,
    "09-admin-list-desktop",
    "認証済み・REQUESTED絞り込み・連絡先なし",
  );
  await page.goto(`/admin/orders/${id}`);
  await expect(page.getByText(buyer.contact, { exact: true })).toBeVisible();
  await snapshot(
    page,
    "10-admin-detail-desktop",
    "認証済み・REQUESTED・2 SKU・1390円",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await snapshot(
    page,
    "11-admin-detail-mobile",
    "認証済み・REQUESTED・入金/引渡記録なし",
  );
  await page.getByRole("button", { name: "承諾", exact: true }).click();
  await expect(
    page.getByText("承諾を実行しますか？", { exact: true }),
  ).toBeVisible();
  await snapshot(page, "12-admin-confirm-mobile", "承諾確認中・未実行");
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(page.getByRole("status")).toContainText("現在の状態：ACCEPTED");
  await expect(
    page.getByText("担当者：local-operator", { exact: true }),
  ).toBeVisible();
  await snapshot(
    page,
    "13-admin-accepted-mobile",
    "ACCEPTED・署名済みsubjectの操作履歴あり",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(page.getByRole("status")).toContainText("現在の状態：CANCELLED");
  const rejected = await create();
  await page.goto(`/admin/orders/${rejected}`);
  await page.getByRole("button", { name: "拒否", exact: true }).click();
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(page.getByRole("status")).toContainText("現在の状態：REJECTED");
  await expect(page.getByText("状態：REJECTED", { exact: true })).toBeVisible();
  await snapshot(
    page,
    "14-admin-rejected-mobile",
    "REJECTED・担当者付き履歴、全SKU解放済み",
  );
  const holds = await withD1((db) =>
    db
      .prepare(
        "SELECT COUNT(*) n FROM inventory_reservations WHERE order_id IN (?,?) AND status='HELD'",
      )
      .bind(id, rejected)
      .first(),
  );
  expect(holds!.n).toBe(0);
  await page.goto("/admin/orders?status=COMPLETED");
  await expect(
    page.getByText("注文はありません。", { exact: true }),
  ).toBeVisible();
  await snapshot(page, "15-admin-empty-mobile", "COMPLETED絞り込み・0件");
  await context.clearCookies();
  const denied = await page.goto("/admin/orders");
  expect(denied!.status()).toBe(401);
  await expect(page.getByText(buyer.contact, { exact: true })).toHaveCount(0);
  await snapshot(page, "16-admin-denied-mobile", "未認証401・管理情報非表示");
});
test("visual review: empty cart, quote loading and recoverable quote error", async ({
  page,
}) => {
  await page.goto("/cart");
  await expect(
    page.getByText("カートは空です。", { exact: true }),
  ).toBeVisible();
  await snapshot(page, "17-cart-empty-mobile", "カート0件");
  await addCarrot(page);
  await page.getByRole("link", { name: "カートを確認する" }).click();
  await fillBuyer(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/quote", async (route) => {
    localRequestURL(route.request().url(), new URL(page.url()).origin);
    await gate;
    await route.fulfill({
      status: 503,
      json: {
        message: "検証用：金額を取得できません。もう一度お試しください。",
      },
    });
  });
  await page
    .getByRole("button", { name: "最新の金額・申込み内容を確認" })
    .click();
  await expect(
    page.getByRole("button", { name: "確認中…", exact: true }),
  ).toBeDisabled();
  try {
    await snapshot(
      page,
      "18-quote-loading-mobile",
      "見積をブラウザfixtureで一時停止・二重確認を禁止",
    );
  } finally {
    release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "検証用：金額を取得できません" }),
  ).toContainText("検証用：金額を取得できません");
  await expect(
    page.getByRole("button", { name: "最新の金額・申込み内容を確認" }),
  ).toBeEnabled();
  await snapshot(
    page,
    "19-quote-error-mobile",
    "ブラウザfixtureの見積503・修正再試行可能・注文未作成",
  );
});
