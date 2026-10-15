# 注文ライフサイクル・在庫解放（ローカル検証版）

PR #1のHEAD `dbd8ff244e033dfbaeb6d8bfb01cb1c2331cb590` を基点にした追加実装。既存の0001 migrationは変更しない。実販売、管理認証、本番Cronは未実装。

## 状態と取消範囲

| 遷移 | 条件 | 確保在庫 |
| --- | --- | --- |
| REQUESTED → ACCEPTED | 期限設定済み・現在時刻が期限より前・全SKUのHELDが一致 | 維持 |
| REQUESTED → REJECTED | 内部の運営操作・全SKUのHELDが一致 | 全件解放 |
| REQUESTED → CANCELLED | 未引渡・現金未受領・全SKUのHELDが一致 | 全件解放 |
| REQUESTED → EXPIRED | 期限設定済み・現在時刻が期限以上 | 全件解放 |
| ACCEPTED → CANCELLED | 未引渡・現金未受領・全SKUのHELDが一致 | 全件解放 |

上記以外の新しい遷移、終了状態からの復活、ACCEPTEDの承諾期限による失効、今回未実装のCOMPLETEDへの遷移は拒否する。期限ちょうどは承諾不可・失効可能。期限後でも定期処理を待たずに承諾を拒否する。拒否・取消は処理前のREQUESTEDにも可能で、期限切れと競合しても1回だけ終了する。

`handover_recorded_at_ms` / `cash_received_at_ms` は将来の引渡・入金記録のための取消ガード。どちらかが記録されたACCEPTEDは、通常取消では解放しない。返金/受渡済みの訂正が必要になるため、別の認証・監査付き業務処理を設計する。今回、実際の入金や引渡を記録するAPIは作らず、テストでは架空の記録を内部SQLで設定してガードを確認する。記録をNULLに戻して取消ガードを回避する更新も拒否する。

## 期限の意味

- 新規申込みはUTCのepochミリ秒で `requested_at_ms` と `expires_at_ms` を保存する。実時刻はサーバーのDate.now()。統合テストでは `nowMs` を注入可能。
- 既定24時間は**ローカル検証の仮値**。`ORDER_REQUEST_TTL_MINUTES` で新規申込みの期限を調整できる（1〜10080分）。例：通常Next.jsでは `ORDER_REQUEST_TTL_MINUTES=120 npm run dev -- --hostname 127.0.0.1`。Workerでは将来、同名のサーバー側bindingへ設定する。今回、リモート設定は行わない。
- 注文に保存した期限は後から環境変数を変えても書き換えない。過去の約束を無監査で延長・短縮しない。
- 実運用期限・承諾通知・期限超過時の案内が未確定なので、この仮値のまま公開可能とは判断しない。

## 0002 migrationと旧データ保全

`migrations/0002_order_lifecycle.sql` はordersのCHECK制約にREJECTED/EXPIREDを追加するため、ordersを新テーブルへコピーして再構築する。D1ではforeign_keysを無効化できないため、`PRAGMA defer_foreign_keys=ON` で同一migrationトランザクション内だけ外部キー検証を遅延し、末尾でOFFへ戻す。子テーブルは作り直さず、ON DELETE CASCADEも追加しない。

再構築時にordersを参照する既存トリガーを一旦外し、価格・売主・販売状態検証を維持して再作成する。他の元トリガーも保持する。元のUNIQUE、外部キー、整数価格/在庫のCHECK、INDEXは保持・再作成し、期限検索・SKU別HELD合計・監査検索用の索引を追加する。

**旧注文のrequested_at_ms / expires_at_msはNULLのまま保持。** 古いcreated_atから24時間を機械的に足して大量失効させない。旧REQUESTEDは自動失効の対象外、期限未設定の承諾はDEADLINE_REQUIREDで拒否する。旧注文は本人確認・業務確認後の明示的な拒否/取消で解放できる。承諾して販売を続けたい場合は旧申込みを適切に終了し、最新条件の新申込みへ案内する等、認証付きの移行運用を決める必要がある。旧ACCEPTED/COMPLETED等もそのまま保持し、今回、過去の監査イベントを捏造しない。

