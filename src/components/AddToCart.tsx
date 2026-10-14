"use client";
import { useState } from "react";
import Link from "next/link";
import type { CatalogProduct } from "@/types/catalog";
import { useCart } from "./CartProvider";
import styles from "./shop.module.scss";
export function AddToCart({ product }: { product: CatalogProduct }) {
  const { add, message, ready } = useCart();
  const [skuId, setSku] = useState(product.skus[0].id),
    [quantity, setQuantity] = useState(1),
    [added, setAdded] = useState(false);
  const sku = product.skus.find((s) => s.id === skuId)!;
  return (
    <section className={styles.panel}>
      <label>
        内容量・税込価格
        <select
          value={skuId}
          onChange={(e) => {
            setSku(e.target.value);
            setAdded(false);
          }}
        >
          {product.skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} / {s.priceYen.toLocaleString("ja-JP")}円
            </option>
          ))}
        </select>
      </label>
      <p>申込み可能数：{sku.available}個</p>
      <label>
        数量
        <input
          type="number"
          min={1}
          max={Math.min(99, sku.available)}
          value={quantity}
          onChange={(e) => {
            setQuantity(Number(e.target.value));
            setAdded(false);
          }}
        />
      </label>
      <p>同じ生産者の商品を、複数種類まとめて申し込めます。</p>
      <button
        disabled={
          !ready ||
          !sku.active ||
          sku.available < quantity ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 99
        }
        onClick={() => {
          add({ skuId, sellerId: product.sellerId, quantity });
          setAdded(true);
        }}
      >
        カートに入れる
      </button>
      {message ? (
        <p role="alert">{message}</p>
      ) : added ? (
        <p role="status">カートに追加しました。</p>
      ) : null}
      <Link href="/cart">カートを確認する</Link>
    </section>
  );
}
