import type { ExtractedTurnsMessage, JumpToTurnMessage, Turn } from "../shared/types";
import { isContentCommand } from "../shared/runtime-protocol.ts";
import { getContentLifecycleState, startContentPhase } from "./content-lifecycle.ts";
import { selectConversationAdapter, type ConversationAdapter } from "./conversation-adapters";
import { previewCustomSiteProfile, selectConversationAdapterAsync } from "./custom-site-adapter";
import { getTurnMapLauncherIconUrl, loadTurnMapLauncherIconSrc } from "./launcher-icon";
import { startPromptWorkbench } from "./prompt-workbench";
import { mergeTurns } from "./turn-extractor";
import { pauseChatGptObserverForNavigation } from "./chatgpt-observer.ts";
import {
  isTurnFavorited,
  loadFloatingFavorites,
  resolveFloatingFavorites,
  saveFloatingFavorites,
  toggleTurnFavorite,
  type FloatingFavorite
} from "./floating-favorites";
import {
  CUSTOM_LANGUAGES_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  formatTranslation,
  loadLanguageSettings,
  translationsFor,
  type I18nKey,
  type TranslationMap
} from "../localization/index.ts";

const contentLifecycle = getContentLifecycleState(window);

function broadcastTurns(message: ExtractedTurnsMessage): void {
  const conversationChanged = message.conversationId.trim() !== floatingConversationId;
  floatingTurns = conversationChanged ? message.turns : mergeFloatingTurns(floatingTurns, message.turns);
  setFloatingConversationId(message.conversationId);
  renderFloatingNavigator();
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may be closed. The next explicit request will fetch current turns.
  });
}

let activeAdapter: ConversationAdapter | null = selectConversationAdapter();
const activeAdapterReady: Promise<ConversationAdapter | null> = activeAdapter
  ? Promise.resolve(activeAdapter)
  : selectConversationAdapterAsync(new URL(window.location.href), activeAdapter).then((adapter) => {
      activeAdapter = adapter;
      return adapter;
    });

function getCurrentAdapter(): ConversationAdapter | null {
  return activeAdapter;
}

function toUnsupportedTurnsMessage(): ExtractedTurnsMessage {
  return {
    type: "TURNMAP_TURNS_UPDATED",
    turns: [],
    conversationTitle: document.title || "Current AI conversation",
    conversationId: window.location.href,
    site: {
      id: "unsupported",
      displayName: "Unsupported site"
    }
  };
}

let floatingPanel: HTMLElement | null = null;
let launcherButton: HTMLButtonElement | null = null;
let floatingTurns: Turn[] = [];
let launcherMovedDuringPointer = false;
let floatingThemeSetting: FloatingThemeMode = "browser";
let floatingNavigatorEnabled = false;
let floatingNavigatorOpenTimer: number | null = null;
let floatingNavigatorCloseTimer: number | null = null;
let floatingNavigatorViewSwitchGraceUntil = 0;

const FLOATING_NAVIGATOR_HOVER_DELAY_MS = 400;
const FLOATING_NAVIGATOR_CLOSE_DELAY_MS = 200;
const FLOATING_NAVIGATOR_VIEW_SWITCH_GRACE_MS = 250;

type FloatingThemeMode = "browser" | "day" | "night" | "eye-care";

type FloatingPosition = {
  left: number;
  top: number;
};

type FloatingNavigatorView = "all" | "favorites";
type FloatingNavigatorEntry = {
  turn: Turn;
  favorite?: FloatingFavorite;
  unavailable: boolean;
};

const FLOATING_NAVIGATOR_I18N_KEYS = {
  all: "floatingNavigator.view.all",
  favorites: "floatingNavigator.view.favorites",
  addFavorite: "floatingNavigator.action.addFavorite",
  removeFavorite: "floatingNavigator.action.removeFavorite",
  jump: "floatingNavigator.action.jump",
  emptyAll: "floatingNavigator.empty.all",
  emptyFavorites: "floatingNavigator.empty.favorites",
  unavailable: "floatingNavigator.unavailable",
  turn: "floatingNavigator.turn"
} satisfies Record<string, I18nKey>;

type FloatingNavigatorLabel = keyof typeof FLOATING_NAVIGATOR_I18N_KEYS;

