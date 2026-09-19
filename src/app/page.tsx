"use client";

import { useEffect, useState } from "react";
import { RACE_FRAMES, type RaceFrame } from "@/lib/race";

type Result = {
  mode: "demo" | "live";
  direct: { text: string; latencyMs: number };
  jev: {
    text: string;
    decisionLatencyMs: number;
    narrationLatencyMs: number;
    totalLatencyMs: number;
    decision: {
      focus: string;
      event: string;
      urgency: number;
      speakNow: number;
      confidence: number;
    };
  };
};

type Row = Result & { frame: RaceFrame; runAt: string };
type Status = { typesafe: boolean; aiGateway: boolean; model: string };

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/commentary")
      .then((response) => response.json())
      .then((data: Status) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  async function runBenchmark() {
    setRunning(true);
    setRows([]);
    setError("");

    try {
      for (const frame of RACE_FRAMES) {
        const response = await fetch("/api/commentary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame }),
        });
        const result = (await response.json()) as Result | { error: string };
        if (!response.ok || "error" in result) {
          throw new Error("error" in result ? result.error : "実行に失敗しました");
        }
        setRows((current) => [
          ...current,
          { ...result, frame, runAt: new Date().toISOString() },
        ]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "実行に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  function downloadJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      model: status?.model,
      results: rows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jev-keiba-benchmark-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const live = Boolean(status?.typesafe && status?.aiGateway);

  return (
    <main>
      <header>
        <div>
          <h1>Jev Keiba Calling</h1>
          <p>同一の架空レース状態で「LLM直接実況」と「Jev判断＋同じLLM」を比較します。</p>
        </div>
        <span className={live ? "live" : "demo"}>{live ? "LIVE API" : "DEMO MODE"}</span>
      </header>

      <section className="settings">
        <dl>
          <div><dt>Jev</dt><dd>{status?.typesafe ? "接続済み" : "未設定"}</dd></div>
          <div><dt>AI Gateway</dt><dd>{status?.aiGateway ? "接続済み" : "未設定"}</dd></div>
          <div><dt>Model</dt><dd>{status?.model ?? "確認中"}</dd></div>
          <div><dt>Fixtures</dt><dd>{RACE_FRAMES.length}</dd></div>
        </dl>
        <div className="actions">
          <button onClick={runBenchmark} disabled={running}>
            {running ? `実行中 ${rows.length}/${RACE_FRAMES.length}` : "ベンチマーク実行"}
          </button>
          <button className="secondary" onClick={downloadJson} disabled={!rows.length || running}>
            結果JSONを保存
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>時刻 / 状態</th>
              <th>LLM直接実況</th>
              <th>Jev判断</th>
              <th>Jev経由実況</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.frame.id}>
                <td>
                  <strong>{row.frame.elapsedSeconds}秒・{row.frame.phase}</strong>
                  <small>{row.frame.facts.join(" / ")}</small>
                </td>
                <td>
                  {row.direct.text}
                  <small>{row.direct.latencyMs} ms</small>
                </td>
                <td>
                  <code>{row.jev.decision.event}</code>
                  <small>
                    focus={row.jev.decision.focus}, confidence={row.jev.decision.confidence.toFixed(3)}<br />
                    Jev {row.jev.decisionLatencyMs} ms
                  </small>
                </td>
                <td>
                  {row.jev.text}
                  <small>LLM {row.jev.narrationLatencyMs} ms / total {row.jev.totalLatencyMs} ms</small>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="empty">
                  「ベンチマーク実行」を押すと、固定fixtureを順番に評価します。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="note">
        デモモードの数値は固定値です。実測には <code>AI_GATEWAY_API_KEY</code> と
        <code>TYPESAFE_API_KEY</code> の両方が必要です。
      </p>
    </main>
  );
}
