"use client";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CatalogProduct, Receipt } from "@/types/catalog";
import { cartSnapshot, useCart } from "./CartProvider";
import {
  confirmCheckout,
  sameCart,
  quoteItems,
  orderBody,
  isReceipt,
  isDefinitiveRejection,
  type ConfirmedCheckout,
} from "@/lib/checkout";
import {
  pendingSnapshot,
  subscribePending,
  savePending,
  clearPending,
} from "@/lib/pending-checkout";
import styles from "./shop.module.scss";
export function CartCheckout({ products }: { products: CatalogProduct[] }) {
  const { items, quantity, clearIfMatches, message, ready } = useCart();
  const router = useRouter();
  const [name, setName] = useState(""),
    [contact, setContact] = useState(""),
    [agreed, setAgreed] = useState(false);
  const [review, setReview] = useState<ConfirmedCheckout | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useSyncExternalStore(
    subscribePending,
    pendingSnapshot,
    () => null,
  );
  const pendingBody = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const [recovered, setRecovered] = useState(false);
  const cartChanged = !!review && !sameCart(items, quoteItems(review.quote));
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
    if (inFlight.current || !agreed) return;
    const unresolved = pendingSnapshot();
    if (unresolved === "blocked") return;
    // A recovered request uses the original quote, even if current price/stock changed.
    if (unresolved) {
      setRecovered(pendingBody.current === null);
      setReview(confirmCheckout(unresolved.quote, { name, contact }));
      setError("");
      return;
    }
    const requestedItems = cartSnapshot().map((i) => ({ ...i }));
    const buyer = { name, contact };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: requestedItems, fulfillment: "PICKUP" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (!sameCart(requestedItems, quoteItems(data)))
        throw new Error("確認する明細が一致しません。再確認してください。");
      setReview(confirmCheckout(data, buyer));
    } catch (e) {
      setError(e instanceof Error ? e.message : "金額を確認できませんでした。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (!review || inFlight.current) return;
    const unresolved = pendingSnapshot();
    if (unresolved === "blocked") return;
    // Read storage synchronously as well: its event may not have been delivered yet.
    if (!unresolved && !sameCart(cartSnapshot(), quoteItems(review.quote))) {
      setError("カートが変更されました。申込み内容を確認し直してください。");
      return;
    }
    const target = unresolved ?? {
      key: crypto.randomUUID(),
      quote: review.quote,
    };
    if (JSON.stringify(target.quote) !== JSON.stringify(review.quote)) {
      setError("前回の申込みを先に確認してください。");
      return;
    }
    try {
      savePending(target);
    } catch {
      setError(
        "再送情報を保存できません。二重申込みを防ぐため送信を停止しました。",
      );
      return;
    }
    pendingBody.current ??= { key: target.key, body: orderBody(review) };
    if (pendingBody.current.key !== target.key) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": target.key,
        },
        body: pendingBody.current.body,
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (res.ok && isReceipt(data, target.quote)) {
        setReceipt(data);
        setReview(null);
        setRecovered(false);
        clearIfMatches(quoteItems(target.quote));
        setName("");
        setContact("");
        pendingBody.current = null;
        try {
          clearPending();
        } catch {
          /* Keeping an old key is safer than issuing a new one. */
        }
        router.refresh();
      } else if (!unresolved && isDefinitiveRejection(res.status, data.code)) {
        clearPending();
        pendingBody.current = null;
        setError(data.message);
      } else {
        if (recovered && data.code === "IDEMPOTENCY_CONFLICT")
          pendingBody.current = null;
        setError(
          "受付結果を確認できません。同じ内容・同じ送信キーで再確認してください。" +
            (data.code === "IDEMPOTENCY_CONFLICT"
              ? " 前回と同じ氏名・連絡先を入力してください。"
              : ""),
        );
      }
    } catch {
      setError(
        "通信結果が不明です。申込みが保存された可能性があります。同じ内容で受付結果を確認してください。",
      );
    } finally {
      inFlight.current = false;
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
  if (pending === "blocked")
    return (
      <main>
        <h1>受付結果の確認が必要です</h1>
        <p role="alert">
          再送情報を読み取れません。二重申込みを防ぐため新しい送信を停止しています。ブラウザの保存設定を確認してください。
        </p>
      </main>
    );
  if (pending && !review)
    return (
      <main>
        <h1>前回の受付結果を確認</h1>
        <p>
          前回の申込みが保存された可能性があります。新しいキーでは送信せず、元の申込みを再送して結果を確認します。
        </p>
        <p>
          氏名・連絡先は保存していないため、前回と同じ内容を入力してください。
        </p>
        <form className={styles.form} onSubmit={confirm}>
          <label>
            お名前
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            メールアドレスまたは電話番号
            <input
              required
              maxLength={120}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </label>
          <label>
            <input
              required
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            前回と同じ申込みで結果を確認します。
          </label>
          <button disabled={!agreed}>元の申込み内容を確認</button>
        </form>
      </main>
    );
  if (!items.length && !review)
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
        <p>売主・代金受取人・引渡担当者：{review.quote.sellerName}</p>
        <ul className={styles.list}>
          {review.quote.items.map((i) => (
            <li className={styles.item} key={i.skuId}>
              {i.productName} {i.label} × {i.quantity}
              <br />
              {i.unitPriceYen.toLocaleString("ja-JP")}円 × {i.quantity} ={" "}
              {i.subtotalYen.toLocaleString("ja-JP")}円（税込）
            </li>
          ))}
        </ul>
        <p className={styles.total}>
          合計 {review.quote.totalYen.toLocaleString("ja-JP")}円（税込・JPY）
        </p>
        <section className={styles.panel}>
          <h2>現地受取・現金払い</h2>
          <p>{review.quote.pickupConditions}</p>
          <p>送料なし。生産者の承諾後、引渡時に生産者へ現金で支払います。</p>
        </section>
        <p>お名前：{review.buyer.name}</p>
        <p>連絡先：{review.buyer.contact}</p>
        <p>
          申込み受付と購入確定は異なります。今回は架空の検証用条件への申込みです。
        </p>
        {cartChanged && !pending && (
          <p role="alert" className={styles.error}>
            カートが変更されました。申込み内容を確認し直してください。
          </p>
        )}
        {pending && (
          <p role="alert">
            前回の受付結果が未確認です。結果を確認するまで修正・新しい申込みはできません。
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button disabled={busy || (cartChanged && !pending)} onClick={submit}>
            {busy
              ? "送信中…"
              : pending
                ? "同じ内容で受付結果を確認"
                : "この内容で申し込む"}
          </button>
          <button
            disabled={busy || !!pending}
            onClick={() => {
              setReview(null);
              setError("");
            }}
          >
            内容を修正・金額を再確認
          </button>
        </div>
        {pending && recovered && (
          <button
            disabled={busy}
            onClick={() => {
              setReview(null);
              pendingBody.current = null;
              setError("");
            }}
          >
            前回の氏名・連絡先を入力し直す
          </button>
        )}
        <p>
          通信結果が不明な場合は同じ内容で再送してください。送信キーと商品明細だけをタブ内に保存し、氏名・連絡先は保存しません。再読み込み後は元の氏名・連絡先を再入力します。
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
