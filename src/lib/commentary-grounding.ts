type GroundingState = {
  phase: string;
  cameraShot: string;
  leadSituation?: "単独先頭" | "接戦" | "一団" | "不明";
  visibleHorseNumbers: number[];
  visibleHorses: Array<{
    number: number;
    horseName: string;
    confidence: number;
  }>;
  fieldTracker?: {
    horses: Array<{
      number: number;
      horseName: string;
      trackingStatus: "tracked" | "unreadable";
      confidence: number;
    }>;
  };
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
  const trackerHorses = (state.fieldTracker?.horses ?? []).filter(
    (horse) => horse.trackingStatus === "tracked" && horse.confidence >= 0.78,
  );
  const trackerNumbers = new Set(trackerHorses.map((horse) => horse.number));
  const groundedNames = new Set(
    [
      ...state.visibleHorses
      .filter((horse) => horse.confidence >= minConfidence && visibleNumbers.has(horse.number))
      .map((horse) => horse.horseName),
      ...trackerHorses.map((horse) => horse.horseName),
    ].filter(Boolean),
  );
  let grounded = text;
  for (const horse of state.visibleHorses) {
    if (
      horse.horseName &&
      horse.confidence >= minConfidence &&
      visibleNumbers.has(horse.number)
    ) {
      const safeName = escapeRegExp(horse.horseName);
      grounded = grounded
        .replace(new RegExp(`(?<!\\d)${horse.number}番(?:の)?${safeName}`, "g"), horse.horseName)
        .replace(new RegExp(`(?<!\\d)${horse.number}番`, "g"), horse.horseName);
    }
  }
  for (const horse of trackerHorses) {
    if (!horse.horseName) continue;
    const safeName = escapeRegExp(horse.horseName);
    grounded = grounded
      .replace(new RegExp(`(?<!\\d)${horse.number}番(?:の)?${safeName}`, "g"), horse.horseName)
      .replace(new RegExp(`(?<!\\d)${horse.number}番`, "g"), horse.horseName);
  }
  for (const entrant of raceContext?.entrants ?? []) {
    if (groundedNames.has(entrant.horseName)) continue;
    const safeName = escapeRegExp(entrant.horseName);
    const replacement = visibleNumbers.has(entrant.number) || trackerNumbers.has(entrant.number)
      ? `${entrant.number}番`
      : "馬群の一頭";
    grounded = grounded
      .replace(new RegExp(`(?<!\\d)${entrant.number}番(?:の)?${safeName}`, "g"), replacement)
      .replace(new RegExp(safeName, "g"), replacement);
  }
  if (state.phase !== "スタート") {
    grounded = grounded.replace(/スタートしました[。！]?/g, "馬群が進みます。");
  }
  if (
    state.leadSituation !== "単独先頭" &&
    /引き離|抜け出|独走|突き放|リードを広げ/.test(grounded)
  ) {
    const labels = state.visibleHorses
      .filter((horse) => horse.confidence >= minConfidence && visibleNumbers.has(horse.number))
      .slice(0, 2)
      .map((horse) => horse.horseName || `${horse.number}番`);
    if (state.leadSituation === "接戦" && labels.length >= 2) {
      grounded = `${labels[0]}と${labels[1]}、並んで先頭争い！`;
    } else if (state.leadSituation === "接戦" && labels.length === 1) {
      grounded = `${labels[0]}を中心に、並んで先頭争い！`;
    } else if (state.leadSituation === "一団") {
      grounded = "先頭は一団、馬群が競り合います！";
    } else {
      grounded = "先頭争いが続きます。";
    }
  }
  return grounded.replace(/馬群の一頭、馬群の一頭/g, "馬群の各馬").trim();
}
