import { optimizePromptInput, sanitizePromptOptimizerError } from "../../side-panel/ai/prompt-optimizer";
import {
  loadPromptWorkbenchLibrary,
  localizePromptWorkbenchLibrary,
  promptWorkbenchLocaleFromLanguageMode,
  savePromptWorkbenchLibrary,
  createPromptWorkbenchId,
  type PromptApplyMode,
  type PromptItem,
  type PromptWorkbenchLocale,
  type PromptWorkbenchLibrary
} from "../../shared/prompt-workbench-storage";
import {
  IMAGE_PROMPT_MENU_GROUPS,
  buildImagePromptMenuDraft,
  buildImagePromptPresetItem,
  type ImagePromptMenuGroupId
} from "../../shared/image-prompt-workbench";
import {
  applySelectionWrapFallback,
  extractPromptTemplateVariables,
  hasPromptTemplateVariables,
  renderPromptTemplate,
  templateUsesSelection,
  type PromptTemplateVariable
} from "../../shared/prompt-template";
import {
  ChatGPTPromptWorkbenchAdapter,
  type PromptEditorTarget,
  type PromptInputState
} from "./chatgpt-adapter";
import { getTurnMapLauncherIconUrl, loadTurnMapLauncherIconSrc } from "../launcher-icon";
import {
  CUSTOM_LANGUAGES_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  formatTranslation,
  loadLanguageSettings,
  translationsFor,
  type I18nKey,
  type TranslationMap
} from "../../localization/index.ts";

type WorkbenchView = "actions" | "library" | "variables" | "optimize" | "imagePrompt" | "apply";

const adapter = new ChatGPTPromptWorkbenchAdapter();
const PROMPT_WORKBENCH_CONTENT_I18N_KEYS = {
  launcher: "promptWorkbench.aria.launcher",
  library: "promptWorkbench.content.library",
  optimize: "promptWorkbench.content.optimize",
  imagePrompt: "promptWorkbench.content.imagePrompt",
  variables: "promptWorkbench.content.variables",
  manage: "promptWorkbench.content.manage",
  selectedText: "promptWorkbench.content.selectedText",
  searchPrompts: "promptWorkbench.content.searchPrompts",
  searchHint: "promptWorkbench.content.searchHint",
  apply: "promptWorkbench.content.apply",
  insert: "promptWorkbench.content.insert",
  append: "promptWorkbench.content.append",
  replace: "promptWorkbench.content.replace",
  chooseApply: "promptWorkbench.content.chooseApply",
  selectVariables: "promptWorkbench.content.selectVariables",
  missing: "promptWorkbench.content.missing",
  inputMissing: "promptWorkbench.content.inputMissing",
  writeSomething: "promptWorkbench.content.writeSomething",
  optimizing: "promptWorkbench.content.optimizing",
  optimizedPrompt: "promptWorkbench.content.optimizedPrompt",
  strictPlanningSuggestions: "promptWorkbench.content.strictPlanningSuggestions",
  optimizationFailed: "promptWorkbench.content.optimizationFailed",
  errorDetails: "promptWorkbench.content.errorDetails",
  optimizeStageReadInput: "promptWorkbench.content.optimizeStage.readInput",
  optimizeStageRequestChatCompletion: "promptWorkbench.content.optimizeStage.requestChatCompletion",
  optimizeStageWriteInput: "promptWorkbench.content.optimizeStage.writeInput",
  optimizeFailureHint: "promptWorkbench.content.optimizeFailureHint",
  openAiSettings: "promptWorkbench.content.openAiSettings",
  copy: "promptWorkbench.content.copy",
  imagePromptConcept: "promptWorkbench.content.imagePromptConcept",
  imagePromptCustom: "promptWorkbench.content.imagePromptCustom",
  imagePromptAddCustom: "promptWorkbench.content.imagePromptAddCustom",
  imagePromptRandom: "promptWorkbench.content.imagePromptRandom",
  imagePromptGenerate: "promptWorkbench.content.imagePromptGenerate",
  imagePromptSavePreset: "promptWorkbench.content.imagePromptSavePreset",
  imagePromptPresetSaved: "promptWorkbench.content.imagePromptPresetSaved"
} satisfies Record<string, I18nKey>;

type PromptWorkbenchContentLabel = keyof typeof PROMPT_WORKBENCH_CONTENT_I18N_KEYS;
type PromptOptimizeFailureStage = "readInput" | "requestChatCompletion" | "writeInput";

let promptWorkbenchTranslations: TranslationMap = translationsFor("en", []);
let promptWorkbenchLocale: PromptWorkbenchLocale = "en";
let promptWorkbenchOutputLanguageName = "English";

let launcher: HTMLButtonElement | null = null;
let toolbar: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;
let observer: MutationObserver | null = null;
let libraryCache: PromptWorkbenchLibrary | null = null;
let activePrompt: PromptItem | null = null;
let activeVariables: PromptTemplateVariable[] = [];
let pendingRenderedPrompt = "";
let imagePromptPresetSavedMessage = "";
let initializationScheduled = false;
let i18nSyncStarted = false;
let toolbarCloseTimer: number | null = null;

function icon(
  name: "library" | "sparkles" | "image" | "braces" | "settings" | "launcher" | "copy" | "insert" | "replace"
): string {
  const icons = {
    launcher:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
    sparkles:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5.2-5.2a2 2 0 0 0-2.8 0L5 18"/></svg>',
    braces: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H7a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3h1"/><path d="M16 4h1a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3h-1"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7.7 7.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7.1 7.1 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a7.1 7.1 0 0 0-1.8 1l-2.4-1-2 3.4L5 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.1 7.1 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a7.1 7.1 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>',
    insert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    replace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10a4 4 0 0 1 0 8H8"/><path d="M8 11l-4 4 4 4"/></svg>'
  };
  return icons[name];
}

