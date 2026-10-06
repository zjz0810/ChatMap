function countMessageBlocks(element: HTMLElement): number {
  return element.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')
    .length;
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
    element.scrollHeight > element.clientHeight + 120 &&
    isVisible(element)
  );
}

export function describeScrollElement(element: HTMLElement): string {
  const id = element.id ? `#${element.id}` : "";
  const className =
    typeof element.className === "string"
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  return `${element.tagName.toLowerCase()}${id}${className}`;
}

export function getChatScrollRange(element: HTMLElement): { min: number; max: number } {
  const flexDirection = typeof window.getComputedStyle === "function"
    ? window.getComputedStyle(element).flexDirection
    : "";
  const reverseFlow = element.scrollTop < 0 || flexDirection === "column-reverse";
  return reverseFlow
    ? { min: Math.min(0, element.clientHeight - element.scrollHeight), max: 0 }
    : { min: 0, max: Math.max(0, element.scrollHeight - element.clientHeight) };
}

export function clampChatScrollTop(element: HTMLElement, top: number): number {
  const range = getChatScrollRange(element);
  return Math.min(range.max, Math.max(range.min, top));
}

export function getChatScrollElement(): HTMLElement {
  const fallback = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const candidates = [fallback, ...Array.from(document.querySelectorAll<HTMLElement>("body *"))]
    .filter(isScrollable)
    .map((element) => ({
      element,
      messageCount: countMessageBlocks(element),
      scrollableHeight: element.scrollHeight - element.clientHeight
    }))
    .sort((left, right) => {
      const messageDelta = right.messageCount - left.messageCount;
      if (messageDelta !== 0) return messageDelta;
      return right.scrollableHeight - left.scrollableHeight;
    });

  return candidates[0]?.element ?? fallback;
}

export function getChatGptScrollElement(doc: Document = document): HTMLElement {
  const fallback = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
  const candidateSet = new Set<HTMLElement>();
  for (const turn of doc.querySelectorAll<HTMLElement>("[data-virtualized-turn-content], [class~='group/user-message']")) {
    for (let current = turn.parentElement; current; current = current.parentElement) {
      if (isScrollable(current)) candidateSet.add(current);
    }
  }

  const candidates = Array.from(candidateSet).map((element) => ({
    element,
    turnCount: element.querySelectorAll("[data-virtualized-turn-content], [class~='group/user-message']").length,
    scrollableHeight: element.scrollHeight - element.clientHeight
  }));
  candidates.sort((left, right) => {
    if (right.turnCount !== left.turnCount) return right.turnCount - left.turnCount;
    return right.scrollableHeight - left.scrollableHeight;
  });
  return candidates[0]?.element ?? getChatScrollElement();
}
