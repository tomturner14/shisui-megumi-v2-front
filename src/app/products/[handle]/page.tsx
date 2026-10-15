import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import Image from "next/image";
import { getProducts } from "@/lib/server/catalog";
import { AddToCart } from "@/components/AddToCart";
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  await connection();
  const { handle } = await params;
  const [product] = await getProducts(handle);
  if (!product) notFound();
  return (
    <main>
      <p>
        <Link href="/products">商品一覧へ戻る</Link>
      </p>
      {product.imageUrl ? (
        <Image
          src={product.imageUrl}
          alt={product.title}
          width={342}
          height={240}
          unoptimized
        />
      ) : (
        <p>商品写真は準備中（架空の商品）</p>
      )}
      <h1>{product.title}</h1>
      <p>売主：{product.sellerName}</p>
      <p>{product.description}</p>
      <p>{product.pickupConditions}</p>
      <AddToCart product={product} />
    </main>
  );
}
