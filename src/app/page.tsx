"use client";

import { useEffect, useState } from "react";
import { RACE_FRAMES, type RaceFrame } from "@/lib/race";
import YouTubeTranscriber from "./youtube-transcriber";

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
type Status = {
  aiGateway: boolean;
  commentaryModel: string;
  jevModel: string;
};

const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20key.%20Both%20the%20commentary%20model%20and%20Jev%20run%20through%20AI%20Gateway.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-key";

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
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      comparison: "same-model-without-jev-vs-with-jev",
      commentaryModel: status?.commentaryModel,
      jevModel: status?.jevModel,
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

  const live = Boolean(status?.aiGateway);

  return (
    <main>
      <header>
        <div>
          <h1>Jev Keiba Calling</h1>
          <p>同じ固定LLMを「Jevなし」と「Jevあり」で比較します。すべてVercel AI Gateway経由です。</p>
        </div>
        <div className="header-actions">
          <a className="deploy-link" href={DEPLOY_URL} target="_blank" rel="noreferrer">
            自分のキーでDeploy
          </a>
          <span className={live ? "live" : "demo"}>{live ? "LIVE API" : "DEMO MODE"}</span>
        </div>
      </header>

      <YouTubeTranscriber />

      <section className="settings">
        <dl>
          <div><dt>Gateway</dt><dd>{status?.aiGateway ? "接続済み" : "未設定"}</dd></div>
          <div><dt>固定LLM</dt><dd>{status?.commentaryModel ?? "確認中"}</dd></div>
          <div><dt>Jev</dt><dd>{status?.jevModel ?? "確認中"}</dd></div>
          <div><dt>Fixtures</dt><dd>{RACE_FRAMES.length}</dd></div>
        </dl>
        <div className="actions">
          <button onClick={runBenchmark} disabled={running}>
            {running ? `実行中 ${rows.length}/${RACE_FRAMES.length}` : "Jevあり／なしを比較"}
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
              <th>固定LLM・Jevなし</th>
              <th>Jevの判断</th>
              <th>固定LLM・Jevあり</th>
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
                  同じfixtureと固定LLMで、Jevを挟む効果だけを比較します。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="note">
        生成は <code>{status?.commentaryModel ?? "固定LLM"}</code>、判断は <code>typesafe-ai/jev</code>。
        どちらも同じ <code>AI_GATEWAY_API_KEY</code> を使用します。デモモードの数値は固定値です。
      </p>
    </main>
  );
}
