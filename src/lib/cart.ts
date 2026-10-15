import type { CartItem } from "@/types/catalog";
export const CART_KEY = "shisui-cart-v1";
export function readCart(value: unknown): CartItem[] {
  if (!Array.isArray(value) || value.length > 10) return [];
  const items: CartItem[] = [];
  for (const v of value) {
    if (
      !v ||
      typeof v.skuId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(v.skuId) ||
      typeof v.sellerId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(v.sellerId) ||
      !Number.isInteger(v.quantity) ||
      v.quantity < 1 ||
      v.quantity > 99 ||
      items.some((i) => i.skuId === v.skuId) ||
      (items.length > 0 && items[0].sellerId !== v.sellerId)
    )
      return [];
    items.push({ skuId: v.skuId, sellerId: v.sellerId, quantity: v.quantity });
  }
  return items;
}
export function addItem(items: CartItem[], item: CartItem): CartItem[] {
  if (items.length && items[0].sellerId !== item.sellerId)
    throw new Error(
      "別の生産者の商品は別注文です。今のカートはそのままです。先に申込みを終えるか、カートで商品を削除してください。",
    );
  const existing = items.find((i) => i.skuId === item.skuId);
  if (
    (existing?.quantity ?? 0) + item.quantity > 99 ||
    (!existing && items.length >= 10)
  )
    throw new Error("1商品99個・10種類まで追加できます。");
  return existing
    ? items.map((i) =>
        i.skuId === item.skuId
          ? { ...i, quantity: i.quantity + item.quantity }
          : i,
      )
    : [...items, item];
}
export function setQuantity(
  items: CartItem[],
  skuId: string,
  quantity: number,
): CartItem[] {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99)
    throw new Error("数量は0〜99の整数で指定してください。");
  return quantity === 0
    ? items.filter((i) => i.skuId !== skuId)
    : items.map((i) => (i.skuId === skuId ? { ...i, quantity } : i));
}