let floatingNavigatorView: FloatingNavigatorView = "all";
let floatingConversationId = "";
let floatingFavorites: FloatingFavorite[] = [];
let floatingFavoritesLoadVersion = 0;
let floatingFavoritesSaveQueue: Promise<void> = Promise.resolve();
let floatingNavigatorTranslations: TranslationMap = translationsFor("en", []);

function floatingLabel(key: FloatingNavigatorLabel, values?: Record<string, string | number>): string {
  const i18nKey = FLOATING_NAVIGATOR_I18N_KEYS[key];
  return formatTranslation(floatingNavigatorTranslations[i18nKey] ?? translationsFor("en", [])[i18nKey], values);
}

function refreshFloatingNavigatorTranslations(): void {
  void loadLanguageSettings().then((settings) => {
    floatingNavigatorTranslations = translationsFor(settings.mode, settings.customLanguages);
    renderFloatingNavigator();
  });
}

function setFloatingConversationId(conversationId: string): void {
  const nextConversationId = conversationId.trim();
  if (nextConversationId === floatingConversationId) return;
  floatingConversationId = nextConversationId;
  floatingNavigatorView = "all";
  floatingFavorites = [];
  const loadVersion = ++floatingFavoritesLoadVersion;
  if (!nextConversationId) {
    renderFloatingNavigator();
    return;
  }
  void loadFloatingFavorites(nextConversationId)
    .then((favorites) => {
      if (loadVersion !== floatingFavoritesLoadVersion || floatingConversationId !== nextConversationId) return;
      floatingFavorites = favorites;
      renderFloatingNavigator();
    })
    .catch(() => {
      if (loadVersion !== floatingFavoritesLoadVersion || floatingConversationId !== nextConversationId) return;
      floatingFavorites = [];
      renderFloatingNavigator();
    });
}

function syncFloatingTurnsFromAdapter(): void {
  const adapter = getCurrentAdapter();
  if (!adapter) return;
  const turns = adapter.getLatestTurns();
  const message = adapter.toTurnsMessage(turns);
  const conversationChanged = message.conversationId.trim() !== floatingConversationId;
  floatingTurns = conversationChanged ? turns : mergeFloatingTurns(floatingTurns, turns);
  setFloatingConversationId(message.conversationId);
}

function storedFavoriteAsTurn(favorite: FloatingFavorite): Turn {
  return {
    id: `favorite:${favorite.identity}`,
    turnIndex: favorite.turnIndex,
    userText: favorite.userText,
    assistantText: "",
    sourceAnchor: favorite.sourceAnchor,
    navigation: favorite.navigation,
    extractedAt: favorite.savedAt
  };
}

function floatingNavigatorEntries(): FloatingNavigatorEntry[] {
  if (floatingNavigatorView === "all") {
    return floatingTurns.map((turn) => ({
      turn,
      unavailable: false
    }));
  }
  return resolveFloatingFavorites(floatingFavorites, floatingTurns).map(({ favorite, turn }) => ({
    turn: turn ?? storedFavoriteAsTurn(favorite),
    favorite,
    unavailable: !turn
  }));
}

function toggleFloatingFavorite(turn: Turn, favorite?: FloatingFavorite): void {
  if (!floatingConversationId) return;
  const previousFavorites = floatingFavorites;
  const conversationId = floatingConversationId;
  floatingFavorites = favorite && !floatingTurns.some((candidate) => candidate === turn)
    ? floatingFavorites.filter((candidate) => candidate.identity !== favorite.identity)
    : toggleTurnFavorite(turn, floatingFavorites);
  renderFloatingNavigator();
  const favoritesToSave = floatingFavorites;
  floatingFavoritesSaveQueue = floatingFavoritesSaveQueue
    .catch(() => undefined)
    .then(() => saveFloatingFavorites(conversationId, favoritesToSave))
    .catch(() => {
      if (floatingConversationId !== conversationId || floatingFavorites !== favoritesToSave) return;
      floatingFavorites = previousFavorites;
      renderFloatingNavigator();
    });
}
function floatingPanelEnabledKey(): string {
  return "turnmap.floatingPanel.enabled";
}

function themeStorageKey(): string {
  return "turnmap.interface.theme";
}

function launcherEnabledKey(): string {
  return "turnmap.launcher.enabled";
}

function launcherPositionKey(): string {
  return "turnmap.launcher.position";
}

function removeFloatingPanel(): void {
  cancelFloatingNavigatorOpen();
  cancelFloatingNavigatorClose();
  floatingNavigatorViewSwitchGraceUntil = 0;
  floatingPanel?.remove();
  floatingPanel = null;
}

