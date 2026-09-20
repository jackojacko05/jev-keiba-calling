export type CommentaryCandidate = {
  id: string;
  kind: "scene_fact" | "camera_horse" | "field_position" | "rider_move" | "field_change" | "race_context";
  source: "camera" | "field_tracker" | "frame_difference" | "scene";
  text: string;
  confidence: number;
  horseNumbers: number[];
};

type CandidateState = {
  phase: string;
  overallFormation: string;
  sceneFacts: string[];
  changes: string[];
  jockeyAction: string;
  jockeyActionConfidence: number;
  fieldTracker?: {
    detected: boolean;
    horses: Array<{
      number: number;
      horseName: string;
      trackingStatus: "tracked" | "unreadable";
      orderFromFront: number | null;
      gapToAhead: "接触" | "小" | "中" | "大" | "不明";
      movementFromPrevious: "進出" | "後退" | "前との差を詰める" | "前との差が開く" | "位置維持" | "初回" | "不明";
      confidence: number;
    }>;
  };
  horseObservations?: Array<{
    trackId: string;
    number: number | null;
    horseName: string;
    racePosition?: string;
    relativeToNearby?: string;
    movement: string;
    confidence: number;
    riderAction?: string;
    riderActionConfidence?: number;
  }>;
  visibleHorses: Array<{
    number: number;
    horseName: string;
    racePosition?: string;
    relativeToNearby?: string;
    movement: string;
    confidence: number;
    riderAction?: string;
    riderActionConfidence?: number;
  }>;
};

function useful(text: string) {
  return text.trim() && !/^(不明|なし|変化なし|判別不能)$/.test(text.trim());
}

/**
 * Mechanically converts observations into an action space. It intentionally
 * contains no editorial ranking, novelty score, urgency, or coverage hint;
 * those decisions belong to the selector being compared.
 */
export function buildCommentaryCandidates(state: CandidateState): CommentaryCandidate[] {
  const candidates: CommentaryCandidate[] = [];
  const seen = new Set<string>();

  function add(
    kind: CommentaryCandidate["kind"],
    source: CommentaryCandidate["source"],
    text: string,
    confidence: number,
    horseNumbers: number[] = [],
  ) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!useful(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({
      id: `candidate_${candidates.length + 1}`,
      kind,
      source,
      text: normalized,
      confidence: Math.max(0, Math.min(1, confidence)),
      horseNumbers,
    });
  }

  for (const change of state.changes) {
    add("field_change", "frame_difference", change, 0.82);
  }

  for (const horse of state.fieldTracker?.horses ?? []) {
    if (horse.trackingStatus !== "tracked" || horse.orderFromFront === null) continue;
    const label = horse.horseName || `${horse.number}番`;
    add(
      "field_position",
      "field_tracker",
      `${label}は全体の${horse.orderFromFront}番手。前との差は${horse.gapToAhead}。前フレーム比は${horse.movementFromPrevious}`,
      horse.confidence,
      [horse.number],
    );
  }

  const observations = state.horseObservations ?? state.visibleHorses.map((horse) => ({
    ...horse,
    trackId: `number-${horse.number}`,
    number: horse.number as number | null,
  }));
  for (const horse of observations) {
    const label = horse.horseName || (horse.number === null ? horse.trackId : `${horse.number}番`);
    const horseNumbers = horse.number === null ? [] : [horse.number];
    add(
      "camera_horse",
      "camera",
      `${label}はカメラ内で${horse.racePosition ?? "位置不明"}。${horse.relativeToNearby ?? "周辺関係不明"}。${horse.movement}`,
      horse.confidence,
      horseNumbers,
    );
    if (
      (horse.riderActionConfidence ?? 0) >= 0.7 &&
      horse.riderAction &&
      !/通常|判別不能/.test(horse.riderAction)
    ) {
      add(
        "rider_move",
        "camera",
        `${label}の騎手は${horse.riderAction}`,
        horse.riderActionConfidence ?? 0,
        horseNumbers,
      );
    }
  }

  for (const fact of state.sceneFacts) {
    add("scene_fact", "scene", fact, 0.78);
  }
  if (state.jockeyActionConfidence >= 0.8 && !/通常|判別不能/.test(state.jockeyAction)) {
    add("rider_move", "camera", `画面内の騎手は${state.jockeyAction}`, state.jockeyActionConfidence);
  }
  add("race_context", "scene", `${state.phase}。${state.overallFormation}`, 0.72);
  if (candidates.length < 2) {
    add("race_context", "scene", "現在フレームから確実な位置変化は読み取れない", 0.65);
  }

  return candidates.slice(0, 48);
}
