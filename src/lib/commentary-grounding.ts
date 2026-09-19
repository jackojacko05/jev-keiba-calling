type GroundingState = {
  phase: string;
  cameraShot: string;
  visibleHorseNumbers: number[];
  visibleHorses: Array<{
    number: number;
    horseName: string;
    confidence: number;
  }>;
};

type RaceContext = {
  entrants: Array<{
    number: number;
    horseName: string;
  }>;
} | null;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function groundNarration(
  text: string,
  state: GroundingState,
  raceContext: RaceContext,
) {
  const visibleNumbers = new Set(state.visibleHorseNumbers);
  const minConfidence = state.cameraShot === "俯瞰" ? 0.95 : 0.85;
  const groundedNames = new Set(
    state.visibleHorses
      .filter((horse) => horse.confidence >= minConfidence && visibleNumbers.has(horse.number))
      .map((horse) => horse.horseName),
  );
  let grounded = text;
  for (const horse of state.visibleHorses) {
    if (
      horse.horseName &&
      horse.confidence >= minConfidence &&
      visibleNumbers.has(horse.number)
    ) {
      grounded = grounded.replace(
        new RegExp(`(?<!\\d)${horse.number}番(?!${escapeRegExp(horse.horseName)})`, "g"),
        `${horse.number}番${horse.horseName}`,
      );
    }
  }
  for (const entrant of raceContext?.entrants ?? []) {
    if (groundedNames.has(entrant.horseName)) continue;
    const safeName = escapeRegExp(entrant.horseName);
    const replacement = visibleNumbers.has(entrant.number) ? `${entrant.number}番` : "馬群の一頭";
    grounded = grounded
      .replace(new RegExp(`(?<!\\d)${entrant.number}番(?:の)?${safeName}`, "g"), replacement)
      .replace(new RegExp(safeName, "g"), replacement);
  }
  if (state.phase !== "スタート") {
    grounded = grounded.replace(/スタートしました[。！]?/g, "馬群が進みます。");
  }
  return grounded.replace(/馬群の一頭、馬群の一頭/g, "馬群の各馬").trim();
}
