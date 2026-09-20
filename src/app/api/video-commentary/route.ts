import { experimental_evaluate as evaluate, generateObject, generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { groundNarration } from "@/lib/commentary-grounding";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMENTARY_MODEL = process.env.COMMENTARY_MODEL ?? "openai/gpt-4.1-mini";
const JEV_MODEL = "typesafe-ai/jev";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const visualStateSchema = z.object({
  phase: z.enum(["発走前", "スタート", "序盤", "向正面", "コーナー", "直線", "ゴール", "ゴール後", "不明"]),
  focus: z.string().describe("画面上で最も注目すべき馬または馬群。識別不能なら位置で表す"),
  event: z.string().describe("このフレームで視覚的に確認できる出来事"),
  facts: z.array(z.string()).min(1).max(4),
  changeFromPrevious: z.string().describe("前回状態からの変化。初回または不明なら『不明』"),
  leadSituation: z.enum(["単独先頭", "接戦", "一団", "不明"]),
  leadSituationEvidence: z.string().describe("先頭差を判断した画面上の根拠。根拠がなければ『不明』"),
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
  cameraShot: z.enum(["ゲート", "正面", "横", "後方", "俯瞰", "リプレイ・演出", "不明"]),
  visibleHorses: z.array(z.object({
    number: z.number().int().min(1).max(99),
    horseName: z.string(),
    screenPosition: z.enum(["左", "中央", "右", "不明"]),
    movement: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(6),
});

const rawVisualStateSchema = visualStateSchema.extend({
  visibleHorses: z.array(z.object({
    number: z.number().int().min(1).max(99),
    screenPosition: z.enum(["左", "中央", "右", "不明"]),
    movement: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(6),
});

const frameAnalysisSchema = z.object({
  visualState: rawVisualStateSchema,
  directNarration: z.string().max(80),
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
  delivery: string;
  urgency: number;
  speakNow: number;
  confidence: number;
};

const EVENT_OPTIONS = {
  start_break: "ゲートが開く、出遅れ、または発馬直後の明確な変化",
  lead_change: "先頭交代、または先頭争いの決着",
  rapid_close: "後続馬または馬群が急速に接近",
  position_change: "注目に値する位置取りの変化",
  steady: "大きな変化のない展開",
  finish: "ゴールまたは着順の確定",
  rider_drive: "騎手が明確に追い始めた、または腕の動きが強まった",
  rider_hold: "騎手が上体を起こす、または控える動作が見える",
  uncertain: "映像だけでは重要イベントを特定できない",
} as const;

const DELIVERY_OPTIONS = {
  hold: "新情報が乏しく発話を待つ",
  brief: "現在位置や隊列を短く更新する",
  call: "動き出した馬や位置変化を強調する",
  climax: "直線の攻防やゴールを強く伝える",
} as const;

function highestProbability(probabilities: Record<string, number> | undefined) {
  const values = Object.values(probabilities ?? {});
  return values.length ? Math.max(...values) : 0;
}

async function extractVisualState(
  imageBase64: string,
  previousImageBase64: string | null,
  previousState: VisualState | null,
  browserVision: z.infer<typeof browserVisionSchema> | null,
  raceContext: z.infer<typeof raceContextSchema> | null,
) {
  const startedAt = performance.now();
  const { object } = await generateObject({
    model: COMMENTARY_MODEL,
    schema: frameAnalysisSchema,
    schemaName: "horse_race_frame_analysis",
    system:
      "あなたは競馬映像の視覚解析器兼実況者です。音声・実況・字幕の文章は使わず、画像の画素から確認できるレース映像の事実だけを構造化してください。馬名や出走名簿は与えられていません。2枚ある場合は1枚目が直前、2枚目が現在です。まず両画像の馬群・カメラ位置・進行方向を比較して位置変化を捉え、次に現在画像のゼッケンを拡大して数字を読みます。画面の左右だけを根拠に先頭・順位・内外を決めてはいけません。先頭は、進行方向と前後関係が画像間で明瞭な場合だけ述べてください。先頭付近の2頭の鼻先または胴体が重なって見える場合はleadSituationを『接戦』とし、『引き離す』『抜け出す』『独走』とは表現しないでください。『単独先頭』は、後続との明瞭な空間が2枚の画像で継続して見える場合だけ選んでください。コース上の100m・200mなどの残距離標識が見える場面は直線として扱ってください。区間名は標識やコース形状に明確な根拠がない限りeventやdirectNarrationへ入れないでください。前画像が激しい先頭争いで、現在画像が正面の接写へ切り替わり、計時が固定され速度表示が消え、騎手が体を起こし始めていればゴール後を強く疑ってください。ゴール線そのものが見えない場合は勝者や着順を断定しないでください。ゼッケンの数字を一桁ずつ明確に視認できた馬だけvisibleHorsesへ入れてください。6と16、3と13など末尾だけが似る馬番を推測で補完してはいけません。速度・距離・ゲート番号など単独の放送数字を馬番として扱わないでください。一方、複数の馬番と勝負服アイコンが縦に並ぶ現在進行中の順位パネルは、ライブの先頭候補を補助するためだけに使えます。最終結果・リプレイ・表彰・まとめ画面の順位は使わないでください。読めない数字はvisibleHorseNumbersへ入れず、位置表現を使ってください。連続する同じカメラショットでは、前フレームで高信頼に識別した馬を毛色・勝負服・位置関係が一致する1フレーム先まで追跡して構いません。発走は、馬体がゲート前方へ明確に飛び出している場合だけ『スタート』とし、枠内の馬や扉らしき形だけでゲートが開いたと判断しないでください。騎手の意図を断定せず、上体・肘・手首の観察可能な動きから『可能性』として分類してください。遠景・遮蔽・低解像度では必ず判別不能または低い信頼度にしてください。directNarrationはeventを主語・前後関係・馬番を反転させずに言い換えた、45文字以内の自然な日本語実況1文です。馬を特定できる場合も馬名を作らず『16番』のように馬番だけで呼んでください。『確認』『判別』『映像では』など解析作業を説明する語を避け、見えているレース展開を実況してください。",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              task: "現在の映像フレームを解析する",
              previousVisualState: previousState ? {
                ...previousState,
                visibleHorses: previousState.visibleHorses.map((horse) => ({
                  number: horse.number,
                  screenPosition: horse.screenPosition,
                  movement: horse.movement,
                  confidence: horse.confidence,
                })),
              } : null,
              browserVision,
            }),
          },
          ...(previousImageBase64
            ? [
                { type: "text" as const, text: "直前フレーム" },
                { type: "file" as const, data: previousImageBase64, mediaType: "image/jpeg" as const },
              ]
            : []),
          { type: "text", text: "現在フレーム" },
          { type: "file", data: imageBase64, mediaType: "image/jpeg" },
        ],
      },
    ],
    temperature: 0,
    reasoning: "none",
  });

  const entrantsByNumber = new Map((raceContext?.entrants ?? []).map((entrant) => [entrant.number, entrant]));
  const visibleNumbers = new Set(object.visualState.visibleHorseNumbers);
  const state: VisualState = {
    ...object.visualState,
    visibleHorses: object.visualState.visibleHorses
      .filter((horse) => visibleNumbers.has(horse.number))
      .map((horse) => ({
        ...horse,
        horseName: entrantsByNumber.get(horse.number)?.horseName ?? "",
      })),
  };

  return {
    state,
    directText: object.directNarration.trim(),
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
      delivery: {
        type: "choice",
        instructions: "いま出す実況の強さを選ぶ。前回との差が乏しい場合はholdを選ぶ",
        criteria: DELIVERY_OPTIONS,
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
  const delivery = response.answers.delivery;
  const urgency = response.answers.urgency;
  const speakNow = response.answers.speakNow;

  let normalizedEvent = event.choice;
  if (normalizedEvent === "start_break" && state.phase !== "スタート") {
    normalizedEvent = state.shouldSpeak ? "position_change" : "steady";
  }
  if (
    (normalizedEvent === "rider_drive" || normalizedEvent === "rider_hold") &&
    (
      state.jockeyActionConfidence < 0.9 ||
      !["横", "正面"].includes(state.cameraShot) ||
      state.cameraShot === "リプレイ・演出"
    )
  ) {
    normalizedEvent = state.shouldSpeak ? "position_change" : "steady";
  }

  return {
    latencyMs: Math.round(performance.now() - startedAt),
    decision: {
      event: normalizedEvent,
      delivery: delivery.choice,
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
      "あなたは日本語の競馬実況者です。与えられた視覚解析の事実だけを使い、馬名・馬番・順位を創作しないでください。visibleHorsesに信頼度0.7以上の馬がいれば最大2頭まで馬番と馬名で呼び、Jevが選んだ重要イベントへ焦点を絞ってください。deliveryがbriefなら簡潔に、callなら動きを強調し、climaxなら先頭争いを力強く伝えてください。leadSituationが『単独先頭』でない限り『引き離す』『抜け出す』『独走』『突き放す』を使わず、接戦なら『並ぶ』『競り合う』と表現してください。区間名はvisualStateのeventまたはfactsに明確な視覚根拠がある場合だけ述べてください。騎手動作は信頼度0.9以上の場合だけ触れ、疑問文にはせず『手が動く』『追い始める』のように観察できる動作だけを現在形で述べてください。『確認』『判別』『映像では』など解析作業を説明する語を避けてください。出力は実況文1文のみ、45文字以内です。",
    prompt: JSON.stringify(
      decision
        ? { task: "Jevの判断を優先して実況する", visualState: state, jevDecision: decision }
        : { task: "視覚状態から直接実況する", visualState: state },
    ),
    maxOutputTokens: 160,
    temperature: 0.2,
    reasoning: "none",
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
    leadSituation: "一団",
    leadSituationEvidence: "複数頭が密集している",
    shouldSpeak: true,
    uncertainty: "馬名と正確な順位は判別不能",
    visibleHorseNumbers: [],
    jockeyAction: "追っている可能性",
    jockeyActionConfidence: 0.72,
    jockeyActionEvidence: "上体が低く、腕の前後運動が見える",
    cameraShot: "横",
    visibleHorses: [],
  };

  return {
    mode: "demo",
    visualState: state,
    visionLatencyMs: 920,
    direct: { text: "先頭は一団、各馬が激しく競り合っています。", latencyMs: 710 },
    jev: {
      decision: { event: "position_change", delivery: "call", urgency: 1.3, speakNow: 0.82, confidence: 0.76 },
      spoken: true,
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
      previousImage?: unknown;
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
    const previousMatch = typeof body.previousImage === "string"
      ? body.previousImage.match(/^data:image\/jpeg;base64,(.+)$/)
      : null;
    if (
      body.previousImage !== undefined &&
      body.previousImage !== null &&
      (!previousMatch || Buffer.byteLength(previousMatch[1], "base64") > MAX_IMAGE_BYTES)
    ) {
      return NextResponse.json({ error: "直前フレームの形式またはサイズが不正です。" }, { status: 400 });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json(demoResult(body.elapsedMs));
    }

    const parsedPrevious = visualStateSchema.safeParse(body.previousState);
    const parsedBrowserVision = browserVisionSchema.safeParse(body.browserVision);
    const parsedRaceContext = raceContextSchema.safeParse(body.raceContext);
    const vision = await extractVisualState(
      match[1],
      previousMatch?.[1] ?? null,
      parsedPrevious.success ? parsedPrevious.data : null,
      parsedBrowserVision.success ? parsedBrowserVision.data : null,
      parsedRaceContext.success ? parsedRaceContext.data : null,
    );
    const jevResult = await askJev(vision.state);
    const decisiveEvent =
      (jevResult.decision.event === "start_break" && vision.state.phase === "スタート") ||
      ["lead_change", "rapid_close", "finish"].includes(jevResult.decision.event);
    const firstBeat =
      !parsedPrevious.success &&
      vision.state.phase !== "不明" &&
      vision.state.shouldSpeak;
    const observableRaceAction =
      vision.state.phase !== "不明" ||
      vision.state.visibleHorseNumbers.length > 0 ||
      !/不明|確認できない|見えない/.test(vision.state.event);
    const periodicBeat =
      body.elapsedMs >= 3_000 &&
      body.elapsedMs % 3_000 < 1_000 &&
      observableRaceAction &&
      jevResult.decision.event !== "uncertain";
    const spoken = firstBeat || decisiveEvent || periodicBeat || (
      jevResult.decision.delivery !== "hold" &&
      jevResult.decision.speakNow >= 0.5 &&
      (vision.state.shouldSpeak || jevResult.decision.urgency >= 1)
    );
    const assisted = spoken
      ? await narrate(vision.state, jevResult.decision)
      : { text: "", latencyMs: 0 };
    const directText = groundNarration(vision.directText, vision.state, parsedRaceContext.success ? parsedRaceContext.data : null);
    const assistedText = spoken
      ? groundNarration(assisted.text, vision.state, parsedRaceContext.success ? parsedRaceContext.data : null)
      : "";

    return NextResponse.json({
      mode: "live",
      visualState: vision.state,
      visionLatencyMs: vision.latencyMs,
      direct: { text: directText, latencyMs: 0 },
      jev: {
        decision: jevResult.decision,
        spoken,
        decisionLatencyMs: jevResult.latencyMs,
        narrationLatencyMs: assisted.latencyMs,
        text: assistedText,
      },
    });
  } catch (error) {
    console.error("Video commentary failed", error);
    const message = error instanceof Error ? error.message : "";
    const customerVerificationRequired =
      message.includes("customer_verification_required") ||
      message.includes("valid credit card");
    const rateLimited = message.includes("rate_limit") || message.includes("429");
    const insufficientCredit =
      message.includes("insufficient") ||
      message.includes("credit balance") ||
      message.includes("402");
    const invalidKey = message.includes("Unauthorized") || message.includes("401") || message.includes("API key");
    const status = rateLimited ? 429 : insufficientCredit ? 402 : invalidKey ? 401 : 502;
    return NextResponse.json(
      {
        error: customerVerificationRequired
          ? "Vercel AI Gatewayの無料枠を使うには、Vercelチームへのカード登録が必要です。クレジット購入は不要です。"
          : rateLimited
            ? "モデルのレート制限に達しました。API頻度を『節約』へ下げ、少し待ってから再開してください。"
            : insufficientCredit
              ? "AI Gatewayのクレジット残高が不足しています。"
              : invalidKey
                ? "AI Gateway APIキーが無効、または対象環境に設定されていません。"
          : "映像解析に失敗しました。Gatewayの残高・キー・画像対応モデルを確認してください。",
      },
      { status },
    );
  }
}