function label(key: PromptWorkbenchContentLabel, values?: Record<string, string | number>): string {
  const i18nKey = PROMPT_WORKBENCH_CONTENT_I18N_KEYS[key];
  return formatTranslation(promptWorkbenchTranslations[i18nKey] ?? translationsFor("en", [])[i18nKey] ?? key, values);
}

function updateLauncherLabel(): void {
  if (!launcher) return;
  launcher.setAttribute("aria-label", label("launcher"));
}

function updateToolbarLabels(): void {
  toolbar?.querySelectorAll<HTMLButtonElement>("[data-label-key]").forEach((element) => {
    const key = element.dataset.labelKey as PromptWorkbenchContentLabel | undefined;
    if (!key || !(key in PROMPT_WORKBENCH_CONTENT_I18N_KEYS)) return;
    const nextLabel = label(key);
    element.setAttribute("aria-label", nextLabel);
    const labelElement = element.querySelector<HTMLElement>(".turnmap-prompt-workbench-toolbar-label");
    if (labelElement) labelElement.textContent = nextLabel;
  });
}

function outputLanguageNameFromSettings(
  mode: string,
  customLanguages: Array<{ id: string; languageName?: string; label?: string }>
): string {
  if (mode.startsWith("custom:")) {
    const id = mode.slice("custom:".length);
    const custom = customLanguages.find((language) => language.id === id);
    return custom?.languageName?.trim() || custom?.label?.trim() || "English";
  }
  return promptWorkbenchLocaleFromLanguageMode(mode) === "zh" ? "Chinese" : "English";
}

async function refreshPromptWorkbenchTranslations(): Promise<void> {
  const settings = await loadLanguageSettings();
  promptWorkbenchTranslations = translationsFor(settings.mode, settings.customLanguages);
  promptWorkbenchLocale = promptWorkbenchLocaleFromLanguageMode(settings.mode);
  promptWorkbenchOutputLanguageName = outputLanguageNameFromSettings(settings.mode, settings.customLanguages);
  if (libraryCache) libraryCache = localizePromptWorkbenchLibrary(libraryCache, { locale: promptWorkbenchLocale });
  updateLauncherLabel();
  updateToolbarLabels();
}

function startPromptWorkbenchI18nSync(): void {
  if (i18nSyncStarted) return;
  i18nSyncStarted = true;
  void refreshPromptWorkbenchTranslations();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!(LANGUAGE_STORAGE_KEY in changes) && !(CUSTOM_LANGUAGES_STORAGE_KEY in changes)) return;
    void refreshPromptWorkbenchTranslations();
  });
}

