export type RaceEntrant = {
  number: number;
  horseName: string;
  jockey?: string;
};

export type RaceContext = {
  entrants: RaceEntrant[];
};

const RESULT_LABELS = /(?:レース結果|着順|払戻|配当|確定結果|勝ち馬|上位(?:3|３)頭)/g;

function cleanName(value: string) {
  return value
    .replace(/^[\s　:：・\-－]+|[\s　:：・\-－]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract only the number/name/jockey mapping. Rank prefixes may be present in
 * pasted race results, but they are counted and discarded before building the
 * context sent to either model.
 */
export function parseRaceDescription(input: string) {
  const entrants = new Map<number, RaceEntrant>();
  const normalized = input.replace(/[\r\n\t]+/g, " ").replace(/　/g, " ").replace(/\s+/g, " ").trim();
  const rankMatches = normalized.match(/(?:^|\s)\d{1,2}着(?=\s)/g) ?? [];
  const labelMatches = normalized.match(RESULT_LABELS) ?? [];

  // Handles JRA-style pasted rows, including a one-line ranked result list:
  // "1着 16番 ウインカーネリアン / 三浦 皇成 2着 13番 ..."
  const delimited = /(?:^|\s)(?:\d{1,2}着\s*)?(\d{1,2})番(?:馬)?\s*[:：・\-－]?\s*([^/／|｜]+?)\s*[/／|｜]\s*(.+?)(?=(?:\s+\d{1,2}着\s+\d{1,2}番)|(?:\s+\d{1,2}番)|$)/g;
  for (const match of normalized.matchAll(delimited)) {
    const number = Number(match[1]);
    const horseName = cleanName(match[2]);
    const jockey = cleanName(match[3]);
    if (number > 0 && horseName) {
      entrants.set(number, { number, horseName, ...(jockey ? { jockey } : {}) });
    }
  }

  // Also support the simpler README format without a slash, one horse per line.
  if (!entrants.size) {
    for (const rawLine of input.split(/\r?\n/)) {
      const line = rawLine.replace(/　/g, " ").trim();
      if (!line) continue;
      const match = line.match(
        /^(?:\d{1,2}着\s*)?(?:\d{1,2}枠\s*)?(\d{1,2})番(?:馬)?\s*[:：・\-－]?\s*([^\s/／|｜]+)(?:\s+(?:騎手\s*[:：]?\s*)?(.+))?$/,
      );
      if (!match) continue;
      const number = Number(match[1]);
      const horseName = cleanName(match[2]);
      const jockey = cleanName(match[3] ?? "");
      if (number > 0 && horseName) {
        entrants.set(number, { number, horseName, ...(jockey ? { jockey } : {}) });
      }
    }
  }

  return {
    context: { entrants: [...entrants.values()].sort((a, b) => a.number - b.number) } satisfies RaceContext,
    removedSpoilerSegments: rankMatches.length + labelMatches.length,
  };
}