function removeLauncher(): void {
  removeFloatingPanel();
  launcherButton?.remove();
  launcherButton = null;
}

function normalizeFloatingTheme(value: unknown): FloatingThemeMode {
  return value === "browser" || value === "day" || value === "night" || value === "eye-care" ? value : "browser";
}

function resolveFloatingTheme(theme: FloatingThemeMode): Exclude<FloatingThemeMode, "browser"> {
  if (theme !== "browser") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function applyFloatingTheme(theme: FloatingThemeMode = floatingThemeSetting): void {
  floatingThemeSetting = normalizeFloatingTheme(theme);
  if (!floatingPanel) return;
  floatingPanel.dataset.turnmapTheme = resolveFloatingTheme(floatingThemeSetting);
  floatingPanel.dataset.turnmapThemeSetting = floatingThemeSetting;
}

function loadFloatingTheme(): void {
  void chrome.storage.local.get(themeStorageKey()).then((result) => {
    applyFloatingTheme(normalizeFloatingTheme(result[themeStorageKey()]));
  });
}

function canShowFloatingNavigator(): boolean {
  return Boolean(floatingNavigatorEnabled && Boolean(activeAdapter) && launcherButton && !launcherMovedDuringPointer);
}

function cancelFloatingNavigatorOpen(): void {
  if (floatingNavigatorOpenTimer === null) return;
  window.clearTimeout(floatingNavigatorOpenTimer);
  floatingNavigatorOpenTimer = null;
}

function cancelFloatingNavigatorClose(): void {
  if (floatingNavigatorCloseTimer === null) return;
  window.clearTimeout(floatingNavigatorCloseTimer);
  floatingNavigatorCloseTimer = null;
}

function holdFloatingNavigatorOpenAfterViewSwitch(): void {
  floatingNavigatorViewSwitchGraceUntil = Date.now() + FLOATING_NAVIGATOR_VIEW_SWITCH_GRACE_MS;
  cancelFloatingNavigatorClose();
}

function scheduleFloatingNavigatorOpen(): void {
  if (!canShowFloatingNavigator()) return;
  cancelFloatingNavigatorClose();
  cancelFloatingNavigatorOpen();
  floatingNavigatorOpenTimer = window.setTimeout(() => {
    floatingNavigatorOpenTimer = null;
    if (!canShowFloatingNavigator()) return;
    syncFloatingTurnsFromAdapter();
    ensureFloatingPanel();
  }, FLOATING_NAVIGATOR_HOVER_DELAY_MS);
}

function scheduleFloatingNavigatorClose(): void {
  cancelFloatingNavigatorOpen();
  cancelFloatingNavigatorClose();
  const delay = Math.max(
    FLOATING_NAVIGATOR_CLOSE_DELAY_MS,
    floatingNavigatorViewSwitchGraceUntil - Date.now()
  );
  floatingNavigatorCloseTimer = window.setTimeout(() => {
    floatingNavigatorCloseTimer = null;
    if (floatingPanel?.matches(":hover") || launcherButton?.matches(":hover")) return;
    removeFloatingPanel();
  }, delay);
}

function positionFloatingNavigatorNearLauncher(): void {
  if (!floatingPanel || !launcherButton) return;
  const margin = 8;
  const launcherRect = launcherButton.getBoundingClientRect();
  const width = floatingPanel.offsetWidth || 320;
  const height = Math.min(floatingPanel.offsetHeight || 360, window.innerHeight * 0.6);
  const rightLeft = launcherRect.right + 8;
  const leftLeft = launcherRect.left - width - 8;
  const left = rightLeft + width <= window.innerWidth - margin ? rightLeft : Math.max(margin, leftLeft);
  const top = Math.max(margin, Math.min(window.innerHeight - height - margin, launcherRect.top + launcherRect.height / 2 - height / 2));

  floatingPanel.style.left = `${left}px`;
  floatingPanel.style.top = `${top}px`;
  floatingPanel.style.right = "auto";
  floatingPanel.style.bottom = "auto";
}

async function performJumpToTurn(message: JumpToTurnMessage): Promise<unknown> {
  const adapter = await activeAdapterReady;
  if (!adapter) {
    return { ok: false, reason: "This AI conversation site is not supported yet." };
  }

  const resumeObserver = adapter.site.id === "chatgpt"
    ? pauseChatGptObserverForNavigation()
    : null;
  try {
    return await adapter.jumpToTurn({
      navigation: message.navigation,
      anchor: message.anchor,
      promptText: message.promptText
    });
  } finally {
    resumeObserver?.();
  }
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
}

function mergeFloatingTurns(existingTurns: Turn[], incomingTurns: Turn[]): Turn[] {
  if (incomingTurns.length === 0) return existingTurns;
  if (existingTurns.length === 0) return incomingTurns;
  if (incomingTurns.length >= existingTurns.length) return mergeTurns(existingTurns, incomingTurns);

  const merged = mergeTurns(existingTurns, incomingTurns);
  return merged.length >= existingTurns.length ? merged : existingTurns;
}

function getVisibleChatGptTurnIndex(): number | null {
  const users = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
  });
  if (users.length === 0) return null;

  const viewportCenter = window.innerHeight / 2;
  const visible = users
    .map((element, visibleIndex) => {
      const rect = element.getBoundingClientRect();
      const message = element.closest<HTMLElement>("[data-message-id]") ?? element.querySelector<HTMLElement>("[data-message-id]");
      const turn =
        element.closest<HTMLElement>("[data-turn-id], [data-turn-id-container], [data-testid^='conversation-turn']") ??
        element.querySelector<HTMLElement>("[data-turn-id], [data-turn-id-container], [data-testid^='conversation-turn']");
      const messageId = message?.getAttribute("data-message-id") ?? null;
      const turnId =
        turn?.getAttribute("data-turn-id") ??
        turn?.getAttribute("data-turn-id-container") ??
        turn?.getAttribute("data-testid") ??
        null;
      return {
        visibleIndex,
        messageId,
        turnId,
        distance: Math.abs(rect.top + rect.height / 2 - viewportCenter)
      };
    })
    .sort((left, right) => left.distance - right.distance)[0];

  if (!visible) return null;

  const byIdentity = floatingTurns.find((turn) => {
    const navigation = turn.navigation;
    return (
      (visible.messageId && (navigation?.messageId === visible.messageId || turn.sourceAnchor.userMessageId === visible.messageId)) ||
      (visible.turnId && navigation?.turnId === visible.turnId)
    );
  });
  if (byIdentity) return byIdentity.turnIndex;

  return floatingTurns[visible.visibleIndex]?.turnIndex ?? null;
}

