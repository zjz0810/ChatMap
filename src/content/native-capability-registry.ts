import type { NativeConversationCapabilities } from "../shared/types.ts";

export type BuiltInNativeCapabilityRecord = NativeConversationCapabilities & {
  siteId: string;
  qaStatus: "verified" | "smoke-verified" | "blocked-auth" | "blocked-access" | "not-run";
  verifiedAt?: string;
  realBrowserEvidence: string[];
};

const MOUNTED_DOM_LIMITATIONS = [
  "The index contains only turns currently mounted by the site.",
  "An unmounted target fails explicitly instead of triggering a scroll or text-search fallback."
];

function mountedDomRecord(
  siteId: string,
  qaStatus: BuiltInNativeCapabilityRecord["qaStatus"],
  report: string,
  additionalLimitations: string[] = []
): BuiltInNativeCapabilityRecord {
  return {
    siteId,
    qaStatus,
    userIndex: "mounted-dom",
    targetIdentity: "mounted-dom",
    directJump: "mounted-only",
    shellRevive: "unavailable",
    assistantText: "best-effort",
    limitations: [...MOUNTED_DOM_LIMITATIONS, ...additionalLimitations],
    realBrowserEvidence: [report]
  };
}

export const BUILT_IN_NATIVE_CAPABILITY_RECORDS: BuiltInNativeCapabilityRecord[] = [
  {
    siteId: "chatgpt",
    qaStatus: "verified",
    verifiedAt: "2026-07-11",
    userIndex: "verified-native",
    targetIdentity: "verified-native",
    directJump: "verified-native",
    shellRevive: "bounded-native",
    assistantText: "best-effort",
    limitations: ["Assistant text can remain partial when the page does not expose it cheaply."],
    realBrowserEvidence: ["docs/qa/native-navigation/chatgpt-reference-2026-07-11.md"]
  },
  mountedDomRecord("deepseek", "blocked-auth", "docs/qa/native-navigation/deepseek-2026-07-12.md"),
  mountedDomRecord("kimi", "blocked-auth", "docs/qa/native-navigation/kimi-2026-07-12.md"),
  mountedDomRecord("doubao", "blocked-auth", "docs/qa/native-navigation/doubao-2026-07-12.md"),
  mountedDomRecord("qwen", "smoke-verified", "docs/qa/native-navigation/qwen-2026-07-12.md", [
    "Two repeated mounted turns passed an anonymous browser smoke test; an evidence-gated structured index is implemented, but off-screen direct remount remains unverified."
  ]),
  mountedDomRecord("gemini", "smoke-verified", "docs/qa/native-navigation/gemini-2026-07-12.md", [
    "Two repeated mounted turns passed an anonymous browser smoke test; off-screen native indexing remains unverified."
  ]),
  mountedDomRecord("google-ai-studio", "blocked-auth", "docs/qa/native-navigation/google-ai-studio-2026-07-12.md"),
  mountedDomRecord("claude", "blocked-access", "docs/qa/native-navigation/claude-2026-07-12.md"),
  mountedDomRecord("perplexity", "blocked-access", "docs/qa/native-navigation/perplexity-2026-07-12.md"),
  mountedDomRecord("grok", "blocked-auth", "docs/qa/native-navigation/grok-2026-07-12.md"),
  mountedDomRecord("glm", "smoke-verified", "docs/qa/native-navigation/glm-2026-07-12.md", [
    "One mounted turn passed an anonymous browser smoke test; repeated and off-screen native indexing remain unverified.",
    "ChatGLM inspection was blocked by slider verification before the application shell, so it remains mounted-DOM only.",
    "Z.ai exposed stable message UUIDs and chat.history.messages, but slider verification blocked completed streaming and long/off-screen acceptance; its structured index remains evidence-gated."
  ]),
  mountedDomRecord("mistral", "blocked-access", "docs/qa/native-navigation/mistral-2026-07-12.md"),
  mountedDomRecord("arena", "blocked-access", "docs/qa/native-navigation/arena-2026-07-12.md")
];

export function capabilityRecordForBuiltInSite(siteId: string): BuiltInNativeCapabilityRecord {
  const record = BUILT_IN_NATIVE_CAPABILITY_RECORDS.find((candidate) => candidate.siteId === siteId);
  if (!record) throw new Error(`Unknown built-in native capability site: ${siteId}`);
  return record;
}

export function capabilitiesForBuiltInSite(siteId: string): NativeConversationCapabilities {
  const record = capabilityRecordForBuiltInSite(siteId);
  return {
    userIndex: record.userIndex,
    targetIdentity: record.targetIdentity,
    directJump: record.directJump,
    shellRevive: record.shellRevive,
    assistantText: record.assistantText,
    limitations: [...record.limitations]
  };
}
