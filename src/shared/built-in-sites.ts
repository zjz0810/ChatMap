export type BuiltInSiteId =
  | "chatgpt"
  | "deepseek"
  | "kimi"
  | "doubao"
  | "qwen"
  | "gemini"
  | "google-ai-studio"
  | "claude"
  | "perplexity"
  | "grok"
  | "glm"
  | "mistral"
  | "arena";

export type ConversationSite = {
  id: string;
  displayName: string;
  hostPatterns: string[];
};

export type BuiltInConversationSite = ConversationSite & {
  id: BuiltInSiteId;
};

export const CHATGPT_SITE: BuiltInConversationSite = {
  id: "chatgpt",
  displayName: "ChatGPT",
  hostPatterns: ["chatgpt.com", "*.chatgpt.com"]
};

export const BUILT_IN_CONVERSATION_SITES: BuiltInConversationSite[] = [
  CHATGPT_SITE,
  { id: "deepseek", displayName: "DeepSeek", hostPatterns: ["chat.deepseek.com"] },
  { id: "kimi", displayName: "Kimi", hostPatterns: ["www.kimi.com", "kimi.com"] },
  { id: "doubao", displayName: "Doubao", hostPatterns: ["doubao.com", "*.doubao.com"] },
  {
    id: "qwen",
    displayName: "Qwen",
    hostPatterns: [
      "chat.qwen.ai",
      "qianwen.com",
      "www.qianwen.com",
      "*.qianwen.com",
      "tongyi.aliyun.com",
      "*.tongyi.aliyun.com",
      "qianwen.aliyun.com",
      "*.qianwen.aliyun.com"
    ]
  },
  { id: "gemini", displayName: "Gemini", hostPatterns: ["gemini.google.com"] },
  {
    id: "google-ai-studio",
    displayName: "Google AI Studio",
    hostPatterns: ["aistudio.google.com", "makersuite.google.com"]
  },
  { id: "claude", displayName: "Claude", hostPatterns: ["claude.ai", "*.claude.ai"] },
  {
    id: "perplexity",
    displayName: "Perplexity",
    hostPatterns: ["perplexity.ai", "*.perplexity.ai"]
  },
  { id: "grok", displayName: "Grok", hostPatterns: ["grok.com", "*.grok.com", "x.com"] },
  {
    id: "glm",
    displayName: "GLM / Z.ai",
    hostPatterns: ["chatglm.cn", "www.chatglm.cn", "chat.z.ai", "z.ai"]
  },
  { id: "mistral", displayName: "Mistral Le Chat", hostPatterns: ["chat.mistral.ai"] },
  {
    id: "arena",
    displayName: "Arena / LMArena",
    hostPatterns: ["arena.ai", "www.arena.ai", "lmarena.ai", "www.lmarena.ai"]
  }
];

export function siteMatchesUrl(site: ConversationSite, url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return site.hostPatterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(2);
      return hostname.endsWith(`.${suffix}`);
    }
    return hostname === normalized;
  });
}

export function contentMatchPattern(hostPattern: string): string {
  return `https://${hostPattern}/*`;
}

export const BUILT_IN_CONTENT_MATCHES = [
  ...new Set(BUILT_IN_CONVERSATION_SITES.flatMap((site) => site.hostPatterns.map(contentMatchPattern)))
];
