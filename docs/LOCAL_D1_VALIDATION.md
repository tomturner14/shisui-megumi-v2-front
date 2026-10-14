# 実装・ローカルD1検証記録

検証日：2026-10-14。基準：GitHub main `1b25def`。Node.js 24.19.0 / Next.js 16.4.0 / React 19.2.7 / vinext 1.2.0 / Wrangler 4.151.0。

## 実装範囲

- 架空の生産者2名、公開商品3種類・公開SKU4種類、販売停止の異常系商品1種類。売主・商品・SKU・税込JPY価格・現物在庫・確保数を分離。
- D1から商品一覧と詳細を取得。既存の `next/image` 表示を維持。架空seedには実商品写真がないため明示的な写真準備中表示。
- SKU選択、複数個・複数種類、同一SKU追加時の合算、数量増減・削除。別生産者の追加は警告し、既存カートを保持。
- 現地受取・生産者への現金払い。最小限の氏名とメールまたは電話番号。配送先住所は要求しない。ブラウザ永続保存はSKU ID・sellerId・数量のみ。
- サーバー見積→最終確認→ `REQUESTED` 受付。架空の受取所・日時を画面と注文に明示。生産者承諾 `ACCEPTED` は別のDB状態だが、今回承諾APIは実装しない。
- 発送は `422 REVIEW_REQUIRED`。送料を捏造せず、注文・在庫確保を作らない。
- 注文GET・管理APIは提供しない。受付応答は受付番号・状態・合計・通貨のみ。エラー応答にSQL・個人情報を含めない。Origin確認、JSON限定、実際のリクエストボディ16KiB上限。

## 主要ファイルと判断

| ファイル | 役割 |
| --- | --- |
| `migrations/0001_catalog_orders.sql` | STRICTテーブル、外部キー、整数金額、在庫制約、販売者・販売状況検証と確保トリガー |
| `scripts/seed.sql` | 架空データ。既存在庫を再seedでリセットしない |
| `src/lib/server/catalog.ts` | 公開商品・SKU・生産者・利用可能在庫の取得 |
| `src/lib/server/orders.ts` | 入力検証、見積、正規化ハッシュによる冪等性、D1 batch注文受付 |
| `src/lib/server/db.ts` / `db-cloudflare.ts` | 通常Next.jsはローカルgetPlatformProxy、vinextはネイティブD1 binding。Vite aliasで分離 |
| `src/app/api/{products,quote,orders}/route.ts` | Next.js Route Handlers。注文はPOSTのみ |
| `src/lib/cart.ts` / `src/components/*` | Reactカート、最終確認、受付結果。SCSS Modulesでスマホ優先 |
| `src/app/products/*` / `src/app/cart/page.tsx` | D1取得と画面。`connection()`でビルド時取得を避ける |
| `vite.config.ts` / `wrangler.jsonc` | vinext＋Cloudflareのローカル構成。リモートbindingなし |
| `tests/*` / `playwright.config.ts` | カート単体・実D1・ブラウザ・HTTP API検証 |

旧Express通信コードと旧Product型は履歴・将来の比較用に残すが、新しい画面・APIからは呼び出さない。EXPRESS_API_BASE_URLは設定していない。Shopify・Expressの別リポジトリは変更していない。Figmaの自然な緑・生成り・商品行・余白を既存React/SCSSへ適用。Figmaに存在しない実商品写真は作っていない。

## 値の流れ

1. `/products`、`/products/[handle]`、`/cart` のServer Component → `getDB()` → D1 SELECT → 商品・SKU・税込価格・生産者・利用可能在庫を画面へ。
2. カートは `localStorage` に `{skuId,sellerId,quantity}` だけを保存。氏名・連絡先・価格・秘密情報は保存しない。
3. `/api/quote` にSKUと数量をPOST → D1の現在価格・在庫・売主を照合 → 税込合計と架空受取条件 → 最終確認画面。
4. 最終確認から `/api/orders` に明細、氏名・連絡先、確認した合計、同意、冪等キーをPOST。送信中と同一内容再送では同じキーを利用。
5. サーバーが内容を正規化してSHA-256ハッシュ化。同じキーが存在すれば一致時は同じ受付番号、不一致なら409。
6. `batch()` 内で注文ヘッダーINSERT → 各SKUの**DB値**から商品名・SKUラベル・単価をスナップショットINSERT → トリガーによる在庫確保 → DB明細小計SUMで合計再計算。確認合計と一致しなければ全体をロールバック。
7. 受付番号・ `REQUESTED` ・合計を画面へ返し、「まだ購入確定ではありません」と表示。カートを空にし、個人情報入力もメモリからクリア。注文一覧を公開しない。