function renderFloatingNavigator(): void {
  if (!floatingPanel) return;
  const previousList = floatingPanel.querySelector<HTMLElement>(".turnmap-floating-list");
  const previousScrollTop = previousList?.scrollTop ?? 0;
  const previousWasNearBottom = previousList
    ? previousList.scrollTop + previousList.clientHeight >= previousList.scrollHeight - 16
    : false;
  floatingPanel.innerHTML = "";

  const tabs = document.createElement("div");
  tabs.className = "turnmap-floating-tabs";
  tabs.setAttribute("role", "tablist");
  ([
    ["all", "all", "\u2261"],
    ["favorites", "favorites", "\u2605"]
  ] as const).forEach(([view, labelKey, icon]) => {
    const tab = document.createElement("button");
    const label = floatingLabel(labelKey);
    tab.type = "button";
    tab.className = "turnmap-floating-tab";
    tab.textContent = icon;
    tab.title = label;
    tab.setAttribute("aria-label", label);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(floatingNavigatorView === view));
    if (floatingNavigatorView === view) tab.dataset.active = "true";
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (floatingNavigatorView === view) return;
      floatingNavigatorView = view;
      holdFloatingNavigatorOpenAfterViewSwitch();
      renderFloatingNavigator();
    });
    tabs.append(tab);
  });

  const list = document.createElement("div");
  list.className = "turnmap-floating-list";
  list.addEventListener("wheel", containFloatingWheel, { passive: false });
  const activeTurnIndex = getVisibleChatGptTurnIndex();
  const entries = floatingNavigatorEntries();
  entries.forEach(({ turn, favorite, unavailable }) => {
    const card = document.createElement("article");
    card.className = "turnmap-floating-card";
    if (unavailable) card.dataset.unavailable = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "turnmap-floating-turn";
    button.title = unavailable ? floatingLabel("unavailable") : floatingLabel("jump");
    button.dataset.turnIndex = String(turn.turnIndex);
    if (turn.turnIndex === activeTurnIndex && !unavailable) {
      button.dataset.active = "true";
      button.setAttribute("aria-current", "true");
    }
    const turnLabel = document.createElement("span");
    turnLabel.textContent = floatingLabel("turn", { number: turn.turnIndex + 1 });
    const question = document.createElement("strong");
    question.textContent = previewText(turn.userText);
    button.append(turnLabel, question);
    if (unavailable) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      const unavailableNote = document.createElement("p");
      unavailableNote.textContent = floatingLabel("unavailable");
      button.append(unavailableNote);
    } else {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.focus();
        void performJumpToTurn({
          type: "TURNMAP_JUMP_TO_TURN",
          navigation: turn.navigation,
          anchor: turn.sourceAnchor,
          promptText: turn.navigation?.site === "chatgpt" ? turn.userText : undefined
        });
      });
    }

    const favorited = Boolean(favorite) || isTurnFavorited(turn, floatingFavorites);
    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "turnmap-floating-favorite";
    favoriteButton.textContent = favorited ? "\u2605" : "\u2606";
    favoriteButton.title = floatingLabel(favorited ? "removeFavorite" : "addFavorite");
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.setAttribute("aria-pressed", String(favorited));
    if (favorited) favoriteButton.dataset.active = "true";
    favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFloatingFavorite(turn, favorite);
    });

    card.append(button, favoriteButton);
    list.append(card);
  });

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = floatingLabel(floatingNavigatorView === "favorites" ? "emptyFavorites" : "emptyAll");
    list.append(empty);
  }

  floatingPanel.append(tabs, list);
  list.scrollTop = previousWasNearBottom ? list.scrollHeight : previousScrollTop;
  if (activeTurnIndex !== null && previousList === null && floatingNavigatorView === "all") {
    list.querySelector<HTMLElement>(`button[data-turn-index="${activeTurnIndex}"]`)?.scrollIntoView({
      block: "center",
      inline: "nearest"
    });
  }
}

