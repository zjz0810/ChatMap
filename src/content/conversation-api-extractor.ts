import type { FetchConversationApiResult, Turn } from "../shared/types";
import { getBestTurnsFromRoots } from "./structured-extractor.ts";

export type ConversationApiExtractionResult = {
  turns: Turn[];
  source: "conversation-api";
};

type ApiAttempt = {
  root?: unknown;
  status?: number;
};

const NOT_FOUND_COOLDOWN_MS = 30 * 60 * 1000;
const AUTH_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const TRANSIENT_FAILURE_COOLDOWN_MS = 20 * 1000;
const EMPTY_SCHEMA_COOLDOWN_MS = 30 * 1000;

const nextAttemptByConversation = new Map<string, number>();
const inFlightByConversation = new Map<string, Promise<ConversationApiExtractionResult | null>>();

export function getChatGptConversationIdFromUrl(href = window.location.href): string | null {
  let pathname = href;
  try {
    pathname = new URL(href, window.location.origin).pathname;
  } catch {
    // The path-only value remains usable for tests and unusual embedded documents.
  }

  // ChatGPT conversation routes include /c/:id and custom GPT routes /g/:gptId/c/:id.
  // Keep /chat/:id for older URLs while deliberately excluding shared /share/:id links.
  const match = pathname.match(/\/(?:g\/[^/]+\/)?c\/([^/?#]+)(?:\/|$)|\/chat\/([^/?#]+)(?:\/|$)/);
  const encodedId = match?.[1] ?? match?.[2];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}

function rememberFailure(conversationId: string, status?: number, emptySchema = false): void {
  const cooldown = emptySchema
    ? EMPTY_SCHEMA_COOLDOWN_MS
    : status === 404
      ? NOT_FOUND_COOLDOWN_MS
      : status === 401 || status === 403
        ? AUTH_FAILURE_COOLDOWN_MS
        : TRANSIENT_FAILURE_COOLDOWN_MS;
  nextAttemptByConversation.set(conversationId, Date.now() + cooldown);
}

async function fetchFromContentScript(conversationId: string): Promise<ApiAttempt | null> {
  try {
    const response = await fetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
      credentials: "include",
      headers: { accept: "application/json" }
    });
    if (!response.ok) return { status: response.status };
    return { status: response.status, root: await response.json() };
  } catch {
    return null;
  }
}

async function fetchFromBackground(conversationId: string): Promise<ApiAttempt | null> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "TURNMAP_FETCH_CONVERSATION_API",
      conversationId
    })) as FetchConversationApiResult;
    return response.ok ? { status: response.status, root: response.root } : { status: response.status };
  } catch {
    return null;
  }
}

async function requestConversationApiTurns(conversationId: string): Promise<ConversationApiExtractionResult | null> {
  const background = await fetchFromBackground(conversationId);
  if (background?.status === 404) {
    rememberFailure(conversationId, 404);
    return null;
  }

  let attempt = background?.root !== undefined ? background : null;
  if (!attempt) {
    attempt = await fetchFromContentScript(conversationId);
    if (attempt?.status === 404) {
      rememberFailure(conversationId, 404);
      return null;
    }
  }

  if (!attempt?.root) {
    rememberFailure(conversationId, attempt?.status);
    return null;
  }

  let turns: Turn[] = [];
  try {
    turns = getBestTurnsFromRoots([attempt.root]);
  } catch {
    // An unexpected response shape is treated like an empty API result and falls through to DOM.
  }
  if (turns.length === 0) {
    rememberFailure(conversationId, attempt.status, true);
    return null;
  }

  nextAttemptByConversation.delete(conversationId);
  return { turns, source: "conversation-api" };
}

export async function extractConversationApiTurns(): Promise<ConversationApiExtractionResult | null> {
  const conversationId = getChatGptConversationIdFromUrl();
  if (!conversationId) return null;
  if ((nextAttemptByConversation.get(conversationId) ?? 0) > Date.now()) return null;

  const current = inFlightByConversation.get(conversationId);
  if (current) return current;

  const pending = requestConversationApiTurns(conversationId).finally(() => {
    inFlightByConversation.delete(conversationId);
  });
  inFlightByConversation.set(conversationId, pending);
  return pending;
}
