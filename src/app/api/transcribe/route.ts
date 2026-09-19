import { gateway } from "@ai-sdk/gateway";
import { transcribe } from "ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: "音声データがありません。" }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "音声データが20MBを超えています。短い区間で試してください。" },
        { status: 413 },
      );
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json({
        mode: "demo",
        text: "これはデモモードの文字起こしです。AI_GATEWAY_API_KEYを設定すると、共有したタブ音声を実際に文字起こしします。",
        language: "ja",
        durationInSeconds: null,
        segments: [],
      });
    }

    const result = await transcribe({
      model: gateway.transcriptionModel(
        process.env.TRANSCRIPTION_MODEL ?? "openai/whisper-1",
      ),
      audio: new Uint8Array(await audio.arrayBuffer()),
    });

    return NextResponse.json({
      mode: "live",
      text: result.text,
      language: result.language,
      durationInSeconds: result.durationInSeconds,
      segments: result.segments,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("Transcription failed", error);
    return NextResponse.json(
      { error: "文字起こしに失敗しました。共有音声の形式とAI Gateway設定を確認してください。" },
      { status: 502 },
    );
  }
}