function containFloatingWheel(event: WheelEvent): void {
  event.preventDefault();
  event.stopPropagation();

  const list = event.currentTarget as HTMLElement;
  list.scrollTop += event.deltaY;
  list.scrollLeft += event.deltaX;
}

function ensureFloatingPanel(): void {
  if (floatingPanel) {
    renderFloatingNavigator();
    positionFloatingNavigatorNearLauncher();
    return;
  }

  const style = document.createElement("style");
  style.id = "turnmap-floating-style";
  style.textContent = `
    .turnmap-floating-panel {
      --turnmap-float-bg: rgba(255, 255, 255, 0.96);
      --turnmap-float-surface: #ffffff;
      --turnmap-float-surface-soft: #f7fbff;
      --turnmap-float-border: #d7e3ec;
      --turnmap-float-border-strong: #a9c3d4;
      --turnmap-float-text: #102033;
      --turnmap-float-muted: #708397;
      --turnmap-float-note: #5c6f82;
      --turnmap-float-shadow: rgba(20, 68, 105, 0.14);
      background: var(--turnmap-float-bg);
      border: 1px solid var(--turnmap-float-border);
      border-radius: 8px;
      box-shadow: 0 18px 42px var(--turnmap-float-shadow);
      color: var(--turnmap-float-text);
      display: block;
      font: 12px Inter, ui-sans-serif, system-ui, sans-serif;
      max-height: min(60vh, calc(100vh - 16px));
      min-height: 0;
      overflow: hidden;
      padding: 10px;
      position: fixed;
      width: min(320px, calc(100vw - 16px));
      z-index: 2147483600;
    }
    .turnmap-floating-panel[data-turnmap-theme="night"] {
      --turnmap-float-bg: rgba(15, 23, 34, 0.96);
      --turnmap-float-surface: #162232;
      --turnmap-float-surface-soft: #101a27;
      --turnmap-float-border: #314457;
      --turnmap-float-border-strong: #4d6b84;
      --turnmap-float-text: #e6eef7;
      --turnmap-float-muted: #9fb2c5;
      --turnmap-float-note: #b7c7d7;
      --turnmap-float-shadow: rgba(0, 0, 0, 0.34);
    }
    .turnmap-floating-panel[data-turnmap-theme="eye-care"] {
      --turnmap-float-bg: rgba(255, 255, 250, 0.96);
      --turnmap-float-surface: #fffef5;
      --turnmap-float-surface-soft: #f4faea;
      --turnmap-float-border: #d8e4c6;
      --turnmap-float-border-strong: #a9bf8e;
      --turnmap-float-text: #25311e;
      --turnmap-float-muted: #68795a;
      --turnmap-float-note: #5f704f;
      --turnmap-float-shadow: rgba(73, 96, 52, 0.16);
    }
    .turnmap-floating-panel button {
      background: linear-gradient(180deg, var(--turnmap-float-surface) 0%, var(--turnmap-float-surface-soft) 100%);
      border: 1px solid var(--turnmap-float-border-strong);
      border-radius: 6px;
      color: var(--turnmap-float-text);
      cursor: pointer;
      font: inherit;
      padding: 5px 8px;
    }
    .turnmap-floating-tabs {
      display: flex;
      gap: 5px;
      margin-bottom: 8px;
    }
    .turnmap-floating-tab {
      align-items: center;
      display: inline-flex;
      font-size: 16px !important;
      height: 30px;
      justify-content: center;
      line-height: 1;
      padding: 0 !important;
      transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
      width: 30px;
    }
    .turnmap-floating-tab[data-active="true"] {
      border-color: #10a37f;
      box-shadow: inset 0 -2px 0 #10a37f;
      color: #087b60;
    }
    .turnmap-floating-list {
      display: grid;
      gap: 6px;
      max-height: calc(min(60vh, calc(100vh - 16px)) - 58px);
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding-right: 2px;
      scrollbar-gutter: stable;
      overscroll-behavior: contain;
    }
    .turnmap-floating-card {
      display: grid;
      gap: 6px;
      grid-template-columns: minmax(0, 1fr) 32px;
      min-width: 0;
    }
    .turnmap-floating-turn {
      box-sizing: border-box;
      display: grid;
      gap: 3px;
      justify-items: start;
      min-height: 67px;
      min-width: 0;
      text-align: left;
      width: 100%;
    }
    .turnmap-floating-turn[data-active="true"] {
      border-color: #10a37f;
      box-shadow: inset 3px 0 0 #10a37f;
    }
    .turnmap-floating-turn:disabled {
      cursor: not-allowed;
      opacity: 0.72;
    }
    .turnmap-floating-favorite {
      align-self: start;
      display: grid;
      font-size: 18px !important;
      height: 32px;
      line-height: 1;
      padding: 0 !important;
      place-items: center;
      transition: border-color 140ms ease, color 140ms ease, transform 140ms ease;
      width: 32px;
    }
    .turnmap-floating-favorite:hover,
    .turnmap-floating-favorite:focus-visible {
      transform: translateY(-1px);
    }
    .turnmap-floating-favorite[data-active="true"] {
      border-color: #d79716;
      color: #d79716;
    }
    .turnmap-floating-list span {
      color: var(--turnmap-float-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .turnmap-floating-list strong {
      color: var(--turnmap-float-text);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .turnmap-floating-list p {
      color: var(--turnmap-float-note);
      margin: 0;
    }
  `;
  if (!document.getElementById(style.id)) document.documentElement.append(style);

  floatingPanel = document.createElement("aside");
  floatingPanel.className = "turnmap-floating-panel";
  floatingPanel.addEventListener("mouseenter", cancelFloatingNavigatorClose);
  floatingPanel.addEventListener("mouseleave", scheduleFloatingNavigatorClose);
  document.body.append(floatingPanel);
  applyFloatingTheme();
  loadFloatingTheme();
  renderFloatingNavigator();
  positionFloatingNavigatorNearLauncher();
}

