import type { SourceAnchor } from "./types.ts";

function safePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function stableTurnIdBase(anchor: SourceAnchor): string {
  const assistantId = anchor.assistantMessageId ? safePart(anchor.assistantMessageId) : "";
  if (assistantId) return `turn-aid-${assistantId}`;

  const userId = anchor.userMessageId ? safePart(anchor.userMessageId) : "";
  if (userId) return `turn-uid-${userId}-${safePart(anchor.assistantHash)}`;

  return `turn-hash-${safePart(anchor.userHash)}-${safePart(anchor.assistantHash)}`;
}

export function stableTurnId(anchor: SourceAnchor, seen?: Map<string, number>): string {
  const base = stableTurnIdBase(anchor);
  if (!seen) return base;

  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export function stableTurnIdAssigner(): (anchor: SourceAnchor) => string {
  const seen = new Map<string, number>();
  return (anchor) => stableTurnId(anchor, seen);
}
