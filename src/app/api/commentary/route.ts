import { experimental_evaluate as evaluate, generateText } from "ai";
import { NextResponse } from "next/server";
import type { RaceFrame } from "@/lib/race";

export const runtime = "nodejs";

const COMMENTARY_MODEL = process.env.COMMENTARY_MODEL ?? "openai/gpt-5-mini";
const JEV_MODEL = "typesafe-ai/jev";

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

function selectedProbability(
  probabilities: Record<string, number> | undefined,
  selected: string,
) {
  return probabilities?.[selected] ?? 0;
}

function highestProbability(probabilities: Record<string, number> | undefined) {
  const values = Object.values(probabilities ?? {});
  return values.length ? Math.max(...values) : 0;
}

async function askJev(frame: RaceFrame) {
  const horseCriteria = Object.fromEntries(
    frame.horses.map((horse) => [
      `horse_${horse.number}`,
      `${horse.number}番 ${horse.name}（${horse.position}番手、勢い: ${horse.momentum}）`,
    ]),
  );
  const startedAt = performance.now();
  const response = await evaluate({
    model: JEV_MODEL,
    state: JSON.stringify(frame),
    questions: {
      focus: {
        type: "choice",
        instructions: "この瞬間、実況で最も注目すべき馬を1頭選ぶ",
        criteria: horseCriteria,
      },
      event: {
        type: "choice",
        instructions: "現在起きている最重要イベントを1つ選ぶ",
        criteria: EVENT_OPTIONS,
      },
      urgency: {
        type: "score",
        instructions: "この状態を今すぐ実況で強調する必要性",
        criteria: [
          "低い。大きな変化はなく静観できる",
          "中程度。短く状況を更新する",
          "高い。勝負を左右する変化として直ちに強調する",
        ],
      },
      speakNow: {
        type: "boolean",
        instructions: "この瞬間に新しい実況文を出すべきである",
      },
    },
  });

  const focus = response.answers.focus;
  const event = response.answers.event;
  const urgency = response.answers.urgency;
  const speakNow = response.answers.speakNow;
  const confidence = Math.min(
    selectedProbability(focus.probabilities, focus.choice),
    selectedProbability(event.probabilities, event.choice),
    highestProbability(urgency.probabilities),
  );

  return {
    latencyMs: Math.round(performance.now() - startedAt),
    decision: {
      focus: focus.choice,
      event: event.choice,
      urgency: urgency.score,
      speakNow: speakNow.probability,
      confidence,
    } satisfies JevDecision,
  };
}

async function narrate(frame: RaceFrame, decision?: JevDecision) {
  const startedAt = performance.now();
  const { text } = await generateText({
    model: COMMENTARY_MODEL,
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
    aiGateway: Boolean(process.env.AI_GATEWAY_API_KEY),
    commentaryModel: COMMENTARY_MODEL,
    jevModel: JEV_MODEL,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { frame?: unknown };
    if (!isRaceFrame(body.frame)) {
      return NextResponse.json({ error: "Invalid race frame" }, { status: 400 });
    }

    const frame = body.frame;
    if (!process.env.AI_GATEWAY_API_KEY) {
      const decision = mockDecision(frame);
      return NextResponse.json({
        mode: "demo",
        direct: { text: mockCommentary(frame, false), latencyMs: 820 },
        jev: {
          decision,
          decisionLatencyMs: 118,
          narrationLatencyMs: 640,
          totalLatencyMs: 758,
          text: mockCommentary(frame, true),
        },
      });
    }

    const directPromise = narrate(frame);
    const [direct, jevResult] = await Promise.all([directPromise, askJev(frame)]);
    const jevNarration = await narrate(frame, jevResult.decision);

    return NextResponse.json({
      mode: "live",
      direct,
      jev: {
        decision: jevResult.decision,
        decisionLatencyMs: jevResult.latencyMs,
        narrationLatencyMs: jevNarration.latencyMs,
        totalLatencyMs: jevResult.latencyMs + jevNarration.latencyMs,
        text: jevNarration.text,
      },
    });
  } catch (error) {
    console.error("Commentary benchmark failed", error);
    return NextResponse.json(
      { error: "実行に失敗しました。AI Gatewayの残高・キー・モデル設定を確認してください。" },
      { status: 502 },
    );
  }
}