function setFloatingPanel(enabled: boolean, persist = true): void {
  if (persist) {
    void chrome.storage.local.set({ [floatingPanelEnabledKey()]: enabled });
  }
  floatingNavigatorEnabled = enabled;
  if (enabled) {
    syncFloatingTurnsFromAdapter();
  } else {
    removeFloatingPanel();
  }
}

function openSidePanelFromLauncher(): void {
  void chrome.runtime.sendMessage({ type: "TURNMAP_OPEN_SIDE_PANEL" }).catch(() => {
    launcherButton?.setAttribute("title", "ChatMap could not open the side panel.");
  });
}

function openSettingsFromLauncher(): void {
  void chrome.runtime.sendMessage({ type: "TURNMAP_OPEN_SETTINGS" }).catch(() => {
    launcherButton?.setAttribute("title", "ChatMap settings could not be opened.");
  });
}

function ensureLauncherStyle(): void {
  document.getElementById("turnmap-launcher-style")?.remove();
  if (document.getElementById("chatmap-launcher-style")) return;

  const style = document.createElement("style");
  style.id = "chatmap-launcher-style";
  style.textContent = `
    .turnmap-launcher {
      all: initial;
      align-items: center;
      appearance: none;
      background: transparent;
      border: 0;
      border-radius: 12px;
      box-shadow: 0 12px 28px rgba(10, 40, 68, 0.28);
      box-sizing: border-box;
      color: #ffffff;
      cursor: pointer;
      display: grid;
      font: 700 12px Inter, ui-sans-serif, system-ui, sans-serif;
      height: 44px;
      justify-items: center;
      line-height: 1;
      overflow: hidden;
      padding: 0;
      position: fixed;
      right: 18px;
      top: 38vh;
      user-select: none;
      width: 44px;
      z-index: 2147483599;
    }
    .turnmap-launcher img {
      display: block;
      height: 44px;
      object-fit: contain;
      pointer-events: none;
      width: 44px;
    }
    .turnmap-launcher:hover {
      box-shadow: 0 14px 34px rgba(20, 120, 200, 0.32);
      transform: translateY(-1px);
    }
    .turnmap-launcher:focus-visible {
      outline: 3px solid rgba(16, 163, 127, 0.32);
      outline-offset: 3px;
    }
  `;
  document.documentElement.append(style);
}