## 原子的在庫確保

条件付きUPDATEの変更件数0はSQLエラーではないことをローカルD1で確認済み。したがって「UPDATEが失敗したはず」と仮定しない。

`order_items` INSERT前に生産者一致・SKU存在・販売状態・単価を検証。INSERT後に `inventory_reservations` を作る。確保前トリガーが在庫不足を `RAISE(ABORT,'OUT_OF_STOCK')` に変換し、D1 `batch()` 全体を失敗させる。確保成功時だけ `inventory.reserved` を増やす。予約PKと注文冪等キーUNIQUEで二重確保・二重注文を拒否。存在しないSKUはNULL/トリガー/外部キーで失敗させ、0明細の黙示的成功を避ける。

ブラウザ送信単価は使用しない。合計確認値だけを期待値として保存し、D1明細から再計算した値との不一致で失敗させる。注文処理は最大10SKU、最大12個のbatch文＋既存キー照会1回（失敗時は再照会1回）。トリガーと索引の行読み書きも利用量に含まれる。

## 検証結果

| 検証 | 結果・範囲 |
| --- | --- |
| lint | 成功 |
| TypeScript (`next typegen` + `tsc`) | 成功 |
| カート単体 | 3件成功：複数SKU、重複合算、増減・削除、混在拒否、保存フィールド制限 |
| 実ローカルD1 | 9件成功。Wrangler migration/seed + workerd D1 binding。SQLite代替・DBモックなし |
| D1の正常注文 | 同じ生産者の2SKU・各2個、税込2,780円、単価/小計保存、氏名連絡先保存、PIIを返さない |
| 条件付きUPDATE | 変更0件で `success:true`。SQLエラーは自動発生しない |
| 途中の1SKU不足 | 先行SKUを確保した後に不足。注文・明細・予約数・全在庫が開始前と完全一致 |
| 同時注文 | 在庫1個に対して8件同時申込み、成功1件・不足7件。在庫負数なし |
| 冪等性 | 同時同一キー・同内容再送は同じ注文。数量/金額/氏名変更は409 |
| 入力・販売状態 | 0、負数、小数、100、文字列数量、SKU不在、販売停止商品/SKU、売主偽装を拒否 |
| 金額 | 改ざん価格無視、D1単価で再計算、確認後価格変更は全体ロールバック |
| 発送 | `REVIEW_REQUIRED`、注文・在庫確保とも増えない |
| SQL制約 | 予約重複INSERT・負の在庫UPDATEを拒否 |
| Next.js開発HTTP/画面 | 2件成功：スマホ操作から実D1受付、API入力/Origin/ボディ上限/再送/非公開情報 |
| 通常Next.jsビルド | 成功。Express接続不要、商品ページはリクエスト時取得 |
| Next.js本番起動HTTP/画面 | 2件成功。通常 `next build` 出力を `next start` で起動し、画面→Route Handler→実D1を確認 |
| vinext check | 94%互換。画像最適化部分対応のみ。チェックは実動作保証ではない |
| vinextビルド | 成功。RSC/SSR/client生成。sourcemap等の上流警告あり |
| vinext開発HTTP | `/products` と `/api/products` が200。3商品・2生産者・4SKU取得 |
| ビルド済みWorker `wrangler dev --local` | ブラウザとHTTP APIの2件成功。ローカルD1に保存 |

最初の試行で発生した問題は修正・再検証した：ローカル待受制限への実行権限付与、テストのD1保存先v3指定、Next.jsの内部URLとHostの差を考慮したOrigin照合、Next.jsのroute announcerを考慮したテストセレクタ、並列ビルドによる生成型競合。テストが成功するために在庫・DBエラーをモックしていない。

最終HTTP検証後にWrangler `--local` SELECTでE2E用D1を照会し、注文2件・明細3件・確保記録3件・確保数量5個・注文合計3,130円を確認した。氏名・連絡先は照会出力していない。

テスト用DBは通常開発DBと隔離し、毎回migration・seedから再構築する。E2Eのスクリーンショットを目視確認済み。指定外の本番、外部通知、実売・生産者の承諾は検証していない。

## 依存関係監査

