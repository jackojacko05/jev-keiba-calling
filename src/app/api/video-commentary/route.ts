import { experimental_evaluate as evaluate, generateObject, generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { groundNarration } from "@/lib/commentary-grounding";
import { buildCommentaryCandidates, type CommentaryCandidate } from "@/lib/commentary-candidates";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMENTARY_MODEL = process.env.COMMENTARY_MODEL ?? "openai/gpt-4.1-mini";
const JEV_MODEL = "typesafe-ai/jev";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const trackerGapSchema = z.enum(["接触", "小", "中", "大", "不明"]);
const trackerMovementSchema = z.enum([
  "進出",
  "後退",
  "前との差を詰める",
  "前との差が開く",
  "位置維持",
  "初回",
  "不明",
]);

const rawTrackerHorseSchema = z.object({
  number: z.number().int().min(1).max(99),
  orderFromFront: z.number().int().min(1).max(30),
  normalizedProgress: z.number().min(0).max(1),
  groupIndex: z.number().int().min(1).max(12),
  gapToAhead: trackerGapSchema,
  confidence: z.number().min(0).max(1),
});

const trackerHorseSchema = rawTrackerHorseSchema.extend({
  horseName: z.string(),
  trackingStatus: z.enum(["tracked", "unreadable"]),
  orderFromFront: z.number().int().min(1).max(30).nullable(),
  normalizedProgress: z.number().min(0).max(1).nullable(),
  groupIndex: z.number().int().min(1).max(12).nullable(),
  orderChange: z.number().int().min(-30).max(30).nullable(),
  movementFromPrevious: trackerMovementSchema,
});

const rawFieldTrackerSchema = z.object({
  detected: z.boolean(),
  leaderDirection: z.enum(["左が先頭", "右が先頭", "不明"]),
  horses: z.array(rawTrackerHorseSchema).max(30),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string(),
});

const fieldTrackerSchema = rawFieldTrackerSchema.omit({ horses: true }).extend({
  horses: z.array(trackerHorseSchema).max(30),
});

const visualStateSchema = z.object({
  phase: z.enum(["発走前", "スタート", "序盤", "向正面", "コーナー", "直線", "ゴール", "ゴール後", "不明"]),
  phaseEvidence: z.string().describe("区間を判断した画面上の根拠。根拠がなければ『不明』"),
  overallFormation: z.string().describe("画面内の隊列を価値判断なしで説明する"),
  sceneFacts: z.array(z.string()).min(1).max(12).describe("画面から読める独立した事実を優先順位なしで列挙する"),
  changes: z.array(z.string()).max(12).describe("直前フレームから確認できる変化を優先順位なしで列挙する"),
  leadSituation: z.enum(["単独先頭", "接戦", "一団", "不明"]),
  leadSituationEvidence: z.string().describe("先頭差を判断した画面上の根拠。根拠がなければ『不明』"),
  uncertainty: z.string(),
  visibleHorseNumbers: z.array(z.number().int().min(1).max(99)).max(20),
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
  cameraTraversal: z.enum(["前方から後方", "後方から前方", "同じ集団を追従", "切り替わり", "不明"]),
  fieldTracker: fieldTrackerSchema,
  horseObservations: z.array(z.object({
    trackId: z.string().min(1).max(40),
    number: z.number().int().min(1).max(99).nullable(),
    horseName: z.string(),
    screenPosition: z.enum(["左", "中央", "右", "不明"]),
    racePosition: z.enum(["先頭", "先頭付近", "中団", "後方", "不明"]),
    relativeToNearby: z.string(),
    movement: z.string(),
    riderAction: z.enum([
      "追っている可能性",
      "控えている可能性",
      "鞭の動作らしきもの",
      "通常の騎乗",
      "判別不能",
    ]),
    riderActionConfidence: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  })).max(20),
  visibleHorses: z.array(z.object({
    number: z.number().int().min(1).max(99),
    horseName: z.string(),
    screenPosition: z.enum(["左", "中央", "右", "不明"]),
    racePosition: z.enum(["先頭", "先頭付近", "中団", "後方", "不明"]),
    relativeToNearby: z.string(),
    movement: z.string(),
    riderAction: z.enum([
      "追っている可能性",
      "控えている可能性",
      "鞭の動作らしきもの",
      "通常の騎乗",
      "判別不能",
    ]),
    riderActionConfidence: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  })).max(20),
});

const rawVisualStateSchema = visualStateSchema.omit({
  horseObservations: true,
  visibleHorses: true,
  fieldTracker: true,
}).extend({
  fieldTracker: rawFieldTrackerSchema,
  horseObservations: z.array(z.object({
    trackId: z.string().min(1).max(40),
    number: z.number().int().min(1).max(99).nullable(),
    screenPosition: z.enum(["左", "中央", "右", "不明"]),
    racePosition: z.enum(["先頭", "先頭付近", "中団", "後方", "不明"]),
    relativeToNearby: z.string(),
    movement: z.string(),
    riderAction: z.enum([
      "追っている可能性",
      "控えている可能性",
      "鞭の動作らしきもの",
      "通常の騎乗",
      "判別不能",
    ]),
    riderActionConfidence: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
  })).max(20),
});

const frameAnalysisSchema = z.object({
  visualState: rawVisualStateSchema,
  previousFieldTracker: rawFieldTrackerSchema.nullable().describe("直前画像の位置パネル。直前画像がない、または読めない場合はnull"),
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

const recentCommentarySchema = z.array(z.object({
  elapsedMs: z.number().nonnegative(),
  directText: z.string().max(120),
  assistedText: z.string().max(120),
  directCandidateId: z.string().max(40),
  directCandidateText: z.string().max(160),
  jevCandidateId: z.string().max(40),
  jevCandidateText: z.string().max(160),
})).max(6);

const mentionedHorseNumbersSchema = z.object({
  direct: z.array(z.number().int().min(1).max(99)).max(30),
  jev: z.array(z.number().int().min(1).max(99)).max(30),
});

type VisualState = z.infer<typeof visualStateSchema>;
type SelectionHistoryItem = {
  elapsedMs: number;
  text: string;
  candidateId: string;
  candidateText: string;
};

type JevDecision = {
  event: string;
  candidateId: string;
  candidateText: string;
  delivery: string;
  urgency: number;
  speakNow: number;
  interrupt: number;
  confidence: number;
};

const DELIVERY_OPTIONS = {
  brief: "現在位置や隊列を短く更新し、実況を途切れさせない",
  call: "動き出した馬や位置変化を強調する",
  climax: "直線の攻防やゴールを強く伝える",
} as const;

function highestProbability(probabilities: Record<string, number> | undefined) {
  const values = Object.values(probabilities ?? {});
  return values.length ? Math.max(...values) : 0;
}

function gapRank(gap: z.infer<typeof trackerGapSchema>) {
  return { 接触: 0, 小: 1, 中: 2, 大: 3, 不明: 4 }[gap];
}

function enrichFieldTracker(
  raw: z.infer<typeof rawFieldTrackerSchema>,
  previousState: VisualState | null,
  raceContext: z.infer<typeof raceContextSchema> | null,
  previousRaw: z.infer<typeof rawFieldTrackerSchema> | null,
): z.infer<typeof fieldTrackerSchema> {
  const entrantsByNumber = new Map((raceContext?.entrants ?? []).map((entrant) => [entrant.number, entrant]));
  const currentByNumber = new Map<number, z.infer<typeof rawTrackerHorseSchema>>();
  for (const horse of raw.horses) {
    const existing = currentByNumber.get(horse.number);
    if (!existing || horse.confidence > existing.confidence) currentByNumber.set(horse.number, horse);
  }
  const previousByNumber = previousRaw
    ? new Map(previousRaw.horses.map((horse) => [horse.number, horse]))
    : new Map(
      (previousState?.fieldTracker.horses ?? [])
        .filter((horse) => horse.trackingStatus === "tracked")
        .map((horse) => [horse.number, horse]),
    );
  const numbers = entrantsByNumber.size
    ? [...entrantsByNumber.keys()]
    : [...currentByNumber.keys()];

  const horses = numbers.map((number) => {
    const current = currentByNumber.get(number);
    const previous = previousByNumber.get(number);
    if (!current) {
      return {
        number,
        horseName: entrantsByNumber.get(number)?.horseName ?? "",
        trackingStatus: "unreadable" as const,
        orderFromFront: null,
        normalizedProgress: null,
        groupIndex: null,
        gapToAhead: "不明" as const,
        orderChange: null,
        movementFromPrevious: "不明" as const,
        confidence: 0,
      };
    }

    const orderChange = previous?.orderFromFront === null || previous === undefined
      ? null
      : previous.orderFromFront - current.orderFromFront;
    let movementFromPrevious: z.infer<typeof trackerMovementSchema> = previous ? "位置維持" : "初回";
    if (orderChange !== null && orderChange > 0) movementFromPrevious = "進出";
    else if (orderChange !== null && orderChange < 0) movementFromPrevious = "後退";
    else if (previous && previous.gapToAhead !== "不明" && current.gapToAhead !== "不明") {
      const gapDelta = gapRank(current.gapToAhead) - gapRank(previous.gapToAhead);
      if (gapDelta < 0) movementFromPrevious = "前との差を詰める";
      if (gapDelta > 0) movementFromPrevious = "前との差が開く";
    }

    return {
      ...current,
      horseName: entrantsByNumber.get(number)?.horseName ?? "",
      trackingStatus: "tracked" as const,
      orderChange,
      movementFromPrevious,
    };
  }).sort((left, right) => (
    (left.orderFromFront ?? Number.MAX_SAFE_INTEGER) - (right.orderFromFront ?? Number.MAX_SAFE_INTEGER) ||
    left.number - right.number
  ));

  return {
    ...raw,
    detected: raw.detected || currentByNumber.size > 0,
    horses,
  };
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
    system: [
      "あなたは競馬映像の知覚専用モジュールです。実況内容の優先順位、注目対象、発話要否、文章表現を決めてはいけません。",
      "音声と画面上の実況字幕・自動字幕・テロップ文章は使わず、レース映像と公式の位置表示から確認できる事実だけを漏れなく構造化してください。馬名や出走名簿は与えられていません。",
      "2枚ある場合は1枚目が直前、2枚目が現在です。両画像を比較し、確認できる変化をchangesへ互いに独立した項目として列挙してください。直前画像の位置パネルはpreviousFieldTrackerへ、現在画像の位置パネルはvisualState.fieldTrackerへ、同じ基準で別々に転記してください。直前画像がない、またはパネルが読めない場合だけpreviousFieldTrackerをnullにします。",
      "画面下部のコース図に馬番アイコンが横並びになるライブ位置パネルをfieldTrackerとして、実写の馬群とは別に読み取ってください。パネルが見える場合、読める馬番を注目度に関係なく全頭列挙し、先頭からの順番orderFromFront、0〜1の相対進行位置、近い集団groupIndex、前の馬との間隔を記録します。",
      "fieldTrackerのleaderDirectionはコース図の進行矢印・先頭表示・アイコンの動きから判断し、画面の左右だけで決めません。馬番を読めないアイコンは推測で補完せず、fieldTracker.uncertaintyへ残します。",
      "直前と現在の位置パネルを比較しても、進出・後退の価値判断や実況対象の選択はしません。現在の全頭配置を正確に転記することだけに集中してください。差分はサーバー側でも機械計算します。",
      "現在画像で個体として区別できる馬は、注目度に関係なくすべてhorseObservationsへ同じ項目で列挙してください。馬番が読めない馬も除外せず、numberをnullにして画面内で一意なtrackIdを付けます。",
      "各馬についてracePosition、近くの馬との前後関係、馬自身のmovement、その馬の騎手のriderActionを独立に記録します。見えない馬や騎手を補完してはいけません。",
      "画面の左右だけを根拠に先頭・順位・内外を決めてはいけません。先頭は進行方向と前後関係が明瞭な場合だけ述べます。2頭の鼻先や胴体が重なる場合はleadSituationを接戦とし、後続との明瞭な空間が2枚で続く場合だけ単独先頭とします。",
      "100m・200mなどの残距離標識は区間判断に使えます。前画像が激しい先頭争いで、現在画像が正面接写へ切り替わり、計時固定・速度表示消失・騎手が体を起こす条件が重なる場合はゴール後を疑います。ゴール線が見えなければ勝者や着順を断定しません。",
      "6と16、3と13などを推測で補完しません。実写側のvisibleHorseNumbersにはゼッケンを明確に読めた番号だけを入れ、速度・距離・ゲート番号を馬番にしません。fieldTrackerの馬番は位置パネル内だけから読み、実写の馬番と混ぜません。最終結果・リプレイ・表彰画面の順位は使いません。",
      "連続ショットでは、前フレームで高信頼に識別した馬を毛色・勝負服・位置関係が一致する1フレーム先まで追跡できます。騎手の意図は断定せず、観察可能な上体・肘・手首の動きだけを分類します。",
      "sceneFactsには画面全体から読める事実を最大12件、価値判断や順序付けをせず列挙してください。遠景・遮蔽・低解像度では信頼度を下げ、不明と明示してください。",
    ].join(""),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              task: "現在の映像フレームを解析する",
              previousVisualState: previousState ? {
                phase: previousState.phase,
                phaseEvidence: previousState.phaseEvidence,
                overallFormation: previousState.overallFormation,
                sceneFacts: previousState.sceneFacts,
                changes: previousState.changes,
                leadSituation: previousState.leadSituation,
                leadSituationEvidence: previousState.leadSituationEvidence,
                uncertainty: previousState.uncertainty,
                visibleHorseNumbers: previousState.visibleHorseNumbers,
                cameraShot: previousState.cameraShot,
                cameraTraversal: previousState.cameraTraversal,
                fieldTracker: {
                  detected: previousState.fieldTracker.detected,
                  leaderDirection: previousState.fieldTracker.leaderDirection,
                  confidence: previousState.fieldTracker.confidence,
                  uncertainty: previousState.fieldTracker.uncertainty,
                  horses: previousState.fieldTracker.horses
                    .filter((horse) => horse.trackingStatus === "tracked" && horse.orderFromFront !== null)
                    .map((horse) => ({
                      number: horse.number,
                      orderFromFront: horse.orderFromFront,
                      normalizedProgress: horse.normalizedProgress,
                      groupIndex: horse.groupIndex,
                      gapToAhead: horse.gapToAhead,
                      confidence: horse.confidence,
                    })),
                },
                horseObservations: previousState.horseObservations.map(({ horseName, ...horse }) => {
                  void horseName;
                  return horse;
                }),
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
  const horseObservations = object.visualState.horseObservations.map((horse) => ({
    ...horse,
    horseName: horse.number === null ? "" : entrantsByNumber.get(horse.number)?.horseName ?? "",
  }));
  const state: VisualState = {
    ...object.visualState,
    fieldTracker: enrichFieldTracker(
      object.visualState.fieldTracker,
      previousState,
      raceContext,
      object.previousFieldTracker,
    ),
    horseObservations,
    visibleHorses: horseObservations
      .filter((horse): horse is typeof horse & { number: number } => (
        horse.number !== null && visibleNumbers.has(horse.number)
      ))
      .map((horse) => ({
        number: horse.number,
        horseName: horse.horseName,
        screenPosition: horse.screenPosition,
        racePosition: horse.racePosition,
        relativeToNearby: horse.relativeToNearby,
        movement: horse.movement,
        riderAction: horse.riderAction,
        riderActionConfidence: horse.riderActionConfidence,
        confidence: horse.confidence,
      })),
  };

  return {
    state,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function askJev(
  state: VisualState,
  candidates: CommentaryCandidate[],
  recentCommentary: SelectionHistoryItem[],
  mentionedHorseNumbers: number[],
) {
  const startedAt = performance.now();
  const candidateCriteria = Object.fromEntries(candidates.map((candidate) => [
    candidate.id,
    `観測元:${candidate.source} / 視認信頼度:${candidate.confidence.toFixed(2)} / ${candidate.text}`,
  ]));
  const response = await evaluate({
    model: JEV_MODEL,
    state: JSON.stringify({
      observations: state,
      commentaryCandidates: candidates,
      recentCommentary,
      mentionedHorseNumbers,
      cameraTraversal: state.cameraTraversal,
    }),
    questions: {
      primary: {
        type: "choice",
        instructions: "現在の競馬実況で次に伝える具体的事実を候補から必ず1つ選ぶ。候補の並び順を重要度と解釈せず、映像状態、全頭位置、直前状態、実況履歴から判断する",
        criteria: candidateCriteria,
      },
      delivery: {
        type: "choice",
        instructions: "選んだ事実を伝える実況の強さを選ぶ。変化が乏しくてもbriefを選び、無言にはしない",
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
      interrupt: {
        type: "boolean",
        instructions: "選んだ事実が、通常の位置・隊列説明を句の区切りで打ち切ってでも直ちに優先すべき重大変化である",
      },
    },
  });

  const primary = response.answers.primary;
  const delivery = response.answers.delivery;
  const urgency = response.answers.urgency;
  const interrupt = response.answers.interrupt;
  const selected = candidates.find((candidate) => candidate.id === primary.choice) ?? candidates[0];

  return {
    latencyMs: Math.round(performance.now() - startedAt),
    selected,
    decision: {
      event: selected.kind,
      candidateId: selected.id,
      candidateText: selected.text,
      delivery: delivery.choice,
      urgency: urgency.score,
      speakNow: 1,
      interrupt: interrupt.probability,
      confidence: Math.min(
        primary.probabilities?.[primary.choice] ?? 0,
        highestProbability(urgency.probabilities),
      ),
    } satisfies JevDecision,
  };
}

const baselineSelectionSchema = z.object({
  candidateId: z.string(),
  delivery: z.enum(["brief", "call", "climax"]),
  urgency: z.number().min(0).max(2),
  interrupt: z.boolean(),
  confidence: z.number().min(0).max(1),
});

async function askBaseline(
  state: VisualState,
  candidates: CommentaryCandidate[],
  recentCommentary: SelectionHistoryItem[],
  mentionedHorseNumbers: number[],
) {
  const startedAt = performance.now();
  const { object } = await generateObject({
    model: COMMENTARY_MODEL,
    schema: baselineSelectionSchema,
    schemaName: "horse_race_commentary_selection",
    system: [
      "あなたはリアルタイム競馬実況で、次に発話する観測事実を1つ選ぶ選択器です。",
      "候補は知覚結果から機械的に作られており、重要度順ではありません。candidateIdだけを選び、候補の事実を書き換えないでください。",
      "映像状態、全頭位置パネル、直前フレームとの差分、直近の実況履歴、紹介済み馬番を材料にします。",
    ].join(""),
    prompt: JSON.stringify({
      visualState: state,
      candidates,
      recentCommentary,
      mentionedHorseNumbers,
    }),
    temperature: 0,
    reasoning: "none",
  });
  const selected = candidates.find((candidate) => candidate.id === object.candidateId) ?? candidates[0];
  return {
    selected,
    latencyMs: Math.round(performance.now() - startedAt),
    decision: {
      event: selected.kind,
      candidateId: selected.id,
      candidateText: selected.text,
      delivery: object.delivery,
      urgency: object.urgency,
      speakNow: 1,
      interrupt: object.interrupt ? 1 : 0,
      confidence: object.confidence,
    } satisfies JevDecision,
  };
}

async function narrate(state: VisualState, decision: JevDecision) {
  const startedAt = performance.now();
  const { text } = await generateText({
    model: COMMENTARY_MODEL,
    instructions:
      "あなたは日本語の競馬実況者です。candidateTextで選ばれた事実だけを自然な実況1文にし、別候補へ変更しないでください。馬名・馬番・順位を創作してはいけません。実写のvisibleHorsesまたは画面下位置パネルのfieldTrackerで高信頼に馬番とhorseNameが対応している場合は、原則として馬番ではなく馬名で呼びます。deliveryがbriefなら簡潔に、callなら動きを強調し、climaxなら競り合いを力強く伝えてください。leadSituationが『単独先頭』でない限り『引き離す』『抜け出す』『独走』『突き放す』を使いません。区間名はphaseEvidenceに根拠がある場合だけ述べます。騎手動作は対象馬のriderActionConfidenceが0.9以上の場合だけ触れ、意図を推測しません。『確認』『判別』『映像では』など解析作業を説明する語を避け、出力は45文字以内の1文だけです。",
    prompt: JSON.stringify({ task: "選択済み候補を実況文にする", visualState: state, decision }),
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
    phaseEvidence: "コース映像と馬群の走行状態",
    overallFormation: "先頭から後方まで複数の集団に分かれている",
    sceneFacts: ["複数頭が密集して走行", "カメラは先頭付近を横から追っている"],
    changes: elapsedMs ? ["3番が前の集団との差を詰めた"] : [],
    leadSituation: "一団",
    leadSituationEvidence: "複数頭が密集している",
    uncertainty: "実写側の馬番は判別不能",
    visibleHorseNumbers: [],
    jockeyAction: "追っている可能性",
    jockeyActionConfidence: 0.72,
    jockeyActionEvidence: "上体が低く、腕の前後運動が見える",
    cameraShot: "横",
    cameraTraversal: "同じ集団を追従",
    fieldTracker: {
      detected: true,
      leaderDirection: "右が先頭",
      horses: [
        {
          number: 3,
          horseName: "サンプルホースA",
          trackingStatus: "tracked",
          orderFromFront: 1,
          normalizedProgress: 0.82,
          groupIndex: 1,
          gapToAhead: "接触",
          orderChange: 1,
          movementFromPrevious: "進出",
          confidence: 0.9,
        },
        {
          number: 8,
          horseName: "サンプルホースB",
          trackingStatus: "tracked",
          orderFromFront: 2,
          normalizedProgress: 0.8,
          groupIndex: 1,
          gapToAhead: "小",
          orderChange: -1,
          movementFromPrevious: "後退",
          confidence: 0.86,
        },
      ],
      confidence: 0.88,
      uncertainty: "デモ用の位置表示",
    },
    horseObservations: [],
    visibleHorses: [],
  };
  const commentaryCandidates = buildCommentaryCandidates(state);
  const directCandidate = commentaryCandidates[0];
  const jevCandidate = commentaryCandidates[1] ?? directCandidate;

  return {
    mode: "demo",
    visualState: state,
    commentaryCandidates,
    visionLatencyMs: 920,
    direct: {
      text: "サンプルホースAが先頭へ進出。",
      latencyMs: 710,
      decision: {
        event: directCandidate.kind,
        candidateId: directCandidate.id,
        candidateText: directCandidate.text,
        delivery: "call",
        urgency: 1.2,
        speakNow: 1,
        interrupt: 0.2,
        confidence: 0.78,
      },
    },
    jev: {
      decision: {
        event: jevCandidate.kind,
        candidateId: jevCandidate.id,
        candidateText: jevCandidate.text,
        delivery: "call",
        urgency: 1.3,
        speakNow: 1,
        interrupt: 0.35,
        confidence: 0.76,
      },
      spoken: true,
      decisionLatencyMs: 120,
      narrationLatencyMs: 620,
      text: "サンプルホースAが先頭、サンプルホースBが続きます。",
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
      recentCommentary?: unknown;
      mentionedHorseNumbers?: unknown;
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
    const parsedRecentCommentary = recentCommentarySchema.safeParse(body.recentCommentary);
    const recentCommentary = parsedRecentCommentary.success ? parsedRecentCommentary.data : [];
    const parsedMentionedHorseNumbers = mentionedHorseNumbersSchema.safeParse(body.mentionedHorseNumbers);
    const mentionedHorseNumbers = parsedMentionedHorseNumbers.success
      ? parsedMentionedHorseNumbers.data
      : { direct: [], jev: [] };
    const vision = await extractVisualState(
      match[1],
      previousMatch?.[1] ?? null,
      parsedPrevious.success ? parsedPrevious.data : null,
      parsedBrowserVision.success ? parsedBrowserVision.data : null,
      parsedRaceContext.success ? parsedRaceContext.data : null,
    );
    const commentaryCandidates = buildCommentaryCandidates(vision.state);
    const directHistory = recentCommentary.map((item) => ({
      elapsedMs: item.elapsedMs,
      text: item.directText,
      candidateId: item.directCandidateId,
      candidateText: item.directCandidateText,
    }));
    const jevHistory = recentCommentary.map((item) => ({
      elapsedMs: item.elapsedMs,
      text: item.assistedText,
      candidateId: item.jevCandidateId,
      candidateText: item.jevCandidateText,
    }));
    const [directResult, jevResult] = await Promise.all([
      askBaseline(vision.state, commentaryCandidates, directHistory, mentionedHorseNumbers.direct),
      askJev(vision.state, commentaryCandidates, jevHistory, mentionedHorseNumbers.jev),
    ]);
    const spoken = true;
    const [directNarration, assisted] = await Promise.all([
      narrate(vision.state, directResult.decision),
      narrate(vision.state, jevResult.decision),
    ]);
    const directText = groundNarration(
      directNarration.text,
      vision.state,
      parsedRaceContext.success ? parsedRaceContext.data : null,
    );
    const assistedText = spoken
      ? groundNarration(assisted.text, vision.state, parsedRaceContext.success ? parsedRaceContext.data : null)
      : "";

    return NextResponse.json({
      mode: "live",
      visualState: vision.state,
      commentaryCandidates,
      visionLatencyMs: vision.latencyMs,
      direct: {
        text: directText,
        latencyMs: directResult.latencyMs + directNarration.latencyMs,
        decision: directResult.decision,
      },
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