function clampLauncherPosition(position: FloatingPosition): FloatingPosition {
  const size = 44;
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(position.left, window.innerWidth - size - margin)),
    top: Math.max(margin, Math.min(position.top, window.innerHeight - size - margin))
  };
}

function applyLauncherPosition(position: FloatingPosition): void {
  if (!launcherButton) return;
  const next = clampLauncherPosition(position);
  launcherButton.style.left = `${next.left}px`;
  launcherButton.style.top = `${next.top}px`;
  launcherButton.style.right = "auto";
}

function saveLauncherPosition(position: FloatingPosition): void {
  void chrome.storage.local.set({ [launcherPositionKey()]: clampLauncherPosition(position) });
}

function loadLauncherPosition(): void {
  void chrome.storage.local.get(launcherPositionKey()).then((result) => {
    const value = result[launcherPositionKey()];
    if (
      value &&
      typeof value === "object" &&
      typeof (value as FloatingPosition).left === "number" &&
      typeof (value as FloatingPosition).top === "number"
    ) {
      applyLauncherPosition(value as FloatingPosition);
    }
  });
}

function attachLauncherDrag(button: HTMLButtonElement): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    launcherMovedDuringPointer = false;
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      launcherMovedDuringPointer = true;
      cancelFloatingNavigatorOpen();
      removeFloatingPanel();
    }
    if (!launcherMovedDuringPointer) return;
    event.preventDefault();
    applyLauncherPosition({
      left: startLeft + dx,
      top: startTop + dy
    });
  });

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    button.releasePointerCapture(event.pointerId);
    const rect = button.getBoundingClientRect();
    saveLauncherPosition({ left: rect.left, top: rect.top });
  };

  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", finish);
}

function ensureLauncher(): void {
  if (launcherButton) return;
  ensureLauncherStyle();

  launcherButton = document.createElement("button");
  launcherButton.type = "button";
  launcherButton.className = "turnmap-launcher";
  launcherButton.textContent = "";
  launcherButton.setAttribute("aria-label", "Open ChatMap");
  const icon = document.createElement("img");
  icon.src = getTurnMapLauncherIconUrl();
  icon.alt = "";
  launcherButton.append(icon);
  void loadTurnMapLauncherIconSrc().then((src) => {
    if (icon.isConnected) icon.src = src;
  });
  launcherButton.addEventListener("click", (event) => {
    if (launcherMovedDuringPointer) {
      event.preventDefault();
      launcherMovedDuringPointer = false;
      return;
    }
    openSidePanelFromLauncher();
  });
  launcherButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openSettingsFromLauncher();
  });
  launcherButton.addEventListener("mouseenter", scheduleFloatingNavigatorOpen);
  launcherButton.addEventListener("mouseleave", scheduleFloatingNavigatorClose);
  attachLauncherDrag(launcherButton);
  document.body.append(launcherButton);
  loadLauncherPosition();
}

function syncLauncherFromStorage(): void {
  void chrome.storage.local.get(launcherEnabledKey()).then((result) => {
    if (result[launcherEnabledKey()] === false) {
      removeLauncher();
    } else {
      ensureLauncher();
    }
  });
}

