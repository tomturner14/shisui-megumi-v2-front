# PR #1〜#3：画面確認と統合準備

2026-10-15（JST）。[依頼コメント](https://github.com/tomturner14/shisui-megumi-v2-front/pull/3#issuecomment-6193295597)への対応。**全3件のDraft・base・既存ブランチを維持し、マージ・Ready for review化・本番公開は行っていない。**

## 2026-10-15 追加監査による訂正

[最終マージ前の独立監査](https://github.com/tomturner14/shisui-megumi-v2-front/pull/3#issuecomment-6194509020)で、`41e5465` の[PR実行38747021723](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38747021723)は成功した一方、[push実行38747013557](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38747013557)は `SQLITE_BUSY` で失敗していたと確認した。以前のPR実行だけを見た成功報告は全チェックの確認として不十分だった。以下の画面/機能評価は過去の実測記録であり、この失敗を打ち消さない。

修正の原因・再現手順・反復テストと最新CIは [CI安定化記録](./CI_STABILITY.md) とPR #3のSHA付き対応コメントを参照。**最新HEADの全イベント/全jobの成功確認、外部自動デプロイの停止確認、人間の画面承認・最終レビューが揃うまで統合は保留する。** GitHub上で手動管理している依存PRであり、GitHubネイティブのStacked PR一括マージ機能を確認したものではない。

## 判断（追加監査前の評価）

現時点のコードは、**非公開のローカル検証版として順次統合の判断に進める**。競合なしのローカル模擬統合と機能検証を実施し、[19枚の実画面](./visual-review/README.md)を共有した。ただし、実販売・本番公開の準備完了ではない。人間の画面承認と各段階の最新CI確認を経て、ユーザーが別途承認した場合だけ、下記の順次統合を行う。

## 1. PR依存関係と基点

| PR                                                                 | head → base                                   | 作業開始時HEAD                           | 固有コミット               |
| ------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------- | -------------------------- |
| [#1](https://github.com/tomturner14/shisui-megumi-v2-front/pull/1) | codex/local-d1-pickup → main                  | dbd8ff244e033dfbaeb6d8bfb01cb1c2331cb590 | 4                          |
| [#2](https://github.com/tomturner14/shisui-megumi-v2-front/pull/2) | codex/order-lifecycle → codex/local-d1-pickup | 37b2bcef3eefe0510ea518328c1f71bd2b26c178 | 2                          |
| [#3](https://github.com/tomturner14/shisui-megumi-v2-front/pull/3) | codex/operator-admin → codex/order-lifecycle  | 3ffc71f21d9b56f7124515c7388494c45817f114 | 2 + 今回の画像/テスト/資料 |

mainは `1b25def8e19fad8962a95804e44437570ad29aed`。GitHub APIと `git ls-remote` で照合し、作業ツリーがクリーンだったことを確認。PR #3の既存ブランチで作業し、PR #4や追加worktreeは作成していない。開始時のmain→#1→#2→#3が祖先関係で連続し、3段のコミット範囲を足すとmainから#3までと一致する。今回の差分は画面確認・証拠・ローカル検証スクリプトで、商品/注文/認証の製品処理を変更していない。

`node scripts/check-pr-stack.mjs 1b25def dbd8ff2 37b2bce HEAD` で再現できる。実リポジトリは読取りだけ、一時的なbare cloneに `merge-tree` と `commit-tree` でmerge commitを3回作り、各treeが対応PRのtreeと同一であることをassertする。実ブランチ、remote、作業ツリーは更新しない。競合があれば非ゼロ終了。これは現在の祖先関係での結果で、後日mainに別変更が入った状態の無競合を保証しない。

## 2. 今回の検証と過去の証拠

**今回の結果は実装担当が同じクラウド環境で再実行したもの。第三者の独立環境での再試験や本番Accessの試験ではない。**

| 対象                                                     | 今回の再実行                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| lint / Next型生成 + TypeScript                           | 成功                                                                                                  |
| 既存カート・確認スナップショット・通信断復旧・送信先制限 | 単体9件成功                                                                                           |
| RSA署名・claim・認可・CSRF・設定不足                     | 認証テスト4件成功（複数条件を内包）                                                                   |
| 実ローカルD1                                             | 33件成功。モックSQLiteではなくWrangler migrations/getPlatformProxyのD1                                |
| Next.js通常ビルド / vinext Workerビルド                  | 成功                                                                                                  |
| Next.js本番HTTP + Chromium E2E                           | 25件成功（既存22 + 画面確認3）                                                                        |
| ビルド済みWorker HTTP + Chromium E2E                     | 25件成功（既存22 + 画面確認3）。最新PR Checksと対応コメントでも照合                                   |
| 認証設定なしの通常entry                                  | Next/Workerそれぞれの専用実行で拒否を確認。署名fixture専用5件はこの実行ではskip、上記の署名実行で実施 |
| ローカルmerge commit模擬統合                             | #1→#2→#3：競合なし、最終treeが#3と一致                                                                |

初回の追加画面テストは2件失敗した。更新中に消えるボタンへのlocator待機と、Nextのroute announcerまで一致するalert指定が原因。DOM寸法を1回のevaluateで取得し、エラー文で対象alertを限定して修正・再実行した。製品のP0問題として修正したものではない。既知のvinext sourcemap警告、通信中断時のworkerd Broken pipe/再接続メッセージは残る。

過去のCIは [#1 / 38669729615](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38669729615)、[#2 / 38674708218](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38674708218)、[今回以前の#3 / 38678300692](https://github.com/tomturner14/shisui-megumi-v2-front/actions/runs/38678300692) が成功。今回は別途再実行した。**今回の最新コミットの結果は [PR #3 Checks](https://github.com/tomturner14/shisui-megumi-v2-front/pull/3/checks) と対応完了コメントのSHA付きrunリンクを正とする。古い緑を最新HEADの成功とは扱わない。** 新しい画面テストも既存workflowの `npm run test:e2e` に自動で含まれる。

### migration・取得経路・認証の再確認

- 0001：商品・SKU・在庫・注文スナップショット・原子的確保。0002：状態/期限・全SKU解放・監査。0003：nullable担当者IDとindex。0001/0002/0003は今回変更していない。
- 33件の実D1検証には、注文/明細/確保があるDBへの0002、旧イベントがあるDBへの0003、全値・FK・index/trigger・reserved整合性、途中エラーの全体rollback、同時処理・冪等再送を含む。
- 現行の一覧/詳細/カート/購入APIは `catalog` / `orders` → DBへ接続。Express/Shopifyを呼ばず、`EXPRESS_API_BASE_URL` 未設定で両ビルド/HTTPが成功。**旧 `product-api.ts`・`express-api.ts`・`env.ts` 自体は未参照のまま残っており、「ファイルを全削除した」とは扱わない。** 無関係な削除は今回しない。
- 管理画面/APIはproxyと各ページ/handlerで検証。通常起動で設定がなければ503拒否、署名設定済みでも未認証401、許可外subject403。一般の買い物は公開のまま。実Accessの入口/ログインは未検証。

## 3. 実物のUI評価とFigmaとの差

参照：[要件v0.9](https://docs.google.com/document/d/16T08R1-W8AwkgmgfcQBWUpl_x_Qfmj-P692ZilVamVQ/edit)（38〜41章を確認）、[Figma](https://www.figma.com/design/LXtePzJjeElC6NyLvS4L5o)。今回はFigmaへアクセスでき、Page 1の `3:2` 商品一覧、`3:30` 詳細、`3:49` カート、`4:44` 最終確認、`4:64` 受付、`4:79` 運営をget_design_contextの実レンダーで比較した。Figma側は変更せず、その画像も公開成果物にはコピーしていない。

### 機能・取引条件の評価

P0（申込み不能、価格/状態誤認、認証漏れ、情報露出）は**今回検証した範囲で未検出**。価格はにんじん190円×2＋米1200円×1＝1580円が見積→最終確認→受付→D1で一致。売主Aのみ、2 SKU/3点、住所不要、現地受取・現金払い、受付REQUESTEDを確認。管理では承諾後ACCEPTEDの履歴と保持、取消/拒否の全SKU解放を確認。Chromiumの390pxと指定PC画面1280pxに横スクロールなし。可視buttonは高さ44px以上。全ブラウザ/実機/支援技術での保証ではない。

Figmaの発送・振込・送料見積、および `/checkout*` 独立画面に対し、今回の実装は `/cart` 内で現地受取だけを進める。これは今回の確定スコープによる差で、架空送料の注文を追加して埋めない。受付の「まだ購入確定ではありません」は一致し、運営は認証後の詳細にだけ連絡先を表示する。Figmaにある振込待ち・発送待ちの管理機能は未実装。商品名/価格例の違いはfixtureの違いで、同じ見積の価格不一致ではない。

### UX（P1：次のUI改善候補。今回は記録のみ）

| 問題                                                                                      | 実画像                                                                                                  | 判断                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| カートに説明/同意/入力が集まり、390pxでは最終確認へ進むまで約2画面以上スクロールする      | [05](./visual-review/05-cart-mobile.webp)                                                               | 情報の整理とステップ案内を検討。住所を要求する発送画面へ戻さない                    |
| 管理一覧の英語status・長いUUID・UTC日時が大きく、件数が増えると縦長。管理詳細の操作も下方 | [08](./visual-review/08-admin-list-mobile.webp)・[11](./visual-review/11-admin-detail-mobile.webp)      | 日本語状態ラベル/日時補助・密度・見出し導線を検討。ID/監査は保持                    |
| ローカル未認証はJSON拒否表示でログイン導線がない                                          | [16](./visual-review/16-admin-denied-mobile.webp)                                                       | 拒否自体は正常。実Accessログイン/失効後導線を検証してから改善                       |
| 見積ローディングは無効化で分かるが、エラー文がフォーム上方にあり見落とす可能性            | [18](./visual-review/18-quote-loading-mobile.webp)・[19](./visual-review/19-quote-error-mobile.webp)    | フォーカス/スクロール/ライブ通知を検討。再試行は可能                                |
| トップと空カートの主導線が小さいテキストリンク                                            | [01](./visual-review/01-home-mobile.webp)・[17](./visual-review/17-cart-empty-mobile.webp)              | タップ範囲と主ボタンの統一を検討                                                    |
| 管理操作の通信不明後、再読み込み/タブ終了でメモリ内の操作キーが消える                     | [12](./visual-review/12-admin-confirm-mobile.webp)・[13](./visual-review/13-admin-accepted-mobile.webp) | 同一画面の再送は既存E2Eで安全。再取得で結果を識別する運用UXは公開前ゲートとして維持 |

### 見た目（P2：大きな改修は未実施）

- 緑 `#256a4d`、生成り `#faf9f5`、90px写真プレースホルダー、白い角丸商品行はFigmaの方向性を維持。一方、ヘッダー〜見出しの余白・文字サイズ/行間・本文量が増え、ワイヤーより縦長（[02](./visual-review/02-products-mobile.webp)）。
- 詳細の写真領域がFigmaの色付き枠からテキストの「写真準備中」へ、数量±からnumber input/SKU selectへ変わっている（[04](./visual-review/04-product-mobile.webp)）。実商品写真は未準備。
- 最終確認の主ボタンがFigmaの横幅いっぱいより狭く、修正導線と上下に並ぶ（[06](./visual-review/06-confirm-mobile.webp)）。操作可能・金額一致は確認済み。
- PCは商品一覧が2列、管理詳細が2カラム、管理一覧は縦のカード。FigmaにはPC/管理詳細の対応フレームがなく、忠実再現とは判定しない（[03](./visual-review/03-products-desktop.webp)・[09](./visual-review/09-admin-list-desktop.webp)・[10](./visual-review/10-admin-detail-desktop.webp)）。

## 4. 将来の安全な統合手順（今回は実行しない）

| 方法                                 | このstackでの判断                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| merge commitを#1→#2→#3で順次取り込む | 推奨。祖先SHAを保ち、後続のbaseをmainへ変更した時に前段差分を除外しやすい                                                                              |
| squash merge                         | 元のコミットがmainの祖先にならず、後続PRに前段差分が再表示されるリスク。単にbaseだけを変えない。採用するなら明示的な再構成・差分照合・再レビューが必要 |
| rebase and merge                     | GitHubでSHAが変わるため、このstackでは後続の再構成が必要になり得る。今回の最小リスク案にはしない                                                       |

GitHub API上はmerge commit/squash/rebaseが許可されている。追加監査時点のmainは `protected=false`、rulesetは0件、required checksは未設定。これらの設定は変更していない。所有者が別作業で、PR必須、`Local verification / verify` 相当の実際のチェック名を確認したrequired check、force push禁止、適切なレビュー要件を設定することを推奨する。今回のmerge commit方式と両立しないlinear history必須は推奨しない。自動ブランチ削除/最新レビュー条件は最終実行時に再確認する。

承認後の操作者向け手順：

1. **統合前の停止条件：所有者がCloudflare管理画面でWorkers BuildsのGit連携、production branch、main更新時の自動ビルド/デプロイを確認し、意図しない公開が起きない状態と証拠を用意する。** GitHub workflowにdeployがないこと、`workers_dev=false` / `preview_urls=false` だけでは外部Git連携を否定できない。このタスクではCloudflareへ接続・設定変更していない。
2. 人間が[画像一覧](./visual-review/README.md)とP1/P2、ローカル検証版という範囲を確認。全PRのHEAD・base・最新CI・レビューとmainの更新有無を再取得する。変更があれば模擬統合をやり直す。
3. 自動ブランチ削除/保護ルールを確認し、後続PRがbase参照しているブランチを削除しない手順を合意する。必要な設定変更は承認された操作者が別途実施。今は切替も削除もしていない。
4. 明示承認された#1だけをReadyにして最終レビューし、**merge commit**でmainへ取り込む。`codex/local-d1-pickup` は保持。
5. #2のbaseを `codex/local-d1-pickup` → `main` に変更する。#1の差分が含まれず、0002/ライフサイクル等の固有差分だけかFiles changedを再確認。レビューのoutdated化と新しいmerge対象のCIも再確認する。必要ならmainを専用branchへ通常mergeして再テストし、force pushしない。
6. 承認後に#2をmerge commitでmainへ。`codex/order-lifecycle` は#3のbaseなので保持。
7. #3のbaseを `codex/order-lifecycle` → `main` に変更。#1/#2の差分が重複しないこと、0003/管理認証/UI/今回の証拠だけであることを照合し、最新CI・画像・レビューを確認してから、別途承認されたmerge commitを実行。
8. 全3件の統合後にmainを再取得し、全機能・migration・認証設定なし拒否・CIを再確認。ブランチ削除はbase参照がなくなったことを確認してから別途判断する。コード統合とCloudflare公開を連動させない。

GitHub仕様の参照：[merge方式](https://docs.github.com/en/pull-requests/reference/pull-request-merges)、[base変更とレビューへの影響](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-base-branch-of-a-pull-request)、[自動削除設定](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)。GitHubが自動でbaseを調整するという想定だけに頼らず、各段階を目視確認する。

## 5. 統合しても残る本番公開ゲート

- 実Cloudflare Access・IdP/MFA・Team/AUD/許可sub/正規Origin。admin親子、API、custom domain、workers.dev、preview/version URL、Cookie/ヘッダー、ログアウト・権限剥奪・鍵ローテーション・HTML/RSC/APIのキャッシュ検証。
- 承諾期限の業務合意、旧期限NULL注文の扱い、Cron接続、失敗注文の隔離/継続処理・監視。先頭10件の失敗による後続滞留は未解消。
- botの申込み/在庫占有に対するサーバー検証付きチャレンジ・レート制御・本人確認付き復旧。
- COMPLETED・現金受領/引渡確認・HELD→CONSUMED。発送の梱包/送料実データ、振込/通知等は未実装。
- 実販売の受取/返品/取消条件、売主の了承、特商法等の表示、個人情報の保持/共有/削除方針・バックアップ復旧。
- Workers CPU/無料枠の実測・D1容量/読書込の運用見積。ローカル成功から適合済みとは判断しない。

**追加監査後は上記の統合保留条件が優先。次に必要な最小判断：画像とP1/P2を確認した上で、「本番公開せず、検証版コードを#1からmerge commitで順次統合する最終レビューへ進めるか」を承認すること。今すぐのmergeや実環境設定を求めるものではない。**
