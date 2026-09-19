export const MODEL_OPTIONS = [
  { id: "openai/gpt-5-mini", label: "OpenAI · GPT-5 Mini" },
  { id: "openai/gpt-5.4", label: "OpenAI · GPT-5.4" },
  { id: "anthropic/claude-haiku-4.5", label: "Anthropic · Claude Haiku 4.5" },
  { id: "anthropic/claude-sonnet-4.6", label: "Anthropic · Claude Sonnet 4.6" },
  { id: "google/gemini-3-flash", label: "Google · Gemini 3 Flash" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export const FALLBACK_MODELS: readonly [ModelId, ModelId] = [
  "openai/gpt-5-mini",
  "anthropic/claude-haiku-4.5",
];

export function isSupportedModel(value: unknown): value is ModelId {
  return typeof value === "string" && MODEL_OPTIONS.some((option) => option.id === value);
}

export function getDefaultModels(): [ModelId, ModelId] {
  const first = process.env.MODEL_A ?? process.env.COMMENTARY_MODEL;
  const second = process.env.MODEL_B;
  return [
    isSupportedModel(first) ? first : FALLBACK_MODELS[0],
    isSupportedModel(second) ? second : FALLBACK_MODELS[1],
  ];
}
