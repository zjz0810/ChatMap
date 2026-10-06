import { loadDefaultLayout, saveDefaultLayout, type LayoutMode } from "../graph/graph-storage";
import {
  normalizeConversationGraphLayoutSettings,
  type ConversationGraphLayoutSettings
} from "../graph/graph-layout.ts";
import { DEFAULT_THEME, THEME_STORAGE_KEY, normalizeTheme, type ThemeMode } from "./theme-storage";

const FLOATING_PANEL_ENABLED_KEY = "turnmap.floatingPanel.enabled";
const LAUNCHER_ENABLED_KEY = "turnmap.launcher.enabled";
const UPDATE_NOTICE_ENABLED_KEY = "turnmap.updateNotice.enabled";
const UPDATE_NOTICE_PRERELEASE_KEY = "turnmap.updateNotice.includePrerelease";
const IGNORED_VERSION_KEY = "turnmap.updateNotice.ignoredVersion";
const NODE_COLOR_RENDER_MODE_KEY = "turnmap.nodeColor.renderMode";
const NODE_COLOR_RENDER_STRENGTH_KEY = "turnmap.nodeColor.renderStrength";
const LINK_CONNECTION_STYLE_KEY = "turnmap.link.connectionStyle";
const DEFAULT_LAYOUT_STORAGE_KEY = "turnmap.defaultLayout";
const DEFAULT_NODE_WIDTH_KEY = "turnmap.nodeSize.defaultWidth";
const DEFAULT_NODE_HEIGHT_KEY = "turnmap.nodeSize.defaultHeight";
const DEFAULT_NODE_PROMPT_RATIO_KEY = "turnmap.nodeSize.promptRatio";
const GRAPH_LAYOUT_COLUMNS_KEY = "turnmap.graphLayout.columnsPerRow";
const GRAPH_LAYOUT_HORIZONTAL_SPACING_KEY = "turnmap.graphLayout.horizontalSpacing";
const GRAPH_LAYOUT_VERTICAL_SPACING_KEY = "turnmap.graphLayout.verticalSpacing";
const GRAPH_LAYOUT_ARRANGEMENT_KEY = "turnmap.graphLayout.arrangement";
const GRAPH_LAYOUT_SEQUENCE_EDGES_KEY = "turnmap.graphLayout.showSequenceEdges";

export const UI_SETTINGS_STORAGE_KEYS = [
  FLOATING_PANEL_ENABLED_KEY,
  LAUNCHER_ENABLED_KEY,
  UPDATE_NOTICE_ENABLED_KEY,
  UPDATE_NOTICE_PRERELEASE_KEY,
  IGNORED_VERSION_KEY,
  THEME_STORAGE_KEY,
  NODE_COLOR_RENDER_MODE_KEY,
  NODE_COLOR_RENDER_STRENGTH_KEY,
  LINK_CONNECTION_STYLE_KEY,
  DEFAULT_LAYOUT_STORAGE_KEY,
  DEFAULT_NODE_WIDTH_KEY,
  DEFAULT_NODE_HEIGHT_KEY,
  DEFAULT_NODE_PROMPT_RATIO_KEY,
  GRAPH_LAYOUT_COLUMNS_KEY,
  GRAPH_LAYOUT_HORIZONTAL_SPACING_KEY,
  GRAPH_LAYOUT_VERTICAL_SPACING_KEY,
  GRAPH_LAYOUT_ARRANGEMENT_KEY,
  GRAPH_LAYOUT_SEQUENCE_EDGES_KEY
] as const;

export type NodeColorRenderMode = "gradient" | "solid";
export type LinkConnectionStyle = "curved" | "angled";
export type DefaultNodeSizeSettings = {
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  defaultNodePromptRatio: number;
};

export const DEFAULT_NODE_SIZE_SETTINGS: DefaultNodeSizeSettings = {
  defaultNodeWidth: 280,
  defaultNodeHeight: 220,
  defaultNodePromptRatio: 0.25
};

export type UiSettings = {
  defaultLayout: LayoutMode;
  theme: ThemeMode;
  floatingPanelEnabled: boolean;
  launcherEnabled: boolean;
  updateNoticeEnabled: boolean;
  includePrereleaseUpdates: boolean;
  ignoredVersion: string;
  nodeColorRenderMode: NodeColorRenderMode;
  nodeColorRenderStrength: number;
  linkConnectionStyle: LinkConnectionStyle;
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  defaultNodePromptRatio: number;
  conversationGraphLayout: ConversationGraphLayoutSettings;
};

function normalizeRenderMode(value: unknown): NodeColorRenderMode {
  return value === "solid" ? "solid" : "gradient";
}

