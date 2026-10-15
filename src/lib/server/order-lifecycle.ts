import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { OrderStatus } from "@/types/catalog";
export type TransitionStatus =
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";
export type ActorCategory = "OPERATOR" | "SYSTEM";
export class LifecycleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export type TransitionCommand = {
  orderId: string;
  toStatus: TransitionStatus;
  operationKey: string;
  actorCategory: ActorCategory;
  nowMs?: number;
};
export type TransitionResult = {
  orderId: string;
  status: OrderStatus;
  eventId: string;
  applied: boolean;
};
type EventRow = {
  id: string;
  order_id: string;
  to_status: TransitionStatus;
  actor_category: ActorCategory;
  status: OrderStatus;
};
const operation = {
  ACCEPTED: "ACCEPT",
  REJECTED: "REJECT",
  CANCELLED: "CANCEL",
  EXPIRED: "EXPIRE",
} as const;
// Internal primitive ONLY: caller must be a trusted operator service or expiry job.
// No HTTP handler exposes this function; actorCategory is audit classification, not authentication.
export async function transitionOrder(
  db: D1Database,
  command: TransitionCommand,
): Promise<TransitionResult> {
  const { orderId, toStatus, operationKey, actorCategory } = command,
    nowMs = command.nowMs ?? Date.now();
  if (
    typeof orderId !== "string" ||
    orderId.length < 1 ||
    orderId.length > 100 ||
    !Object.hasOwn(operation, toStatus) ||
    !/^[a-zA-Z0-9:_-]{16,150}$/.test(operationKey) ||
    !["OPERATOR", "SYSTEM"].includes(actorCategory) ||
    (toStatus === "EXPIRED"
      ? actorCategory !== "SYSTEM"
      : actorCategory !== "OPERATOR") ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  )
    throw new LifecycleError("INVALID_COMMAND");
  const existing = () =>
    db
      .prepare(
        `SELECT e.id,e.order_id,e.to_status,e.actor_category,o.status
 FROM order_events e JOIN orders o ON o.id=e.order_id WHERE e.operation_key=?`,
      )
      .bind(operationKey)
      .first<EventRow>();
  const replay = (e: EventRow): TransitionResult => {
    if (
      e.order_id !== orderId ||
      e.to_status !== toStatus ||
      e.actor_category !== actorCategory
    )
      throw new LifecycleError("OPERATION_CONFLICT");
    return { orderId, status: e.status, eventId: e.id, applied: false };
  };
  const previous = await existing();
  if (previous) return replay(previous);
  const id = crypto.randomUUID();
  try {
    const result = await db.batch<{ status: OrderStatus }>([
      db
        .prepare(
          `INSERT INTO order_events(id,operation_key,order_id,operation,actor_category,from_status,to_status,occurred_at_ms)
    VALUES(?,?,?,?,?,COALESCE((SELECT status FROM orders WHERE id=?),'REQUESTED'),?,?)`,
        )
        .bind(
          id,
          operationKey,
          orderId,
          operation[toStatus],
          actorCategory,
          orderId,
          toStatus,
          nowMs,
        ),
      db.prepare("SELECT status FROM orders WHERE id=?").bind(orderId),
    ]);
    const current = result[1].results[0];
    if (!current) throw new LifecycleError("TRANSITION_NOT_APPLIED");
    return { orderId, status: current.status, eventId: id, applied: true };
  } catch (error) {
    const raced = await existing();
    if (raced) return replay(raced);
    if (error instanceof LifecycleError) throw error;
    const message = error instanceof Error ? error.message : "";
    const codes = [
      "ORDER_NOT_FOUND",
      "TRANSITION_NOT_ALLOWED",
      "DEADLINE_REQUIRED",
      "DEADLINE_PASSED",
      "NOT_DUE",
      "CANCELLATION_BLOCKED",
      "INVALID_EVENT_TIME",
      "RESERVATION_MISMATCH",
      "INVENTORY_HOLD_MISMATCH",
    ];
    throw new LifecycleError(
      codes.find((code) => message.includes(code)) ?? "LIFECYCLE_FAILED",
    );
  }
}
export type ExpirySummary = {
  expired: string[];
  skipped: string[];
  failed: { orderId: string; code: string }[];
};
export async function expireRequestedOrders(
  db: D1Database,
  options: { nowMs?: number; limit?: number } = {},
): Promise<ExpirySummary> {
  const nowMs = options.nowMs ?? Date.now(),
    limit = options.limit ?? 10;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10
  )
    throw new LifecycleError("INVALID_COMMAND");
  const due = await db
    .prepare(
      `SELECT id,expires_at_ms FROM orders WHERE status='REQUESTED'
 AND expires_at_ms IS NOT NULL AND expires_at_ms<=? ORDER BY expires_at_ms,id LIMIT ?`,
    )
    .bind(nowMs, limit)
    .all<{ id: string; expires_at_ms: number }>();
  const summary: ExpirySummary = { expired: [], skipped: [], failed: [] };
  // Each order is its own atomic transaction. Failure never rolls back other orders.
  for (const row of due.results) {
    try {
      const result = await transitionOrder(db, {
        orderId: row.id,
        toStatus: "EXPIRED",
        actorCategory: "SYSTEM",
        operationKey: `expire:${row.id}:${row.expires_at_ms}`,
        nowMs,
      });
      (result.status === "EXPIRED" ? summary.expired : summary.skipped).push(
        row.id,
      );
    } catch (error) {
      const code =
        error instanceof LifecycleError ? error.code : "LIFECYCLE_FAILED";
      if (code === "TRANSITION_NOT_ALLOWED") summary.skipped.push(row.id);
      else summary.failed.push({ orderId: row.id, code });
    }
  }
  return summary;
}
