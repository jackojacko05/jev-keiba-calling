import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { getDefaultModels, isSupportedModel, MODEL_OPTIONS, type ModelId } from "@/lib/models";
import type { RaceFrame } from "@/lib/race";

export const runtime = "nodejs";

type JevDecision = {
  focus: string;
  event: string;
  urgency: number;
  speakNow: number;
  confidence: number;
};

const EVENT_OPTIONS = {
  lead_change: "先頭交代、または先頭争いの決着",
  rapid_close: "後続馬が先頭へ急速に接近",
  position_change: "注目に値する順位変動",
  steady: "大きな変化のない展開",
  finish: "ゴールと着順の確定",
} as const;

function isRaceFrame(value: unknown): value is RaceFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<RaceFrame>;
  return (
    typeof frame.id === "string" &&
    typeof frame.elapsedSeconds === "number" &&
    typeof frame.remainingMeters === "number" &&
    typeof frame.phase === "string" &&
    Array.isArray(frame.horses) &&
    Array.isArray(frame.facts)
  );
}

function mockDecision(frame: RaceFrame): JevDecision {
  const leader = frame.horses.find((horse) => horse.position === 1) ?? frame.horses[0];
  const challenger = frame.horses.find((horse) => horse.momentum === "surging");
  const event = frame.remainingMeters === 0
    ? "finish"
    : frame.id === "overtake"
      ? "lead_change"
      : challenger && challenger.position > 1
        ? "rapid_close"
        : frame.id === "backstretch"
          ? "position_change"
          : "steady";

  return {
    focus: `horse_${challenger?.number ?? leader.number}`,
    event,
    urgency: event === "steady" ? 0.7 : event === "position_change" ? 1.4 : 1.9,
    speakNow: event === "steady" ? 0.58 : 0.96,
    confidence: event === "steady" ? 0.71 : 0.9,
  };
}

function mockCommentary(frame: RaceFrame, assisted: boolean) {
  if (frame.remainingMeters === 0) {
    return assisted
      ? "2番シロガネ先頭でゴール、鮮やかな差し切りです！"
      : "ゴール！2番シロガネが1着、4番アカツキが2着です。";
  }
  if (frame.id === "overtake") {
    return assisted
      ? "2番シロガネが先頭！残り170メートルで抜け出した！"
      : "直線で2番シロガネが先頭に変わりました。";
  }
  return `${frame.phase}、${frame.facts.join("。")}。`;
}

async function askJev(frame: RaceFrame) {
  const horseOptions = Object.fromEntries(
    frame.horses.map((horse) => [
      `horse_${horse.number}`,
      `${horse.number}番 ${horse.name}（${horse.position}番手、勢い: ${horse.momentum}）`,
    ]),
  );
  const startedAt = performance.now();
  const client = new TypeSafeClient();
  const response = await client.systemOne({
    state: frame,
    questions: {
      focus: choice("この瞬間、実況で最も注目すべき馬を1頭選ぶ", horseOptions),
      event: choice("現在起きている最重要イベントを1つ選ぶ", EVENT_OPTIONS),
      urgency: score("この状態を今すぐ実況で強調する必要性", [
        "低い。大きな変化はなく静観できる",
        "中程度。短く状況を更新する",
        "高い。勝負を左右する変化として直ちに強調する",
      ]),
      speakNow: noul("この瞬間に新しい実況文を出すべきである"),
    },
  });

  return {
    latencyMs: Math.round(performance.now() - startedAt),
    decision: {
      focus: response.answers.focus.choice,
      event: response.answers.event.choice,
      urgency: response.answers.urgency.score,
      speakNow: response.answers.speakNow.noul,
      confidence: Math.min(
        response.answers.focus.confidence,
        response.answers.event.confidence,
        response.answers.urgency.confidence,
      ),
    } satisfies JevDecision,
  };
}

async function narrate(frame: RaceFrame, model: ModelId, decision?: JevDecision) {
  const startedAt = performance.now();
  const { text } = await generateText({
    model,
    instructions:
      "あなたは日本語の競馬実況者です。入力の事実だけを使い、馬名・馬番・順位を創作しないでください。出力は実況文1文のみ、45文字以内です。",
    prompt: JSON.stringify(
      decision
        ? { task: "Jevの判断を優先して実況する", raceState: frame, jevDecision: decision }
        : { task: "レース状態から直接実況する", raceState: frame },
    ),
    maxOutputTokens: 80,
    temperature: 0.4,
  });
  return { text: text.trim(), latencyMs: Math.round(performance.now() - startedAt) };
}

export async function GET() {
  return NextResponse.json({
    typesafe: Boolean(process.env.TYPESAFE_API_KEY),
    aiGateway: Boolean(process.env.AI_GATEWAY_API_KEY),
    defaultModels: getDefaultModels(),
    models: MODEL_OPTIONS,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { frame?: unknown; models?: unknown };
    if (!isRaceFrame(body.frame)) {
      return NextResponse.json({ error: "Invalid race frame" }, { status: 400 });
    }
    if (
      !Array.isArray(body.models) ||
      body.models.length !== 2 ||
      !body.models.every(isSupportedModel) ||
      body.models[0] === body.models[1]
    ) {
      return NextResponse.json({ error: "異なる対応モデルを2つ選択してください。" }, { status: 400 });
    }

    const frame = body.frame;
    const models = body.models as [ModelId, ModelId];
    const live = Boolean(process.env.TYPESAFE_API_KEY && process.env.AI_GATEWAY_API_KEY);
    if (!live) {
      const decision = mockDecision(frame);
      return NextResponse.json({
        mode: "demo",
        decision,
        decisionLatencyMs: 118,
        results: models.map((model, index) => ({
          model,
          direct: { text: mockCommentary(frame, false), latencyMs: 780 + index * 90 },
          jev: {
            narrationLatencyMs: 610 + index * 70,
            totalLatencyMs: 728 + index * 70,
            text: mockCommentary(frame, true),
          },
        })),
      });
    }

    const directPromise = Promise.all(models.map((model) => narrate(frame, model)));
    const [directResults, jevResult] = await Promise.all([directPromise, askJev(frame)]);
    const jevNarrations = await Promise.all(
      models.map((model) => narrate(frame, model, jevResult.decision)),
    );

    return NextResponse.json({
      mode: "live",
      decision: jevResult.decision,
      decisionLatencyMs: jevResult.latencyMs,
      results: models.map((model, index) => ({
        model,
        direct: directResults[index],
        jev: {
          narrationLatencyMs: jevNarrations[index].latencyMs,
          totalLatencyMs: jevResult.latencyMs + jevNarrations[index].latencyMs,
          text: jevNarrations[index].text,
        },
      })),
    });
  } catch (error) {
    console.error("Commentary benchmark failed", error);
    return NextResponse.json(
      { error: "実行に失敗しました。環境変数とAPIの利用状況を確認してください。" },
      { status: 502 },
    );
  }
}
