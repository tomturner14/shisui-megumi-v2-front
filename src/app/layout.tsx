import type { Metadata } from "next";
import Link from "next/link";
import { CartProvider } from "@/components/CartProvider";
import { CartLink } from "@/components/CartLink";
import "./globals.scss";
export const metadata: Metadata = {
  title: "酒々井の恵｜検証用",
  description:
    "野菜と米を生産者から直接。架空の商品を使ったローカル検証アプリ。",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <CartProvider>
          <header>
            <Link href="/">酒々井の恵</Link>
            <nav aria-label="メインナビゲーション">
              <Link href="/products">商品一覧</Link>
              <CartLink />
            </nav>
          </header>
          {children}
          <footer>
            架空のデータを用いた検証用アプリです。実販売前に、販売条件・特商法表示・個人情報の扱いを確認します。
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
