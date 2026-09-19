export type HorseState = {
  number: number;
  name: string;
  position: number;
  gapLengths: number;
  momentum: "surging" | "gaining" | "steady" | "fading";
};

export type RaceFrame = {
  id: string;
  elapsedSeconds: number;
  remainingMeters: number;
  phase: string;
  horses: HorseState[];
  facts: string[];
};

export const RACE_FRAMES: RaceFrame[] = [
  {
    id: "start",
    elapsedSeconds: 0,
    remainingMeters: 1600,
    phase: "スタート",
    horses: [
      { number: 4, name: "アカツキ", position: 1, gapLengths: 0, momentum: "surging" },
      { number: 7, name: "ブルーリバー", position: 2, gapLengths: 0.5, momentum: "steady" },
      { number: 2, name: "シロガネ", position: 3, gapLengths: 1, momentum: "steady" },
    ],
    facts: ["4番アカツキが好スタート", "7番ブルーリバーが半馬身差で続く"],
  },
  {
    id: "backstretch",
    elapsedSeconds: 28,
    remainingMeters: 850,
    phase: "向正面",
    horses: [
      { number: 4, name: "アカツキ", position: 1, gapLengths: 0, momentum: "steady" },
      { number: 2, name: "シロガネ", position: 2, gapLengths: 0.8, momentum: "gaining" },
      { number: 7, name: "ブルーリバー", position: 3, gapLengths: 1.2, momentum: "fading" },
    ],
    facts: ["2番シロガネが2番手へ浮上", "7番ブルーリバーは3番手に後退"],
  },
  {
    id: "final-turn",
    elapsedSeconds: 51,
    remainingMeters: 300,
    phase: "最終コーナー",
    horses: [
      { number: 4, name: "アカツキ", position: 1, gapLengths: 0, momentum: "fading" },
      { number: 2, name: "シロガネ", position: 2, gapLengths: 0.1, momentum: "surging" },
      { number: 7, name: "ブルーリバー", position: 3, gapLengths: 3, momentum: "fading" },
    ],
    facts: ["2番シロガネが4番アカツキに並びかける", "残り300メートル"],
  },
  {
    id: "overtake",
    elapsedSeconds: 57,
    remainingMeters: 170,
    phase: "直線",
    horses: [
      { number: 2, name: "シロガネ", position: 1, gapLengths: 0, momentum: "surging" },
      { number: 4, name: "アカツキ", position: 2, gapLengths: 0.5, momentum: "fading" },
      { number: 7, name: "ブルーリバー", position: 3, gapLengths: 4, momentum: "fading" },
    ],
    facts: ["2番シロガネが先頭に立つ", "4番アカツキとの差は半馬身"],
  },
  {
    id: "finish",
    elapsedSeconds: 64,
    remainingMeters: 0,
    phase: "ゴール",
    horses: [
      { number: 2, name: "シロガネ", position: 1, gapLengths: 0, momentum: "surging" },
      { number: 4, name: "アカツキ", position: 2, gapLengths: 1.2, momentum: "fading" },
      { number: 7, name: "ブルーリバー", position: 3, gapLengths: 5, momentum: "fading" },
    ],
    facts: ["2番シロガネが1着", "4番アカツキが2着", "着差は1馬身余り"],
  },
];
