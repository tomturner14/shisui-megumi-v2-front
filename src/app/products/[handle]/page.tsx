import Link from "next/link";
import { notFound } from "next/navigation";

import { products } from "@/data/products";

type ProductDetailPageProps = {
  params: Promise<{
    handle: string;
  }>;
};

export default async function ProductDetailPage({
  params,
}: ProductDetailPageProps) {
  const { handle } = await params;

  const product = products.find((product) => product.handle === handle);

  if (!product) {
    notFound();
  }

  return (
    <main>
      {product.imageUrl === null && <p>商品画像はありません</p>}
      <h1>{product.title}</h1>

      <p>{product.description}</p>

      <p>{product.priceYen.toLocaleString("ja-JP")}円</p>

      <p>{product.availableForSale ? "販売中" : "売り切れ"}</p>

      <Link href="/products">商品一覧へ戻る</Link>
    </main>
  );
}
