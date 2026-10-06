import type { PromptApplyMode } from "../../shared/prompt-workbench-storage";

export type PromptInputState = {
  text: string;
  selectedText: string;
  selectionStart: number | null;
  selectionEnd: number | null;
};

export type PromptEditorTarget = {
  element: HTMLElement;
};

export type PromptMountPoint = {
  container: HTMLElement;
  reference: HTMLElement;
};

export type PromptWriteRequest = {
  text: string;
  mode: Exclude<PromptApplyMode, "smart">;
};

const ACCEPTED_COMPOSER_BUTTON_PATTERN = /add|attach|upload|file|plus|添加|上传|附件/i;
const REJECTED_COMPOSER_BUTTON_PATTERN = /send|submit|voice|microphone|dictation|model|tools?|deep research|canvas|发送|提交|语音|麦克风|模型|工具|画布/i;

export class ChatGPTPromptWorkbenchAdapter {
  readonly site = "chatgpt";

  matches(): boolean {
    return location.hostname === "chatgpt.com" || location.hostname.endsWith(".chatgpt.com");
  }

  findEditor(root: ParentNode = document): PromptEditorTarget | null {
    const element = root.querySelector<HTMLElement>("#prompt-textarea");
    if (!element || !this.isComposerEditor(element)) return null;
    return { element };
  }

  isComposerEditor(element: HTMLElement): boolean {
    if (!element.isConnected) return false;
    if (!(element instanceof HTMLTextAreaElement) && !element.isContentEditable) return false;
    const composer =
      element.closest("form") ??
      element.closest("[data-testid*='composer']") ??
      element.closest("[class*='composer' i]");
    return Boolean(composer && !element.closest("[data-message-author-role], pre, code, nav, aside"));
  }

  findMountPoint(root: ParentNode = document): PromptMountPoint | null {
    const anchor =
      root.querySelector<HTMLElement>("#composer-plus-btn") ??
      root.querySelector<HTMLElement>('[data-testid="composer-plus-btn"]') ??
      this.findFallbackComposerButton(root);
    if (!anchor || !anchor.isConnected) return null;
    const container = anchor.parentElement;
    if (!container) return null;
    return { container, reference: anchor };
  }

  mountLauncher(mountPoint: PromptMountPoint, launcher: HTMLElement): void {
    const existing = mountPoint.container.querySelector<HTMLElement>('[data-testid="turnmap-prompt-workbench-launcher"]');
    if (existing && existing !== launcher) existing.remove();
    launcher.setAttribute("data-testid", "turnmap-prompt-workbench-launcher");
    if (launcher.parentElement !== mountPoint.container) {
      mountPoint.container.insertBefore(launcher, mountPoint.reference);
    }
  }

  isStillValid(target: PromptEditorTarget | null): boolean {
    return Boolean(target?.element.isConnected && this.isComposerEditor(target.element));
  }

  readInput(target: PromptEditorTarget): PromptInputState {
    const element = target.element;
    if (element instanceof HTMLTextAreaElement) {
      const selectionStart = element.selectionStart ?? element.value.length;
      const selectionEnd = element.selectionEnd ?? selectionStart;
      return {
        text: element.value,
        selectedText: element.value.slice(selectionStart, selectionEnd),
        selectionStart,
        selectionEnd
      };
    }

    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const selectedText =
      selection &&
      selection.rangeCount > 0 &&
      isNodeWithinElement(element, anchorNode) &&
      isNodeWithinElement(element, focusNode)
        ? selection.toString()
        : "";

    return {
      text: element.textContent ?? "",
      selectedText,
      selectionStart: null,
      selectionEnd: null
    };
  }

  writeInput(target: PromptEditorTarget, request: PromptWriteRequest): boolean {
    const before = this.readInput(target);
    try {
      if (target.element instanceof HTMLTextAreaElement) {
        this.writeTextarea(target.element, request, before);
      } else {
        this.writeContentEditable(target.element, request);
      }
      target.element.focus();
      return true;
    } catch {
      this.restoreInput(target, before.text);
      return false;
    }
  }

