export type ApiTaskKind =
  | "summarize"
  | "suggest-links"
  | "translate"
  | "test-connection"
  | "analyze-topics"
  | "expand-answer"
  | "graph-health";
export type ApiTaskStatus = "running" | "success" | "error";

export type ApiTaskLogEntry = {
  id: string;
  kind: ApiTaskKind;
  status: ApiTaskStatus;
  message: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiTaskLogDraft = Omit<ApiTaskLogEntry, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

export type ApiTaskLogExport = {
  version: 1;
  exportedAt: string;
  entries: ApiTaskLogEntry[];
};

export const TASK_LOG_STORAGE_KEY = "turnmap.apiTaskLog";
const MAX_LOG_ENTRIES = 80;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeLogText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._:-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted-key]")
    .replace(/\bkey=[A-Za-z0-9._:-]+/gi, "key=[redacted]")
    .replace(/https?:\/\/([^/\s]+)(?:\/[^\s]*)?/g, "host=$1")
    .replace(/private\s+(user|assistant)\s+text/gi, "[redacted-conversation-text]");
}

function sanitizeLogId(value: string): string {
  return sanitizeLogText(value).replace(/secret[-_\w]*/gi, "redacted");
}

export function sanitizeTaskLogEntry(entry: ApiTaskLogDraft): ApiTaskLogEntry {
  const timestamp = nowIso();
  return {
    id: sanitizeLogId(entry.id).slice(0, 120),
    kind: entry.kind,
    status: entry.status,
    message: sanitizeLogText(entry.message).replace(/\s+/g, " ").trim().slice(0, 200),
    progress: Math.max(0, Math.min(100, Math.round(entry.progress))),
    createdAt: entry.createdAt ?? timestamp,
    updatedAt: entry.updatedAt ?? timestamp
  };
}

export async function loadApiTaskLog(): Promise<ApiTaskLogEntry[]> {
  const result = await chrome.storage.local.get(TASK_LOG_STORAGE_KEY);
  const entries = result[TASK_LOG_STORAGE_KEY];
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is ApiTaskLogEntry => Boolean(entry && typeof entry === "object"))
    .map((entry) => sanitizeTaskLogEntry(entry))
    .slice(0, MAX_LOG_ENTRIES);
}

export async function recordApiTaskLog(entry: ApiTaskLogDraft): Promise<ApiTaskLogEntry[]> {
  const nextEntry = sanitizeTaskLogEntry(entry);
  const current = await loadApiTaskLog();
  const withoutSameId = current.filter((item) => item.id !== nextEntry.id);
  const nextLog = [nextEntry, ...withoutSameId].slice(0, MAX_LOG_ENTRIES);
  await chrome.storage.local.set({ [TASK_LOG_STORAGE_KEY]: nextLog });
  return nextLog;
}

export function buildApiTaskLogExport(entries: ApiTaskLogEntry[]): ApiTaskLogExport {
  return {
    version: 1,
    exportedAt: nowIso(),
    entries: entries.map((entry) => sanitizeTaskLogEntry(entry))
  };
}
