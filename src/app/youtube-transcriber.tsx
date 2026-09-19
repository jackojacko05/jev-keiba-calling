"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type VisualState = {
  phase: string;
  focus: string;
  event: string;
  facts: string[];
  changeFromPrevious: string;
  shouldSpeak: boolean;
  uncertainty: string;
};

type VideoResult = {
  mode: "demo" | "live";
  visualState: VisualState;
  visionLatencyMs: number;
  direct: { text: string; latencyMs: number };
  jev: {
    decision: {
      event: string;
      urgency: number;
      speakNow: number;
      confidence: number;
    };
    decisionLatencyMs: number;
    narrationLatencyMs: number;
    text: string;
  };
};

type TimelineRow = VideoResult & {
  id: number;
  capturedElapsedMs: number;
  displayDelayMs: number;
  thumbnail: string;
};

type CurrentTabDisplayMediaOptions = DisplayMediaStreamOptions & {
  preferCurrentTab: boolean;
  selfBrowserSurface: "include";
  surfaceSwitching: "include";
};

const SAMPLE_INTERVAL_MS = 8_000;
const MAX_SAMPLES = 6;

function getYouTubeVideoId(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
      return match?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function formatElapsed(ms: number) {
  return `${(ms / 1000).toFixed(1)}秒`;
}

export default function YouTubeTranscriber() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [error, setError] = useState("");
  const [playerSession, setPlayerSession] = useState(0);

  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const sampleCountRef = useRef(0);
  const previousStateRef = useRef<VisualState | null>(null);

  function loadVideo() {
    const id = getYouTubeVideoId(url);
    if (!id) {
      setError("YouTubeの動画URLを確認してください。");
      return;
    }
    setVideoId(id);
    setRows([]);
    setError("");
  }

  function releaseCapture() {
    activeRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    if (captureVideoRef.current) captureVideoRef.current.srcObject = null;
    captureVideoRef.current = null;
    setAnalyzing(false);
  }

  useEffect(() => releaseCapture, []);

  function captureVideoFrame() {
    const captureVideo = captureVideoRef.current;
    const videoWrap = videoWrapRef.current;
    if (!captureVideo || !videoWrap || !captureVideo.videoWidth || !captureVideo.videoHeight) {
      throw new Error("共有映像の準備ができていません。");
    }

    const rect = videoWrap.getBoundingClientRect();
    const scaleX = captureVideo.videoWidth / window.innerWidth;
    const scaleY = captureVideo.videoHeight / window.innerHeight;
    const sourceX = Math.max(0, rect.left * scaleX);
    const sourceY = Math.max(0, rect.top * scaleY);
    const sourceWidth = Math.min(captureVideo.videoWidth - sourceX, rect.width * scaleX);
    const sourceHeight = Math.min(captureVideo.videoHeight - sourceY, rect.height * scaleY);

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error("動画プレイヤーを画面内に表示したまま実行してください。");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = Math.max(1, Math.round((sourceHeight / sourceWidth) * canvas.width));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("映像フレームを取得できませんでした。");
    context.drawImage(
      captureVideo,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  async function analyzeNextFrame() {
    if (!activeRef.current || sampleCountRef.current >= MAX_SAMPLES) {
      releaseCapture();
      return;
    }

    const captureStartedAt = performance.now();
    const capturedElapsedMs = Math.round(captureStartedAt - startedAtRef.current);

    try {
      const image = captureVideoFrame();
      const response = await fetch("/api/video-commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          elapsedMs: capturedElapsedMs,
          previousState: previousStateRef.current,
        }),
      });
      const result = (await response.json()) as VideoResult | { error: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "映像解析に失敗しました。");
      }

      previousStateRef.current = result.visualState;
      sampleCountRef.current += 1;
      setRows((current) => [
        ...current,
        {
          ...result,
          id: sampleCountRef.current,
          capturedElapsedMs,
          displayDelayMs: Math.round(performance.now() - captureStartedAt),
          thumbnail: image,
        },
      ]);

      if (activeRef.current && sampleCountRef.current < MAX_SAMPLES) {
        const processingMs = performance.now() - captureStartedAt;
        timerRef.current = setTimeout(
          () => void analyzeNextFrame(),
          Math.max(0, SAMPLE_INTERVAL_MS - processingMs),
        );
      } else {
        releaseCapture();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "映像解析に失敗しました。");
      releaseCapture();
    }
  }

  async function startVisualAnalysis() {
    if (!videoId || !authorized) return;
    setError("");
    setRows([]);
    previousStateRef.current = null;
    sampleCountRef.current = 0;

    try {
      const displayOptions: CurrentTabDisplayMediaOptions = {
        video: true,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "include",
      };
      const displayStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
      displayStream.getAudioTracks().forEach((track) => track.stop());

      const captureVideo = document.createElement("video");
      captureVideo.muted = true;
      captureVideo.playsInline = true;
      captureVideo.srcObject = displayStream;
      await captureVideo.play();

      displayStreamRef.current = displayStream;
      captureVideoRef.current = captureVideo;
      activeRef.current = true;
      startedAtRef.current = performance.now();
      setAnalyzing(true);
      setPlayerSession((current) => current + 1);

      displayStream.getVideoTracks()[0]?.addEventListener("ended", releaseCapture);
      timerRef.current = setTimeout(() => void analyzeNextFrame(), 2_500);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(
        message.includes("Permission denied") || message.includes("not allowed")
          ? "共有がキャンセルされました。もう一度開始し、このプレビュータブを選んでください。"
          : message || "映像を共有できませんでした。",
      );
      releaseCapture();
    }
  }

  function downloadJson() {
    const payload = {
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      source: "youtube-visual-frames-no-audio",
      videoId,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      results: rows.map(({ thumbnail, ...row }) => {
        void thumbnail;
        return row;
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `jev-video-benchmark-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <section className="youtube-tool">
      <h2>YouTube映像・リアルタイム実況比較</h2>
      <p className="description">
        動画をミュート再生し、8秒ごとに映像フレームだけを解析します。音声は取得も送信もしません。
      </p>

      <div className="url-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube URL"
          disabled={analyzing}
        />
        <button onClick={loadVideo} disabled={analyzing}>動画を開く</button>
      </div>

      {videoId && (
        <>
          <div className="youtube-workspace">
            <div className="video-wrap" ref={videoWrapRef}>
              <iframe
                key={playerSession}
                src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=${analyzing ? "1" : "0"}&mute=1&playsinline=1`}
                title="YouTube video player"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="transcript-panel">
              <label className="rights-check">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(event) => setAuthorized(event.target.checked)}
                  disabled={analyzing}
                />
                この映像のAI解析に必要な権利・許諾を確認しました
              </label>
              <ol>
                <li>「映像解析と再生を同時開始」を押す</li>
                <li>候補の先頭に出るこのプレビュータブを選ぶ</li>
                <li>共有後、動画がミュートで再生・解析される</li>
              </ol>
              <p className="audio-free">音声トラック: <strong>取得しない</strong></p>
              <div className="capture-actions">
                {!analyzing ? (
                  <button onClick={startVisualAnalysis} disabled={!authorized}>
                    映像解析と再生を同時開始
                  </button>
                ) : (
                  <button className="stop" onClick={releaseCapture}>解析を停止</button>
                )}
                <button className="secondary" onClick={downloadJson} disabled={!rows.length || analyzing}>
                  結果JSONを保存
                </button>
              </div>
              <small className="capture-status">
                {analyzing
                  ? `解析中 ${rows.length}/${MAX_SAMPLES}（約8秒間隔）`
                  : rows.length
                    ? `${rows.length}フレームの解析完了`
                    : `最大${MAX_SAMPLES}フレームを解析`}
              </small>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="video-results" aria-live="polite">
              {rows.map((row) => (
                <article className="video-result" key={row.id}>
                  <div className="frame-summary">
                    <Image
                      src={row.thumbnail}
                      alt={`${formatElapsed(row.capturedElapsedMs)}の解析フレーム`}
                      width={768}
                      height={432}
                      unoptimized
                    />
                    <div>
                      <strong>動画 +{formatElapsed(row.capturedElapsedMs)}</strong>
                      <span>表示遅延 {row.displayDelayMs} ms</span>
                      <span>視覚抽出 {row.visionLatencyMs} ms</span>
                    </div>
                  </div>
                  <div>
                    <small>映像から抽出した共通状態</small>
                    <strong>{row.visualState.phase} — {row.visualState.event}</strong>
                    <p>{row.visualState.facts.join(" / ")}</p>
                  </div>
                  <div>
                    <small>固定LLM・Jevなし</small>
                    <p>{row.direct.text}</p>
                    <span>{row.visionLatencyMs + row.direct.latencyMs} ms</span>
                  </div>
                  <div>
                    <small>Jev判断 → 同じ固定LLM</small>
                    <code>{row.jev.decision.event}</code>
                    <p>{row.jev.text}</p>
                    <span>
                      {row.visionLatencyMs + row.jev.decisionLatencyMs + row.jev.narrationLatencyMs} ms
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
