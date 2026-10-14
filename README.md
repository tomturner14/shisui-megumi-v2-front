# 酒々井の恵 — ローカル購入申込み検証

既存のNext.js App Routerを使い、架空の野菜・米をD1から表示し、同じ生産者の複数SKUを現地受取・現金払いで申し込むアプリです。受付状態は `REQUESTED`。生産者承諾・実販売・発送・オンライン決済は行いません。

## 起動

Node.js 24で検証済み。リポジトリのルートで実行してください。Cloudflareアカウント・APIトークン・Express URLは不要です。

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run dev -- --hostname 127.0.0.1
```

[商品一覧](http://127.0.0.1:3000/products)から操作します。架空の氏名・連絡先（例：`test@example.invalid`）を使ってください。通常のNext.jsビルドも可能です。

```bash
npm run build
npm run start -- --hostname 127.0.0.1
```

vinext / Workersローカルプレビュー：

```bash
npm run dev:vinext
# または、開発サーバーを終了してから
npm run build:vinext
npm run start:vinext
```

[vinextの商品一覧](http://127.0.0.1:3001/products)。`start:vinext` はWranglerの `--local` を明示しています。外部に公開するトンネル・デプロイは実施していません。

`wrangler.jsonc` のDB IDはローカル専用の固定ダミーIDで、実在するリモートDBを指定していません。`remote: false`、`remoteBindings: false`。migration・seed・起動はリモート操作をしません。デプロイスクリプトはありません。

Wranglerの既定保存先は `.wrangler/state/v3`。通常Next.jsの `getPlatformProxy()` とvinextが同じローカルD1を参照します。CLIの `--persist-to` は **v3を付けない親ディレクトリ**、`getPlatformProxy()` の `persist.path` は **v3を含むディレクトリ**です。seedの再実行は既存注文の在庫をリセットしません。

クラウド環境でホームディレクトリへのログ書き込みが制限される場合は `XDG_CONFIG_HOME=/tmp/shisui-config WRANGLER_SEND_METRICS=false` をコマンドの前に付けてください。npmキャッシュ制限時は `npm_config_cache=/tmp/shisui-npm` を使えます。ローカル待受権限も必要です。

## 自動検証

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:d1
npm run test:e2e
npm run build
E2E_RUNTIME=next-production npm run test:e2e
npm run build:vinext
E2E_RUNTIME=vinext npm run test:e2e
```

**ビルド・typecheck・両開発サーバーは順番に実行してください。** vinext 1.2.0はNext.jsと同じ `.next/types/routes.d.ts` と `next-env.d.ts` を生成します。同時ビルドで生成型が競合するため、両方を並列起動しません。`typecheck` は先に `next typegen` でNext.js用の型を再生成します。

ブラウザテストは `/usr/bin/chromium` があれば利用します。他の環境では `npx playwright install chromium`、または `CHROMIUM_PATH` で実行ファイルを指定してください。ブラウザ・HTTP APIテストは本物のローカルD1に接続します。

- `test:d1`：一時ディレクトリにWranglerの `--local` migration・seedを実行。D1 bindingの `batch()` を検証し、終了時にテストDBのみ削除します。SQLiteだけの代替テストではありません。
- `test:e2e`：起動前に専用 `.wrangler/e2e-state` を初期化し、2テストを実行。通常開発用 `.wrangler/state` は変更しません。Next.js開発・本番起動・ビルド済みvinextで同じ試験を実行できます。
- `E2E_BASE_URL`：既存の**ローカル**サーバーを使う場合のみ指定。初期化・起動を省略するため、指定したサーバーのDBには架空のテスト注文が残ります。公開・本番URLを指定しないでください。
- 完成画面のスクリーンショット：`test-results/products-mobile.png`、`confirm-mobile.png`、`receipt-mobile.png`。Gitには含めません。

設計・実施結果・残る制約は [検証記録](docs/LOCAL_D1_VALIDATION.md) を参照してください。
