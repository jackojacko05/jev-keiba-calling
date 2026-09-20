import assert from "node:assert/strict";
import test from "node:test";
import { buildCommentaryCandidates } from "../src/lib/commentary-candidates";

test("every visible horse can contribute a commentary candidate", () => {
  const candidates = buildCommentaryCandidates({
    phase: "直線",
    focus: "先頭争い",
    event: "2頭が並んでいる",
    facts: ["後続も接近している"],
    changeFromPrevious: "13番が16番に並んだ",
    visibleHorseNumbers: [6, 13, 16],
    jockeyAction: "判別不能",
    jockeyActionConfidence: 0.2,
    visibleHorses: [
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
    ],
  });

  for (const name of ["ウインカーネリアン", "ジューンブレア", "ナムラクレア"]) {
    assert.ok(candidates.some((candidate) => candidate.text.includes(name)));
  }
  assert.ok(candidates.some((candidate) => candidate.kind === "rider_move"));
});

test("quiet frames still contain a filler candidate", () => {
  const candidates = buildCommentaryCandidates({
    phase: "向正面",
    focus: "馬群",
    event: "変化なし",
    facts: ["不明"],
    changeFromPrevious: "変化なし",
    visibleHorseNumbers: [],
    jockeyAction: "判別不能",
    jockeyActionConfidence: 0,
    visibleHorses: [],
  });

  assert.ok(candidates.length >= 2);
  assert.ok(candidates.some((candidate) => candidate.priorityHint === "filler"));
});

test("an unnumbered visible horse remains eligible for Jev", () => {
  const candidates = buildCommentaryCandidates({
    phase: "コーナー",
    focus: "馬群",
    event: "馬群がコーナーを進む",
    facts: [],
    changeFromPrevious: "外の馬が接近",
    visibleHorseNumbers: [],
    jockeyAction: "判別不能",
    jockeyActionConfidence: 0,
    horseObservations: [{
      trackId: "右外の栗毛",
      number: null,
      horseName: "",
      movement: "外から前との差を詰める",
      confidence: 0.84,
      riderAction: "追っている可能性",
      riderActionConfidence: 0.88,
    }],
    visibleHorses: [],
  });

  assert.ok(candidates.some((candidate) => candidate.text.includes("右外の栗毛")));
});