function startTurnMapContentUi(): void {
  syncLauncherFromStorage();
  startPromptWorkbench();
  refreshFloatingNavigatorTranslations();
  window.addEventListener("resize", positionFloatingNavigatorNearLauncher);

  void chrome.storage.local.get(floatingPanelEnabledKey()).then((result) => {
    if (result[floatingPanelEnabledKey()]) {
      floatingNavigatorEnabled = true;
      syncFloatingTurnsFromAdapter();
    }
  });
}

function startTurnMapContentObservers(adapter: ConversationAdapter | null = activeAdapter): void {
  adapter?.startObserver((turns) => broadcastTurns(adapter.toTurnsMessage(turns)));
}

function startTurnMapContentStorageListener(): void {
  startContentPhase(contentLifecycle, "storage", () => {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (launcherEnabledKey() in changes) {
        syncLauncherFromStorage();
      }
      if (floatingPanelEnabledKey() in changes) {
        setFloatingPanel(Boolean(changes[floatingPanelEnabledKey()].newValue), false);
      }
      if (themeStorageKey() in changes) {
        applyFloatingTheme(normalizeFloatingTheme(changes[themeStorageKey()].newValue));
      }
      if (LANGUAGE_STORAGE_KEY in changes || CUSTOM_LANGUAGES_STORAGE_KEY in changes) {
        refreshFloatingNavigatorTranslations();
      }
    });
  });
}

function startTurnMapContentThemeMediaListener(): void {
  startContentPhase(contentLifecycle, "theme", () => {
    window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
      if (floatingThemeSetting === "browser") applyFloatingTheme("browser");
    });
  });
}

function startTurnMapContentMessageListener(): void {
  startContentPhase(contentLifecycle, "messages", () => chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isContentCommand(message)) return false;

    if (message.type === "TURNMAP_REQUEST_TURNS") {
      void (async () => {
        const adapter = await activeAdapterReady;
        if (!adapter) {
          sendResponse(toUnsupportedTurnsMessage());
          return;
        }

        const operation =
          "harvest" in message && message.harvest
            ? adapter.harvestTurnsByScrolling()
            : "ensureFull" in message && message.ensureFull
              ? adapter.refreshCompleteTurns()
              : adapter.refreshLatestTurns();
        operation
          .then((turns) => sendResponse(adapter.toTurnsMessage(turns)))
          .catch((error: unknown) => {
            const fallback = adapter.toTurnsMessage(adapter.getLatestTurns());
            const scanError = error instanceof Error ? error.message : String(error);
            sendResponse({
              ...fallback,
              harvestMeta: {
                ...(fallback.harvestMeta ?? {
                  attempted: true,
                  source: "dom",
                  scrollContainer: "unknown",
                  scrollHeight: 0,
                  clientHeight: 0,
                  scannedSteps: 0
                }),
                complete: false,
                scanError
              }
            });
          });
      })();
      return true;
    }

    if (message.type === "TURNMAP_VALIDATE_CUSTOM_SITE") {
      sendResponse(
        previewCustomSiteProfile(
          message.profile
        )
      );
      return true;
    }

    if (message.type === "TURNMAP_JUMP_TO_TURN") {
      performJumpToTurn(message)
        .then(sendResponse)
        .catch(() =>
          sendResponse({ ok: false, reason: "The original conversation turn could not be found." })
        );
      return true;
    }

    if (message.type === "TURNMAP_SET_FLOATING_PANEL") {
      setFloatingPanel(message.enabled);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "TURNMAP_SYNC_LAUNCHER") {
      syncLauncherFromStorage();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  }));
}

const launcherNeedsRepair = !document.querySelector(".turnmap-launcher") || !document.getElementById("chatmap-launcher-style");

const uiStarted = startContentPhase(contentLifecycle, "ui", startTurnMapContentUi);
if (!uiStarted && launcherNeedsRepair) startTurnMapContentUi();

startTurnMapContentStorageListener();
startTurnMapContentThemeMediaListener();
startTurnMapContentMessageListener();
void (async () => {
  const adapter = await activeAdapterReady;
  if (adapter) {
    startContentPhase(contentLifecycle, "observer", () => startTurnMapContentObservers(adapter));
  }
  if (adapter && floatingNavigatorEnabled) syncFloatingTurnsFromAdapter();
})();
