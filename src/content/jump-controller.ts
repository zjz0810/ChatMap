import type { JumpToTurnMessage, JumpToTurnResult, TurnNavigation } from "../shared/types";
import { hashText } from "../shared/hash";
import { resolveChatGptOphelTarget } from "./chatgpt-ophel-navigation";
import { clampChatScrollTop, getChatGptScrollElement, getChatScrollElement } from "./scroll-container";

const HIGHLIGHT_CLASS = "turnmap-source-highlight";

let jumpSequence = 0;
let activeJump: { key: string; promise: Promise<JumpToTurnResult> } | null = null;

function ensureHighlightStyle(): void {
  if (document.getElementById("turnmap-highlight-style")) return;

  const style = document.createElement("style");
  style.id = "turnmap-highlight-style";
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #10a37f !important;
      outline-offset: 6px !important;
      border-radius: 8px !important;
      transition: outline-color 200ms ease;
    }
  `;
  document.documentElement.append(style);
}

function isCurrentJump(sequence: number): boolean {
  return sequence === jumpSequence;
}

function navigationKey(navigation: TurnNavigation): string {
  return [
    navigation.kind,
    navigation.site,
    navigation.navigationId,
    navigation.messageId ?? "",
    navigation.turnId ?? "",
    navigation.nativeTocIndex ?? ""
  ].join("::");
}

function highlightElement(element: HTMLElement, sequence: number): void {
  if (!isCurrentJump(sequence)) return;
  element.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => {
    if (!isCurrentJump(sequence)) return;
    element.classList.remove(HIGHLIGHT_CLASS);
  }, 2200);
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isScrollable(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight + 1 &&
    isVisible(element)
  );
}

function getNearestScrollableAncestor(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (isScrollable(current)) return current;
  }
  return null;
}

function resolveRevealScrollElement(element: HTMLElement): HTMLElement {
  const chatScrollElement = getChatGptScrollElement();
  if (chatScrollElement.contains(element)) return chatScrollElement;
  const genericScrollElement = getChatScrollElement();
  if (genericScrollElement.contains(element)) return genericScrollElement;
  return getNearestScrollableAncestor(element) ?? ((document.scrollingElement ?? document.documentElement) as HTMLElement);
}

function scrollElementToCenter(element: HTMLElement, scrollElement: HTMLElement): void {
  const elementRect = element.getBoundingClientRect();
  const containerRect = scrollElement.getBoundingClientRect();
  const containerTop =
    scrollElement === document.documentElement || scrollElement === document.body ? 0 : containerRect.top;
  const targetTop = scrollElement.scrollTop + elementRect.top - containerTop - scrollElement.clientHeight * 0.35;

  scrollElement.scrollTo({
    top: clampChatScrollTop(scrollElement, targetTop),
    behavior: "instant"
  });
}

function revealChatGptTarget(element: HTMLElement, sequence: number): void {
  if (!isCurrentJump(sequence)) return;
  scrollElementToCenter(element, resolveRevealScrollElement(element));
  highlightElement(element, sequence);
}

function navigationFromTarget(
  target: Pick<JumpToTurnMessage, "navigation" | "anchor" | "promptText">
): TurnNavigation | null {
  const navigation = target.navigation;
  const anchor = target.anchor;
  const promptText = target.promptText?.replace(/\s+/g, " ").trim();
  if (navigation) {
    return {
      ...navigation,
      messageId: navigation.messageId ?? anchor?.userMessageId,
      textHash: promptText ? hashText(promptText) : navigation.textHash ?? anchor?.userHash,
      userPreview: promptText ? promptText.slice(0, 120) : navigation.userPreview ?? anchor?.userPreview,
      turnIndex: navigation.turnIndex ?? anchor?.turnIndex,
      nativeTocIndex: navigation.nativeTocIndex ?? anchor?.turnIndex
    };
  }
  if (!anchor && !promptText) return null;
  const turnIndex = anchor?.turnIndex ?? 0;
  const userHash = promptText ? hashText(promptText) : anchor!.userHash;
  return {
    kind: "ophel_notSourceAnchor",
    site: "chatgpt",
    navigationId: `chatgpt-source-anchor:${turnIndex}:${userHash}`,
    messageId: anchor?.userMessageId,
    turnIndex,
    nativeTocIndex: turnIndex,
    textHash: userHash,
    userPreview: promptText ? promptText.slice(0, 120) : anchor?.userPreview
  };
}

async function runJump(
  target: Pick<JumpToTurnMessage, "navigation" | "anchor" | "promptText">,
  sequence: number
): Promise<JumpToTurnResult> {
  ensureHighlightStyle();

  const navigation = navigationFromTarget(target);
  if (!navigation) {
    return {
      ok: false,
      reason: "This ChatGPT turn has no saved message id or prompt text to locate. Refresh the map and try again."
    };
  }

  const nativeTarget = await resolveChatGptOphelTarget(navigation);
  if (!isCurrentJump(sequence)) {
    return { ok: false, reason: "Jump cancelled by a newer node click." };
  }
  if (!nativeTarget.ok) {
    return { ok: false, reason: nativeTarget.detail };
  }

  revealChatGptTarget(nativeTarget.element, sequence);
  return { ok: true };
}

export function jumpToTurn(target: Pick<JumpToTurnMessage, "navigation" | "anchor" | "promptText">): Promise<JumpToTurnResult> {
  const navigation = navigationFromTarget(target);
  const key = navigation ? navigationKey(navigation) : "missing-navigation";
  if (activeJump?.key === key) return activeJump.promise;

  const sequence = (jumpSequence += 1);
  const promise = runJump(target, sequence).finally(() => {
    if (activeJump?.key === key) activeJump = null;
  });

  activeJump = { key, promise };
  return promise;
}
