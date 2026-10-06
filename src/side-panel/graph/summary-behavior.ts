import type { SourceAnchor, Turn } from "../../shared/types.ts";
import { hasAiTag } from "./source-anchors.ts";

export type SummaryNodeLike = {
  title: string;
  summary: string;
  turn?: Turn;
  isCustomNode?: boolean;
  isConversationRoot?: boolean;
  tags?: string[];
  sourceAnchors?: SourceAnchor[];
};

export function titleFromTurn(turn: Turn): string {
  const trimmed = turn.userText.trim();
  return trimmed.length > 72 ? `${trimmed.slice(0, 72)}...` : trimmed;
}

export function summaryFromTurn(turn: Turn): string {
  const trimmed = turn.assistantText.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}...` : trimmed;
}

function isBlank(value: string | undefined): boolean {
  return !value?.trim();
}

export function canOverwriteTurnTitle(node: SummaryNodeLike): boolean {
  return Boolean(node.turn && (isBlank(node.title) || node.title === titleFromTurn(node.turn)));
}

export function canOverwriteTurnSummary(node: SummaryNodeLike): boolean {
  return Boolean(node.turn && (isBlank(node.summary) || node.summary === summaryFromTurn(node.turn)));
}

export function hasSummarizableTurnField(node: SummaryNodeLike): boolean {
  return canOverwriteTurnTitle(node) || canOverwriteTurnSummary(node);
}

export function nodeHasDefaultText(node: SummaryNodeLike): boolean {
  return Boolean(node.turn && canOverwriteTurnTitle(node) && canOverwriteTurnSummary(node));
}

export function applyProtectedTurnSummary(
  node: SummaryNodeLike,
  summary: { title: string; summary: string }
): { updates: { title?: string; summary?: string }; blocked: boolean } {
  const updates: { title?: string; summary?: string } = {};
  if (canOverwriteTurnTitle(node)) updates.title = summary.title;
  if (canOverwriteTurnSummary(node)) updates.summary = summary.summary;
  return {
    updates,
    blocked: Object.keys(updates).length === 0
  };
}

export function isAiSummaryNote(node: SummaryNodeLike): boolean {
  return Boolean(node.isCustomNode && hasAiTag(node.tags));
}

export function canSummarizeAiNote(node: SummaryNodeLike): boolean {
  return Boolean(isAiSummaryNote(node) && (node.sourceAnchors?.length ?? 0) > 0);
}

export function shouldShowAiSummaryButton(node: SummaryNodeLike): boolean {
  if (node.isConversationRoot) return false;
  if (node.turn) return true;
  return isAiSummaryNote(node);
}
