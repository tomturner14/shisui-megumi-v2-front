import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAdmin, AdminError } from "@/lib/server/admin-auth";
import { getAdminOrder } from "@/lib/server/admin-orders";
import { getDB } from "@/lib/server/db";
import Actions from "./Actions";
import styles from "../page.module.scss";
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin(await headers());
  const { id } = await params;
  const o = await getAdminOrder(await getDB(), id).catch((e) => {
    if (e instanceof AdminError && e.status === 404) notFound();
    throw e;
  });
  const actions: ("ACCEPTED" | "REJECTED" | "CANCELLED")[] = [];
  // Dynamic server request time; the DB independently enforces the deadline on action.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (o.status === "REQUESTED") {
    if (o.expires_at_ms !== null && o.expires_at_ms > now)
      actions.push("ACCEPTED");
    actions.push("REJECTED");
  }
  if (
    ["REQUESTED", "ACCEPTED"].includes(o.status) &&
    o.cash_received_at_ms === null &&
    o.handover_recorded_at_ms === null
  )
    actions.push("CANCELLED");
  return (
    <main>
      <Link prefetch={false} href="/admin/orders">
        注文一覧へ
      </Link>
      <h1>注文詳細</h1>
      <p>受付番号：{o.id}</p>
      <p>状態：{o.status}</p>
      <p>申込日時：{o.created_at}（UTC）</p>
      <p>
        承諾期限：
        {o.expires_at_ms === null
          ? "未設定（承諾不可）"
          : new Date(o.expires_at_ms).toISOString()}
      </p>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>売主・受取条件</h2>
          <p>
            {o.seller_name}（{o.seller_id}）
          </p>
          <p>{o.pickup_conditions}</p>
          <p>現地受取・生産者へ現金払い</p>
          <p>
            入金記録：{o.cash_received_at_ms === null ? "なし" : "あり"} /
            引渡記録：{o.handover_recorded_at_ms === null ? "なし" : "あり"}
          </p>
        </section>
        <section className={styles.card}>
          <h2>購入者（運営者限定）</h2>
          <p>{o.buyer_name}</p>
          <p>{o.buyer_contact}</p>
        </section>
      </div>
      <h2>注文明細</h2>
      <ul className={styles.list}>
        {o.items.map((i) => (
          <li key={i.sku_id} className={styles.card}>
            {i.product_name} / {i.sku_label}
            <p>SKU：{i.sku_id}</p>
            <p>
              {i.unit_price_yen}円 × {i.quantity}個 = {i.subtotal_yen}円
            </p>
          </li>
        ))}
      </ul>
      <p>合計：{o.total_yen.toLocaleString("ja-JP")}円（税込・JPY）</p>
      <Actions orderId={id} actions={actions} />
      <h2>操作履歴</h2>
      {!o.events.length && <p>操作履歴はありません。</p>}
      <ul className={styles.list}>
        {o.events.map((e) => (
          <li key={e.id} className={styles.card}>
            <p>
              {e.operation}：{e.from_status} → {e.to_status}
            </p>
            <p>
              担当者：
              {e.actor_id ??
                (e.actor_category === "SYSTEM"
                  ? "内部期限処理"
                  : "担当者ID未記録（旧・内部操作）")}
            </p>
            <p>
              {new Date(e.occurred_at_ms).toISOString()} / {e.actor_category}
            </p>
            <p>操作キー：{e.operation_key}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