function ensureStyle(): void {
  if (document.getElementById("turnmap-prompt-workbench-style")) return;
  const style = document.createElement("style");
  style.id = "turnmap-prompt-workbench-style";
  style.textContent = `
    .turnmap-prompt-workbench-button,
    .turnmap-prompt-workbench-toolbar button,
    .turnmap-prompt-panel button {
      --turnmap-prompt-control-size: 36px;
      box-sizing: border-box;
      color: inherit;
      font: 500 12px Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .turnmap-prompt-workbench-button {
      align-items: center;
      background: #fff;
      border: 0;
      border-radius: 999px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72), 0 1px 5px rgba(0, 0, 0, 0.18);
      color: #202123;
      cursor: pointer;
      display: inline-flex;
      flex: 0 0 auto;
      height: var(--turnmap-prompt-control-size);
      justify-content: center;
      margin-inline: 4px;
      overflow: hidden;
      padding: 0;
      transition:
        transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1),
        box-shadow 150ms ease;
      width: var(--turnmap-prompt-control-size);
    }
    .turnmap-prompt-workbench-button:hover,
    .turnmap-prompt-workbench-button:focus-visible {
      box-shadow: 0 0 0 2px rgba(109, 93, 252, 0.36), 0 3px 10px rgba(0, 0, 0, 0.22);
      transform: translateY(-1px);
    }
    .turnmap-prompt-workbench-icon {
      border-radius: 999px;
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .turnmap-prompt-workbench-button svg,
    .turnmap-prompt-workbench-toolbar svg,
    .turnmap-prompt-panel svg {
      fill: none;
      height: 17px;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.9;
      width: 17px;
    }
    .turnmap-prompt-workbench-toolbar {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 999px;
      box-shadow: none;
      display: flex;
      flex-direction: column-reverse;
      gap: 5px;
      opacity: 0;
      padding: 0;
      pointer-events: auto;
      position: fixed;
      transform: translateY(8px) scale(0.96);
      transform-origin: bottom center;
      transition:
        opacity 120ms ease,
        transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
      z-index: 2147483600;
    }
    .turnmap-prompt-workbench-toolbar.is-open {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .turnmap-prompt-workbench-toolbar.is-closing {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    .turnmap-prompt-workbench-toolbar button {
      align-items: center;
      background: rgba(33, 33, 33, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 999px;
      color: #f7f7f8;
      cursor: pointer;
      display: inline-flex;
      height: var(--turnmap-prompt-control-size);
      justify-content: center;
      position: relative;
      padding: 0;
      transition:
        background 120ms ease,
        border-color 120ms ease,
        transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
      width: var(--turnmap-prompt-control-size);
    }
    .turnmap-prompt-workbench-toolbar button:hover,
    .turnmap-prompt-workbench-toolbar button:focus-visible {
      background: rgba(74, 74, 74, 0.98);
      border-color: rgba(255, 255, 255, 0.24);
      transform: translateY(-1px);
    }
    .turnmap-prompt-workbench-toolbar-label {
      background: rgba(33, 33, 33, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
      color: #fff;
      font: 500 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
      left: calc(100% + 8px);
      max-width: min(220px, calc(100vw - 72px));
      opacity: 0;
      padding: 6px 8px;
      pointer-events: none;
      position: absolute;
      top: 50%;
      transform: translate(4px, -50%);
      transition:
        opacity 60ms ease,
        transform 80ms ease;
      overflow-wrap: anywhere;
      text-align: left;
      white-space: normal;
    }
    .turnmap-prompt-workbench-toolbar-label::after {
      background: rgba(33, 33, 33, 0.96);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      border-left: 1px solid rgba(255, 255, 255, 0.12);
      content: "";
      height: 7px;
      position: absolute;
      right: 100%;
      top: 50%;
      transform: translate(4px, -50%) rotate(45deg);
      width: 7px;
    }
    .turnmap-prompt-workbench-toolbar button:hover .turnmap-prompt-workbench-toolbar-label,
    .turnmap-prompt-workbench-toolbar button:focus-visible .turnmap-prompt-workbench-toolbar-label {
      opacity: 1;
      transform: translate(0, -50%);
    }
    @media (max-width: 460px) {
      .turnmap-prompt-workbench-toolbar-label {
        max-width: min(180px, calc(100vw - 64px));
      }
    }
    .turnmap-prompt-panel {
      background: color-mix(in srgb, Canvas 96%, #101827 4%);
      border: 1px solid rgba(125, 132, 150, 0.35);
      border-radius: 10px;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
      color: CanvasText;
      max-height: min(460px, 70vh);
      overflow: auto;
      padding: 10px;
      position: fixed;
      width: 340px;
      max-width: calc(100vw - 16px);
      z-index: 2147483600;
    }
    .turnmap-prompt-panel input,
    .turnmap-prompt-panel textarea,
    .turnmap-prompt-panel select {
      background: Canvas;
      border: 1px solid rgba(125, 132, 150, 0.35);
      border-radius: 8px;
      color: CanvasText;
      font: 500 12px Inter, ui-sans-serif, system-ui, sans-serif;
      padding: 7px 9px;
      width: 100%;
    }
    .turnmap-prompt-panel textarea {
      min-height: 96px;
      resize: vertical;
    }
    .turnmap-prompt-panel__row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .turnmap-prompt-panel__row button,
    .turnmap-prompt-panel__button {
      align-items: center;
      background: rgba(109, 93, 252, 0.12);
      border: 1px solid rgba(109, 93, 252, 0.28);
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      gap: 5px;
      justify-content: center;
      min-height: 30px;
      padding: 6px 8px;
    }
    .turnmap-prompt-item {
      border: 1px solid rgba(125, 132, 150, 0.22);
      border-radius: 8px;
      cursor: pointer;
      margin-top: 7px;
      padding: 8px;
    }
    .turnmap-prompt-item:hover {
      border-color: rgba(109, 93, 252, 0.55);
    }
    .turnmap-prompt-item strong {
      display: block;
      font-size: 12px;
      line-height: 1.35;
    }
    .turnmap-prompt-item p,
    .turnmap-prompt-panel__hint {
      color: color-mix(in srgb, CanvasText 62%, transparent);
      font-size: 11px;
      line-height: 1.45;
      margin: 4px 0 0;
    }
    .turnmap-prompt-panel__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .turnmap-prompt-panel__tags span {
      background: rgba(16, 163, 127, 0.13);
      border-radius: 999px;
      font-size: 10px;
      padding: 2px 6px;
    }
    .turnmap-prompt-panel__preview {
      background: rgba(125, 132, 150, 0.1);
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.45;
      margin-top: 8px;
      max-height: 180px;
      overflow: auto;
      padding: 8px;
      white-space: pre-wrap;
    }
    .turnmap-prompt-image-group {
      border-top: 1px solid rgba(125, 132, 150, 0.16);
      margin-top: 8px;
      padding-top: 8px;
    }
    .turnmap-prompt-image-group strong {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
    }
    .turnmap-prompt-image-options {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .turnmap-prompt-image-option {
      align-items: center;
      background: rgba(125, 132, 150, 0.09);
      border: 1px solid rgba(125, 132, 150, 0.2);
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      font-size: 11px;
      gap: 4px;
      line-height: 1.2;
      padding: 4px 7px;
    }
    .turnmap-prompt-image-option.is-selected,
    .turnmap-prompt-image-option[data-selected="true"] {
      background: rgba(109, 93, 252, 0.18);
      border-color: rgba(109, 93, 252, 0.58);
      color: #efeefe;
      box-shadow: 0 0 0 1px rgba(109, 93, 252, 0.2);
    }
  `;
  document.documentElement.append(style);
}

