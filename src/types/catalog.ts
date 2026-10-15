export type CatalogSku = {
  id: string;
  label: string;
  priceYen: number;
  available: number;
  active: boolean;
};
export type CatalogProduct = {
  id: string;
  sellerId: string;
  sellerName: string;
  pickupConditions: string;
  handle: string;
  title: string;
  description: string;
  imageUrl: string | null;
  skus: CatalogSku[];
};
export type CartItem = { skuId: string; sellerId: string; quantity: number };
export type Quote = {
  sellerId: string;
  sellerName: string;
  pickupConditions: string;
  totalYen: number;
  items: {
    skuId: string;
    productName: string;
    label: string;
    unitPriceYen: number;
    quantity: number;
    subtotalYen: number;
  }[];
};
export const ORDER_STATUSES = [
  "REQUESTED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Receipt = {
  orderId: string;
  status: OrderStatus;
  totalYen: number;
  currency: "JPY";
};
