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
  visibleHorseNumbers: number[];
  jockeyAction: string;
  jockeyActionConfidence: number;
  jockeyActionEvidence: string;
};

type BrowserVision = {
  horseCount: number;
  personCount: number;
  poseCount: number;
  packDensity: "dense" | "spread" | "unknown";
  motionLevel: "low" | "medium" | "high" | "unknown";
  torsoLeanDegrees: number | null;
  wristMotion: number | null;
  riderMotionHint: "driving_candidate" | "upright_hold_candidate" | "steady" | "unknown";
  confidence: number;
};

type RaceContext = {
  entrants: Array<{ number: number; horseName: string; jockey?: string }>;
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
  browserVision: BrowserVision | null;
};

type Prediction = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
};

type PoseKeypoint = { x: number; y: number; score?: number; name?: string };
type Pose = { keypoints: PoseKeypoint[]; score?: number };
type ObjectDetector = {
  detect: (input: HTMLCanvasElement, maxNumBoxes?: number, minScore?: number) => Promise<Prediction[]>;
};
type PoseDetector = {
  estimatePoses: (
    input: HTMLCanvasElement,
    config?: { maxPoses?: number; flipHorizontal?: boolean },
  ) => Promise<Pose[]>;
};

type CurrentTabDisplayMediaOptions = DisplayMediaStreamOptions & {
  preferCurrentTab: boolean;
  selfBrowserSurface: "include";
  surfaceSwitching: "include";
};

const SAMPLE_INTERVAL_MS = 3_000;
const VISION_INTERVAL_MS = 350;
const MAX_SAMPLES = 10;

const EMPTY_VISION: BrowserVision = {
  horseCount: 0,
  personCount: 0,
  poseCount: 0,
  packDensity: "unknown",
  motionLevel: "unknown",
  torsoLeanDegrees: null,
  wristMotion: null,
  riderMotionHint: "unknown",
  confidence: 0,
};

const SPOILER_MARKERS = [
  /レース結果/,
  /着順/,
  /払戻/,
  /配当/,
  /確定結果/,
  /勝ち馬/,
  /上位(?:3|３)頭/,
];

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

