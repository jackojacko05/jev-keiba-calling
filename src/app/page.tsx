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
          <p>同じ映像・固定LLMで「Jevなし」と「Jevあり」を比較します。音声はAI認識に使用しません。</p>
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
          <div><dt>入力</dt><dd>映像＋ブラウザCV</dd></div>
          <div><dt>音声</dt><dd>再生のみ・AI入力なし</dd></div>
        </dl>
      </section>

      <YouTubeTranscriber />

      <p className="note">
        ブラウザ内CVを連続実行し、定期フレームは固定LLMで一度だけ全頭位置と実写状態へ変換します。
        同じ候補群から「固定LLM選択」と「<code>typesafe-ai/jev</code>選択」を比較し、同じ固定LLMで実況文にします。
        表示遅延には映像抽出・Gateway通信・生成処理が含まれます。
      </p>
    </main>
  );
}
