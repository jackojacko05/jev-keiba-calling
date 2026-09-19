import { experimental_evaluate as evaluate, generateObject, generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMENTARY_MODEL = process.env.COMMENTARY_MODEL ?? "openai/gpt-5-mini";
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
  uncertain: "映像だけでは重要イベントを特定できない",
} as const;

function highestProbability(probabilities: Record<string, number> | undefined) {
  const values = Object.values(probabilities ?? {});
  return values.length ? Math.max(...values) : 0;
}

async function extractVisualState(
  imageBase64: string,
  previousState: VisualState | null,
) {
  const startedAt = performance.now();
  const { object } = await generateObject({
    model: COMMENTARY_MODEL,
    schema: visualStateSchema,
    schemaName: "horse_race_visual_state",
    system:
      "あなたは競馬映像の視覚解析器です。音声・実況・字幕の内容は使わず、画像の画素から確認できる事実だけを構造化してください。馬名や馬番は明瞭に読める場合だけ記載し、推測しないでください。",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              task: "現在の映像フレームを解析する",
              previousVisualState: previousState,
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
        instructions: "現在の視覚状態で最重要のイベントを1つ選ぶ",
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
        instructions: "この瞬間に新しい実況文を出すべきである",
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
      "あなたは日本語の競馬実況者です。与えられた視覚解析の事実だけを使い、馬名・馬番・順位を創作しないでください。音声情報は存在しません。出力は実況文1文のみ、45文字以内です。判断不能ならその旨を簡潔に述べてください。",
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
    const vision = await extractVisualState(
      match[1],
      parsedPrevious.success ? parsedPrevious.data : null,
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
    return NextResponse.json(
      { error: "映像解析に失敗しました。Gatewayの残高・キー・画像対応モデルを確認してください。" },
      { status: 502 },
    );
  }
}
