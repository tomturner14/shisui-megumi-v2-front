import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { ORDER_STATUSES } from "@/types/catalog";
import type { AdminOrderDetail, AdminOrderSummary } from "@/types/admin";
import { AdminError } from "./admin-auth";
import { transitionOrder, LifecycleError } from "./order-lifecycle";
const summary = `o.id,o.created_at,o.requested_at_ms,o.status,o.seller_id,s.name seller_name,o.total_yen,o.expires_at_ms`;
export async function listAdminOrders(db: D1Database, params: URLSearchParams) {
  const status = params.get("status") || "",
    page = Number(params.get("page") || "1"),
    size = 20;
  if (
    (status && !(ORDER_STATUSES as readonly string[]).includes(status)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000
  )
    throw new AdminError("INVALID_REQUEST", 400);
  const rows = await db
    .prepare(
      `SELECT ${summary} FROM orders o JOIN sellers s ON s.id=o.seller_id WHERE (?='' OR o.status=?) ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(status, status, size + 1, (page - 1) * size)
    .all<AdminOrderSummary>();
  return {
    orders: rows.results.slice(0, size),
    page,
    hasNext: rows.results.length > size,
  };
}
export async function getAdminOrder(
  db: D1Database,
  id: string,
): Promise<AdminOrderDetail> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new AdminError("NOT_FOUND", 404);
  const row = await db
    .prepare(
      `SELECT ${summary},o.buyer_name,o.buyer_contact,o.pickup_conditions,o.handover_recorded_at_ms,o.cash_received_at_ms FROM orders o JOIN sellers s ON s.id=o.seller_id WHERE o.id=?`,
    )
    .bind(id)
    .first<Omit<AdminOrderDetail, "items" | "events">>();
  if (!row) throw new AdminError("NOT_FOUND", 404);
  const [items, events] = await db.batch([
    db
      .prepare(
        "SELECT sku_id,product_name,sku_label,unit_price_yen,quantity,subtotal_yen FROM order_items WHERE order_id=? ORDER BY sku_id",
      )
      .bind(id),
    db
      .prepare(
        "SELECT id,operation,actor_category,actor_id,from_status,to_status,occurred_at_ms,operation_key FROM order_events WHERE order_id=? ORDER BY occurred_at_ms,id",
      )
      .bind(id),
  ]);
  return {
    ...row,
    items: items.results as AdminOrderDetail["items"],
    events: events.results as AdminOrderDetail["events"],
  };
}
export async function operateAdminOrder(
  db: D1Database,
  id: string,
  body: unknown,
  actorId: string,
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AdminError("INVALID_REQUEST", 400);
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some((k) => !["toStatus", "operationKey"].includes(k)) ||
    typeof value.toStatus !== "string" ||
    !["ACCEPTED", "REJECTED", "CANCELLED"].includes(value.toStatus) ||
    typeof value.operationKey !== "string"
  )
    throw new AdminError("INVALID_REQUEST", 400);
  try {
    return await transitionOrder(db, {
      orderId: id,
      toStatus: value.toStatus as "ACCEPTED" | "REJECTED" | "CANCELLED",
      operationKey: value.operationKey,
      actorCategory: "OPERATOR",
      actorId,
    });
  } catch (error) {
    if (!(error instanceof LifecycleError)) throw error;
    throw new AdminError(
      error.code,
      error.code === "ORDER_NOT_FOUND"
        ? 404
        : error.code === "INVALID_COMMAND"
          ? 400
          : error.code === "LIFECYCLE_FAILED"
            ? 503
            : 409,
    );
  }
}
