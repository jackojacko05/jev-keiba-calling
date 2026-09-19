import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    aiGateway: Boolean(process.env.AI_GATEWAY_API_KEY),
    commentaryModel: process.env.COMMENTARY_MODEL ?? "openai/gpt-4.1-mini",
    jevModel: "typesafe-ai/jev",
    inputModality: "image",
    audioEnabled: false,
  });
}
