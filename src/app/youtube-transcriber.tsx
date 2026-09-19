"use client";

import { useRef, useState } from "react";

type TranscriptResult = {
  mode: "demo" | "live";
  text: string;
  language?: string;
  durationInSeconds?: number | null;
};

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

export default function YouTubeTranscriber() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function loadVideo() {
    const id = getYouTubeVideoId(url);
    if (!id) {
      setError("YouTubeの動画URLを確認してください。");
      return;
    }
    setVideoId(id);
    setTranscript(null);
    setError("");
  }

  async function uploadAudio(blob: Blob) {
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "youtube-tab-audio.webm");
      const response = await fetch("/api/transcribe", { method: "POST", body: formData });
      const result = (await response.json()) as TranscriptResult | { error: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "文字起こしに失敗しました。");
      }
      setTranscript(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文字起こしに失敗しました。");
    } finally {
      setTranscribing(false);
    }
  }

  async function startCapture() {
    if (!videoId || !authorized) return;
    setError("");
    setTranscript(null);
    chunksRef.current = [];

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      displayStreamRef.current = displayStream;
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach((track) => track.stop());
        throw new Error("タブ共有時に「タブの音声も共有」を有効にしてください。");
      }

      const audioStream = new MediaStream(audioTracks);
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(audioStream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        displayStreamRef.current?.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
        void uploadAudio(blob);
      };
      displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
        setRecording(false);
      });
      recorder.start(1000);
      setRecording(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "タブ音声を共有できませんでした。");
      setRecording(false);
    }
  }

  function stopCapture() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  return (
    <section className="youtube-tool">
      <h2>YouTube再生・文字起こし</h2>
      <p className="description">
        URLから公式プレイヤーを埋め込みます。音声はYouTubeから自動取得せず、ブラウザで明示的に共有したタブ音声だけを文字起こしします。
      </p>

      <div className="url-row">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube URL"
        />
        <button onClick={loadVideo}>動画を開く</button>
      </div>

      {videoId && (
        <div className="youtube-workspace">
          <div className="video-wrap">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="transcript-panel">
            <label className="rights-check">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(event) => setAuthorized(event.target.checked)}
              />
              この動画の文字起こしに必要な権利・許諾を確認しました
            </label>
            <ol>
              <li>「録音開始」を押す</li>
              <li>このタブを選び「タブの音声も共有」を有効にする</li>
              <li>動画を再生し、必要な区間で「停止して文字起こし」</li>
            </ol>
            <div className="capture-actions">
              {!recording ? (
                <button onClick={startCapture} disabled={!authorized || transcribing}>
                  {transcribing ? "文字起こし中…" : "録音開始"}
                </button>
              ) : (
                <button className="stop" onClick={stopCapture}>停止して文字起こし</button>
              )}
            </div>
            {transcript && (
              <div className="transcript-result">
                <strong>{transcript.mode === "live" ? "TRANSCRIPT" : "DEMO TRANSCRIPT"}</strong>
                <p>{transcript.text}</p>
                <small>
                  {transcript.language ? `language=${transcript.language}` : ""}
                  {transcript.durationInSeconds ? ` / ${transcript.durationInSeconds}s` : ""}
                </small>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