function compact(text: string, length = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}...` : normalized;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });
}

function button(labelKey: PromptWorkbenchContentLabel, iconName: Parameters<typeof icon>[0], onClick: () => void): HTMLButtonElement {
  const buttonLabel = label(labelKey);
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.labelKey = labelKey;
  element.setAttribute("aria-label", buttonLabel);
  element.innerHTML = `${icon(iconName)}<span class="turnmap-prompt-workbench-toolbar-label">${escapeHtml(buttonLabel)}</span>`;
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return element;
}

function positionNearAnchor(element: HTMLElement, anchor: HTMLElement, offset = 6): void {
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - element.offsetWidth - 8, rect.left));
  const top = Math.max(8, Math.min(window.innerHeight - element.offsetHeight - 8, rect.top - element.offsetHeight - offset));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function positionPanelNearAnchor(element: HTMLElement, anchor: HTMLElement, offset = 8): void {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(window.innerWidth - margin * 2, element.offsetWidth || 340);
  const spaceAbove = Math.max(0, rect.top - margin - offset);
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin - offset);
  const preferredHeight = Math.min(element.scrollHeight || element.offsetHeight || 420, 460);
  const openAbove = spaceAbove >= preferredHeight || spaceAbove >= spaceBelow;
  const availableHeight = Math.max(180, openAbove ? spaceAbove : spaceBelow);

  element.style.maxHeight = `${Math.min(460, availableHeight)}px`;
  element.style.width = `${width}px`;

  const measuredHeight = Math.min(element.offsetHeight || preferredHeight, availableHeight);
  const top = openAbove ? rect.top - measuredHeight - offset : rect.bottom + offset;
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));

  element.style.left = `${left}px`;
  element.style.top = `${Math.max(margin, Math.min(window.innerHeight - measuredHeight - margin, top))}px`;
}

function positionToolbarAboveLauncher(element: HTMLElement, anchor: HTMLElement): void {
  const margin = 8;
  const offset = 6;
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth || 36;
  const height = element.offsetHeight || 200;
  const spaceAbove = Math.max(0, rect.top - margin - offset);
  const top =
    spaceAbove >= height
      ? rect.top - height - offset
      : Math.max(margin, Math.min(window.innerHeight - height - margin, rect.bottom + offset));
  const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left + (rect.width - width) / 2));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function ensureLauncher(): HTMLButtonElement {
  if (launcher) return launcher;
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "turnmap-prompt-workbench-button";
  launcher.setAttribute("aria-label", label("launcher"));
  const image = document.createElement("img");
  image.className = "turnmap-prompt-workbench-icon";
  image.alt = "";
  image.decoding = "async";
  image.draggable = false;
  image.src = getTurnMapLauncherIconUrl();
  launcher.append(image);
  void loadTurnMapLauncherIconSrc().then((src) => {
    if (image.isConnected) image.src = src;
  });
  launcher.addEventListener("mouseenter", showToolbar);
  launcher.addEventListener("mouseleave", scheduleToolbarClose);
  launcher.addEventListener("focus", showToolbar);
  launcher.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showToolbar();
  });
  return launcher;
}

function removeSurfaces(): void {
  if (toolbarCloseTimer !== null) {
    window.clearTimeout(toolbarCloseTimer);
    toolbarCloseTimer = null;
  }
  toolbar?.remove();
  panel?.remove();
  toolbar = null;
  panel = null;
}

function cancelToolbarClose(): void {
  if (toolbarCloseTimer === null) return;
  window.clearTimeout(toolbarCloseTimer);
  toolbarCloseTimer = null;
}

function scheduleToolbarClose(): void {
  cancelToolbarClose();
  toolbarCloseTimer = window.setTimeout(() => {
    toolbarCloseTimer = null;
    closeToolbar();
  }, 120);
}

function closeToolbar(): void {
  if (!toolbar) return;
  const closingToolbar = toolbar;
  toolbar = null;
  closingToolbar.classList.remove("is-open");
  closingToolbar.classList.add("is-closing");
  window.setTimeout(() => closingToolbar.remove(), 150);
}

function showToolbar(): void {
  if (!launcher) return;
  cancelToolbarClose();
  ensureStyle();
  if (toolbar) {
    positionToolbarAboveLauncher(toolbar, launcher);
    toolbar.classList.add("is-open");
    toolbar.classList.remove("is-closing");
    return;
  }
  toolbar = document.createElement("div");
  toolbar.className = "turnmap-prompt-workbench-toolbar";
  toolbar.addEventListener("mouseenter", cancelToolbarClose);
  toolbar.addEventListener("mouseleave", scheduleToolbarClose);
  toolbar.append(
    button("library", "library", () => void showLibraryPanel()),
    button("optimize", "sparkles", () => void showOptimizePanel()),
    button("imagePrompt", "image", () => void showImagePromptPanel()),
    button("variables", "braces", () => showVariablesPanel()),
    button("manage", "settings", openPromptWorkbenchSettings)
  );
  document.body.append(toolbar);
  positionToolbarAboveLauncher(toolbar, launcher);
  requestAnimationFrame(() => {
    toolbar?.classList.add("is-open");
  });
}

function ensurePanel(view: WorkbenchView): HTMLDivElement {
  if (!launcher) throw new Error("Prompt workbench launcher is missing.");
  panel?.remove();
  panel = document.createElement("div");
  panel.className = `turnmap-prompt-panel turnmap-prompt-panel--${view}`;
  document.body.append(panel);
  requestAnimationFrame(() => {
    if (panel && launcher) positionPanelNearAnchor(panel, launcher);
  });
  return panel;
}

function repositionPanel(): void {
  requestAnimationFrame(() => {
    if (panel && launcher) positionPanelNearAnchor(panel, launcher);
  });
}

async function loadLibrary(): Promise<PromptWorkbenchLibrary> {
  libraryCache = await loadPromptWorkbenchLibrary({ locale: promptWorkbenchLocale });
  return libraryCache;
}

function sortedPrompts(library: PromptWorkbenchLibrary): PromptItem[] {
  return [...library.prompts]
    .filter((prompt) => prompt.enabled)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      const recentDelta = (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0);
      if (recentDelta !== 0) return recentDelta;
      return left.sortOrder - right.sortOrder;
    });
}

async function showLibraryPanel(): Promise<void> {
  const library = await loadLibrary();
  const root = ensurePanel("library");
  root.innerHTML = `
    <input type="search" aria-label="${escapeHtml(label("searchPrompts"))}" placeholder="${escapeHtml(label("searchPrompts"))}" />
    <div class="turnmap-prompt-panel__hint">${escapeHtml(label("searchHint"))}</div>
    <div data-list></div>
  `;
  repositionPanel();
  const search = root.querySelector<HTMLInputElement>("input");
  const list = root.querySelector<HTMLElement>("[data-list]");
  const render = () => {
    if (!list) return;
    const query = search?.value.trim().toLowerCase() ?? "";
    const prompts = sortedPrompts(library).filter((prompt) => {
      const haystack = `${prompt.title} ${prompt.content} ${prompt.tags.join(" ")}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    list.textContent = "";
    for (const prompt of prompts) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "turnmap-prompt-item";
      item.setAttribute("aria-label", prompt.title);
      item.innerHTML = `
        <strong>${escapeHtml(prompt.pinned ? `* ${prompt.title}` : prompt.title)}</strong>
        <p>${escapeHtml(compact(prompt.content))}</p>
        <div class="turnmap-prompt-panel__tags">${prompt.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      `;
      item.addEventListener("click", () => void choosePrompt(prompt));
      list.append(item);
    }
    repositionPanel();
  };
  search?.addEventListener("input", render);
  render();
  setTimeout(() => search?.focus(), 30);
}

