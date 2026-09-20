import assert from "node:assert/strict";
import test from "node:test";
import { buildCommentaryCandidates } from "../src/lib/commentary-candidates";

function baseState() {
  return {
    phase: "直線",
    overallFormation: "先頭2頭に後続が接近",
    sceneFacts: ["複数頭が密集して走行"],
    changes: ["外の馬が前との差を詰めた"],
    jockeyAction: "判別不能",
    jockeyActionConfidence: 0.2,
    fieldTracker: {
      detected: true,
      horses: [] as Array<{
        number: number;
        horseName: string;
        trackingStatus: "tracked" | "unreadable";
        orderFromFront: number | null;
        gapToAhead: "接触" | "小" | "中" | "大" | "不明";
        movementFromPrevious: "進出" | "後退" | "前との差を詰める" | "前との差が開く" | "位置維持" | "初回" | "不明";
        confidence: number;
      }>,
    },
    visibleHorses: [] as Array<{
      number: number;
      horseName: string;
      racePosition?: string;
      relativeToNearby?: string;
      movement: string;
      confidence: number;
      riderAction?: string;
      riderActionConfidence?: number;
    }>,
  };
}

test("every camera-visible horse can contribute a commentary candidate", () => {
  const state = baseState();
  state.visibleHorses = [
    {
      number: 16,
      horseName: "ウインカーネリアン",
      movement: "先頭を維持",
      confidence: 0.95,
      riderAction: "追っている可能性",
      riderActionConfidence: 0.93,
    },
    {
      number: 13,
      horseName: "ジューンブレア",
      movement: "16番に並ぶ",
      confidence: 0.94,
      riderAction: "追っている可能性",
      riderActionConfidence: 0.91,
    },
    {
      number: 6,
      horseName: "ナムラクレア",
      movement: "後ろから差を詰める",
      confidence: 0.9,
      riderAction: "通常の騎乗",
      riderActionConfidence: 0.8,
    },
  ];

  const candidates = buildCommentaryCandidates(state);
  for (const name of ["ウインカーネリアン", "ジューンブレア", "ナムラクレア"]) {
    assert.ok(candidates.some((candidate) => candidate.text.includes(name)));
  }
  assert.ok(candidates.some((candidate) => candidate.kind === "rider_move"));
});

test("every readable full-field tracker horse gets a neutral position candidate", () => {
  const state = baseState();
  state.fieldTracker.horses = [
    {
      number: 3,
      horseName: "アルファ",
      trackingStatus: "tracked",
      orderFromFront: 1,
      gapToAhead: "接触",
      movementFromPrevious: "進出",
      confidence: 0.91,
    },
    {
      number: 8,
      horseName: "ベータ",
      trackingStatus: "tracked",
      orderFromFront: 7,
      gapToAhead: "中",
      movementFromPrevious: "前との差を詰める",
      confidence: 0.82,
    },
    {
      number: 12,
      horseName: "ガンマ",
      trackingStatus: "unreadable",
      orderFromFront: null,
      gapToAhead: "不明",
      movementFromPrevious: "不明",
      confidence: 0,
    },
  ];

  const candidates = buildCommentaryCandidates(state);
  assert.ok(candidates.some((candidate) => candidate.text.includes("アルファは全体の1番手")));
  assert.ok(candidates.some((candidate) => candidate.text.includes("ベータは全体の7番手")));
  assert.equal(candidates.some((candidate) => candidate.text.includes("ガンマは全体")), false);
});

test("candidate generation contains no hidden editorial ranking", () => {
  const candidates = buildCommentaryCandidates(baseState());
  assert.ok(candidates.length >= 2);
  for (const candidate of candidates) {
    assert.equal("priorityHint" in candidate, false);
    assert.equal("novelty" in candidate, false);
    assert.equal("introducesHorse" in candidate, false);
  }
});

test("an unnumbered camera horse remains eligible for Jev", () => {
  const state = {
    ...baseState(),
    horseObservations: [{
      trackId: "右外の栗毛",
      number: null,
      horseName: "",
      movement: "外から前との差を詰める",
      confidence: 0.84,
      riderAction: "追っている可能性",
      riderActionConfidence: 0.88,
    }],
  };

  const candidates = buildCommentaryCandidates(state);
  assert.ok(candidates.some((candidate) => candidate.text.includes("右外の栗毛")));
});
