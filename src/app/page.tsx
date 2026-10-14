import Link from "next/link";
export default function Home() {
  return (
    <main>
      <h1>地元の旬を、少しずつ。</h1>
      <p>
        少量・不定期の余剰農産物を、生産者が無理なく直接販売する「酒々井の恵」。
      </p>
      <p>今回は架空の商品で現地受取・現金払いの購入申込みを試せます。</p>
      <Link href="/products">商品一覧を見る</Link>
    </main>
  );
}