旧データの在庫reservedとHELD合計、明細と確保数量、注文状態と確保状態が矛盾していればmigrationをエラーにし、元データと元スキーマを保つ。勝手な再計算・削除・状態修正はしない。異常データは認証された運営者が別途確認・復旧する。

## 原子性・冪等性

`src/lib/server/order-lifecycle.ts` の `transitionOrder()` は、信頼できる内部処理向けの関数。`actorCategory` はOPERATOR/SYSTEMという監査分類であり、認証を代替するものではない。HTTP Route Handlerからは呼び出していない。固定パスワード、簡易トークン、開発フラグの管理APIは作らない。

1. 操作キーを確認し、同一キー・同一注文/操作/実行者区分なら保存済みの操作を再実行しない。別の操作ならOPERATION_CONFLICT。
2. `order_events` をINSERT。DBトリガーが現在状態、許可遷移、期限、入金/引渡、全SKUのHELDを検証する。
3. 検証済みイベントからだけordersの状態と変更時刻を更新。状態UPDATEの変更0件がエラーだとは仮定せず、更新後の状態とイベントIDも検査する。
4. 終了状態では全SKUの `HELD → RELEASED` を更新。各行のAFTERトリガーがreservedを正確に減らす。既にRELEASEDの行は再減算しない。
5. 状態変更・全確保解放・監査記録はD1 batchとSQLトリガーの同一トランザクション。途中で1SKUでもSQLエラーならすべてロールバックする。

`inventory.reserved = SUM(HELD.quantity)`、`0 <= reserved <= on_hand` をDBで検査し、監査なしの状態変更、単独の不正な確保解除、スナップショット/監査の改変を拒否する。監査は操作種別・実行者区分・UTC時刻・変更前後状態・操作キー・注文IDのみ。氏名や連絡先を複製しない。

## 注文受付の再送と画面

購入申込みの冪等キー/本文ハッシュは従来どおり。期限値をハッシュへ足して旧キーを壊さない。同じキーなら新規注文/確保を作らず、**DBに保存された現在状態**を返す。ACCEPTED/EXPIRED/REJECTED/CANCELLED/旧COMPLETEDをREQUESTEDとして返さない。

ReactのReceipt型・検査・結果表示を拡張。終了状態では「この申込みは終了」と案内し、同じキーで復活させない。購入し直す場合は商品一覧で最新価格/在庫を再確認して、新しい申込み・キーを作る。通信結果不明時のスナップショット固定・sessionStorageの再送情報・同一キー復旧は維持。注文GETや未認証の状態照会APIは追加していない。

## 期限切れ処理とローカル実行

`expireRequestedOrders(db,{nowMs,limit})` は期限設定済みREQUESTEDを期限順に最大10件取得し、各注文を独立の原子的処理でEXPIREDにする。再実行は安全。既に承諾/終了した競合相手はスキップし、その他のエラーは注文IDとエラーコードだけを集計する。1注文の失敗で同じ回の他注文をロールバックしない。失敗分はREQUESTEDのまま残して再実行できる。