function promptModeFromSmart(state: PromptInputState, configured: PromptApplyMode): Exclude<PromptApplyMode, "smart"> | "choose" {
  if (configured !== "smart") return configured;
  if (!state.text.trim()) return "insert";
  if (state.selectedText.trim()) return "wrapSelection";
  return "choose";
}

async function choosePrompt(prompt: PromptItem): Promise<void> {
  activePrompt = prompt;
  activeVariables = extractPromptTemplateVariables(prompt.content);
  if (activeVariables.length > 0) {
    showVariablesPanel();
    return;
  }
  await applyPrompt(prompt, {});
}

async function applyPrompt(prompt: PromptItem, values: Record<string, string>): Promise<void> {
  const target = adapter.findEditor();
  if (!target) return;
  const library = libraryCache ?? (await loadLibrary());
  const input = adapter.readInput(target);
  const rendered = renderPromptTemplate(prompt.content, values, { input: input.text, selection: input.selectedText });
  if (!rendered.ok) {
    activePrompt = prompt;
    activeVariables = extractPromptTemplateVariables(prompt.content);
    showVariablesPanel(rendered.missingVariables);
    return;
  }

  pendingRenderedPrompt =
    input.selectedText.trim() && !templateUsesSelection(prompt.content)
      ? applySelectionWrapFallback(rendered.text, input.selectedText, label("selectedText"))
      : rendered.text;
  const mode = promptModeFromSmart(input, library.settings.defaultApplyMode);
  if (mode === "choose") {
    showApplyChoicePanel(prompt, target);
    return;
  }

  completePromptApplication(prompt, target, mode);
}

async function completePromptApplication(
  prompt: PromptItem,
  target: PromptEditorTarget,
  mode: Exclude<PromptApplyMode, "smart">
): Promise<void> {
  if (!adapter.writeInput(target, { text: pendingRenderedPrompt, mode })) return;
  const library = libraryCache ?? (await loadLibrary());
  library.prompts = library.prompts.map((item) =>
    item.id === prompt.id
      ? {
          ...item,
          useCount: item.useCount + 1,
          lastUsedAt: Date.now(),
          updatedAt: Date.now()
        }
      : item
  );
  await savePromptWorkbenchLibrary(library, { locale: promptWorkbenchLocale });
  libraryCache = library;
  removeSurfaces();
  target.element.focus();
}

function showApplyChoicePanel(prompt: PromptItem, target: PromptEditorTarget): void {
  const root = ensurePanel("apply");
  root.innerHTML = `
    <strong>${escapeHtml(prompt.title)}</strong>
    <p class="turnmap-prompt-panel__hint">${escapeHtml(label("chooseApply"))}</p>
    <div class="turnmap-prompt-panel__preview">${escapeHtml(pendingRenderedPrompt)}</div>
    <div class="turnmap-prompt-panel__row"></div>
  `;
  repositionPanel();
  const row = root.querySelector<HTMLElement>(".turnmap-prompt-panel__row");
  row?.append(
    actionButton(label("insert"), "insert", () => void completePromptApplication(prompt, target, "insert")),
    actionButton(label("append"), "insert", () => void completePromptApplication(prompt, target, "append")),
    actionButton(label("replace"), "replace", () => void completePromptApplication(prompt, target, "replace"))
  );
}

function actionButton(label: string, iconName: Parameters<typeof icon>[0], onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
  element.setAttribute("aria-label", label);
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return element;
}

