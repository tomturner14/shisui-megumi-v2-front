# ローカルD1のCI安定化（2026-10-15）

対象：[独立監査コメント](https://github.com/tomturner14/shisui-megumi-v2-front/pull/3#issuecomment-6194509020)、PR #3 `codex/operator-admin`。main、PR #1/#2、実環境のDB/認証/公開設定は変更しない。

## 原因と再現

旧HEAD `41e5465d6b279814306bbfb29e493dad5358b8f1` の[PR実行38747021723](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38747021723)は成功したが、[push実行38747013557](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38747013557)のNext E2Eは24成功/1失敗。注文POSTが201ではなく503になり、workerdは `database is locked: SQLITE_BUSY` を記録した。後続Worker検証はskipされた。PRだけを返すworkflow取得結果では、このpush失敗を見落とす。

アプリの `getPlatformProxy()` は長寿命なのに対し、旧 `withD1()` は呼出しごとに別workerdを起動・同じ永続化SQLiteを開き・disposeしていた。アプリのSQLと、別所有者のDB初期化/読み取り/終了が重なり得る。異なるGitHub runner同士の競合ではない。

独立した一時DBに対し、所有者が連続UPDATEする間に別proxyを40回作成・SELECT・disposeする最小実験で、**SELECTの1回がSQLITE_BUSYで失敗**した（UPDATE 2,884回は保存済み）。単に2所有者のUPDATEを同時に出すだけの最初の実験1,200回では再現しなかった。元のCI障害の各SQLまで特定できたわけではないが、ブラウザや業務ロジックを使わず旧接続構成だけで同種のロックを再現した。

```sh
# 既存の検証環境のみ。実DBではなくmkdtempの専用一時DBを使いfinallyでdispose/削除。
WRANGLER_SEND_METRICS=false node scripts/reproduce-local-d1-contention.mjs --multiple-owners
# 修正後と同じ単一所有者の対照（失敗件数を隠さず表示）
WRANGLER_SEND_METRICS=false node scripts/reproduce-local-d1-contention.mjs
```

発生はタイミング依存で、旧構成でも毎回失敗する保証はない。診断コマンドは件数を報告するもので、失敗0を旧構成の安全性の証明にしない。

## 修正

- NextローカルadapterはNodeプロセスのglobal singletonを使い、server bundleや開発reloadをまたぐ追加proxyを避ける。通常のD1 SQL・制約・batch・トリガー・冪等処理は変更しない。ローカル開発でも同じ永続化先へ複数アプリを同時起動しない。
- ブラウザの `withD1()` はSQLiteを直接開かず、**アプリが所有する同じD1バインディング**へSQLを送る。Nextは明示的なテストpreloadでloopback専用3002ポートを開き、Workerは生成したtest-only entryから `env.DB` を使う。`batch()` はそのままD1の1回のbatchへ転送する。SQL再試行や失敗許容は追加しない。
- テスト用dispatcherは通常entryに存在しない。Node preload/生成Worker entryはテストコマンドだけで選択する。Workerの通常config/entryは書き換えず、生成ファイルはignore対象。使い捨てランダム鍵（0600、ログ/URLへ出さない）、literal loopback、POST限定、Origin拒否、no-storeを使い、不正要求を拒否する。公開・デプロイ用途に使わない。
- 終了時はfixture鍵/生成entryを削除し、Playwrightが所有するアプリ/Workerプロセスを終了する。helperごとのworkerd作成・disposeが不要になる。通常entry検証は `E2E_NORMAL_ENTRY=1` によりpreloadと生成entryの両方を使わない。
- HTTPの同一申込み12並列再送と、SQL 80更新/80読取りを同時実行し、全HTTP成功・同一注文ID・注文1件・カウンター80・在庫制約を検査する。不正なSQL dispatcherアクセス拒否と、通常entryの404も検査する。既存の不足在庫rollback・状態遷移競合・監査の検査は維持する。

## CIの変更

- branch filterなしの全 `pull_request`。activityは `opened`, `synchronize`, `reopened`, `edited`, `ready_for_review` を明示。`edited` によりbase変更後も再検証する（本文変更でも起動する）。
- `push` は `main` のみ。feature pushとPRの二重実行を削減する。main pushは将来このworkflowがmainへ統合されてから有効。今回はmainにpush/mergeしていないので実イベントは未検証。
- `checks`：lint、画像hash、型、認証、単体、実D1を2回。
- `browser`：Next/Workerを独立runnerのmatrix、fail-fastなし。それぞれビルド、毎回DBをresetした署名E2Eを2回、fixtureなし通常entryで設定不足拒否/SQL経路404を検証。Nextの失敗でWorkerをskipしない。runnerごとのSQLite/生成型を共有しない。
- 最終job `verify` は `always()` と `needs` で、全依存jobがsuccessの時だけ成功。将来required checkに設定する際はGitHubに表示された正確な `verify` チェック名を所有者が選ぶ。`contents:read` のみ、deploy/Cloudflare認証/外部DB/秘密情報は使わない。retryは追加しない。

公式資料：[PR activity types](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)、[branch filters / jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[D1ローカル開発](https://developers.cloudflare.com/d1/best-practices/local-development/)。Nextのインストール版の `serverExternalPackages` の公式同梱ドキュメントも確認した。

## 実行記録

最新コミット・GitHub Actionsの**全イベント/全job**の結論・URLは、PR #3の監査対応コメントに記録する。旧HEADの赤を新しい成功で消したとは扱わない。

ローカルの初回署名Next E2Eは27件成功。途中の再実行では、担当が前のPlaywright終了前に別のPlaywrightを起動してしまい、ポート使用中とtest-resultsファイル削除（ENOENT）を起こした。SQLITE_BUSYではなく実行手順の誤り。以後のPlaywrightは終了を確認して直列実行した。skipや未実行を成功件数へ加えない。

最終ローカル結果：lint/型・単体9件・認証4件・画像19枚hash・Next/vinextビルドは成功。実ローカルD1 33件を2回、署名E2EはNext/Worker各27件を2回連続で成功（通常entry専用の1件は各署名実行ではskip）。fixtureなしの通常entryは両runtimeで各2件成功（署名専用5件はskip）。通常entry専用の1件はこの実行で検証済み。SQLITE_BUSYは修正後のこれらの実行では未検出。本番D1/Access/CPUの検証ではない。

## 統合前の未確認事項

[統合手順](./PR_STACK_READINESS.md)を参照。mainはprotected=false/ruleset 0で自動の必須CIゲートがない（今回読取り再確認、変更なし）。所有者によるPR必須・verify必須・force push禁止を推奨し、merge commitと矛盾するlinear history必須は選ばない。

**Cloudflare Workers Builds等の外部Git連携はGitHubのworkflowから否定できない。所有者が外部管理画面でmain更新時の自動公開を確認し、意図しない公開が起きない状態にするまで統合しない。** 本タスクは実環境への接続・設定変更を行わない。[公式Git連携資料](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)。

今回のPRはfeature branchをbaseとする手動の依存PR構成。ネイティブStacked PRの一括merge可能性を根拠なく前提にせず、#1→#2→#3のmerge commitと各段階のbase/差分/最新CI確認を維持する。本番Access、Cron、bot対策、完了処理、実売条件等の従来の公開ゲートも残る。