function normalizeRenderStrength(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function normalizeLinkConnectionStyle(value: unknown): LinkConnectionStyle {
  return value === "angled" ? "angled" : "curved";
}

export function normalizeDefaultNodeWidth(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_NODE_SIZE_SETTINGS.defaultNodeWidth;
  return Math.max(220, Math.min(1200, Math.round(numeric)));
}

export function normalizeDefaultNodeHeight(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_NODE_SIZE_SETTINGS.defaultNodeHeight;
  return Math.max(120, Math.min(900, Math.round(numeric)));
}

export function normalizeDefaultNodePromptRatio(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_NODE_SIZE_SETTINGS.defaultNodePromptRatio;
  return Math.max(0, Math.min(1, Math.round(numeric * 4) / 4));
}

export async function loadUiSettings(): Promise<UiSettings> {
  const [defaultLayout, stored] = await Promise.all([
    loadDefaultLayout(),
    chrome.storage.local.get([...UI_SETTINGS_STORAGE_KEYS])
  ]);

  return {
    defaultLayout,
    theme: normalizeTheme(stored[THEME_STORAGE_KEY] ?? DEFAULT_THEME),
    floatingPanelEnabled: Boolean(stored[FLOATING_PANEL_ENABLED_KEY]),
    launcherEnabled: stored[LAUNCHER_ENABLED_KEY] !== false,
    updateNoticeEnabled: stored[UPDATE_NOTICE_ENABLED_KEY] !== false,
    includePrereleaseUpdates: Boolean(stored[UPDATE_NOTICE_PRERELEASE_KEY]),
    ignoredVersion: typeof stored[IGNORED_VERSION_KEY] === "string" ? stored[IGNORED_VERSION_KEY] : "",
    nodeColorRenderMode: normalizeRenderMode(stored[NODE_COLOR_RENDER_MODE_KEY]),
    nodeColorRenderStrength: normalizeRenderStrength(stored[NODE_COLOR_RENDER_STRENGTH_KEY]),
    linkConnectionStyle: normalizeLinkConnectionStyle(stored[LINK_CONNECTION_STYLE_KEY]),
    defaultNodeWidth: normalizeDefaultNodeWidth(stored[DEFAULT_NODE_WIDTH_KEY]),
    defaultNodeHeight: normalizeDefaultNodeHeight(stored[DEFAULT_NODE_HEIGHT_KEY]),
    defaultNodePromptRatio: normalizeDefaultNodePromptRatio(stored[DEFAULT_NODE_PROMPT_RATIO_KEY]),
    conversationGraphLayout: normalizeConversationGraphLayoutSettings({
      columnsPerRow: stored[GRAPH_LAYOUT_COLUMNS_KEY],
      horizontalSpacing: stored[GRAPH_LAYOUT_HORIZONTAL_SPACING_KEY],
      verticalSpacing: stored[GRAPH_LAYOUT_VERTICAL_SPACING_KEY],
      arrangement: stored[GRAPH_LAYOUT_ARRANGEMENT_KEY],
      showSequenceEdges: stored[GRAPH_LAYOUT_SEQUENCE_EDGES_KEY]
    })
  };
}

export async function saveUiSettings(settings: UiSettings): Promise<void> {
  const graphLayout = normalizeConversationGraphLayoutSettings(settings.conversationGraphLayout);
  await Promise.all([
    saveDefaultLayout(settings.defaultLayout),
    chrome.storage.local.set({
      [FLOATING_PANEL_ENABLED_KEY]: settings.floatingPanelEnabled,
      [LAUNCHER_ENABLED_KEY]: settings.launcherEnabled,
      [UPDATE_NOTICE_ENABLED_KEY]: settings.updateNoticeEnabled,
      [UPDATE_NOTICE_PRERELEASE_KEY]: settings.includePrereleaseUpdates,
      [IGNORED_VERSION_KEY]: settings.ignoredVersion.trim(),
      [THEME_STORAGE_KEY]: settings.theme,
      [NODE_COLOR_RENDER_MODE_KEY]: settings.nodeColorRenderMode,
      [NODE_COLOR_RENDER_STRENGTH_KEY]: normalizeRenderStrength(settings.nodeColorRenderStrength),
      [LINK_CONNECTION_STYLE_KEY]: normalizeLinkConnectionStyle(settings.linkConnectionStyle),
      [DEFAULT_NODE_WIDTH_KEY]: normalizeDefaultNodeWidth(settings.defaultNodeWidth),
      [DEFAULT_NODE_HEIGHT_KEY]: normalizeDefaultNodeHeight(settings.defaultNodeHeight),
      [DEFAULT_NODE_PROMPT_RATIO_KEY]: normalizeDefaultNodePromptRatio(settings.defaultNodePromptRatio),
      [GRAPH_LAYOUT_COLUMNS_KEY]: graphLayout.columnsPerRow,
      [GRAPH_LAYOUT_HORIZONTAL_SPACING_KEY]: graphLayout.horizontalSpacing,
      [GRAPH_LAYOUT_VERTICAL_SPACING_KEY]: graphLayout.verticalSpacing,
      [GRAPH_LAYOUT_ARRANGEMENT_KEY]: graphLayout.arrangement,
      [GRAPH_LAYOUT_SEQUENCE_EDGES_KEY]: graphLayout.showSequenceEdges
    })
  ]);
}

export function applyNodeColorRendering(settings: Pick<UiSettings, "nodeColorRenderMode" | "nodeColorRenderStrength">): void {
  const strength = normalizeRenderStrength(settings.nodeColorRenderStrength);
  document.documentElement.dataset.turnmapNodeColorRender = settings.nodeColorRenderMode;
  document.documentElement.style.setProperty("--node-color-fill-mix", `${Math.round(8 + strength * 0.24)}%`);
  document.documentElement.style.setProperty("--node-color-border-mix", `${Math.round(20 + strength * 0.55)}%`);
  document.documentElement.style.setProperty("--node-color-shadow-mix", `${Math.round(6 + strength * 0.24)}%`);
}
