import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sameCart,
  confirmCheckout,
  orderBody,
  parsePending,
  publicQuote,
  isReceipt,
  isDefinitiveRejection,
} from "../src/lib/checkout";
import type { Quote } from "../src/types/catalog";
const quote: Quote = {
  sellerId: "seller-a",
  sellerName: "架空A",
  pickupConditions: "架空条件",
  totalYen: 190,
  items: [
    {
      skuId: "carrot-500",
      productName: "にんじん",
      label: "500g",
      quantity: 1,
      unitPriceYen: 190,
      subtotalYen: 190,
    },
  ],
};
test("cart equality includes seller, SKU and quantity; identical totals do not imply identical orders", () => {
  const original = [{ skuId: "carrot-500", sellerId: "seller-a", quantity: 1 }];
  for (const change of [
    [],
    [{ ...original[0], skuId: "equal-a-190" }],
    [{ ...original[0], sellerId: "seller-b" }],
    [{ ...original[0], quantity: 2 }],
  ])
    assert.equal(sameCart(original, change), false);
  assert.equal(
    sameCart(
      [...original, { skuId: "rice-2kg", sellerId: "seller-a", quantity: 1 }],
      [{ skuId: "rice-2kg", sellerId: "seller-a", quantity: 1 }, ...original],
    ),
    true,
  );
});
test("confirmation and serialized request are independent copies of quote and buyer", () => {
  const q = structuredClone(quote),
    buyer = { name: "架空利用者", contact: "unit@example.invalid" };
  const confirmed = confirmCheckout(q, buyer);
  q.items[0].quantity = 2;
  buyer.name = "changed";
  const body = JSON.parse(orderBody(confirmed));
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.buyer.name, "架空利用者");
});
test("recovery record keeps key and public quote, strips buyer/extra fields, rejects corrupt data", () => {
  const input = {
    key: "12345678-1234-1234-1234-123456789abc",
    quote: { ...quote, buyer: { name: "private" } },
    buyer: { contact: "private" },
  };
  const parsed = parsePending(JSON.stringify(input));
  assert(!JSON.stringify(parsed).includes("private"));
  assert(!JSON.stringify(publicQuote(input.quote)).includes("buyer"));
  assert.throws(() => parsePending("{"));
  assert.throws(() =>
    parsePending(
      JSON.stringify({ ...input, quote: { ...quote, totalYen: 1 } }),
    ),
  );
});
test("only exact successful receipts or documented first-attempt rejection are definitive", () => {
  assert(
    isReceipt(
      {
        orderId: crypto.randomUUID(),
        totalYen: 190,
        status: "REQUESTED",
        currency: "JPY",
      },
      quote,
    ),
  );
  assert(
    !isReceipt(
      {
        orderId: crypto.randomUUID(),
        totalYen: 1,
        status: "REQUESTED",
        currency: "JPY",
      },
      quote,
    ),
  );
  assert(isDefinitiveRejection(409, "PRICE_CHANGED"));
  assert(!isDefinitiveRejection(503, "SERVICE_UNAVAILABLE"));
  assert(!isDefinitiveRejection(200, "PRICE_CHANGED"));
  assert(!isDefinitiveRejection(409, "IDEMPOTENCY_CONFLICT"));
});
