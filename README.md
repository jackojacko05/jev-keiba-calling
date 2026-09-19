# Jev Keiba Calling

同じ架空レース状態を入力し、次の2経路を比較する再現可能な実験環境です。

- 通常LLMによる直接実況
- TypeSafe Jevによる構造化判断 → 同じLLMによる実況

固定fixture、モデルID、各処理のレイテンシ、Jevの構造化出力を結果JSONに保存できます。実在の映像・実況文・馬名は使いません。

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
```

- `AI_GATEWAY_API_KEY`: Vercel AI Gatewayで発行
- `TYPESAFE_API_KEY`: [TypeSafe Console](https://console.typesafe.ai/keys)で発行
- `COMMENTARY_MODEL`: Vercel AI Gatewayで利用する生成モデル

キーが揃っていない場合は固定値を返すデモモードになります。実測には両方のキーが必要です。

## Reproduce

1. `npm run dev` を起動する
2. ブラウザで `http://localhost:3000` を開く
3. 「ベンチマーク実行」を押す
4. 「結果JSONを保存」で入力・出力・モデル・計測値を保存する

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
