import type { ExtractedTurnsMessage } from "../shared/types";
import type { ApiTaskLogEntry } from "./task-log";

type DebugReportInput = {
  conversationTitle: string;
  conversationId: string;
  lastMessage: ExtractedTurnsMessage | null;
  mode: "side-panel" | "full-page";
  sourceTabId?: number;
  status: string;
  userAgent: string;
  extensionVersion?: string;
  generatedAt?: string;
  taskLog?: ApiTaskLogEntry[];
};

function redactConversationId(id: string): string {
  if (!id) return "unknown";
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-6)}`;
}

export function buildDebugReport(input: DebugReportInput): string {
  const meta = input.lastMessage?.harvestMeta;
  const diagnostics = meta?.diagnostics;
  const lines = [
    "# ChatMap Debug Report",
    "",
    `Generated: ${input.generatedAt ?? new Date().toISOString()}`,
    `Version: ${input.extensionVersion ?? "unknown"}`,
    `Mode: ${input.mode}`,
    `Status: ${input.status || "n/a"}`,
    `Source tab: ${input.sourceTabId ?? "active/current"}`,
    "",
    "## Conversation",
    "",
    `Site: ${input.lastMessage?.site?.displayName ?? "unknown"}`,
    `Title: ${input.conversationTitle || "unknown"}`,
    `ID: ${redactConversationId(input.conversationId)}`,
    `Turns: ${input.lastMessage?.turns.length ?? 0}`,
    "",
    "## Extraction",
    "",
    `Source: ${meta?.source ?? "unknown"}`,
    `Attempted non-DOM source: ${meta?.attempted ?? "unknown"}`,
    "Index behavior: non-scrolling identity-first refresh",
    `Selector blocks: ${diagnostics?.selectorBlocks ?? "n/a"}`,
    `Selector turns: ${diagnostics?.selectorTurns ?? "n/a"}`,
    `Fallback selector candidates: ${diagnostics?.fallbackSelectorCandidates ?? "n/a"}`,
    `Fallback text candidates: ${diagnostics?.fallbackTextCandidates ?? "n/a"}`,
    `Fallback blocks: ${diagnostics?.fallbackBlocks ?? "n/a"}`,
    `Fallback turns: ${diagnostics?.fallbackTurns ?? "n/a"}`,
    "",
    "## Browser",
    "",
    input.userAgent,
    "",
    "## Recent API Tasks",
    "",
    ...(input.taskLog?.length
      ? input.taskLog.slice(0, 20).map((entry) =>
          `- ${entry.updatedAt} [${entry.status}] ${entry.kind} ${entry.progress}%: ${entry.message}`
        )
      : ["No API task log entries recorded."]),
    "",
    "## Privacy",
    "",
    "This report excludes conversation text, node summaries, API keys, and custom provider URLs."
  ];

  return `${lines.join("\n")}\n`;
}
