import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/server/admin-auth";
import { listAdminOrders } from "@/lib/server/admin-orders";
import { getDB } from "@/lib/server/db";
import { ORDER_STATUSES } from "@/types/catalog";
import styles from "./page.module.scss";
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin(await headers());
  const query = await searchParams;
  const result = await listAdminOrders(
    await getDB(),
    new URLSearchParams({
      status: query.status ?? "",
      page: query.page ?? "1",
    }),
  );
  // This authenticated dynamic Server Component evaluates deadlines for this request.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const href = (page: number) =>
    `/admin/orders?${new URLSearchParams({ status: query.status ?? "", page: String(page) })}`;
  return (
    <main>
      <h1>運営用 注文一覧</h1>
      <p className={styles.notice}>
        架空の検証用注文です。受付と承諾を区別し、受取条件を確認して操作してください。
      </p>
      <form>
        <label>
          注文状態
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">すべて</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button type="submit">絞り込む</button>
      </form>
      {!result.orders.length && <p>注文はありません。</p>}
      <ul className={styles.list}>
        {result.orders.map((o) => (
          <li className={styles.card} key={o.id}>
            <Link prefetch={false} href={`/admin/orders/${o.id}`}>
              受付番号 {o.id}
            </Link>
            <p>
              {o.status}
              {o.requested_at_ms !== null &&
                o.requested_at_ms >= now - 86400000 && (
                  <span className={styles.badge}>新着（24時間以内）</span>
                )}
              {o.status === "REQUESTED" && (
                <span className={styles.badge}>
                  {o.expires_at_ms !== null && o.expires_at_ms <= now
                    ? "承諾期限超過"
                    : "未対応"}
                </span>
              )}
            </p>
            <p>申込日時：{o.created_at}（UTC）</p>
            <p>生産者：{o.seller_name}</p>
            <p>合計：{o.total_yen.toLocaleString("ja-JP")}円（税込）</p>
            <p>
              承諾期限：
              {o.expires_at_ms === null
                ? "未設定（承諾不可）"
                : new Date(o.expires_at_ms).toISOString()}
            </p>
          </li>
        ))}
      </ul>
      <nav className={styles.paging} aria-label="ページ送り">
        {result.page > 1 && (
          <Link prefetch={false} href={href(result.page - 1)}>
            前の20件
          </Link>
        )}
        <span>{result.page}ページ</span>
        {result.hasNext && (
          <Link prefetch={false} href={href(result.page + 1)}>
            次の20件
          </Link>
        )}
      </nav>
    </main>
  );
}