  createObserver(onInvalidate: () => void): MutationObserver {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="turnmap-prompt-workbench-launcher"]')) onInvalidate();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  private writeTextarea(element: HTMLTextAreaElement, request: PromptWriteRequest, state: PromptInputState): void {
    const selectionStart = state.selectionStart ?? element.value.length;
    const selectionEnd = state.selectionEnd ?? selectionStart;
    const next = nextTextareaValue(element.value, request, selectionStart, selectionEnd);
    const nextCursor = cursorAfterWrite(next, request.text, request.mode);
    dispatchBeforeInput(element, request.text);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(element, next);
    else element.value = next;
    element.setSelectionRange(nextCursor, nextCursor);
    dispatchInput(element, request.text);
  }

  private writeContentEditable(element: HTMLElement, request: PromptWriteRequest): void {
    element.focus();
    if (request.mode === "replace") {
      selectElementContents(element);
    } else if (request.mode === "append") {
      moveSelectionToEnd(element);
      request = { ...request, text: `${element.textContent?.trim() ? "\n\n" : ""}${request.text}` };
    }

    dispatchBeforeInput(element, request.text);
    if (document.execCommand("insertText", false, request.text)) {
      dispatchInput(element, request.text);
      return;
    }

    const data = new DataTransfer();
    data.setData("text/plain", request.text);
    const pasted = element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    if (pasted) {
      dispatchInput(element, request.text);
      return;
    }

    element.textContent = request.mode === "append" ? `${element.textContent ?? ""}${request.text}` : request.text;
    moveSelectionToEnd(element);
    dispatchInput(element, request.text);
  }

  private restoreInput(target: PromptEditorTarget, text: string): void {
    if (target.element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(target.element, text);
      else target.element.value = text;
      dispatchInput(target.element, text);
      return;
    }
    target.element.textContent = text;
    dispatchInput(target.element, text);
  }

  private findFallbackComposerButton(root: ParentNode): HTMLElement | null {
    const editor = this.findEditor(root);
    if (!editor) return null;
    const composer =
      editor.element.closest("form") ??
      editor.element.closest("[data-testid*='composer']") ??
      editor.element.closest("[class*='composer' i]");
    if (!composer) return null;

    const buttons = Array.from(composer.querySelectorAll<HTMLElement>("button, [role='button']"));
    return (
      buttons.find((button) => {
        if (!button.isConnected || button.dataset.testid === "turnmap-prompt-workbench-launcher") return false;
        if (button.closest("[data-testid='turnmap-prompt-workbench-launcher']")) return false;
        if (isRejectedComposerButton(button)) return false;
        const text = buttonText(button);
        if (text.trim() === "+") return true;
        return ACCEPTED_COMPOSER_BUTTON_PATTERN.test(text);
      }) ?? null
    );
  }
}

function buttonText(button: HTMLElement): string {
  return [
    button.id,
    button.dataset.testid,
    button.getAttribute("aria-label"),
    button.getAttribute("title"),
    button.textContent ?? ""
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function isRejectedComposerButton(button: HTMLElement): boolean {
  const text = buttonText(button);
  return REJECTED_COMPOSER_BUTTON_PATTERN.test(text);
}

function isNodeWithinElement(element: HTMLElement, node: Node | null | undefined): boolean {
  return node instanceof Node && element.contains(node);
}

function nextTextareaValue(value: string, request: PromptWriteRequest, selectionStart: number, selectionEnd: number): string {
  if (request.mode === "replace") return request.text;
  if (request.mode === "append") return `${value}${value.trim() ? "\n\n" : ""}${request.text}`;
  if (request.mode === "wrapSelection") {
    return `${value.slice(0, selectionStart)}${request.text}${value.slice(selectionEnd)}`;
  }
  return `${value.slice(0, selectionStart)}${request.text}${value.slice(selectionEnd)}`;
}

function cursorAfterWrite(nextValue: string, insertedText: string, mode: PromptWriteRequest["mode"]): number {
  if (mode === "replace" || mode === "append") return nextValue.length;
  return Math.max(0, nextValue.indexOf(insertedText) + insertedText.length);
}

function dispatchBeforeInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: "insertText"
    })
  );
}

function dispatchInput(element: HTMLElement, text: string): void {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      composed: true,
      data: text,
      inputType: "insertText"
    })
  );
}

function selectElementContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function moveSelectionToEnd(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
