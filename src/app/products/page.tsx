import Link from "next/link";
import { fetchProducts } from "@/lib/server/product-api";
import Image from "next/image";
import styles from "./page.module.scss";

export default async function ProductsPage() {
  const products = await fetchProducts();
  if (products.length === 0) {
    return (
      <main>
        <h1>商品一覧</h1>

        <p>現在、表示できる商品はありません。</p>
      </main>
    );
  }

  return (
    <main>
      <h1>商品一覧</h1>

      <ul className={styles.productList}>
        {products.map((product) => (
          <li key={product.handle}>
            <Link href={`/products/${product.handle}`}>
              {product.imageUrl === null ? (
                <p>商品画像はありません</p>
              ) : (
                <Image
                  src={product.imageUrl}
                  alt={product.title}
                  width={200}
                  height={200}
                />
              )}
              <h2>{product.title}</h2>

              <p>{product.priceYen.toLocaleString("ja-JP")}円</p>

              <p>{product.availableForSale ? "販売中" : "売り切れ"}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
