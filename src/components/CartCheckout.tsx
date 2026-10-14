"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CatalogProduct, Quote, Receipt } from "@/types/catalog";
import { useCart } from "./CartProvider";
import styles from "./shop.module.scss";
export function CartCheckout({ products }: { products: CatalogProduct[] }) {
  const { items, quantity, clear, message, ready } = useCart();
  const router = useRouter();
  const [name, setName] = useState(""),
    [contact, setContact] = useState(""),
    [agreed, setAgreed] = useState(false);
  const [review, setReview] = useState<Quote | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const catalog = products.flatMap((p) =>
    p.skus.map((s) => ({ ...s, product: p })),
  );
  const total = items.reduce(
    (sum, i) =>
      sum + (catalog.find((s) => s.id === i.skuId)?.priceYen ?? 0) * i.quantity,
    0,
  );
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, fulfillment: "PICKUP" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setReview(data);
      pending.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "金額を確認できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    pending.current ??= {
      key: crypto.randomUUID(),
      body: JSON.stringify({
        items,
        fulfillment: "PICKUP",
        buyer: { name, contact },
        expectedTotalYen: review.totalYen,
        agreed,
      }),
    };
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.current.key,
        },
        body: pending.current.body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setReceipt(data);
      clear();
      setName("");
      setContact("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "通信結果を確認できません。同じ内容で再送できます。",
      );
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <main>
        <h1>申込みを受け付けました</h1>
        <section className={styles.panel}>
          <h2>まだ購入確定ではありません</h2>
          <p>状態：REQUESTED（生産者の承諾待ち）</p>
          <p>受付番号：{receipt.orderId}</p>
          <p>税込商品合計：{receipt.totalYen.toLocaleString("ja-JP")}円</p>
          <p>
            検証用の受付です。実際の受取・支払い・承諾の連絡は行われません。
          </p>
        </section>
        <Link href="/products">商品一覧へ戻る</Link>
      </main>
    );
  if (!ready)
    return (
      <main>
        <h1>カート</h1>
        <p>カートを読み込んでいます。</p>
      </main>
    );
  if (!items.length)
    return (
      <main>
        <h1>カート</h1>
        <p>カートは空です。</p>
        <Link href="/products">商品を選ぶ</Link>
      </main>
    );
  if (review)
    return (
      <main>
        <h1>申込み前の最終確認</h1>
        <p>売主・代金受取人・引渡担当者：{review.sellerName}</p>
        <ul className={styles.list}>
          {review.items.map((i) => (
            <li className={styles.item} key={i.skuId}>
              {i.productName} {i.label} × {i.quantity}
              <br />
              {i.unitPriceYen.toLocaleString("ja-JP")}円 × {i.quantity} ={" "}
              {i.subtotalYen.toLocaleString("ja-JP")}円（税込）
            </li>
          ))}
        </ul>
        <p className={styles.total}>
          合計 {review.totalYen.toLocaleString("ja-JP")}円（税込・JPY）
        </p>
        <section className={styles.panel}>
          <h2>現地受取・現金払い</h2>
          <p>{review.pickupConditions}</p>
          <p>送料なし。生産者の承諾後、引渡時に生産者へ現金で支払います。</p>
        </section>
        <p>お名前：{name}</p>
        <p>連絡先：{contact}</p>
        <p>
          申込み受付と購入確定は異なります。今回は架空の検証用条件への申込みです。
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button disabled={busy} onClick={submit}>
            {busy ? "送信中…" : "この内容で申し込む"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setReview(null);
              pending.current = null;
              setError("");
            }}
          >
            内容を修正・金額を再確認
          </button>
        </div>
        <p>
          通信結果が不明な場合は同じ内容で再送してください。入力内容はブラウザに保存していません。
        </p>
      </main>
    );
  return (
    <main>
      <h1>カート</h1>
      <p>1申込みにつき1生産者。異なる生産者の商品は別の申込みになります。</p>
      <ul className={styles.list}>
        {items.map((i) => {
          const sku = catalog.find((s) => s.id === i.skuId);
          return (
            <li className={styles.item} key={i.skuId}>
              <h2>{sku?.product.title ?? "現在販売していない商品"}</h2>
              <p>
                {sku?.product.sellerName} / {sku?.label}
              </p>
              <p>
                {sku
                  ? `${sku.priceYen.toLocaleString("ja-JP")}円（税込） / 申込み可能数 ${sku.available}個`
                  : "削除して商品を選び直してください。"}
              </p>
              <div className={styles.row}>
                <button
                  aria-label={`${i.skuId}を減らす`}
                  onClick={() => quantity(i.skuId, i.quantity - 1)}
                >
                  −
                </button>
                <span aria-label={`${i.skuId}の数量`}>{i.quantity}</span>
                <button
                  aria-label={`${i.skuId}を増やす`}
                  disabled={i.quantity >= 99}
                  onClick={() => quantity(i.skuId, i.quantity + 1)}
                >
                  ＋
                </button>
                <button onClick={() => quantity(i.skuId, 0)}>削除</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={styles.total}>
        商品合計（参考） {total.toLocaleString("ja-JP")}円（税込）
      </p>
      <p>最新の価格・在庫をサーバーで確認してから申し込みます。</p>
      {(message || error) && (
        <p role="alert" className={styles.error}>
          {message || error}
        </p>
      )}
      <form className={styles.form} onSubmit={confirm}>
        <section className={styles.panel}>
          <h2>現地受取・現金払い</h2>
          <p>
            {
              catalog.find((s) => s.id === items[0].skuId)?.product
                .pickupConditions
            }
          </p>
          <p>
            発送：送料・梱包未確定のため受付準備中（REVIEW_REQUIRED）。発送の正式注文はできません。
          </p>
        </section>
        <label>
          お名前
          <input
            required
            maxLength={80}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          メールアドレスまたは電話番号
          <input
            required
            maxLength={120}
            autoComplete="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </label>
        <p>
          現地受取では住所は不要です。検証では架空の氏名と連絡先を入力してください。氏名・連絡先は申込み対応のためD1にのみ保存します。実販売前に保存期間と削除方針の確定が必要です。
        </p>
        <label>
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          架空の商品・受取条件であること、受付時点では購入確定でないことを確認しました。
        </label>
        <button
          disabled={
            busy ||
            !agreed ||
            items.some((i) => !catalog.find((s) => s.id === i.skuId))
          }
        >
          {busy ? "確認中…" : "最新の金額・申込み内容を確認"}
        </button>
      </form>
      <p>
        <Link href="/products">商品を追加する</Link>
      </p>
    </main>
  );
}
