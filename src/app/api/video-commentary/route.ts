import { experimental_evaluate as evaluate, generateObject, generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMENTARY_MODEL = process.env.COMMENTARY_MODEL ?? "google/gemini-2.5-flash-lite";
const JEV_MODEL = "typesafe-ai/jev";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const visualStateSchema = z.object({
  phase: z.enum(["発走前", "スタート", "序盤", "向正面", "コーナー", "直線", "ゴール", "不明"]),
  focus: z.string().describe("画面上で最も注目すべき馬または馬群。識別不能なら位置で表す"),
  event: z.string().describe("このフレームで視覚的に確認できる出来事"),
  facts: z.array(z.string()).min(1).max(4),
  changeFromPrevious: z.string().describe("前回状態からの変化。初回または不明なら『不明』"),
  shouldSpeak: z.boolean(),
  uncertainty: z.string(),
  visibleHorseNumbers: z.array(z.number().int().min(1).max(99)).max(8),
  jockeyAction: z.enum([
    "追っている可能性",
    "控えている可能性",
    "鞭の動作らしきもの",
    "通常の騎乗",
    "判別不能",
  ]),
  jockeyActionConfidence: z.number().min(0).max(1),
  jockeyActionEvidence: z.string(),
});

const browserVisionSchema = z.object({
  horseCount: z.number().int().min(0).max(30),
  personCount: z.number().int().min(0).max(30),
  poseCount: z.number().int().min(0).max(30),
  packDensity: z.enum(["dense", "spread", "unknown"]),
  motionLevel: z.enum(["low", "medium", "high", "unknown"]),
  torsoLeanDegrees: z.number().min(0).max(90).nullable(),
  wristMotion: z.number().min(0).max(5).nullable(),
  riderMotionHint: z.enum([
    "driving_candidate",
    "upright_hold_candidate",
    "steady",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
});

const raceContextSchema = z.object({
  entrants: z.array(z.object({
    number: z.number().int().min(1).max(99),
    horseName: z.string().min(1).max(80),
    jockey: z.string().max(80).optional(),
  })).max(30),
});

type VisualState = z.infer<typeof visualStateSchema>;

type JevDecision = {
  event: string;
  urgency: number;
  speakNow: number;
  confidence: number;
};

const EVENT_OPTIONS = {
  lead_change: "先頭交代、または先頭争いの決着",
  rapid_close: "後続馬または馬群が急速に接近",
  position_change: "注目に値する位置取りの変化",
  steady: "大きな変化のない展開",
  finish: "ゴールまたは着順の確定",
  rider_drive: "騎手が明確に追い始めた、または腕の動きが強まった",
  rider_hold: "騎手が上体を起こす、または控える動作が見える",
  uncertain: "映像だけでは重要イベントを特定できない",
} as const;

function highestProbability(probabilities: Record<string, number> | undefined) {
  const values = Object.values(probabilities ?? {});
  return values.length ? Math.max(...values) : 0;
}

async function extractVisualState(
  imageBase64: string,
  previousState: VisualState | null,
  browserVision: z.infer<typeof browserVisionSchema> | null,
  raceContext: z.infer<typeof raceContextSchema> | null,
) {
  const startedAt = performance.now();
  const { object } = await generateObject({
    model: COMMENTARY_MODEL,
    schema: visualStateSchema,
    schemaName: "horse_race_visual_state",
    system:
      "あなたは競馬映像の視覚解析器です。音声・実況・字幕の内容は使わず、画像の画素から確認できる事実だけを構造化してください。名簿は馬番と馬名の対応表であり、着順情報ではありません。ゼッケンの馬番が画像ではっきり読め、名簿と一致した場合だけ馬名を使ってください。騎手の意図を断定せず、上体・肘・手首の観察可能な動きから『可能性』として分類してください。遠景・遮蔽・低解像度では必ず判別不能または低い信頼度にしてください。",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              task: "現在の映像フレームを解析する",
              previousVisualState: previousState,
              browserVision,
              spoilerSafeRaceRoster: raceContext,
            }),
          },
          { type: "image", image: imageBase64, mediaType: "image/jpeg" },
        ],
      },
    ],
    temperature: 0,
  });

  return {
    state: object,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function askJev(state: VisualState) {
  const startedAt = performance.now();
  const response = await evaluate({
    model: JEV_MODEL,
    state: JSON.stringify(state),
    questions: {
      event: {
        type: "choice",
        instructions: "現在の視覚状態で実況に使う最重要イベントを1つ選ぶ。騎手動作の信頼度が低い場合は騎手イベントを選ばない",
        criteria: EVENT_OPTIONS,
      },
      urgency: {
        type: "score",
        instructions: "この視覚状態を今すぐ実況で強調する必要性",
        criteria: [
          "低い。変化が乏しい、または映像だけでは判断できない",
          "中程度。短く状況を更新する",
          "高い。勝負を左右する変化として直ちに強調する",
        ],
      },
      speakNow: {
        type: "boolean",
        instructions: "前回から意味のある変化があり、この瞬間に新しい実況文を出すべきである",
      },
    },
  });

  const event = response.answers.event;
  const urgency = response.answers.urgency;
  const speakNow = response.answers.speakNow;

  return {
    latencyMs: Math.round(performance.now() - startedAt),
    decision: {
      event: event.choice,
      urgency: urgency.score,
      speakNow: speakNow.probability,
      confidence: Math.min(
        event.probabilities?.[event.choice] ?? 0,
        highestProbability(urgency.probabilities),
      ),
    } satisfies JevDecision,
  };
}

async function narrate(state: VisualState, decision?: JevDecision) {
  const startedAt = performance.now();
  const { text } = await generateText({
    model: COMMENTARY_MODEL,
    instructions:
      "あなたは日本語の競馬実況者です。与えられた視覚解析の事実だけを使い、馬名・馬番・順位を創作しないでください。騎手動作は信頼度0.65以上の場合だけ触れ、断定ではなく観察表現にしてください。音声情報は存在しません。出力は実況文1文のみ、45文字以内です。判断不能ならその旨を簡潔に述べてください。",
    prompt: JSON.stringify(
      decision
        ? { task: "Jevの判断を優先して実況する", visualState: state, jevDecision: decision }
        : { task: "視覚状態から直接実況する", visualState: state },
    ),
    maxOutputTokens: 80,
    temperature: 0.2,
  });

  return {
    text: text.trim(),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

function demoResult(elapsedMs: number) {
  const state: VisualState = {
    phase: elapsedMs < 10_000 ? "序盤" : elapsedMs < 35_000 ? "向正面" : "直線",
    focus: "先頭の馬群",
    event: "馬群が前方へ進んでいる",
    facts: ["複数頭が密集して走行", "先頭争いは映像だけでは未確定"],
    changeFromPrevious: elapsedMs ? "馬群の間隔が変化" : "不明",
    shouldSpeak: true,
    uncertainty: "馬名と正確な順位は判別不能",
    visibleHorseNumbers: [],
    jockeyAction: "追っている可能性",
    jockeyActionConfidence: 0.72,
    jockeyActionEvidence: "上体が低く、腕の前後運動が見える",
  };

  return {
    mode: "demo",
    visualState: state,
    visionLatencyMs: 920,
    direct: { text: "先頭は一団、各馬が激しく競り合っています。", latencyMs: 710 },
    jev: {
      decision: { event: "position_change", urgency: 1.3, speakNow: 0.82, confidence: 0.76 },
      decisionLatencyMs: 120,
      narrationLatencyMs: 620,
      text: "馬群が凝縮、ここから位置取りが変わりそうです！",
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      image?: unknown;
      elapsedMs?: unknown;
      previousState?: unknown;
      browserVision?: unknown;
      raceContext?: unknown;
    };
    if (typeof body.image !== "string" || typeof body.elapsedMs !== "number") {
      return NextResponse.json({ error: "映像フレームがありません。" }, { status: 400 });
    }

    const match = body.image.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!match || Buffer.byteLength(match[1], "base64") > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "映像フレームの形式またはサイズが不正です。" }, { status: 400 });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json(demoResult(body.elapsedMs));
    }

    const parsedPrevious = visualStateSchema.safeParse(body.previousState);
    const parsedBrowserVision = browserVisionSchema.safeParse(body.browserVision);
    const parsedRaceContext = raceContextSchema.safeParse(body.raceContext);
    const vision = await extractVisualState(
      match[1],
      parsedPrevious.success ? parsedPrevious.data : null,
      parsedBrowserVision.success ? parsedBrowserVision.data : null,
      parsedRaceContext.success ? parsedRaceContext.data : null,
    );
    const [direct, jevResult] = await Promise.all([
      narrate(vision.state),
      askJev(vision.state),
    ]);
    const assisted = await narrate(vision.state, jevResult.decision);

    return NextResponse.json({
      mode: "live",
      visualState: vision.state,
      visionLatencyMs: vision.latencyMs,
      direct,
      jev: {
        decision: jevResult.decision,
        decisionLatencyMs: jevResult.latencyMs,
        narrationLatencyMs: assisted.latencyMs,
        text: assisted.text,
      },
    });
  } catch (error) {
    console.error("Video commentary failed", error);
    const message = error instanceof Error ? error.message : "";
    const customerVerificationRequired =
      message.includes("customer_verification_required") ||
      message.includes("valid credit card");
    return NextResponse.json(
      {
        error: customerVerificationRequired
          ? "Vercel AI Gatewayの無料枠を使うには、Vercelチームへのカード登録が必要です。クレジット購入は不要です。"
          : "映像解析に失敗しました。Gatewayの残高・キー・画像対応モデルを確認してください。",
      },
      { status: 502 },
    );
  }
}
