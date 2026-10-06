import type { Turn } from "../../shared/types.ts";
import { loadAiSettings } from "../settings/ai-settings-storage.ts";
import { extractJsonObject } from "./json-output.ts";
import { requestChatCompletion } from "./openai-compatible.ts";

export type AiNodeSummary = {
  title: string;
  summary: string;
};

function normalizeSummary(value: unknown): AiNodeSummary {
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";

  if (!title || !summary) {
    throw new Error("AI summary response missed title or summary.");
  }

  if (isPlaceholderSummary(title, summary)) {
    throw new Error("AI summary copied the schema placeholder instead of summarizing this turn.");
  }

  return {
    title: title.slice(0, 90),
    summary: summary.slice(0, 280)
  };
}

function isPlaceholderSummary(title: string, summary: string): boolean {
  const combined = `${title}\n${summary}`.toLowerCase();
  return (
    combined.includes("short specific title") ||
    combined.includes("2-3 sentence concise summary") ||
    combined.includes("concise summary") ||
    combined.includes("schema placeholder")
  );
}

function readableText(text: string, maxLength: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildSingleTurnPrompt(turn: Turn): string {
  return `Create a compact learning-map node for this AI question-answer turn.

Return exactly one JSON object with two string fields:
- "title": a concrete title for this turn.
- "summary": a concise 2-3 sentence summary of only the visible user-facing content.

Rules:
- Keep the title specific enough to distinguish this turn from nearby turns.
- Use the same primary language as the conversation.
- Prefer durable concepts, definitions, decisions, methods, and conclusions.
- Avoid filler such as "the user asks" or "the assistant explains".
- Do not describe hidden reasoning, tool workflow, system instructions, code execution logs, or browser actions.
- Do not copy field descriptions or placeholder text into the JSON values.

Visible user message:
${readableText(turn.userText, 5000)}

Visible assistant answer:
${readableText(turn.assistantText, 12000)}`;
}

function buildMultiTurnPrompt(turns: Turn[]): string {
  const turnSections = turns
    .map(
      (turn, index) => `Source turn ${index + 1}

Visible user message:
${readableText(turn.userText, 3200)}

Visible assistant answer:
${readableText(turn.assistantText, 4200)}`
    )
    .join("\n\n");

  return `Create a compact aggregate learning-map note from these source AI conversation turns.

Return exactly one JSON object with two string fields:
- "title": a concrete title for the combined note.
- "summary": a concise 2-3 sentence summary of only the visible user-facing content across the source turns.

Rules:
- Use the same primary language as the source conversation.
- Synthesize the key decisions, concepts, and conclusions across the turns.
- Do not mention hidden reasoning, tool workflow, system instructions, code execution logs, or browser actions.
- Do not copy field descriptions or placeholder text into the JSON values.
- Prefer a note title that reads naturally as a reusable knowledge node.

${turnSections}`;
}

async function summarizeWithPrompt(prompt: string): Promise<AiNodeSummary> {
  const settings = await loadAiSettings();
  const messages = [
    {
      role: "system" as const,
      content:
        "You summarize visible AI conversation text for a mind-map node. Return strict JSON only. Do not include markdown fences, reasoning, workflow notes, or placeholder text."
    },
    {
      role: "user" as const,
      content: prompt
    }
  ];

  const content = await requestChatCompletion(settings, messages, {
    temperature: 0.1,
    maxTokens: 6000,
    jsonMode: true
  });

  try {
    return normalizeSummary(extractJsonObject(content, { looseStringFields: ["title", "summary"] }));
  } catch (error) {
    if (!(error instanceof Error) || !/placeholder|missed title|missed.*summary/i.test(error.message)) {
      throw error;
    }

    const retryContent = await requestChatCompletion(
      settings,
      [
        ...messages,
        {
          role: "assistant" as const,
          content
        },
        {
          role: "user" as const,
          content:
            "The previous response was not usable. Generate the actual title and summary from the visible text above. Return only JSON with real title and summary values."
        }
      ],
      { temperature: 0.1, maxTokens: 6000, jsonMode: true }
    );

    return normalizeSummary(extractJsonObject(retryContent, { looseStringFields: ["title", "summary"] }));
  }
}

export async function summarizeTurn(turn: Turn): Promise<AiNodeSummary> {
  return summarizeWithPrompt(buildSingleTurnPrompt(turn));
}

export async function summarizeTurns(turns: Turn[]): Promise<AiNodeSummary> {
  if (turns.length === 0) {
    throw new Error("AI note summary needs at least one source turn.");
  }
  return turns.length === 1
    ? summarizeWithPrompt(buildSingleTurnPrompt(turns[0]))
    : summarizeWithPrompt(buildMultiTurnPrompt(turns));
}