function showVariablesPanel(missingVariables: string[] = []): void {
  const root = ensurePanel("variables");
  if (!activePrompt) {
    root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("selectVariables"))}</p>`;
    repositionPanel();
    return;
  }

  const variables = activeVariables.length > 0 ? activeVariables : extractPromptTemplateVariables(activePrompt.content);
  root.innerHTML = `
    <strong>${escapeHtml(activePrompt.title)}</strong>
    <div data-fields></div>
    <div class="turnmap-prompt-panel__preview" data-preview></div>
    <div class="turnmap-prompt-panel__row">
      <button type="button" data-apply>${icon("insert")}<span>${escapeHtml(label("apply"))}</span></button>
    </div>
  `;
  repositionPanel();
  const fields = root.querySelector<HTMLElement>("[data-fields]");
  const preview = root.querySelector<HTMLElement>("[data-preview]");
  const values: Record<string, string> = {};
  for (const variable of variables) {
    values[variable.name] = variable.defaultValue;
    const label = document.createElement("label");
    label.innerHTML = `${escapeHtml(variable.name)}${variable.required ? " *" : ""}<input data-variable="${escapeHtml(
      variable.name
    )}" value="${escapeHtml(variable.defaultValue)}" />`;
    fields?.append(label);
  }
  const renderPreview = () => {
    root.querySelectorAll<HTMLInputElement>("[data-variable]").forEach((input) => {
      values[input.dataset.variable ?? ""] = input.value;
    });
    const target = adapter.findEditor();
    const inputState = target ? adapter.readInput(target) : { text: "", selectedText: "" };
    const rendered = renderPromptTemplate(activePrompt!.content, values, {
      input: inputState.text,
      selection: inputState.selectedText
    });
    if (preview) {
      preview.textContent =
        rendered.text || (missingVariables.length > 0 ? label("missing", { names: missingVariables.join(", ") }) : "");
    }
  };
  root.querySelectorAll<HTMLInputElement>("[data-variable]").forEach((input) => input.addEventListener("input", renderPreview));
  root.querySelector<HTMLButtonElement>("[data-apply]")?.addEventListener("click", () => {
    void applyPrompt(activePrompt!, values);
  });
  renderPreview();
}

function selectedImagePromptValues(root: HTMLElement): Record<ImagePromptMenuGroupId, string[]> {
  const selections = {} as Record<ImagePromptMenuGroupId, string[]>;
  for (const group of IMAGE_PROMPT_MENU_GROUPS) {
    const selected = root.querySelector<HTMLButtonElement>(
      `button[data-image-option][data-image-group="${group.id}"][data-selected="true"]`
    );
    if (!selected) {
      selections[group.id] = [];
      continue;
    }
    if (selected.dataset.imageOther === "true") {
      const custom = root.querySelector<HTMLInputElement>(`input[data-image-custom-input="${group.id}"]`)?.value.trim() ?? "";
      selections[group.id] = custom ? [custom] : [];
      continue;
    }
    selections[group.id] = selected.value.trim() ? [selected.value.trim()] : [];
  }
  return selections;
}

function currentImagePromptDraft(root: HTMLElement): string {
  const concept = root.querySelector<HTMLTextAreaElement>("[data-image-concept]")?.value ?? "";
  return buildImagePromptMenuDraft({
    concept,
    selections: selectedImagePromptValues(root),
    locale: promptWorkbenchLocale
  });
}

function randomizeImagePromptSelections(root: HTMLElement): void {
  for (const group of IMAGE_PROMPT_MENU_GROUPS) {
    selectRandomImagePromptOption(root, group.id);
  }
}

function setImagePromptOptionSelected(button: HTMLButtonElement, selected: boolean): void {
  button.dataset.selected = selected ? "true" : "false";
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  button.classList.toggle("is-selected", selected);
}

function toggleImagePromptOption(root: HTMLElement, button: HTMLButtonElement): void {
  const groupId = button.dataset.imageGroup as ImagePromptMenuGroupId | undefined;
  if (!groupId) return;
  const wasSelected = button.dataset.selected === "true";
  root
    .querySelectorAll<HTMLButtonElement>(`button[data-image-option][data-image-group="${groupId}"]`)
    .forEach((option) => setImagePromptOptionSelected(option, false));
  setImagePromptOptionSelected(button, !wasSelected);
}

function selectRandomImagePromptOption(root: HTMLElement, groupId: ImagePromptMenuGroupId): void {
  const options = Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      `button[data-image-option][data-image-group="${groupId}"]:not([data-image-other="true"])`
    )
  );
  root
    .querySelectorAll<HTMLButtonElement>(`button[data-image-option][data-image-group="${groupId}"]`)
    .forEach((option) => setImagePromptOptionSelected(option, false));
  const selected = options[Math.floor(Math.random() * options.length)];
  if (selected) setImagePromptOptionSelected(selected, true);
}

function addCustomImagePromptSelection(root: HTMLElement, groupId: ImagePromptMenuGroupId): void {
  const input = root.querySelector<HTMLInputElement>(`input[data-image-custom-input="${groupId}"]`);
  const list = root.querySelector<HTMLElement>(`[data-custom-image-group="${groupId}"]`);
  const value = input?.value.trim();
  if (!input || !list || !value) return;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "turnmap-prompt-image-option";
  chip.dataset.imageOption = "custom";
  chip.dataset.imageGroup = groupId;
  chip.dataset.selected = "false";
  chip.value = value;
  chip.textContent = value;
  chip.setAttribute("aria-pressed", "false");
  chip.setAttribute("aria-label", value);
  chip.addEventListener("click", () => toggleImagePromptOption(root, chip));
  list.append(chip);
  toggleImagePromptOption(root, chip);
  input.value = "";
  repositionPanel();
}

