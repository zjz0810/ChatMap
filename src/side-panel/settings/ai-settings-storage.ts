export type AiProvider =
  | "openai"
  | "deepseek"
  | "openrouter"
  | "qwen"
  | "kimi"
  | "doubao"
  | "zhipu"
  | "mistral"
  | "gemini-compatible"
  | "custom";

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  autoSummarize: boolean;
};

export type AiProviderMetadata = {
  id: AiProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
  chatPath: string;
  supportsJsonMode: boolean;
  providerNoteKey: string;
  docsUrl: string;
  requiresUserBaseUrl: boolean;
};

const SETTINGS_KEY = "turnmap.aiSettings";
export const DEFAULT_MAX_TOKENS = 4000;
export const MIN_MAX_TOKENS = 256;
export const MAX_MAX_TOKENS = 24000;

export const AI_PROVIDER_METADATA: Record<AiProvider, AiProviderMetadata> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.4-nano",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.openai",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-nano/",
    requiresUserBaseUrl: false
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.deepseek",
    docsUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
    requiresUserBaseUrl: false
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "qwen/qwen3.5-flash-02-23",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.openrouter",
    docsUrl: "https://openrouter.ai/qwen/qwen3.5-flash-02-23/api",
    requiresUserBaseUrl: false
  },
  qwen: {
    id: "qwen",
    label: "Qwen / DashScope",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.5-flash",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.qwen",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/models",
    requiresUserBaseUrl: false
  },
  kimi: {
    id: "kimi",
    label: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.6",
    chatPath: "/chat/completions",
    supportsJsonMode: false,
    providerNoteKey: "ai.providerNote.kimi",
    docsUrl: "https://platform.kimi.ai/",
    requiresUserBaseUrl: false
  },
  doubao: {
    id: "doubao",
    label: "Doubao / Volcano Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-1-6-flash-250828",
    chatPath: "/chat/completions",
    supportsJsonMode: false,
    providerNoteKey: "ai.providerNote.doubao",
    docsUrl: "https://www.volcengine.com/docs/6559/2310290",
    requiresUserBaseUrl: false
  },
  zhipu: {
    id: "zhipu",
    label: "Zhipu / GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.7-flash",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.zhipu",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash",
    requiresUserBaseUrl: false
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-2603",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.mistral",
    docsUrl: "https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03",
    requiresUserBaseUrl: false
  },
  "gemini-compatible": {
    id: "gemini-compatible",
    label: "Gemini compatible",
    baseUrl: "",
    defaultModel: "gemini-2.5-flash-lite",
    chatPath: "/chat/completions",
    supportsJsonMode: false,
    providerNoteKey: "ai.providerNote.geminiCompatible",
    docsUrl: "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/openai",
    requiresUserBaseUrl: true
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: "",
    defaultModel: "",
    chatPath: "/chat/completions",
    supportsJsonMode: true,
    providerNoteKey: "ai.providerNote.custom",
    docsUrl: "docs/ai-provider-guide.md",
    requiresUserBaseUrl: true
  }
};

export const aiProviderOptions: AiProviderMetadata[] = [
  AI_PROVIDER_METADATA.openai,
  AI_PROVIDER_METADATA.deepseek,
  AI_PROVIDER_METADATA.openrouter,
  AI_PROVIDER_METADATA.qwen,
  AI_PROVIDER_METADATA.kimi,
  AI_PROVIDER_METADATA.doubao,
  AI_PROVIDER_METADATA.zhipu,
  AI_PROVIDER_METADATA.mistral,
  AI_PROVIDER_METADATA["gemini-compatible"],
  AI_PROVIDER_METADATA.custom
];

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && value in AI_PROVIDER_METADATA;
}

export function metadataForProvider(provider: AiProvider): AiProviderMetadata {
  return AI_PROVIDER_METADATA[provider];
}

export function defaultsForProvider(provider: AiProvider): AiSettings {
  const metadata = metadataForProvider(provider);
  return {
    provider,
    apiKey: "",
    maxTokens: DEFAULT_MAX_TOKENS,
    autoSummarize: false,
    baseUrl: metadata.baseUrl,
    model: metadata.defaultModel
  };
}

export function normalizeMaxTokens(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value.trim(), 10)
        : DEFAULT_MAX_TOKENS;
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_TOKENS;
  return Math.max(MIN_MAX_TOKENS, Math.min(MAX_MAX_TOKENS, Math.round(parsed)));
}

export async function loadAiSettings(): Promise<AiSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<AiSettings> | undefined;
  const provider = isAiProvider(stored?.provider) ? stored.provider : "openai";

  return {
    ...defaultsForProvider(provider),
    ...stored,
    provider,
    maxTokens: normalizeMaxTokens(stored?.maxTokens)
  };
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...settings,
      maxTokens: normalizeMaxTokens(settings.maxTokens)
    }
  });
}
