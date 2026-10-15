import {
  ORDER_STATUSES,
  type CartItem,
  type Quote,
  type Receipt,
} from "@/types/catalog";

export type ConfirmedCheckout = {
  quote: Quote;
  buyer: { name: string; contact: string };
  agreed: true;
};
export type PendingCheckout = { key: string; quote: Quote };
export const PENDING_KEY = "shisui-pending-checkout-v1";
export function quoteItems(quote: Quote): CartItem[] {
  return quote.items.map((i) => ({
    skuId: i.skuId,
    sellerId: quote.sellerId,
    quantity: i.quantity,
  }));
}
export function sameCart(a: CartItem[], b: CartItem[]): boolean {
  const signature = (items: CartItem[]) =>
    JSON.stringify(
      items
        .map((i) => [i.skuId, i.sellerId, i.quantity])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
  return signature(a) === signature(b);
}
// Explicitly copy only public quote fields; buyer information must never enter storage.
export function publicQuote(q: Quote): Quote {
  return {
    sellerId: q.sellerId,
    sellerName: q.sellerName,
    pickupConditions: q.pickupConditions,
    totalYen: q.totalYen,
    items: q.items.map((i) => ({
      skuId: i.skuId,
      productName: i.productName,
      label: i.label,
      unitPriceYen: i.unitPriceYen,
      quantity: i.quantity,
      subtotalYen: i.subtotalYen,
    })),
  };
}
export function confirmCheckout(
  q: Quote,
  buyer: ConfirmedCheckout["buyer"],
): ConfirmedCheckout {
  return {
    quote: publicQuote(q),
    buyer: { name: buyer.name.trim(), contact: buyer.contact.trim() },
    agreed: true,
  };
}
export function orderBody(confirmed: ConfirmedCheckout): string {
  return JSON.stringify({
    items: quoteItems(confirmed.quote),
    fulfillment: "PICKUP",
    buyer: confirmed.buyer,
    expectedTotalYen: confirmed.quote.totalYen,
    agreed: confirmed.agreed,
  });
}
export function parsePending(raw: string): PendingCheckout {
  const value = JSON.parse(raw) as PendingCheckout;
  const q = value?.quote;
  if (
    !/^[a-zA-Z0-9_-]{16,100}$/.test(value?.key ?? "") ||
    !q ||
    !/^[a-z0-9-]{1,64}$/.test(q.sellerId) ||
    typeof q.sellerName !== "string" ||
    typeof q.pickupConditions !== "string" ||
    !Number.isSafeInteger(q.totalYen) ||
    q.totalYen <= 0 ||
    !Array.isArray(q.items) ||
    q.items.length < 1 ||
    q.items.length > 10 ||
    new Set(q.items.map((i) => i.skuId)).size !== q.items.length ||
    q.items.some(
      (i) =>
        !/^[a-z0-9-]{1,64}$/.test(i.skuId) ||
        typeof i.productName !== "string" ||
        typeof i.label !== "string" ||
        !Number.isSafeInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 99 ||
        !Number.isSafeInteger(i.unitPriceYen) ||
        i.unitPriceYen <= 0 ||
        i.subtotalYen !== i.unitPriceYen * i.quantity,
    ) ||
    q.totalYen !== q.items.reduce((sum, i) => sum + i.subtotalYen, 0)
  )
    throw new Error("Invalid pending checkout");
  return { key: value.key, quote: publicQuote(q) };
}
export function isReceipt(value: unknown, quote: Quote): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Receipt;
  return (
    typeof r.orderId === "string" &&
    /^[0-9a-f-]{36}$/.test(r.orderId) &&
    ORDER_STATUSES.includes(r.status) &&
    r.currency === "JPY" &&
    r.totalYen === quote.totalYen
  );
}
// Only documented rejection responses on the FIRST attempt permit editing/new keys.
// A retry/recovery must stay locked even if the buyer accidentally re-enters different data.
export function isDefinitiveRejection(status: number, code: unknown): boolean {
  const codes: Record<string, number> = {
    INVALID_REQUEST: 400,
    MIXED_SELLERS: 400,
    UNAVAILABLE_SKU: 400,
    FORBIDDEN: 403,
    TOO_LARGE: 413,
    OUT_OF_STOCK: 409,
    PRICE_CHANGED: 409,
    REVIEW_REQUIRED: 422,
  };
  return typeof code === "string" && codes[code] === status;
}