async function saveImagePromptPreset(root: HTMLElement): Promise<void> {
  const draft = currentImagePromptDraft(root);
  const library = libraryCache ?? (await loadLibrary());
  const folderName = promptWorkbenchLocale === "zh" ? "生图提示词" : "Image prompts";
  let folder = library.folders.find((item) => item.name.toLowerCase() === folderName.toLowerCase());
  const now = Date.now();
  if (!folder) {
    folder = {
      id: createPromptWorkbenchId("fld"),
      name: folderName,
      sortOrder: library.folders.length,
      createdAt: now,
      updatedAt: now
    };
    library.folders.push(folder);
  }
  const concept = root.querySelector<HTMLTextAreaElement>("[data-image-concept]")?.value.trim() ?? "";
  const preset = buildImagePromptPresetItem({
    title: compact(concept || label("imagePrompt"), 48),
    folderId: folder.id,
    sortOrder: library.prompts.length,
    now,
    draft
  });
  library.prompts.push(preset);
  await savePromptWorkbenchLibrary(library, { locale: promptWorkbenchLocale });
  libraryCache = library;
  imagePromptPresetSavedMessage = label("imagePromptPresetSaved");
  const status = root.querySelector<HTMLElement>("[data-image-status]");
  if (status) status.textContent = imagePromptPresetSavedMessage;
}

async function showImagePromptPanel(): Promise<void> {
  const target = adapter.findEditor();
  const root = ensurePanel("imagePrompt");
  if (!target) {
    root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("inputMissing"))}</p>`;
    repositionPanel();
    return;
  }

  let input = "";
  try {
    input = adapter.readInput(target).text.trim();
  } catch (error) {
    renderOptimizeFailure(root, "readInput", error);
    return;
  }

  root.innerHTML = `
    <strong>${escapeHtml(label("imagePrompt"))}</strong>
    <p class="turnmap-prompt-panel__hint">${escapeHtml(label("imagePromptConcept"))}</p>
    <textarea data-image-concept>${escapeHtml(input)}</textarea>
    <div data-image-groups></div>
    <p class="turnmap-prompt-panel__hint" data-image-status></p>
    <div class="turnmap-prompt-panel__row">
      <button type="button" data-random>${icon("sparkles")}<span>${escapeHtml(label("imagePromptRandom"))}</span></button>
      <button type="button" data-save-preset>${icon("library")}<span>${escapeHtml(label("imagePromptSavePreset"))}</span></button>
      <button type="button" data-generate>${icon("image")}<span>${escapeHtml(label("imagePromptGenerate"))}</span></button>
    </div>
  `;

  const groups = root.querySelector<HTMLElement>("[data-image-groups]");
  for (const group of IMAGE_PROMPT_MENU_GROUPS) {
    const section = document.createElement("section");
    section.className = "turnmap-prompt-image-group";
    const title = group.title[promptWorkbenchLocale];
    section.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <div class="turnmap-prompt-image-options">
        ${group.options
          .map((option) => {
            const value = option[promptWorkbenchLocale];
            return `<button type="button" class="turnmap-prompt-image-option" data-image-option="${escapeHtml(
              option.id
            )}" data-image-group="${group.id}" data-selected="false" aria-pressed="false" value="${escapeHtml(
              value
            )}" aria-label="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
          })
          .join("")}
        <button type="button" class="turnmap-prompt-image-option" data-image-option="other" data-image-group="${
          group.id
        }" data-image-other="true" data-selected="false" aria-pressed="false" value="" aria-label="${escapeHtml(
          label("imagePromptCustom")
        )}">${escapeHtml(label("imagePromptCustom"))}</button>
      </div>
      <div class="turnmap-prompt-panel__row">
        <input data-image-custom-input="${group.id}" placeholder="${escapeHtml(label("imagePromptCustom"))}" />
        <button type="button" data-add-custom="${group.id}" aria-label="${escapeHtml(label("imagePromptAddCustom"))}">${icon(
          "insert"
        )}</button>
      </div>
      <div class="turnmap-prompt-panel__tags" data-custom-image-group="${group.id}"></div>
    `;
    groups?.append(section);
  }
  repositionPanel();

  root.querySelectorAll<HTMLButtonElement>("button[data-image-option]").forEach((button) => {
    button.addEventListener("click", () => toggleImagePromptOption(root, button));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-add-custom]").forEach((button) => {
    button.addEventListener("click", () => addCustomImagePromptSelection(root, button.dataset.addCustom as ImagePromptMenuGroupId));
  });
  root.querySelector<HTMLButtonElement>("[data-random]")?.addEventListener("click", () => {
    randomizeImagePromptSelections(root);
  });
  root.querySelector<HTMLButtonElement>("[data-save-preset]")?.addEventListener("click", () => {
    void saveImagePromptPreset(root);
  });
  root.querySelector<HTMLButtonElement>("[data-generate]")?.addEventListener("click", async () => {
    const currentTarget = adapter.findEditor();
    if (!currentTarget) {
      root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("inputMissing"))}</p>`;
      return;
    }
    const currentInput = adapter.readInput(currentTarget).text.trim() || root.querySelector<HTMLTextAreaElement>("[data-image-concept]")?.value.trim() || "";
    if (!currentInput) {
      root.querySelector<HTMLElement>("[data-image-status]")!.textContent = label("writeSomething");
      return;
    }
    const library = await loadLibrary();
    root.querySelector<HTMLElement>("[data-image-status]")!.textContent = label("optimizing");
    try {
      const result = await optimizePromptInput({
        input: currentInput,
        format: "image-prompt",
        optimizerPrompts: library.optimizerPrompts,
        imagePromptMenuDraft: currentImagePromptDraft(root),
        locale: promptWorkbenchLocale,
        outputLanguage: promptWorkbenchOutputLanguageName
      });
      if (writeOptimizedPrompt(root, currentTarget, result, "replace")) removeSurfaces();
    } catch (error) {
      renderOptimizeFailure(root, "requestChatCompletion", error);
    }
  });
}

