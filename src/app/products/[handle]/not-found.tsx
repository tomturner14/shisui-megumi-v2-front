import Link from "next/link";

export default function ProductNotFound() {
  return (
    <main>
      <h1>商品が見つかりませんでした。</h1>

      <Link href="/products">商品一覧へ戻る</Link>
    </main>
  );
}
