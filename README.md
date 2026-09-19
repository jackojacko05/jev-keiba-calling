# Jev Keiba Calling

[Live demo](https://jev-keiba-calling.vercel.app)（キー未設定のためデモモード）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20key.%20Both%20the%20commentary%20model%20and%20Jev%20run%20through%20AI%20Gateway.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-key)

YouTube競馬映像をミュート再生し、同じ映像フレームと同じ固定LLMを使って次の2経路を比較する実験環境です。

- 共通の視覚状態 → 固定LLMによる実況（Jevなし）
- 同じ視覚状態 → Jevの構造化判断 → 同じ固定LLMによる実況（Jevあり）

映像は8秒ごと、最大6フレーム取得します。各結果には動画開始からの経過時間、視覚抽出時間、各経路の処理時間、画面に結果が出るまでの遅延を表示します。結果JSONには画像自体を含めません。

音声はブラウザへ要求せず、サーバーへ送信しません。YouTubeから動画や音声をダウンロードする実装もありません。ユーザーが共有を許可したブラウザタブの表示領域から、埋め込みプレイヤー部分の静止画だけを切り出します。

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` に実際のキーを設定します。このファイルはGitに入りません。

```env
AI_GATEWAY_API_KEY=...
COMMENTARY_MODEL=openai/gpt-5-mini
```

- `AI_GATEWAY_API_KEY`: Vercel AI Gatewayで発行する唯一の必須キー
- `COMMENTARY_MODEL`: 視覚状態抽出とJevあり／なしの実況生成で使う固定モデル。画像入力対応モデルを指定する

Jevは `typesafe-ai/jev` 固定です。生成モデルとJevは、どちらもVercel AI Gateway経由で呼び出します。OpenAI・Anthropic・Google・TypeSafe個別のAPIキーは不要です。

## API key

1. [AI Gateway API Keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys)を開く
2. `Create API Key`を押して作成する
3. 表示された値を安全な場所へ保存する。作成後に全文を再表示することはできません
4. ローカルでは `.env.local`、VercelではPreview環境の `AI_GATEWAY_API_KEY` に設定する

キーはチャット、Issue、コミットへ貼らないでください。

## Run the visual benchmark

1. YouTube URLを入力して「動画を開く」
2. 映像解析に必要な権利・許諾の確認欄をチェック
3. 「映像解析と再生を同時開始」を押す
4. 共有画面で、このプレビュータブを選択する
5. 動画がミュートで再生され、解析結果が順次表示される

アプリは `preferCurrentTab: true` と `selfBrowserSurface: "include"` を指定して現在のタブを優先します。ただしこれらはブラウザへのヒントであり、ブラウザが無視することがあります。その場合はYouTubeを別タブで再生し、そのタブを共有します。

## Comparison design

視覚モデルの差が比較へ混ざらないよう、各フレームから視覚状態を一度だけ抽出し、両経路で共有します。

1. 固定LLMが画像から共通の視覚状態を抽出
2. Jevなし: 固定LLMが共通状態から実況を生成
3. Jevあり: `typesafe-ai/jev` が共通状態を評価し、同じ固定LLMが判断を反映した実況を生成

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
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