async function showOptimizePanel(): Promise<void> {
  const target = adapter.findEditor();
  const root = ensurePanel("optimize");
  if (!target) {
    root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("inputMissing"))}</p>`;
    repositionPanel();
    return;
  }
  let input = "";
  try {
    input = adapter.readInput(target).text.trim();
  } catch (error) {
    renderOptimizeFailure(root, "readInput", error);
    return;
  }
  if (!input) {
    root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("writeSomething"))}</p>`;
    repositionPanel();
    return;
  }

  const library = await loadLibrary();
  root.innerHTML = `<p class="turnmap-prompt-panel__hint">${escapeHtml(label("optimizing"))}</p>`;
  repositionPanel();
  try {
    const result = await optimizePromptInput({
      input,
      format: library.settings.aiOptimizeFormat,
      optimizerPrompts: library.optimizerPrompts
    });
    if (!library.settings.aiOptimizePreview && library.settings.aiOptimizeFormat === "simple-polish") {
      if (writeOptimizedPrompt(root, target, result, "replace")) removeSurfaces();
      return;
    }
    renderOptimizeResult(root, target, result, library.settings.aiOptimizeFormat);
  } catch (error) {
    renderOptimizeFailure(root, "requestChatCompletion", error);
  }
}

function optimizeStageLabel(stage: PromptOptimizeFailureStage): string {
  if (stage === "readInput") return label("optimizeStageReadInput");
  if (stage === "writeInput") return label("optimizeStageWriteInput");
  return label("optimizeStageRequestChatCompletion");
}

function renderOptimizeFailure(root: HTMLElement, stage: PromptOptimizeFailureStage, error: unknown): void {
  root.innerHTML = `
    <p class="turnmap-prompt-panel__hint">${escapeHtml(label("optimizationFailed"))}</p>
    <div class="turnmap-prompt-panel__preview">${escapeHtml(optimizeStageLabel(stage))}</div>
    <p class="turnmap-prompt-panel__hint">${escapeHtml(label("optimizeFailureHint"))}</p>
    <details open><summary>${escapeHtml(label("errorDetails"))}</summary><pre class="turnmap-prompt-panel__preview">${escapeHtml(
      sanitizePromptOptimizerError(error)
    )}</pre></details>
    <div class="turnmap-prompt-panel__row"><button type="button" data-settings>${icon("settings")}<span>${escapeHtml(
      label("openAiSettings")
    )}</span></button></div>
  `;
  repositionPanel();
  root.querySelector<HTMLButtonElement>("[data-settings]")?.addEventListener("click", openPromptWorkbenchSettings);
}

function writeOptimizedPrompt(
  root: HTMLElement,
  target: PromptEditorTarget,
  result: string,
  mode: Exclude<PromptApplyMode, "smart">
): boolean {
  if (adapter.writeInput(target, { text: result, mode })) return true;
  renderOptimizeFailure(
    root,
    "writeInput",
    new Error("TurnMap could not write the optimized prompt back into the ChatGPT input box. The editor may have remounted or rejected the synthetic input event.")
  );
  return false;
}

function renderOptimizeResult(
  root: HTMLElement,
  target: PromptEditorTarget,
  result: string,
  format: "simple-polish" | "strict-planning"
): void {
  const title = format === "strict-planning" ? label("strictPlanningSuggestions") : label("optimizedPrompt");
  root.innerHTML = `
    <strong>${title}</strong>
    <div class="turnmap-prompt-panel__preview">${escapeHtml(result)}</div>
    <div class="turnmap-prompt-panel__row"></div>
  `;
  repositionPanel();
  const row = root.querySelector<HTMLElement>(".turnmap-prompt-panel__row");
  row?.append(
    actionButton(label("copy"), "copy", () => void navigator.clipboard?.writeText(result)),
    actionButton(label("insert"), "insert", () => writeOptimizedPrompt(root, target, result, "insert")),
    actionButton(label("replace"), "replace", () => writeOptimizedPrompt(root, target, result, "replace"))
  );
}

function openPromptWorkbenchSettings(): void {
  void chrome.runtime.sendMessage({ type: "TURNMAP_OPEN_SETTINGS" }).catch(() => undefined);
}

function scheduleInitialize(): void {
  if (initializationScheduled) return;
  initializationScheduled = true;
  window.setTimeout(() => {
    initializationScheduled = false;
    void initializePromptWorkbench();
  }, 300);
}

function ensurePromptWorkbenchObserver(): void {
  if (!observer) observer = adapter.createObserver(scheduleInitialize);
}

async function initializePromptWorkbench(): Promise<void> {
  if (!adapter.matches()) return;
  startPromptWorkbenchI18nSync();
  const library = await loadLibrary();
  libraryCache = library;
  if (!library.settings.enabled) return;
  ensurePromptWorkbenchObserver();
  const mountPoint = adapter.findMountPoint();
  const editor = adapter.findEditor();
  if (!mountPoint || !editor) return;
  ensureStyle();
  adapter.mountLauncher(mountPoint, ensureLauncher());
}

export function startPromptWorkbench(): void {
  startPromptWorkbenchI18nSync();
  void initializePromptWorkbench();
  document.addEventListener("click", (event) => {
    if (!panel && !toolbar) return;
    const target = event.target as Element | null;
    if (target?.closest(".turnmap-prompt-workbench-toolbar, .turnmap-prompt-panel, .turnmap-prompt-workbench-button")) return;
    removeSurfaces();
  });
  window.addEventListener("resize", () => {
    if (toolbar && launcher) positionToolbarAboveLauncher(toolbar, launcher);
    if (panel && launcher) positionPanelNearAnchor(panel, launcher);
  });
}
