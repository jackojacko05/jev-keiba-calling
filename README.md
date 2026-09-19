# Jev Keiba Calling

[Live demo](https://jev-keiba-calling.vercel.app)（キー未設定のため固定値のデモモード）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20key.%20Both%20the%20commentary%20model%20and%20Jev%20run%20through%20AI%20Gateway.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-key)

同じ架空レース状態と同じ固定LLMを使い、次の2経路を比較する再現可能な実験環境です。

- 固定LLMによる直接実況（Jevなし）
- Jevによる構造化判断 → 同じ固定LLMによる実況（Jevあり）

生成モデルと `typesafe-ai/jev` は、どちらもVercel AI Gateway経由で呼び出します。必要な秘密情報は `AI_GATEWAY_API_KEY` 1つだけです。固定fixture、モデルID、各処理のレイテンシ、Jevの構造化出力を結果JSONに保存できます。実在の映像・実況文・馬名は使いません。

YouTube URLを入力して公式埋め込みプレイヤーで再生し、ユーザーがブラウザで明示的に共有したタブ音声をAI Gatewayで文字起こしする補助機能も含みます。サーバーがYouTube動画を自動ダウンロードする実装ではありません。

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
TRANSCRIPTION_MODEL=openai/whisper-1
```

- `AI_GATEWAY_API_KEY`: Vercel AI Gatewayで発行する唯一の必須キー
- `COMMENTARY_MODEL`: Jevあり／なしの両方で使う固定の生成モデル
- `TRANSCRIPTION_MODEL`: YouTube補助機能で使う文字起こしモデル

キーがない場合は固定値を返すデモモードになります。OpenAI・Anthropic・Google・TypeSafe個別のAPIキーは不要です。

公開Vercelサイトに個人キーを設定すると、閲覧者の利用もそのキーの予算・利用枠へ計上されます。公開デモはキーなしにしておき、実測はローカルまたは保護したVercel Previewで行うのがおすすめです。

「Deploy with Vercel」を使う場合は、利用者自身のGitHub/Vercelへリポジトリが複製され、デプロイ画面で利用者自身のキーを入力します。リポジトリ所有者にはキーが共有されません。

## API key

### Vercel AI Gateway

1. [AI Gateway API Keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys)を開く
2. `Create key` を押し、キー名を入力する
3. 表示された値をすぐコピーする。作成後に値を再表示することはできません
4. `.env.local` の `AI_GATEWAY_API_KEY` に設定する

CLIでも作成できます。

```bash
npx vercel@latest ai-gateway api-keys create --name jev-keiba-calling-local
```

キーはチャット、Issue、コミットへ貼らないでください。

## Reproduce

1. `npm run dev` を起動する
2. ブラウザで `http://localhost:3000` を開く
3. 「Jevあり／なしを比較」を押す
4. 「結果JSONを保存」で入力・出力・モデル・計測値を保存する

### Private Vercel preview

毎回リポジトリをクローンする必要はありません。自分用のVercelプロジェクトを1つだけ作り、Preview環境を使います。

1. VercelのEnvironment Variablesで `AI_GATEWAY_API_KEY` を **Previewだけ** に設定する
2. `vercel`（`--prod` なし）、または作業ブランチ／Pull RequestからPreviewを作る
3. Project Settings → Deployment Protection → Vercel AuthenticationでStandard Protectionを有効にする
4. 発行された保護付きPreview URLで実測する

HobbyプランでもStandard ProtectionでPreviewデプロイをVercelログイン必須にできます。公開Productionはキーなしのデモのまま保てます。独自Productionドメイン自体を非公開にしたい場合はプラン条件を確認してください。

### YouTube transcription

1. YouTube URLを入力して「動画を開く」
2. 権利・許諾の確認欄をチェック
3. 「録音開始」を押し、ブラウザの共有画面でこのタブと「タブの音声も共有」を選択
4. 埋め込み動画を再生
5. 「停止して文字起こし」を押す

この機能は共有された音声をVercel AI Gatewayの文字起こしモデルへ送信します。動画・音声・文字起こしの利用権を確認したうえで使用してください。YouTubeのURLから音声をスクレイピング・ダウンロードする機能はありません。

比較条件を変える場合は `src/lib/race.ts` のfixture、`.env.local` の `COMMENTARY_MODEL`、`src/app/api/commentary/route.ts` のプロンプトを変更します。比較時はコミットSHAも一緒に記録してください。

## Validate

```bash
npm run lint
npm run build
```

## Notes for public release

- APIキー、`.env.local`、実運用のログはコミットしないでください。
- 現時点ではライセンス未設定です。第三者による再利用を許可する場合は公開前にライセンスを選択してください。
- Jevは実況生成モデルではなく、映像などから得た状態を高速に構造化判断するレイヤーとして比較します。

## References

- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Jev on Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev)
- [Jev: a new model for real-time agent control](https://vercel.com/i/jev-agent-control)
- [Vercel AI Gateway with AI SDK](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk)
- [Vercel AI Gateway Speech to Text](https://vercel.com/docs/ai-gateway/modalities/speech-to-text)
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
