# Jev Keiba Calling

同じ架空レース状態を入力し、次の2経路を比較する再現可能な実験環境です。

- 通常LLMによる直接実況
- TypeSafe Jevによる構造化判断 → 同じLLMによる実況

固定fixture、モデルID、各処理のレイテンシ、Jevの構造化出力を結果JSONに保存できます。実在の映像・実況文・馬名は使いません。

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
TYPESAFE_API_KEY=...
COMMENTARY_MODEL=openai/gpt-6-astra
TRANSCRIPTION_MODEL=openai/whisper-1
```

- `AI_GATEWAY_API_KEY`: Vercel AI Gatewayで発行
- `TYPESAFE_API_KEY`: [TypeSafe Console](https://console.typesafe.ai/keys)で発行
- `COMMENTARY_MODEL`: Vercel AI Gatewayで利用する生成モデル
- `TRANSCRIPTION_MODEL`: Vercel AI Gatewayで利用する文字起こしモデル

キーが揃っていない場合は固定値を返すデモモードになります。実測には両方のキーが必要です。

このリポジトリはローカル実測を基本とします。公開Vercelサイトに個人キーを設定すると、閲覧者のAPI利用がそのキーの予算・利用枠へ計上されます。ソースだけを公開し、各利用者が自分の `.env.local` を用意する運用を推奨します。

## Reproduce

1. `npm run dev` を起動する
2. ブラウザで `http://localhost:3000` を開く
3. 「ベンチマーク実行」を押す
4. 「結果JSONを保存」で入力・出力・モデル・計測値を保存する

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
- Jevは実況生成モデルではなく、構造化判断レイヤーとして比較します。

## References

- [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Vercel AI Gateway with AI SDK](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk)
- [Vercel AI Gateway Speech to Text](https://vercel.com/docs/ai-gateway/modalities/speech-to-text)
- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
