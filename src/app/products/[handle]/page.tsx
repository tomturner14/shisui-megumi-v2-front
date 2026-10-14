import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchProduct } from "@/lib/server/product-api";

import Image from "next/image";

type ProductDetailPageProps = {
  params: Promise<{
    handle: string;
  }>;
};

export default async function ProductDetailPage({
  params,
}: ProductDetailPageProps) {
  const { handle } = await params;

  const product = await fetchProduct(handle);

  if (!product) {
    notFound();
  }

  return (
    <main>
      {product.imageUrl === null ? (
        <p>商品画像はありません</p>
      ) : (
        <Image
          src={product.imageUrl}
          alt={product.title}
          width={500}
          height={500}
        />
      )}
      <h1>{product.title}</h1>
      <p>{product.description}</p>
      <p>{product.priceYen.toLocaleString("ja-JP")}円</p>
      <p>{product.availableForSale ? "販売中" : "売り切れ"}</p>
      <Link href="/products">商品一覧へ戻る</Link>
    </main>
  );
}
