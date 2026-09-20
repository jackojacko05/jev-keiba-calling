import assert from "node:assert/strict";
import test from "node:test";
import { groundNarration } from "../src/lib/commentary-grounding";

test("short horse numbers do not match inside longer numbers", () => {
  const text = groundNarration(
    "外から16番、内から6番が追走。",
    {
      phase: "コーナー",
      cameraShot: "横",
      visibleHorseNumbers: [6, 16],
      visibleHorses: [
        { number: 6, horseName: "ナムラクレア", confidence: 0.9 },
        { number: 16, horseName: "ウインカーネリアン", confidence: 0.9 },
      ],
    },
    {
      entrants: [
        { number: 6, horseName: "ナムラクレア" },
        { number: 16, horseName: "ウインカーネリアン" },
      ],
    },
  );

  assert.equal(text, "外からウインカーネリアン、内からナムラクレアが追走。");
});

test("an ungrounded roster name is removed", () => {
  const text = groundNarration(
    "13番ジューンブレアが先頭。",
    {
      phase: "直線",
      cameraShot: "俯瞰",
      visibleHorseNumbers: [],
      visibleHorses: [],
    },
    { entrants: [{ number: 13, horseName: "ジューンブレア" }] },
  );

  assert.equal(text, "馬群の一頭が先頭。");
});

test("a close lead battle cannot be narrated as pulling away", () => {
  const text = groundNarration(
    "先頭ウインカーネリアンが13番を引き離す！",
    {
      phase: "直線",
      cameraShot: "横",
      leadSituation: "接戦",
      visibleHorseNumbers: [13, 16],
      visibleHorses: [
        { number: 16, horseName: "ウインカーネリアン", confidence: 0.94 },
        { number: 13, horseName: "ジューンブレア", confidence: 0.92 },
      ],
    },
    {
      entrants: [
        { number: 13, horseName: "ジューンブレア" },
        { number: 16, horseName: "ウインカーネリアン" },
      ],
    },
  );

  assert.equal(text, "ウインカーネリアンとジューンブレア、並んで先頭争い！");
});
