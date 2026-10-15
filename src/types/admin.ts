import type { OrderStatus } from "./catalog";
export type AdminOrderSummary = {
  id: string;
  created_at: string;
  requested_at_ms: number | null;
  status: OrderStatus;
  seller_id: string;
  seller_name: string;
  total_yen: number;
  expires_at_ms: number | null;
};
export type AdminOrderDetail = AdminOrderSummary & {
  buyer_name: string;
  buyer_contact: string;
  pickup_conditions: string;
  handover_recorded_at_ms: number | null;
  cash_received_at_ms: number | null;
  items: {
    sku_id: string;
    product_name: string;
    sku_label: string;
    unit_price_yen: number;
    quantity: number;
    subtotal_yen: number;
  }[];
  events: {
    id: string;
    operation: string;
    actor_category: string;
    actor_id: string | null;
    from_status: string;
    to_status: string;
    occurred_at_ms: number;
    operation_key: string;
  }[];
};
