"use client";

import { useEffect, useState } from "react";
import YouTubeTranscriber from "./youtube-transcriber";

type Status = {
  aiGateway: boolean;
  commentaryModel: string;
  jevModel: string;
};

const DEPLOY_URL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling&env=AI_GATEWAY_API_KEY&envDescription=Enter%20your%20own%20Vercel%20AI%20Gateway%20key.%20Both%20the%20commentary%20model%20and%20Jev%20run%20through%20AI%20Gateway.&envLink=https%3A%2F%2Fgithub.com%2Fjackojacko05%2Fjev-keiba-calling%23api-key";

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((data: Status) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  const live = Boolean(status?.aiGateway);

  return (
    <main>
      <header>
        <div>
          <h1>Jev Keiba Calling</h1>
          <p>同じ映像・固定LLMで「Jevなし」と「Jevあり」を比較します。音声は使用しません。</p>
        </div>
        <div className="header-actions">
          <a className="deploy-link" href={DEPLOY_URL} target="_blank" rel="noreferrer">
            自分のキーでDeploy
          </a>
          <span className={live ? "live" : "demo"}>{live ? "LIVE API" : "DEMO MODE"}</span>
        </div>
      </header>

      <section className="settings compact-settings">
        <dl>
          <div><dt>Gateway</dt><dd>{status?.aiGateway ? "接続済み" : "未設定"}</dd></div>
          <div><dt>固定LLM</dt><dd>{status?.commentaryModel ?? "確認中"}</dd></div>
          <div><dt>Jev</dt><dd>{status?.jevModel ?? "確認中"}</dd></div>
          <div><dt>入力</dt><dd>映像フレームのみ</dd></div>
          <div><dt>音声</dt><dd>取得しない</dd></div>
        </dl>
      </section>

      <YouTubeTranscriber />

      <p className="note">
        各フレームは固定LLMで一度だけ視覚状態へ変換し、その共通状態から
        「LLM直接実況」と「<code>typesafe-ai/jev</code>判断＋同じLLM」を生成します。
        表示遅延には映像抽出・Gateway通信・生成処理が含まれます。
      </p>
    </main>
  );
}
