import Link from "next/link";
import Image from "next/image";
import { connection } from "next/server";
import { getProducts } from "@/lib/server/catalog";
import styles from "./page.module.scss";
export default async function ProductsPage() {
  await connection();
  const products = await getProducts();
  return (
    <main>
      <h1>地元の旬を、少しずつ。</h1>
      <p>少量・不定期の野菜とお米を、生産者から直接。</p>
      <section className={styles.notice}>
        <h2>検証用の出品</h2>
        <p>
          掲載中の生産者・商品・受取所はすべて架空です。実際の販売は行っていません。
        </p>
      </section>
      <h2>商品一覧</h2>
      {!products.length && <p>現在、表示できる商品はありません。</p>}
      <ul className={styles.productList}>
        {products.map((p) => (
          <li key={p.id}>
            <Link href={`/products/${p.handle}`} className={styles.product}>
              {p.imageUrl ? (
                <Image
                  src={p.imageUrl}
                  alt={p.title}
                  width={90}
                  height={90}
                  unoptimized
                />
              ) : (
                <div
                  className={styles.placeholder}
                  aria-label="商品写真は準備中"
                >
                  写真
                  <br />
                  準備中
                </div>
              )}
              <div>
                <h2>{p.title}</h2>
                <p>{p.sellerName}</p>
                <strong>
                  {Math.min(...p.skus.map((s) => s.priceYen)).toLocaleString(
                    "ja-JP",
                  )}
                  円〜（税込）
                </strong>
                <p>
                  現地受取 /{" "}
                  {p.skus.some((s) => s.active && s.available > 0)
                    ? "申込み受付中"
                    : "売り切れ"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p>
        売主・代金受取人・引渡担当者は各生産者です。現地受取は生産者へ現金払い。申込み後に生産者の承諾が必要です。
      </p>
      <Link href="/cart" className={styles.action}>
        カートを見る
      </Link>
    </main>
  );
}
