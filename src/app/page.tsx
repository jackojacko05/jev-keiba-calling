"use client";

import { useEffect, useState } from "react";
import { FALLBACK_MODELS, MODEL_OPTIONS, type ModelId } from "@/lib/models";
import { RACE_FRAMES, type RaceFrame } from "@/lib/race";
import YouTubeTranscriber from "./youtube-transcriber";

type Decision = {
  focus: string;
  event: string;
  urgency: number;
  speakNow: number;
  confidence: number;
};

type ModelResult = {
  model: ModelId;
  direct: { text: string; latencyMs: number };
  jev: {
    text: string;
    narrationLatencyMs: number;
    totalLatencyMs: number;
  };
};

type BenchmarkResponse = {
  mode: "demo" | "live";
  decision: Decision;
  decisionLatencyMs: number;
  results: ModelResult[];
};

type Row = ModelResult & {
  mode: "demo" | "live";
  decision: Decision;
  decisionLatencyMs: number;
  frame: RaceFrame;
  runAt: string;
};
type Status = {
  typesafe: boolean;
  aiGateway: boolean;
  defaultModels: [ModelId, ModelId];
};

const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY,TYPESAFE_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20and%20TypeSafe%20API%20keys.%20The%20keys%20stay%20in%20your%20Vercel%20project.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-keys";

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [models, setModels] = useState<[ModelId, ModelId]>([...FALLBACK_MODELS]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/commentary")
      .then((response) => response.json())
      .then((data: Status) => {
        setStatus(data);
        setModels(data.defaultModels);
      })
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
          body: JSON.stringify({ frame, models }),
        });
        const result = (await response.json()) as BenchmarkResponse | { error: string };
        if (!response.ok || "error" in result) {
          throw new Error("error" in result ? result.error : "実行に失敗しました");
        }
        const runAt = new Date().toISOString();
        setRows((current) => [
          ...current,
          ...result.results.map((modelResult) => ({
            ...modelResult,
            mode: result.mode,
            decision: result.decision,
            decisionLatencyMs: result.decisionLatencyMs,
            frame,
            runAt,
          })),
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
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      models,
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
  const duplicateModels = models[0] === models[1];
  const totalRuns = RACE_FRAMES.length * 2;

  function setModel(index: 0 | 1, model: ModelId) {
    setModels((current) => index === 0 ? [model, current[1]] : [current[0], model]);
    setRows([]);
    setError("");
  }

  return (
    <main>
      <header>
        <div>
          <h1>Jev Keiba Calling</h1>
          <p>同一の架空レース状態で「LLM直接実況」と「Jev判断＋同じLLM」を比較します。</p>
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
        <div className="model-controls">
          {([0, 1] as const).map((index) => (
            <label key={index}>
              モデル {index === 0 ? "A" : "B"}
              <select
                value={models[index]}
                onChange={(event) => setModel(index, event.target.value as ModelId)}
                disabled={running}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <dl>
          <div><dt>Jev</dt><dd>{status?.typesafe ? "接続済み" : "未設定"}</dd></div>
          <div><dt>AI Gateway</dt><dd>{status?.aiGateway ? "接続済み" : "未設定"}</dd></div>
          <div><dt>Runs</dt><dd>{RACE_FRAMES.length} fixtures × 2 models</dd></div>
        </dl>
        <div className="actions">
          <button onClick={runBenchmark} disabled={running || duplicateModels}>
            {running ? `実行中 ${rows.length}/${totalRuns}` : "2モデルを同時実行"}
          </button>
          <button className="secondary" onClick={downloadJson} disabled={!rows.length || running}>
            結果JSONを保存
          </button>
        </div>
      </section>

      {duplicateModels && <p className="error">異なるモデルを2つ選択してください。</p>}
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>時刻 / 状態</th>
              <th>モデル</th>
              <th>LLM直接実況</th>
              <th>Jev判断</th>
              <th>Jev経由実況</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.frame.id}-${row.model}`}>
                <td>
                  <strong>{row.frame.elapsedSeconds}秒・{row.frame.phase}</strong>
                  <small>{row.frame.facts.join(" / ")}</small>
                </td>
                <td><code>{row.model}</code></td>
                <td>
                  {row.direct.text}
                  <small>{row.direct.latencyMs} ms</small>
                </td>
                <td>
                  <code>{row.decision.event}</code>
                  <small>
                    focus={row.decision.focus}, confidence={row.decision.confidence.toFixed(3)}<br />
                    shared Jev {row.decisionLatencyMs} ms
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
                <td colSpan={5} className="empty">
                  2モデルを選び、同じJev判断と固定fixtureで並列評価します。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="note">
        各fixtureで2モデルを並列実行し、Jev判断は両モデルで共有します。デモモードの数値は固定値です。実測には <code>AI_GATEWAY_API_KEY</code> と
        <code>TYPESAFE_API_KEY</code> の両方が必要です。
      </p>
    </main>
  );
}
