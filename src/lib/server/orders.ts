import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { CartItem, Quote, Receipt } from "@/types/catalog";
export class OrderError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const invalid = () =>
  new OrderError(
    "INVALID_REQUEST",
    400,
    "商品・数量・連絡先を確認してください。",
  );
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}
export function parseItems(value: unknown): CartItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10)
    throw invalid();
  const items = value.map((entry) => {
    const v = record(entry);
    if (
      typeof v.skuId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(v.skuId) ||
      typeof v.sellerId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(v.sellerId) ||
      !Number.isInteger(v.quantity) ||
      Number(v.quantity) < 1 ||
      Number(v.quantity) > 99
    )
      throw invalid();
    return {
      skuId: v.skuId,
      sellerId: v.sellerId,
      quantity: Number(v.quantity),
    };
  });
  if (new Set(items.map((i) => i.skuId)).size !== items.length) throw invalid();
  if (new Set(items.map((i) => i.sellerId)).size !== 1)
    throw new OrderError(
      "MIXED_SELLERS",
      400,
      "別の生産者の商品は別の申込みにしてください。",
    );
  return items.sort((a, b) => a.skuId.localeCompare(b.skuId));
}
function fulfillment(value: unknown) {
  if (value === "SHIPPING")
    throw new OrderError(
      "REVIEW_REQUIRED",
      422,
      "送料・梱包条件が未確定のため、発送の注文は受け付けていません。",
    );
  if (value !== "PICKUP") throw invalid();
}
type SkuRow = {
  sku_id: string;
  seller_id: string;
  product_name: string;
  label: string;
  price_yen: number;
  available: number;
  seller_name: string;
  pickup_conditions: string;
  active: number;
};
export async function quote(
  db: D1Database,
  items: CartItem[],
  method: unknown,
): Promise<Quote> {
  fulfillment(method);
  const rows = await db
    .prepare(
      `SELECT s.id sku_id,p.seller_id,p.title product_name,s.label,s.price_yen,
 i.on_hand-i.reserved available,v.name seller_name,v.pickup_conditions,
 (s.active*p.active*v.active) active FROM skus s JOIN products p ON p.id=s.product_id
 JOIN sellers v ON v.id=p.seller_id JOIN inventory i ON i.sku_id=s.id
 WHERE s.id IN (${items.map(() => "?").join(",")})`,
    )
    .bind(...items.map((i) => i.skuId))
    .all<SkuRow>();
  const result: Quote = {
    sellerId: items[0].sellerId,
    sellerName: "",
    pickupConditions: "",
    items: [],
    totalYen: 0,
  };
  for (const item of items) {
    const r = rows.results.find((r) => r.sku_id === item.skuId);
    if (!r || !r.active)
      throw new OrderError(
        "UNAVAILABLE_SKU",
        400,
        "存在しない商品、または販売停止の商品があります。",
      );
    if (r.seller_id !== result.sellerId)
      throw new OrderError("MIXED_SELLERS", 400, "生産者が一致しません。");
    if (r.available < item.quantity)
      throw new OrderError(
        "OUT_OF_STOCK",
        409,
        "在庫が不足しています。数量を変更してください。",
      );
    result.sellerName = r.seller_name;
    result.pickupConditions = r.pickup_conditions;
    const subtotalYen = r.price_yen * item.quantity;
    result.items.push({
      skuId: r.sku_id,
      productName: r.product_name,
      label: r.label,
      unitPriceYen: r.price_yen,
      quantity: item.quantity,
      subtotalYen,
    });
    result.totalYen += subtotalYen;
  }
  return result;
}
type Existing = {
  id: string;
  request_hash: string;
  total_yen: number;
  status: string;
};
function receipt(order: Existing): Receipt {
  return {
    orderId: order.id,
    status: "REQUESTED",
    totalYen: order.total_yen,
    currency: "JPY",
  };
}
export async function submitOrder(
  db: D1Database,
  input: unknown,
  key: unknown,
): Promise<Receipt> {
  const body = record(input);
  fulfillment(body.fulfillment);
  const items = parseItems(body.items),
    buyer = record(body.buyer);
  if (
    typeof key !== "string" ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(key) ||
    typeof buyer.name !== "string" ||
    typeof buyer.contact !== "string" ||
    body.agreed !== true ||
    !Number.isInteger(body.expectedTotalYen) ||
    Number(body.expectedTotalYen) <= 0
  )
    throw invalid();
  const name = buyer.name.trim(),
    contact = buyer.contact.trim();
  if (
    name.length < 1 ||
    name.length > 80 ||
    contact.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(name + contact) ||
    !(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ||
      /^\+?[0-9 ()-]{8,20}$/.test(contact)
    )
  )
    throw invalid();
  // Only canonical, meaningful fields enter the hash. Browser prices are deliberately ignored.
  const canonical = JSON.stringify({
    items,
    fulfillment: "PICKUP",
    name,
    contact,
    expectedTotalYen: body.expectedTotalYen,
    agreed: true,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hash = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const existing = () =>
    db
      .prepare(
        "SELECT id,request_hash,total_yen,status FROM orders WHERE idempotency_key=?",
      )
      .bind(key)
      .first<Existing>();
  const replay = (o: Existing) => {
    if (o.request_hash !== hash)
      throw new OrderError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "同じ送信キーで異なる申込みはできません。",
      );
    return receipt(o);
  };
  const previous = await existing();
  if (previous) return replay(previous);
  // Do not pre-reject insufficient stock here: the batch itself must enforce all-or-nothing.
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `INSERT INTO orders(id,idempotency_key,request_hash,seller_id,status,fulfillment,
 payment_method,buyer_name,buyer_contact,pickup_conditions,expected_total_yen)
 VALUES(?,?,?,?,'REQUESTED','PICKUP','CASH',?,?,
 (SELECT pickup_conditions FROM sellers WHERE id=? AND active=1),?)`,
      )
      .bind(
        id,
        key,
        hash,
        items[0].sellerId,
        name,
        contact,
        items[0].sellerId,
        Number(body.expectedTotalYen),
      ),
  ];
  for (const item of items) {
    // Scalar subqueries intentionally yield NULL on missing SKU; NOT NULL prevents silent zero-line inserts.
    statements.push(
      db
        .prepare(
          `INSERT INTO order_items(order_id,sku_id,product_name,sku_label,unit_price_yen,quantity)
   VALUES(?,?,(SELECT p.title FROM products p JOIN skus s ON s.product_id=p.id WHERE s.id=?),
   (SELECT label FROM skus WHERE id=?),(SELECT price_yen FROM skus WHERE id=?),?)`,
        )
        .bind(
          id,
          item.skuId,
          item.skuId,
          item.skuId,
          item.skuId,
          item.quantity,
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE orders SET total_yen=(SELECT SUM(subtotal_yen) FROM order_items WHERE order_id=?) WHERE id=?`,
      )
      .bind(id, id),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent request with the same unique key may have committed first.
    const raced = await existing();
    if (raced) return replay(raced);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("OUT_OF_STOCK"))
      throw new OrderError(
        "OUT_OF_STOCK",
        409,
        "在庫が不足しています。申込みは保存されませんでした。",
      );
    if (message.includes("PRICE_CHANGED"))
      throw new OrderError(
        "PRICE_CHANGED",
        409,
        "価格が変更されました。最新の金額で確認し直してください。",
      );
    if (
      /INVALID_ORDER_ITEM|NOT NULL constraint|FOREIGN KEY constraint/.test(
        message,
      )
    )
      throw new OrderError(
        "UNAVAILABLE_SKU",
        400,
        "生産者や商品の販売状況を確認してください。",
      );
    throw new OrderError(
      "SERVICE_UNAVAILABLE",
      503,
      "現在申込みを処理できません。同じ内容で再送してください。",
    );
  }
  return {
    orderId: id,
    status: "REQUESTED",
    totalYen: Number(body.expectedTotalYen),
    currency: "JPY",
  };
}