function parseRaceDescription(input: string) {
  const entrants = new Map<number, RaceContext["entrants"][number]>();
  const lines = input.split(/\r?\n/);
  let removedLines = 0;
  let resultSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SPOILER_MARKERS.some((marker) => marker.test(line))) {
      resultSection = true;
      removedLines += 1;
      continue;
    }
    if (resultSection || /(?:^|\s)[１-３1-3]着(?:\s|[:：]|$)/.test(line)) {
      removedLines += 1;
      continue;
    }

    const explicit = line.match(
      /(?:\d{1,2}枠\s*)?(\d{1,2})番(?:馬)?\s*[:：・\-－]?\s*([^\s　/／|｜（(]+)(?:[\s　/／|｜]+(?:騎手\s*[:：]?\s*)?([^\s　/／|｜（(]+))?/,
    );
    if (!explicit) continue;
    const number = Number(explicit[1]);
    const horseName = explicit[2]?.trim();
    const jockey = explicit[3]?.trim();
    if (!number || !horseName || SPOILER_MARKERS.some((marker) => marker.test(horseName))) continue;
    entrants.set(number, { number, horseName, ...(jockey ? { jockey } : {}) });
  }

  return {
    context: { entrants: [...entrants.values()].sort((a, b) => a.number - b.number) },
    removedLines,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function YouTubeTranscriber() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [error, setError] = useState("");
  const [playerSession, setPlayerSession] = useState(0);
  const [description, setDescription] = useState("");
  const [raceContext, setRaceContext] = useState<RaceContext>({ entrants: [] });
  const [removedSpoilerLines, setRemovedSpoilerLines] = useState(0);
  const [visionStatus, setVisionStatus] = useState<"idle" | "loading" | "ready" | "running">("idle");
  const [liveVision, setLiveVision] = useState<BrowserVision>(EMPTY_VISION);
  const [pendingElapsedMs, setPendingElapsedMs] = useState<number | null>(null);

  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const sampleCountRef = useRef(0);
  const previousStateRef = useRef<VisualState | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const poseDetectorRef = useRef<PoseDetector | null>(null);
  const liveVisionRef = useRef<BrowserVision>(EMPTY_VISION);
  const previousHorseCentersRef = useRef<Array<{ x: number; y: number }>>([]);
  const previousPoseVectorRef = useRef<number[] | null>(null);
  const commentaryFeedRef = useRef<HTMLDivElement | null>(null);

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

  function parseDescription() {
    const parsed = parseRaceDescription(description);
    setRaceContext(parsed.context);
    setRemovedSpoilerLines(parsed.removedLines);
    if (!parsed.context.entrants.length) {
      setError("馬番と馬名を抽出できませんでした。「1番 馬名 騎手」の形式も確認してください。");
      return;
    }
    setError("");
  }

  function releaseCapture() {
    activeRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (visionTimerRef.current) clearTimeout(visionTimerRef.current);
    timerRef.current = null;
    visionTimerRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    if (captureVideoRef.current) captureVideoRef.current.srcObject = null;
    captureVideoRef.current = null;
    setAnalyzing(false);
    setPendingElapsedMs(null);
    setVisionStatus(objectDetectorRef.current ? "ready" : "idle");
  }

  useEffect(() => releaseCapture, []);

  useEffect(() => {
    commentaryFeedRef.current?.scrollTo({
      top: commentaryFeedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [rows]);

  async function loadVisionModels() {
    if (objectDetectorRef.current && poseDetectorRef.current) return;
    setVisionStatus("loading");
    await import("@tensorflow/tfjs-backend-webgl");
    const [tf, cocoSsd, moveNet] = await Promise.all([
      import("@tensorflow/tfjs-core"),
      import("@tensorflow-models/coco-ssd"),
      import("@tensorflow-models/pose-detection/dist/movenet/detector"),
    ]);
    await tf.setBackend("webgl");
    await tf.ready();
    objectDetectorRef.current = await cocoSsd.load({ base: "lite_mobilenet_v2" }) as unknown as ObjectDetector;
    poseDetectorRef.current = await moveNet.load({
      modelType: "MultiPose.Lightning",
      enableSmoothing: true,
    }) as unknown as PoseDetector;
    setVisionStatus("ready");
  }

  function captureVideoCanvas(maxWidth = 1280) {
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
    canvas.width = Math.max(1, Math.min(maxWidth, Math.round(sourceWidth)));
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
    return canvas;
  }

  function canvasToJpeg(source: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(896, source.width);
    canvas.height = Math.max(1, Math.round((source.height / source.width) * canvas.width));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  function summarizeVision(
    predictions: Prediction[],
    poses: Pose[],
    width: number,
    height: number,
  ): BrowserVision {
    const horses = predictions.filter((item) => item.class === "horse" && item.score >= 0.35);
    const people = predictions.filter((item) => item.class === "person" && item.score >= 0.35);
    const centers = horses.map(({ bbox }) => ({
      x: (bbox[0] + bbox[2] / 2) / width,
      y: (bbox[1] + bbox[3] / 2) / height,
    }));

    const nearestDistances = centers.map((center, index) => {
      const others = centers.filter((_, otherIndex) => otherIndex !== index);
      return others.length ? Math.min(...others.map((other) => distance(center, other))) : 1;
    });
    const meanNearest = nearestDistances.length
      ? nearestDistances.reduce((sum, value) => sum + value, 0) / nearestDistances.length
      : 1;
    const packDensity = horses.length < 2 ? "unknown" : meanNearest < 0.18 ? "dense" : "spread";

    const previousCenters = previousHorseCentersRef.current;
    const frameMotion = centers.length && previousCenters.length
      ? centers.reduce((sum, center) => sum + Math.min(...previousCenters.map((old) => distance(center, old))), 0) /
        centers.length
      : 0;
    previousHorseCentersRef.current = centers;
    const motionLevel = !centers.length
      ? "unknown"
      : frameMotion > 0.045
        ? "high"
        : frameMotion > 0.015
          ? "medium"
          : "low";

    const poseVectors: number[][] = [];
    const torsoAngles: number[] = [];
    let keypointConfidence = 0;
    for (const pose of poses) {
      const point = (name: string) => pose.keypoints.find((keypoint) => keypoint.name === name);
      const leftShoulder = point("left_shoulder");
      const rightShoulder = point("right_shoulder");
      const leftHip = point("left_hip");
      const rightHip = point("right_hip");
      const leftWrist = point("left_wrist");
      const rightWrist = point("right_wrist");
      const required = [leftShoulder, rightShoulder, leftHip, rightHip, leftWrist, rightWrist];
      if (required.some((item) => !item || (item.score ?? 0) < 0.2)) continue;

      const shoulder = {
        x: ((leftShoulder?.x ?? 0) + (rightShoulder?.x ?? 0)) / 2,
        y: ((leftShoulder?.y ?? 0) + (rightShoulder?.y ?? 0)) / 2,
      };
      const hip = {
        x: ((leftHip?.x ?? 0) + (rightHip?.x ?? 0)) / 2,
        y: ((leftHip?.y ?? 0) + (rightHip?.y ?? 0)) / 2,
      };
      const torsoLength = Math.max(16, distance(shoulder, hip));
      torsoAngles.push(Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI);
      poseVectors.push([
        ((leftWrist?.x ?? 0) - shoulder.x) / torsoLength,
        ((leftWrist?.y ?? 0) - shoulder.y) / torsoLength,
        ((rightWrist?.x ?? 0) - shoulder.x) / torsoLength,
        ((rightWrist?.y ?? 0) - shoulder.y) / torsoLength,
      ]);
      keypointConfidence += required.reduce((sum, item) => sum + (item?.score ?? 0), 0) / required.length;
    }

    const averageVector = poseVectors.length
      ? poseVectors[0].map((_, index) => poseVectors.reduce((sum, vector) => sum + vector[index], 0) / poseVectors.length)
      : null;
    const wristMotion = averageVector && previousPoseVectorRef.current
      ? Math.sqrt(averageVector.reduce((sum, value, index) => {
          const delta = value - (previousPoseVectorRef.current?.[index] ?? value);
          return sum + delta * delta;
        }, 0) / averageVector.length)
      : null;
    previousPoseVectorRef.current = averageVector;
    const torsoLeanDegrees = torsoAngles.length
      ? torsoAngles.reduce((sum, value) => sum + value, 0) / torsoAngles.length
      : null;
    const poseConfidence = poseVectors.length ? keypointConfidence / poseVectors.length : 0;
    const riderMotionHint = poseConfidence < 0.35
      ? "unknown"
      : (wristMotion ?? 0) > 0.18
        ? "driving_candidate"
        : (torsoLeanDegrees ?? 90) < 20 && (wristMotion ?? 1) < 0.08
          ? "upright_hold_candidate"
          : "steady";

    return {
      horseCount: horses.length,
      personCount: people.length,
      poseCount: poseVectors.length,
      packDensity,
      motionLevel,
      torsoLeanDegrees: torsoLeanDegrees === null ? null : Math.round(torsoLeanDegrees * 10) / 10,
      wristMotion: wristMotion === null ? null : Math.round(wristMotion * 1000) / 1000,
      riderMotionHint,
      confidence: Math.round(Math.max(
        horses.length ? horses.reduce((sum, item) => sum + item.score, 0) / horses.length : 0,
        poseConfidence,
      ) * 100) / 100,
    };
  }

  async function runVisionLoop() {
    if (!activeRef.current || !objectDetectorRef.current || !poseDetectorRef.current) return;
    try {
      const canvas = captureVideoCanvas();
      const [predictions, poses] = await Promise.all([
        objectDetectorRef.current.detect(canvas, 24, 0.3),
        poseDetectorRef.current.estimatePoses(canvas, { maxPoses: 8, flipHorizontal: false }),
      ]);
      const observation = summarizeVision(predictions, poses, canvas.width, canvas.height);
      liveVisionRef.current = observation;
      setLiveVision(observation);
    } catch (caught) {
      console.warn("Browser vision frame skipped", caught);
    } finally {
      if (activeRef.current) {
        visionTimerRef.current = setTimeout(() => void runVisionLoop(), VISION_INTERVAL_MS);
      }
    }
  }

  async function analyzeNextFrame() {
    if (!activeRef.current || sampleCountRef.current >= MAX_SAMPLES) {
      releaseCapture();
      return;
    }

    const captureStartedAt = performance.now();
    const capturedElapsedMs = Math.round(captureStartedAt - startedAtRef.current);
    setPendingElapsedMs(capturedElapsedMs);

    try {
      const canvas = captureVideoCanvas();
      const image = canvasToJpeg(canvas);
      const browserVision = liveVisionRef.current;
      const response = await fetch("/api/video-commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          elapsedMs: capturedElapsedMs,
          previousState: previousStateRef.current,
          browserVision,
          raceContext,
        }),
      });
      const result = (await response.json()) as VideoResult | { error: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "映像解析に失敗しました。");
      }

      previousStateRef.current = result.visualState;
      sampleCountRef.current += 1;
      setPendingElapsedMs(null);
      setRows((current) => [
        ...current,
        {
          ...result,
          id: sampleCountRef.current,
          capturedElapsedMs,
          displayDelayMs: Math.round(performance.now() - captureStartedAt),
          thumbnail: image,
          browserVision,
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
    previousHorseCentersRef.current = [];
    previousPoseVectorRef.current = null;
    liveVisionRef.current = EMPTY_VISION;
    setLiveVision(EMPTY_VISION);

    try {
      await loadVisionModels();
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
      setVisionStatus("running");
      setPlayerSession((current) => current + 1);

      displayStream.getVideoTracks()[0]?.addEventListener("ended", releaseCapture);
      visionTimerRef.current = setTimeout(() => void runVisionLoop(), 700);
      timerRef.current = setTimeout(() => void analyzeNextFrame(), 2_000);
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
      schemaVersion: 5,
      exportedAt: new Date().toISOString(),
      source: "youtube-visual-frames-no-audio",
      videoId,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      raceContext,
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
        映像をミュート再生し、ブラウザ内で馬と騎手姿勢を連続検出します。音声は取得も送信もしません。
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
          <div className="race-context-editor">
            <div>
              <strong>出走馬名簿（任意）</strong>
              <p>YouTube概要欄を貼り付けます。結果・着順セクションはモデルへ送る前に除外します。</p>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={'例:\n1番 馬名 騎手名\n2番 馬名 騎手名'}
              disabled={analyzing}
            />
            <button className="secondary" onClick={parseDescription} disabled={!description.trim() || analyzing}>
              名簿だけ抽出
            </button>
            {raceContext.entrants.length > 0 && (
              <div className="entrants" aria-label="抽出した出走馬">
                {raceContext.entrants.map((entrant) => (
                  <span key={entrant.number}>
                    {entrant.number}番 {entrant.horseName}{entrant.jockey ? ` / ${entrant.jockey}` : ""}
                  </span>
                ))}
                <small>{removedSpoilerLines}行の結果候補を除外。馬番が映像で読めた場合だけ馬名を使います。</small>
              </div>
            )}
          </div>

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
                <li>共有後、無音再生とブラウザ内CVが始まる</li>
              </ol>
              <p className="audio-free">音声トラック: <strong>取得しない</strong></p>
              <div className="capture-actions">
                {!analyzing ? (
                  <button onClick={startVisualAnalysis} disabled={!authorized || visionStatus === "loading"}>
                    {visionStatus === "loading" ? "CVモデルを読込中…" : "映像解析と再生を同時開始"}
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
                  ? `連続認識中・実況 ${rows.length}/${MAX_SAMPLES}（約3秒間隔）`
                  : rows.length
                    ? `${rows.length}フレームの解析完了`
                    : `最大${MAX_SAMPLES}フレームを比較`}
              </small>
            </div>
          </div>

          {(analyzing || liveVision.confidence > 0) && (
            <div className="live-vision" aria-live="polite">
              <div><small>Browser CV</small><strong>{analyzing ? "● LIVE" : "停止"}</strong></div>
              <div><small>馬</small><strong>{liveVision.horseCount}頭</strong></div>
              <div><small>人物</small><strong>{liveVision.personCount}人</strong></div>
              <div><small>騎手姿勢</small><strong>{liveVision.poseCount}件</strong></div>
              <div><small>馬群</small><strong>{liveVision.packDensity}</strong></div>
              <div><small>動き</small><strong>{liveVision.motionLevel}</strong></div>
              <div><small>騎手動作候補</small><strong>{liveVision.riderMotionHint}</strong></div>
              <div><small>CV信頼度</small><strong>{Math.round(liveVision.confidence * 100)}%</strong></div>
            </div>
          )}

          {(analyzing || rows.length > 0) && (
            <section className="commentary-console" aria-live="polite">
              <div className="commentary-console-head">
                <div>
                  <small>実況ターゲット</small>
                  <strong>
                    {pendingElapsedMs !== null
                      ? `動画 +${formatElapsed(pendingElapsedMs)}を映像理解・Jev判断・実況生成中`
                      : analyzing
                        ? "次の映像フレームを待機中"
                        : "解析終了"}
                  </strong>
                </div>
                <span className={analyzing ? "recording" : ""}>
                  {analyzing ? "● LIVE" : `${rows.length}件`}
                </span>
              </div>
              <div className="commentary-feed" ref={commentaryFeedRef}>
                {rows.length === 0 ? (
                  <p className="commentary-empty">最初の実況を生成しています…</p>
                ) : rows.map((row) => (
                  <article className="commentary-line" key={`commentary-${row.id}`}>
                    <time>+{formatElapsed(row.capturedElapsedMs)}</time>
                    <div>
                      <small>Jevなし</small>
                      <p>{row.direct.text}</p>
                    </div>
                    <div className="jev-line">
                      <small>Jevあり · {row.jev.decision.event}</small>
                      <p>{row.jev.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {rows.length > 0 && (
            <div className="video-results" aria-live="polite">
              {rows.map((row) => (
                <article className="video-result" key={row.id}>
                  <div className="frame-summary">
                    <Image
                      src={row.thumbnail}
                      alt={`${formatElapsed(row.capturedElapsedMs)}の解析フレーム`}
                      width={896}
                      height={504}
                      unoptimized
                    />
                    <div>
                      <strong>動画 +{formatElapsed(row.capturedElapsedMs)}</strong>
                      <span>表示遅延 {row.displayDelayMs} ms</span>
                      <span>視覚抽出 {row.visionLatencyMs} ms</span>
                      <span>ローカル検出 馬{row.browserVision?.horseCount ?? 0}頭</span>
                    </div>
                  </div>
                  <div>
                    <small>映像から抽出した共通状態</small>
                    <strong>{row.visualState.phase} — {row.visualState.event}</strong>
                    <p>{row.visualState.facts.join(" / ")}</p>
                    <p className="rider-reading">
                      騎手: {row.visualState.jockeyAction}
                      （{Math.round(row.visualState.jockeyActionConfidence * 100)}%）
                    </p>
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