開始時：34件（critical 1 / high 32 / moderate 1）。Next.js 16.2.10→16.4.0、React 19.2.4→19.2.7、同じメジャー内の互換更新と `npm audit fix` を実施。vinext追加後に判明した `satori` の `fflate` を同じ0.7系列の修正版0.7.5へ限定override。不要なデプロイ用 `@vinext/cloudflare` は削除。

最終 `npm audit --omit=dev`：0件。全依存：high 8件。根本原因は `braces <=3.0.3` の深いglobによるスタック枯渇（GHSA-vfj7-8cjw-p6xm）で、ESLintとvinextの開発・ビルド依存へ伝播する。監査時点で最新bracesは3.0.3、修正版なし。`audit --force` の提案はNext.js用ESLintの14系列へのダウングレード等であり採用しない。未信頼のglobを受け付けるAPIは実装していないが、全依存が無脆弱性とは扱わない。

## Cloudflare無料枠と構成の制約

公式資料確認時点：Workers無料枠は100,000リクエスト/日・CPU 10ms/リクエスト・128MB。D1無料枠は5,000,000行読取/日・100,000行書込/日・合計5GB、1DB最大500MB、1Worker呼び出しあたり50クエリ。今回のSKU上限は送信SQL数をこの上限内に制限する。小規模の架空fixtureのみだが、実トラフィックに対する日次枠内運用は未検証。

**本番CPU・メモリ・起動時間・無料枠適合は未検証。** ローカル所要時間を本番CPU時間と同一視しない。SSRが10msを超える可能性は残る。リモートDB作成、リモートmigration、デプロイ、DNS変更、Cloudflare課金登録は未実施。

vinext 1.2.0の互換性上の注意：

- 画像リサイズには別optimizerが必要。現行の表示経路は `unoptimized`、seedは画像なし。画像最適化サービスは追加していない。
- 生成型をNext.jsと共有するためビルド・開発は順番に行う。現行Next.js経路は維持。
- ビルド時の静的解析では `connection()` 使用の一部ページがUnknown分類。ローカルHTTPでD1取得・注文保存を確認済み。
- 開発起動ではネットワーク制限により `Request.cf` 取得が失敗してplaceholderへフォールバックした。位置情報等は使わず、HTTPは成功。開発用Local Explorer/inspectorを外部公開しない。
- 上流のsourcemap/動的import警告は残る。本番監視・詳細互換性検証は別途必要。

今回はローカルの動作に重大な互換性障害がなかったため、構成を静的フロント＋独立Worker APIへ変更していない。本番CPUを計測後、上限を満たせない場合に「一覧の静的/キャッシュ配信＋在庫照会API」や独立Worker API、成熟したOpenNextを比較する。静的化では在庫・価格の再照合が必須であり、現行の原子的注文処理は再利用できる。

## 未実装・次の優先順位

1. 実販売条件、本人了承済みの生産者・商品・写真・受取日時/場所、特商法表示・返品/取消条件・個人情報の保存期間/削除方針を確定。
2. 認証・権限付き運営管理、生産者承諾/取消/完了、在庫解放・期限切れ（今回はREQUESTED在庫確保が期限なく残る）。公開用の不正申込み対策・レート制限、安全な通知、監査ログ。
3. 梱包・温度帯・配送地域と実送料の見積、`REVIEW_REQUIRED` の運用、銀行振込案内・着金確認・発送。
4. 承認された検証用環境で本番CPU・無料枠、バックアップ/復旧、監視を確認してから公開判断。

今回の成果は実売開始可能という意味ではなく、**架空の購入申込みを実ローカルD1へ原子的に保存できる検証版**。

## 確認した一次資料

- [要件定義書 v0.9](https://docs.google.com/document/d/16T08R1-W8AwkgmgfcQBWUpl_x_Qfmj-P692ZilVamVQ/edit)：2026-10-14更新版を読み取り。最新の決定を古い仮案より優先。
- [Figma](https://www.figma.com/design/LXtePzJjeElC6NyLvS4L5o)：ページ構造と商品一覧3:2の詳細コンテキスト・スクリーンショットを確認。
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)、同梱 `node_modules/next/dist/docs/` のRoute Handlersとconnection。
- [vinext公式README](https://github.com/cloudflare/vinext)：Next.js 16対応、check/init、Cloudflare Vite pluginのbinding取得。
- [Cloudflare Next.jsガイド](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [D1 batch仕様](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[D1制限](https://developers.cloudflare.com/d1/platform/limits/)、[Workers制限](https://developers.cloudflare.com/workers/platform/limits/)
