export type CommentaryCandidate = {
  id: string;
  kind: "race_event" | "horse_move" | "rider_move" | "field_change" | "race_context";
  text: string;
  priorityHint: "critical" | "high" | "normal" | "filler";
  confidence: number;
  horseNumbers: number[];
};

type CandidateState = {
  phase: string;
  focus: string;
  event: string;
  facts: string[];
  changeFromPrevious: string;
  visibleHorseNumbers: number[];
  jockeyAction: string;
  jockeyActionConfidence: number;
  horseObservations?: Array<{
    trackId: string;
    number: number | null;
    horseName: string;
    movement: string;
    confidence: number;
    riderAction?: string;
    riderActionConfidence?: number;
  }>;
  visibleHorses: Array<{
    number: number;
    horseName: string;
    movement: string;
    confidence: number;
    riderAction?: string;
    riderActionConfidence?: number;
  }>;
};

function priorityFor(text: string, kind: CommentaryCandidate["kind"]) {
  if (/発走|出遅|落馬|故障|ゴール|写真判定|先頭交代|差し切|並んだ|並ぶ/.test(text)) return "critical" as const;
  if (/接近|追い上|差を詰|抜け出|競り|追って|鞭|進路変更/.test(text)) return "high" as const;
  if (kind === "race_context") return "filler" as const;
  return "normal" as const;
}

function useful(text: string) {
  return text.trim() && !/^(不明|なし|変化なし|判別不能)$/.test(text.trim());
}

export function buildCommentaryCandidates(state: CandidateState): CommentaryCandidate[] {
  const candidates: CommentaryCandidate[] = [];
  const seen = new Set<string>();

  function add(
    kind: CommentaryCandidate["kind"],
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
      text: normalized,
      priorityHint: priorityFor(normalized, kind),
      confidence: Math.max(0, Math.min(1, confidence)),
      horseNumbers,
    });
  }

  add("race_event", state.event, 0.88, state.visibleHorseNumbers);
  for (const fact of state.facts) add("race_event", fact, 0.82, state.visibleHorseNumbers);
  add("field_change", state.changeFromPrevious, 0.86, state.visibleHorseNumbers);

  const observations = state.horseObservations ?? state.visibleHorses.map((horse) => ({
    ...horse,
    trackId: `number-${horse.number}`,
    number: horse.number as number | null,
  }));
  for (const horse of observations) {
    const label = horse.horseName || (horse.number === null ? horse.trackId : `${horse.number}番`);
    const horseNumbers = horse.number === null ? [] : [horse.number];
    add("horse_move", `${label}：${horse.movement}`, horse.confidence, horseNumbers);
    if (
      (horse.riderActionConfidence ?? 0) >= 0.7 &&
      horse.riderAction &&
      !/通常|判別不能/.test(horse.riderAction)
    ) {
      add(
        "rider_move",
        `${label}の騎手：${horse.riderAction}`,
        horse.riderActionConfidence ?? 0,
        horseNumbers,
      );
    }
  }

  if (state.jockeyActionConfidence >= 0.8 && !/通常|判別不能/.test(state.jockeyAction)) {
    add("rider_move", `画面内の騎手：${state.jockeyAction}`, state.jockeyActionConfidence);
  }

  add("race_context", `${state.phase}。${state.focus}`, 0.72, state.visibleHorseNumbers);
  if (candidates.length < 2) add("race_context", "現在の隊列と先頭付近の状況を簡潔に伝える", 0.65);

  return candidates.slice(0, 24);
}
