import type { SourceAnchor, Turn } from "../../shared/types.ts";

type AnchorCarrier = {
  turn?: Turn;
  sourceAnchors?: SourceAnchor[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizedAttachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase()).filter(Boolean))].sort();
}

export function normalizeNodeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}

export function normalizeNodeTags(tags: string[] | undefined): string[] | undefined {
  const normalized = [...new Set((tags ?? []).map((tag) => normalizeNodeTag(tag)).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

export function hasAiTag(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => normalizeNodeTag(tag).toLowerCase() === "ai");
}

export function isSourceAnchor(value: unknown): value is SourceAnchor {
  return (
    isRecord(value) &&
    typeof value.turnIndex === "number" &&
    typeof value.userHash === "string" &&
    typeof value.assistantHash === "string" &&
    typeof value.userPreview === "string" &&
    typeof value.assistantPreview === "string"
  );
}

function cloneAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    turnIndex: anchor.turnIndex,
    userHash: anchor.userHash,
    assistantHash: anchor.assistantHash,
    userPreview: anchor.userPreview,
    assistantPreview: anchor.assistantPreview,
    ...(anchor.userMessageId ? { userMessageId: anchor.userMessageId } : {}),
    ...(anchor.assistantMessageId ? { assistantMessageId: anchor.assistantMessageId } : {}),
    ...(anchor.userAttachmentNames?.length ? { userAttachmentNames: [...anchor.userAttachmentNames] } : {})
  };
}

function attachmentsMatch(left: SourceAnchor, right: SourceAnchor): boolean {
  const leftNames = normalizedAttachmentNames(left.userAttachmentNames);
  const rightNames = normalizedAttachmentNames(right.userAttachmentNames);
  if (leftNames.length === 0 || rightNames.length === 0) return true;
  return leftNames.every((name) => rightNames.includes(name)) || rightNames.every((name) => leftNames.includes(name));
}

function messageIdsCompatible(left: SourceAnchor, right: SourceAnchor): boolean {
  const userIdsAgree =
    !left.userMessageId || !right.userMessageId || left.userMessageId === right.userMessageId;
  const assistantIdsAgree =
    !left.assistantMessageId || !right.assistantMessageId || left.assistantMessageId === right.assistantMessageId;
  return userIdsAgree && assistantIdsAgree;
}

function hashesMatch(left: SourceAnchor, right: SourceAnchor): boolean {
  return left.userHash === right.userHash && left.assistantHash === right.assistantHash;
}

function hasAnyMessageId(anchor: SourceAnchor): boolean {
  return Boolean(anchor.userMessageId || anchor.assistantMessageId);
}

function previewTextLength(anchor: SourceAnchor): number {
  return anchor.userPreview.length + anchor.assistantPreview.length;
}

function preferRicherAnchor(current: SourceAnchor, candidate: SourceAnchor): SourceAnchor {
  const currentIds = hasAnyMessageId(current);
  const candidateIds = hasAnyMessageId(candidate);
  if (candidateIds && !currentIds) return cloneAnchor(candidate);
  if (currentIds && !candidateIds) return cloneAnchor(current);
  if (previewTextLength(candidate) > previewTextLength(current)) return cloneAnchor(candidate);
  return cloneAnchor(current);
}

export function sourceAnchorMatches(left: SourceAnchor, right: SourceAnchor): boolean {
  if (!attachmentsMatch(left, right)) return false;
  if (messageIdsCompatible(left, right) && hasAnyMessageId(left) && hasAnyMessageId(right)) {
    return true;
  }
  return hashesMatch(left, right);
}

export function mergeSourceAnchors(...groups: Array<SourceAnchor[] | undefined>): SourceAnchor[] {
  const merged: SourceAnchor[] = [];
  groups.flat().forEach((anchor) => {
    if (!anchor || !isSourceAnchor(anchor)) return;
    const matchIndex = merged.findIndex((existing) => sourceAnchorMatches(existing, anchor));
    if (matchIndex === -1) {
      merged.push(cloneAnchor(anchor));
      return;
    }
    merged[matchIndex] = preferRicherAnchor(merged[matchIndex], anchor);
  });
  return merged;
}

export function sanitizeSourceAnchors(value: unknown): SourceAnchor[] | undefined {
  const sanitized = mergeSourceAnchors(Array.isArray(value) ? value.filter(isSourceAnchor) : undefined);
  return sanitized.length > 0 ? sanitized : undefined;
}

export function sourceAnchorsFromNodeData(data: AnchorCarrier): SourceAnchor[] | undefined {
  if (data.turn?.sourceAnchor) return [cloneAnchor(data.turn.sourceAnchor)];
  return sanitizeSourceAnchors(data.sourceAnchors);
}

export function resolveSourceTurnsForAnchors(turns: Turn[], sourceAnchors: SourceAnchor[] | undefined): Turn[] {
  if (!sourceAnchors?.length) return [];
  const resolved: Turn[] = [];
  const seenTurnIds = new Set<string>();

  sourceAnchors.forEach((anchor) => {
    const turn = turns.find((candidate) => sourceAnchorMatches(candidate.sourceAnchor, anchor));
    if (!turn || seenTurnIds.has(turn.id)) return;
    seenTurnIds.add(turn.id);
    resolved.push(turn);
  });

  return resolved;
}
