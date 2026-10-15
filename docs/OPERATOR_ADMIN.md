# 最小運営管理（検証版）

PR #2 `37b2bce` を基点とする追加機能。一般の商品・カート・申込みは従来どおり公開経路。リモートD1・Access設定・デプロイは一切実施していない。

## 認証方式と選択根拠（2026-10-15確認）

| 候補                                   | 判断                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker全体のAccess / `ctx.access`      | 公開の購入経路までログイン対象になり得る。公式にStatic Assets内部ルーターからのコンテキスト伝播制限も記載されている。現在のvinext + Assetsで利用できたとは扱わない。 |
| 別ホスト・別Worker                     | 境界を分離できるが、現段階ではルーティング・運用対象・Cookie/CORS設定を増やす。今回は採用しない。                                                                    |
| 管理パスだけのAccess + アプリ内JWT検証 | 採用。`/admin` と `/api/admin` の親・全子パスのみを保護し、購入経路を公開のまま維持できる。署名検証はAccess経由という推測に依存しない。                              |

公式資料：

- [Access / Workersとctx.access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)（10月12日更新、公式ローカルシミュレーションも存在。ただし本実装はctx.accessを使わない）
- [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)（`/admin/*` だけでは親の `/admin` を含まない点に注意）
- [JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [vinext互換性](https://github.com/cloudflare/vinext#whats-supported)：proxy、headers、Route Handlersを使用。Next.js 16.4同梱docsのproxy/headersも確認。

### サーバー設定（未設定なら503で拒否）

実環境の値は未確認。以下の名前だけを定義し、値はリポジトリに登録しない。

- `ACCESS_ISSUER`：実Team Domain `https://<team>.cloudflareaccess.com`（末尾 `/` なし）。鍵取得URLはこの値から `/cdn-cgi/access/certs` を固定導出する。任意のJWKS URLやローカル鍵設定は製品コードにない。
- `ACCESS_AUD`：実AccessアプリケーションのAUD。管理画面とAPIを同じAccessアプリに含め、同じAUD/ポリシーを使う。
- `ADMIN_SUBJECTS`：許可した実運営者の検証済み `sub` をカンマ区切り。メールヘッダー・JWT内メール・リクエスト本文は権限根拠にしない。
- `ADMIN_ORIGIN`：管理画面の正規Origin（HTTPS、末尾 `/` なし）。HTTPはloopbackだけ許容。

Nextはサーバー環境変数、WorkerはCloudflare env bindingを明示的に読む。RS256署名、iss、aud、exp、iat、nbf（存在時）、type=app、subを確認する。必須claim欠落・不正署名・許可外subject・設定不足・鍵取得失敗はすべて拒否。AccessヘッダーとCF_Authorization Cookieの両方があれば一致が必要。Cookieも署名検証する。

`src/proxy.ts` が親/子パス全体を先に拒否し、各ページ・各APIでも独立して検証する。転送された「管理者フラグ」を信頼しない。管理応答はHTML/RSC/APIともprivate/no-store、CDN no-store、no-referrer、frame禁止。商品APIの応答に管理情報を混ぜない。CSRFはサーバー設定Originの完全一致、JSON、専用ヘッダー、cross-site拒否で防止し、CORS許可を返さない。

## 画面とデータの流れ

`/admin/orders` → 署名/権限確認 → D1から20件（+次ページ判定1件）だけ取得 → 連絡先を含まない一覧。状態絞り込み、申込み未対応/承諾期限超過、UTC日時、最大1000ページ。

`/admin/orders/[id]` → 再度署名/権限確認 → D1の注文時スナップショット・購入者最小情報・監査記録を取得 → SCSS Modulesの画面に表示。

確認ボタン → 同一OriginのJSON POST `/api/admin/orders/[id]/transition` → JWT/許可/CSRF/入力確認 → 検証済みsubとサーバー時刻で既存 `transitionOrder()` → イベント挿入トリガーが状態・全SKU解放・在庫更新を原子的に確定 → 現在状態を返す → 詳細再取得。ブラウザは担当者・時刻を指定できない。EXPIRED/COMPLETEDのHTTP操作はない。

承諾はREQUESTEDかつ期限未到来のみ。拒否はREQUESTEDのみ。取消はREQUESTEDまたはACCEPTED、かつ入金・引渡記録が両方ない場合のみ。競合・期限条件は画面の表示状態に関わらずDBが再判定する。運営者は生産者に確認してから承諾する（生産者アカウントは今回ない）。

## migrationと監査

0001/0002は変更していない。`0003_operator_audit.sql` でnullable `order_events.actor_id` と一覧/担当者検索indexのみを追加。旧イベントのactor_idはNULLで、過去担当者を捏造しない。既存の制約・外部キー・トリガー・イベント不変性を維持する。

操作キー再送は注文・操作・実行者区分に加えて担当者IDも一致する場合のみ同じ結果を返す。別担当者が同じキーを使うと409。新しいHTTPイベントには必ずverified subを保存する。旧内部関数の互換呼び出し（HTTP非公開）ではNULLを保持し、画面に「担当者ID未記録」と明示する。内部SYSTEM期限処理はsubjectを偽装しない。氏名・連絡先・JWTは監査へ複製しない。

二重クリックは画面で抑制し、通信結果不明/5xxでは同じ操作キーで再確認する。詳細を再読み込みしてもDB状態の遷移制約が重複操作を防ぐ。操作キーは個人情報を含まないUUID。

## ローカル再現

Node24、`npm ci` 後：

```sh
npm run db:migrate
npm run db:seed
npm run lint
npm run typecheck
npm run test:unit
npm run test:auth
npm run test:d1
npm run build
E2E_RUNTIME=next-production E2E_ADMIN_AUTH=1 npm run test:e2e
E2E_RUNTIME=next-production npm run test:e2e -- tests/browser/admin.spec.ts
npm run build:vinext
E2E_RUNTIME=vinext E2E_ADMIN_AUTH=1 npm run test:e2e
E2E_RUNTIME=vinext npm run test:e2e -- tests/browser/admin.spec.ts
```

Nextとvinextは生成型を共有するため順番に実行する。クラウド環境でWranglerのユーザー設定フォルダが書込不可なら `XDG_CONFIG_HOME=/tmp/shisui-config WRANGLER_SEND_METRICS=false` を付ける。Chromium未導入なら `npx playwright install --with-deps chromium`（ローカル/CIのみ）。

通常の `npm run dev` / Worker起動では認証設定がないため管理閲覧・操作は503。公開商品は使用できる。

署名認証ブラウザテストはloopback専用の自動起動プロセスを使用し、実行ごとにRSA鍵を生成する。鍵はignore済み `.wrangler/admin-auth-fixture.json`（0600）に置く。Nextのテスト用preload、Workerの**テスト専用エントリ**で架空issuerのcert取得だけを差し替え、製品の署名・claim・権限検証と実ローカルD1をそのまま通す。テスト側コードはsrc/や通常ビルド設定から参照されない。通常Worker entry/configは変更しない。テスト用entry/configをデプロイしてはならない。テスト終了時にテスト用entry/configと秘密鍵fixtureを削除する。製品コードにはtest鍵/envバイパスがない。`E2E_ADMIN_AUTH` はPlaywright構成だけが読む。

ブラウザテストで初期化するのは専用 `.wrangler/e2e-state` のみ。開発者DBは初期化しない。外部URL指定は禁止、外部リクエスト・リダイレクトを安全用fixtureで拒否。管理テストはスマホ幅とPC幅を確認し、架空データの画面画像を `.wrangler/admin-orders-preview.png` に保存する（外部公開なし）。トークンをログ/URLへ出さない。失敗時のPlaywright traceはテスト用Cookieを含み得るためignore済みでCIアップロードしない。

## 公開前に残る作業

実Accessログイン・IdP/MFA/許可ポリシー・Team/AUD/sub・実ドメイン/Originを確認し設定する。親 `/admin`、`/admin/*`、親 `/api/admin`、`/api/admin/*` を同一Accessアプリに含め、より具体的なBypassポリシーがないことを確認する。実ブラウザのCookie/ヘッダー、HTML/RSCキャッシュ、ログアウト・失効・鍵ローテーションを再検証する。

`workers_dev=false`、`preview_urls=false` は維持。将来別のroute/custom domain/previewを有効化する場合、その全入口の管理パスもAccess対象にし、直アクセスでもアプリ検証を必須とする。Worker/アカウント全体のAccessを無条件で有効化して公開購入を閉じない。認証は別ホストURLを隠すことに依存しない。

承諾期限24hは検証仮値のまま。本番Cron未接続、商品編集・通知・生産者管理・手動在庫・決済/引渡完了は範囲外。データ保持期間・バックアップ・問い合わせ/取消運用・不正申込み対策も既存ドキュメントの公開前課題を維持する。本番CPU/無料枠適合や本番Access動作は実測していない。現状はローカル検証版であり、本番公開可能とは判断しない。

PR #2の独立レビューで指摘された、期限処理の失敗注文による後続処理の滞留（最大10件の先頭が失敗し続けるケース）とbotの在庫占有は今回解消していない。本番Cronの前に失敗隔離・継続処理・監視、公開申込みにはサーバー検証付きチャレンジ/レート制御が必要。

## 今回の実行記録

| 確認                                    | 結果                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| lint / Next型生成 + TypeScript          | 成功                                                                                                 |
| 署名・claim・権限・CSRFテスト           | 4件成功（複数の拒否条件を各テスト内で検査）                                                          |
| 既存カート/通信断復旧/実行先制限の単体  | 9件成功                                                                                              |
| 実ローカルD1（既存26 + 管理7）          | 33件成功。注文/確保/旧イベントがあるDBへ0003を適用し、旧全値・index/trigger・FK・在庫整合性を比較    |
| Next.js本番ビルド / vinextビルド        | 両方成功                                                                                             |
| Next.js本番HTTP + ブラウザ              | 22件成功（管理6 + 既存16）                                                                           |
| ビルド済みWorkerローカルHTTP + ブラウザ | 22件成功（管理6 + 既存16）                                                                           |
| 設定なしの拒否（通常entry）             | 両runtimeで各1件成功。署名fixtureを要する5件はこの実行では意図的にskipし、上の署名実行ではすべて実施 |
| `npm audit --omit=dev`                  | 0件。本番Access/CPU/実販売は未検証                                                                   |

途中で見つけた型・lintエラー、管理API不存在を期待する旧テスト、Workerテストのfetch差し替え順を修正して再実行した。vinextビルドの既知sourcemap警告と、ブラウザの通信中断時のworkerd Broken pipe/再接続メッセージは残るが、最終テストは全件成功。これはCloudflare本番の安定性・CPUを実測した結果ではない。
