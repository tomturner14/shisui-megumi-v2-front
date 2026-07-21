import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>酒々井の恵</h1>

      <p>千葉県酒々井町のお米を紹介するサイトです。</p>

      <Link href="/products">商品一覧を見る</Link>
    </main>
  );
}
