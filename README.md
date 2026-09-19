# Jev Keiba Calling

[Live demo](https://jev-keiba-calling.vercel.app)（キー未設定のためデモモード）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20key.%20Both%20the%20commentary%20model%20and%20Jev%20run%20through%20AI%20Gateway.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-key)

YouTube競馬映像を音声付きで再生し、同じ映像フレームと同じ固定LLMを使って次の2経路を比較する実験環境です。音声は利用者のブラウザで再生するだけで、AI認識には使用しません。

- 共通の視覚状態 → 固定LLMによる実況（Jevなし）
- 同じ視覚状態 → Jevの構造化判断 → 同じ固定LLMによる実況（Jevあり）

ブラウザ内では任意でCOCO-SSDによる馬・人物検出とMoveNetによる姿勢推定を約350ms間隔で連続実行できます。これは課金APIを使いませんが、初回のモデル初期化が端末によって十数秒かかり、リアルタイム取得を遅らせるため初期設定はOFFです。実況用フレームの送信頻度は「節約」「標準」「1秒固定」から選択でき、節約・標準では汎用的な画面の動きだけを使って1〜4秒の範囲で調整します。特定の動画・馬・時刻・既知の展開への最適化は行いません。最大フレーム数も実行前に指定でき、途中停止できます。

固定LLMの最初の1回で視覚状態とJevなし実況を同時に生成し、重複したAPI呼び出しを削減します。Jevが「変化待ち」と判断したフレームではJevあり実況の生成LLMを呼ばないため、比較の意味を保ちながらクレジット消費を抑えます。実況文は固定高さのライブ窓へ時系列に追記し、処理中の動画時刻も表示します。各結果には動画開始からの経過時間、視覚抽出時間、各経路の処理時間、画面に結果が出るまでの遅延を表示します。結果JSONには画像自体を含めません。

画面共有では音声を要求せず、サーバーへ送信しません。YouTubeプレイヤー自体の音は利用者へ通常再生します。YouTubeから動画や音声をダウンロードする実装もありません。ユーザーが共有を許可したブラウザタブの表示領域から、埋め込みプレイヤー部分の静止画だけを切り出します。

JRA公式動画などの概要欄は任意で貼り付けられます。着順付きの一覧でも着順を捨て、馬番・馬名・騎手だけの名簿へ変換します。画像モデルには名簿を見せず馬番だけを読ませ、サーバー側で一致した馬番を名前へ機械的に変換するため、名簿候補から見えない名前を推測しにくい構成です。

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` に実際のキーを設定します。このファイルはGitに入りません。

```env
AI_GATEWAY_API_KEY=...
COMMENTARY_MODEL=openai/gpt-4.1-mini
```

- `AI_GATEWAY_API_KEY`: Vercel AI Gatewayで発行する唯一の必須キー
- `COMMENTARY_MODEL`: 視覚状態抽出とJevあり／なしの実況生成で使う固定モデル。画像入力対応モデルを指定する

既定値は馬番など小さい視覚情報の読み取りと遅延のバランスを取った `openai/gpt-4.1-mini` です。各リクエストでは現在フレームに加えて直前フレームも渡し、画面の左右だけを先頭・順位と誤認しにくくしています。Vercel AI Gateway上の料金は変わる可能性があるため、実行前にモデルページで確認してください。コストを優先する場合は環境変数で `openai/gpt-4.1-nano` や `google/gemini-2.5-flash-lite` などへ変更できますが、同じ比較実験中は固定してください。

Jevは `typesafe-ai/jev` 固定です。生成モデルとJevは、どちらもVercel AI Gateway経由で呼び出します。OpenAI・Anthropic・Google・TypeSafe個別のAPIキーは不要です。

## API key

1. [AI Gateway API Keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys)を開く
2. `Create API Key`を押して作成する
3. 表示された値を安全な場所へ保存する。作成後に全文を再表示することはできません
4. ローカルでは `.env.local`、VercelではPreview環境の `AI_GATEWAY_API_KEY` に設定する

キーはチャット、Issue、コミットへ貼らないでください。

## Run the visual benchmark

1. YouTube URLを入力して「動画を開く」
2. 必要ならYouTube概要欄を貼り、「名簿だけ抽出」で内容を確認
3. 映像解析に必要な権利・許諾の確認欄をチェック
4. 「映像解析と再生を同時開始」を押す
5. 共有画面で、このプレビュータブを選択する
6. 動画が音声付きで再生され、ブラウザ内CVと実況が順次表示される

ブラウザの自動再生制限で音声が始まらない場合は、埋め込みプレイヤーを一度クリックして再生してください。画面共有の `audio` は常に無効なので、その場合もAIへの音声入力は行われません。

最初の確認では「1秒固定・最大5枚」など短い設定を推奨します。実況の品質を見てからフレーム数を増やすと、全編を毎回解析せずに調整できます。
YouTubeの時刻付きURL（例: `&t=45s`）にも対応しているため、スタート・中盤・直線の短い区間を個別に再現できます。これは任意の動画に使える検証機能で、特定レースの時刻はコードへ保存しません。

アプリは `preferCurrentTab: true` と `selfBrowserSurface: "include"` を指定して現在のタブを優先します。ただしこれらはブラウザへのヒントであり、ブラウザが無視することがあります。その場合はYouTubeを別タブで再生し、そのタブを共有します。

## Comparison design

視覚モデルの差が比較へ混ざらないよう、各フレームから視覚状態を一度だけ抽出し、両経路で共有します。

1. ブラウザ内のCOCO-SSDとMoveNetが、馬数・馬群密度・人物姿勢・手首の変化を継続的に推定
2. 固定LLMが同じ画像とブラウザCVの状態から、馬名を知らないまま共通の視覚状態と馬番を抽出
3. サーバーが高信頼の馬番だけをネタバレ除去済み名簿の馬名へ対応付け
4. Jevなし: 固定LLMが共通状態から実況を生成
5. Jevあり: `typesafe-ai/jev` が共通状態を評価し、同じ固定LLMが判断を反映した実況を生成

これはJev単体による映像認識ではありません。Jevはテキスト化された状態を高速評価するレイヤーです。

## Private Vercel preview

毎回リポジトリをクローンする必要はありません。Vercelプロジェクトを1つ使い続けます。

1. `AI_GATEWAY_API_KEY`をPreview環境だけに設定
2. `vercel`（`--prod`なし）で新しいPreviewを作成
3. Project Settings → Deployment Protection → Vercel AuthenticationでStandard Protectionを有効化
4. Vercelへログインしたユーザーだけが保護付きPreviewを利用

公開Productionはキーなしのデモとして維持できます。

## Validate

```bash
npm run lint
npm test
npm run build
```

## Notes for public release

- APIキー、`.env.local`、実運用ログ、取得フレームはコミットしないでください。
- 現時点ではライセンス未設定です。第三者による再利用を許可する場合は公開前にライセンスを選択してください。
- 映像の解析・保存・公開に必要な権利を利用者自身で確認してください。

## References

- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Jev on Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev)
- [Jev: a new model for real-time agent control](https://vercel.com/i/jev-agent-control)
- [Vercel AI Gateway with AI SDK](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk)
- [MDN: MediaDevices.getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [TensorFlow.js COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)
- [TensorFlow.js pose-detection / MoveNet](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
