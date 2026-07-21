import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "酒々井の恵",
  description: "千葉県酒々井町のお米を紹介するサイトです。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <header>
          <Link href="/">酒々井の恵</Link>

          <nav aria-label="メインナビゲーション">
            <Link href="/products">商品一覧</Link>
          </nav>
        </header>

        {children}
      </body>
    </html>
  );
}
