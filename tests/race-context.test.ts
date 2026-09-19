import assert from "node:assert/strict";
import test from "node:test";
import { parseRaceDescription } from "../src/lib/race-context";

const rankedRoster = "1着 16番 ウインカーネリアン / 三浦 皇成 2着 13番 ジューンブレア / 武 豊 3着 6番 ナムラクレア / C.ルメール 4着 7番 サトノレーヴ / J.モレイラ 5着 2番 ヨシノイースター / 内田 博幸 6着 3番 ダノンマッキンリー / 横山 典弘 6着 4番 ママコチャ / 岩田 望来 8着 1番 ピューロマジック / 松山 弘平 9着 5番 カンチェンジュンガ / 坂井 瑠星 10着 11番 トウシンマカオ / 横山 武史 11着 10番 ラッキースワイネス / K.リョン 12着 15番 ルガル / 川田 将雅 13着 8番 ペアポルックス / 松若 風馬 14着 9番 ドロップオブライト / 丹内 祐次 15着 12番 ヤマニンアルリフラ / 団野 大成 16着 14番 カピリナ / 戸崎 圭太";

test("ranked result text becomes a spoiler-free roster", () => {
  const result = parseRaceDescription(rankedRoster);
  assert.equal(result.context.entrants.length, 16);
  assert.deepEqual(result.context.entrants[15], {
    number: 16,
    horseName: "ウインカーネリアン",
    jockey: "三浦 皇成",
  });
  assert.equal(result.removedSpoilerSegments, 16);
  assert.doesNotMatch(JSON.stringify(result.context), /(?:着|rank|順位)/i);
});

test("plain number, horse and jockey lines remain supported", () => {
  const result = parseRaceDescription("1番 ピューロマジック 松山 弘平\n2番 ヨシノイースター 内田 博幸");
  assert.deepEqual(result.context.entrants, [
    { number: 1, horseName: "ピューロマジック", jockey: "松山 弘平" },
    { number: 2, horseName: "ヨシノイースター", jockey: "内田 博幸" },
  ]);
});