1回のSQL数を無料枠50クエリに収めるため上限10件。正常系は最大31文、各注文の失敗後照会を含めても最大41文（トリガー内部処理も行読み書き量/CPUには寄与）。大量滞留・繰り返し失敗・上限到達は監視し、継続処理と失敗隔離を公開前に設計する。10件すべてが恒久失敗する等の場合、後続は運営の復旧まで待つ可能性がある。

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run orders:expire:local
```

migration/seedはWrangler `--local`。runnerはgetPlatformProxyのローカルD1のみ、remoteBindings=false、固定の `.wrangler/state/v3` を使う。出力はexpired/skipped/failed件数のみ。旧期限NULLの注文はこのコマンドで失効しない。開発DBを消す・初期化するコマンドではない。

### 将来のCron接続（未実施）

[Cloudflare Scheduled Handler公式仕様](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)を確認した。将来はvinextのfetchハンドラーと共存するWorkerエントリーに `scheduled(controller,env,ctx)` を設け、サーバー側D1 bindingを `expireRequestedOrders` に渡してawaitする。例示：

```ts
async scheduled(controller, env) {
  const result = await expireRequestedOrders(env.DB, { nowMs: Date.now() });
  if (result.failed.length) throw new Error('Order expiry failures');
}
```

controller.scheduledTimeはUTC epochミリ秒の予定時刻。上の案では遅延起動時も実際の現在時刻で期限を判定する。Cron式は別途運用頻度・処理上限・CPUを決定して設定する。今回はworkerエントリー/remote Cron設定を変更せず、ローカル関数とrunnerだけを検証。本番定期実行が動いたという検証結果ではない。

## 検証と再現

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:d1
npm run build
E2E_RUNTIME=next-production npm run test:e2e
npm run build:vinext
E2E_RUNTIME=vinext npm run test:e2e
```

Next.jsとvinextは型生成先を共有するため順番に実行する。クラウド環境のログ/キャッシュ権限制限時の変数はREADMEを参照。

- 単体9件：従来のカート・確認固定・再送情報・E2E実行先制限。
- 実D1 26件：従来9件＋今回17件。Wranglerローカルmigration/seedとworkerd D1を使用し、SQLite代替・DBモックなし。
- 旧DB移行：0001だけのDBにREQUESTED/ACCEPTED/CANCELLED/COMPLETEDと8明細・8確保を登録して0002を追加適用。既存の全注文カラム・明細・在庫・確保を比較。期限NULL、外部キー検査、元の索引/トリガー、旧キー再送も確認。
- 不整合な旧DBのmigration失敗でも元在庫/元スキーマ/外部キーが残ること、確保のあるDBでseed再実行がデータを変えないことも検証。
- 解放/二重実行/承諾保持、期限直前・期限ちょうど・期限後、承諾/失効競合、操作キー衝突、取消ガード、途中SQLエラーの全体ロールバック、複数件/一部失敗/再実行を検証。
- ブラウザ/HTTPは従来11件＋今回5件。実D1へのコミット後に応答だけを失わせ、内部SQLで状態変更して再送時の現在状態を確認。EXPIRED後の新規購入は最新価格/新キーで成立。未認証HTTPの承諾・取消・一括失効・管理パスは404/405で既存注文は変わらない。

最終ローカル実行ではlint・型チェック・単体9件・実D1 26件・通常Next.js/vinextビルドが成功。Next.js開発・本番起動・ビルド済みWorkerで各E2E 16件成功。開発用ローカルDBにも追加migrationを適用し、runnerは `{expired:0,skipped:0,failed:0}` で終了（旧期限NULLを保持）。GitHub Actionsの最終結果はPRに報告する。

Workerのタブ切断・通信断試験では上流workerdのBroken pipeログが残ったが、全試験は成功。本番の障害率・CPUを検証したことにはしない。

## 今回未実装・公開前の課題

- 管理者認証/認可と認証付き状態変更・監査上の実行者ID、実際の生産者承諾/通知、取消/返金の運用。OPERATOR分類だけでHTTP操作を許可してはいけない。
- 実運用の期限決定、旧期限NULL注文の運営確認、監視/失敗隔離/大量滞留対応、本番Cron接続と無料枠/CPU計測。
- 不正申込み対策・レート制限・本人確認付き復旧、個人情報保管方針、販売条件/法定表示。
- COMPLETEDは将来、入金/引渡の証跡を確認後に `HELD → CONSUMED` と on_hand/reservedの同時減算、注文完了、監査を原子的に行う。二重消費、途中障害、取消/完了競合を実D1で検証してから追加する。今回、架空の支払・引渡・完了は自動生成していない。

一次資料：[D1外部キー](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Scheduled Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)。要件書v0.9の38〜41章とPR #1レビューも読み取り、旧Next.jsバージョン等の資料記述より現在のコードを技術的な事実として優先した。
