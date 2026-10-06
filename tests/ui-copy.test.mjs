import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("empty map copy is site-neutral for multi-site adapters", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  assert.doesNotMatch(canvasSource, /Open a ChatGPT conversation/);
  assert.match(canvasSource, /app\.empty\.title/);
  assert.match(canvasSource, /app\.empty\.hint/);
  assert.doesNotMatch(canvasSource, />No map yet</);
  assert.doesNotMatch(canvasSource, /Open a supported AI conversation with at least one complete answer\./);
  assert.match(i18nSource, /"app\.empty\.title": "No map yet"/);
  assert.match(i18nSource, /"app\.empty\.hint": "Open a supported AI conversation with at least one complete answer\."/);
  assert.match(i18nSource, /Open a supported AI conversation tab, then refresh ChatMap\./);
});

test("ChatMap JSON and visual exports preserve appearance settings", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const turnNodeSource = await readFile(new URL("../src/side-panel/graph/TurnNode.tsx", import.meta.url), "utf8");

  assert.match(canvasSource, /schemaVersion:\s*4/);
  assert.match(canvasSource, /appearance/);
  assert.match(canvasSource, /loadExportAppearance/);
  assert.match(canvasSource, /normalizeImportedAppearance/);
  assert.match(canvasSource, /applyImportedAppearance/);
  assert.match(canvasSource, /SVG_THEME_COLORS/);
  assert.match(canvasSource, /nodeColorRendering/);
  assert.match(canvasSource, /node\.data\.collapsed/);
  assert.match(canvasSource, /node\.data\.important/);
  assert.match(canvasSource, /function renderMiniMapSvg/);
  assert.match(canvasSource, /calculateMiniMapLayout\(expansion\)/);
  assert.match(canvasSource, /mini-link/);
  assert.match(canvasSource, /mini-text/);
  assert.match(canvasSource, /isSummary && summaryTargets\.has\(link\.target\)/);
  assert.match(canvasSource, /targetEdge - direction \* Math\.min\(16, Math\.max\(8, gap \/ 2\)\)/);
  assert.match(turnNodeSource, /isSummary && summaryTargets\.has\(link\.target\)/);
  assert.match(turnNodeSource, /targetEdge - direction \* Math\.min\(16, Math\.max\(8, gap \/ 2\)\)/);
});

test("expanded answer mini maps keep node-sized coloring in live view and exports", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const turnNodeSource = await readFile(new URL("../src/side-panel/graph/TurnNode.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");

  assert.match(turnNodeSource, /nodeData\.answerExpansion\?\.displayMode === "expanded" \? "is-expanded" : ""/);
  assert.doesNotMatch(stylesSource, /\.turn-node\.is-colored\.is-expanded\s*,[\s\S]*background:\s*var\(--cm-node-bg\);/);
  assert.match(stylesSource, /\.turn-node__mini-node\s*\{[\s\S]*linear-gradient\(135deg, color-mix\(in srgb, var\(--node-accent/);
  assert.match(stylesSource, /:root\[data-turnmap-node-color-render="solid"\]\s+\.turn-node__mini-node\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--node-accent/);
  assert.match(turnNodeSource, /className=\{`turn-node__mini-node/);
  assert.match(turnNodeSource, /width:\s*item\.width/);
  assert.match(turnNodeSource, /height:\s*item\.height/);
  assert.match(turnNodeSource, /"--node-accent": colorValue\(miniNode\.color as NodeColorName\)/);
  assert.match(canvasSource, /const miniGradientId = `mini-node-accent-\$\{index\}-\$\{miniIndex\}`/);
  assert.match(canvasSource, /fill="\$\{miniFill\}"/);
  assert.match(canvasSource, /const importantGlow = node\.data\.important && !hasExpandedMiniMap/);
});

test("rebuild action is localized and regenerates layout while preserving saved user content", async () => {
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");
  const rebuildStart = appSource.indexOf("const rebuildMap = useCallback");
  const rebuildEnd = appSource.indexOf("const refreshIndexTurns = useCallback", rebuildStart);
  const rebuildHandler = appSource.slice(rebuildStart, rebuildEnd);

  assert.match(appSource, /app\.action\.rebuild/);
  assert.match(rebuildHandler, /currentTurns\.length === 0/);
  assert.match(rebuildHandler, /setRebuildRequest/);
  assert.doesNotMatch(rebuildHandler, /requestTurnsFromActiveTab|applyTurnsMessage/);
  assert.match(canvasSource, /rebuildRequest/);
  const rebuildCanvasStart = canvasSource.indexOf("const shouldRebuild =");
  const rebuildCanvasEnd = canvasSource.indexOf("const nextEdges =", rebuildCanvasStart);
  const rebuildBody = canvasSource.slice(rebuildCanvasStart, rebuildCanvasEnd);
  assert.match(canvasSource, /if \(shouldRebuild \|\| shouldMigrateSequentialLayout\) \{\s*void saveStoredGraph\(/);
  assert.match(rebuildBody, /validUserEdges/);
  assert.match(rebuildBody, /storedCustomNodes/);
  assert.match(i18nSource, /"app\.action\.rebuild": "Rebuild"/);
  assert.match(i18nSource, /"app\.action\.rebuild": "重建"/);
  assert.match(i18nSource, /"app\.status\.rebuildNoTurns": "还没有已保存的轮次可供重建。"/);
});

test("saved graph restore remaps node overrides and manual edges while turn positions come from the grid", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(canvasSource, /function buildStoredTurnIdMap/);
  assert.match(canvasSource, /sourceAnchorMatches\(anchor, turn\.sourceAnchor\)/);
  assert.match(canvasSource, /createLayoutPositions\(orderedTurns, activeLayout, activeGraphLayoutSettings\)/);
  assert.match(canvasSource, /resolveLayoutPositions\(/);
  assert.doesNotMatch(canvasSource, /remapRecordKeys\(storedGraph\.positions, storedTurnIdMap\)/);
  assert.match(canvasSource, /remapStoredEdge\(edge, storedTurnIdMap\)/);
  assert.match(canvasSource, /remapCompoundId\(id, storedTurnIdMap\)/);
});

test("interface titles, hints, placeholders, and panel chrome are localized", async () => {
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const aiPanelSource = await readFile(new URL("../src/side-panel/settings/AiSettingsPanel.tsx", import.meta.url), "utf8");
  const aiFormSource = await readFile(new URL("../src/side-panel/settings/AiSettingsForm.tsx", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  assert.match(appSource, /app\.documentTitle/);
  assert.match(appSource, /debug\.exportReportDone/);
  assert.match(settingsSource, /settings\.documentTitle/);
  assert.match(aiPanelSource, /ai\.title/);
  assert.match(aiPanelSource, /settings\.close/);
  assert.doesNotMatch(aiPanelSource, />AI Provider</);
  assert.doesNotMatch(aiPanelSource, />Close</);
  assert.doesNotMatch(canvasSource, /Layout set to \$\{/);
  assert.match(aiFormSource, /ai\.baseUrlPlaceholder/);
  assert.match(aiFormSource, /ai\.modelPlaceholder/);
  assert.match(aiFormSource, /ai\.maxTokensPlaceholder/);
  assert.match(settingsSource, /settings\.ignoredVersionPlaceholder/);

  for (const key of [
    "app.documentTitle",
    "app.documentTitle.fullPage",
    "settings.documentTitle",
    "ai.baseUrlPlaceholder",
    "ai.modelPlaceholder",
    "ai.maxTokensPlaceholder",
    "settings.ignoredVersionPlaceholder"
  ]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
  }
});

test("theme and language defaults follow the browser", async () => {
  const themeSource = await readFile(new URL("../src/side-panel/settings/theme-storage.ts", import.meta.url), "utf8");
  const localizationSource = await readFile(new URL("../src/localization/index.ts", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");

  assert.match(themeSource, /DEFAULT_THEME:\s*ThemeMode\s*=\s*"browser"/);
  assert.match(localizationSource, /DEFAULT_LANGUAGE:\s*LanguageMode\s*=\s*"browser"/);
  assert.match(settingsSource, /settings\.theme\.browser/);
  assert.match(settingsSource, /settings\.language\.browser/);
});

test("system-adjacent file and status messages are localized", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "file.exported",
    "file.importedJson",
    "file.importJsonFailed",
    "file.markdownCopied",
    "file.markdownCopyFailed",
    "file.exportPngFailed",
    "file.resetConfirm",
    "file.resetDone",
    "file.undoDone",
    "file.redoDone",
    "settings.languagePackChooseFile",
    "settings.languagePackNoFile",
    "settings.languagePackSelected"
  ]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
  }

  assert.match(canvasSource, /file\.resetConfirm/);
  assert.match(canvasSource, /file\.importedJson/);
  assert.match(canvasSource, /file\.markdownCopied/);
  assert.match(canvasSource, /file\.undoDone/);
  assert.doesNotMatch(canvasSource, /Reset this ChatMap\?/);
  assert.doesNotMatch(canvasSource, /Markdown copied to clipboard/);
  assert.doesNotMatch(canvasSource, /Imported ChatMap JSON:/);
  assert.doesNotMatch(canvasSource, /onStatus\?\(`Exported \$\{filename\}`\)/);

  assert.match(settingsSource, /languagePackInputRef/);
  assert.match(settingsSource, /settings\.languagePackChooseFile/);
  assert.match(settingsSource, /settings\.languagePackNoFile/);
  assert.match(settingsSource, /settings\.languagePackSelected/);
  assert.doesNotMatch(settingsSource, /<label>\s*\{t\("settings\.importLanguagePack"\)\}\s*<input type="file"/);
});

test("topic analysis action and status copy are localized", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "toolbar.analyzeTopics",
    "toolbar.analyzingTopics",
    "task.analyzeTopics",
    "task.analyzeTopicsDone",
    "task.analyzeTopicsNone",
    "task.analyzeTopicsFailed"
  ]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
  }

  assert.match(canvasSource, /analyzeTopics/);
  assert.match(canvasSource, /toolbar\.analyzeTopics/);
  assert.match(canvasSource, /task\.analyzeTopicsDone/);
  assert.doesNotMatch(canvasSource, />Analyze Topics</);
  assert.match(i18nSource, /"toolbar\.analyzeTopics": "Analyze Topics"/);
  assert.match(i18nSource, /"toolbar\.analyzeTopics": "分析主题"/);
});

test("link suggestion review panel keeps overflow candidates scrollable", async () => {
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  assert.match(stylesSource, /\.suggestion-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
  assert.match(stylesSource, /\.suggestion-list\s*\{[^}]*min-height:\s*0/s);
  assert.match(stylesSource, /\.suggestion-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(i18nSource, /"suggestions\.title": "Link Suggestions"/);
  assert.match(i18nSource, /"suggestions\.title": "链接建议"/);
  assert.doesNotMatch(i18nSource, /"suggestions\.title": "AI Link Suggestions"/);
});

test("edge weight and graph health copy are localized", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const taskLogSource = await readFile(new URL("../src/side-panel/task-log.ts", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of ["action.edgeWeight", "task.graphHealthDone"]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
    assert.match(canvasSource, new RegExp(key.replaceAll(".", "\\.")));
  }

  assert.match(canvasSource, /type="range"/);
  assert.match(canvasSource, /updateSelectedEdges\(\{ weight:/);
  assert.match(canvasSource, /updateSelectedEdge\(\{ weight:/);
  assert.match(canvasSource, /healthyGraphSnapshot/);
  assert.match(taskLogSource, /"graph-health"/);
});

test("link connection style setting is localized and defaults to curved edges", async () => {
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const uiSettingsSource = await readFile(new URL("../src/side-panel/settings/ui-settings-storage.ts", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "settings.linkConnectionStyle",
    "settings.linkConnectionStyleCurved",
    "settings.linkConnectionStyleAngled"
  ]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
    assert.match(settingsSource, new RegExp(key.replaceAll(".", "\\.")));
  }

  assert.match(uiSettingsSource, /LinkConnectionStyle = "curved" \| "angled"/);
  assert.match(uiSettingsSource, /normalizeLinkConnectionStyle\(value: unknown\): LinkConnectionStyle/);
  assert.match(uiSettingsSource, /value === "angled" \? "angled" : "curved"/);
  assert.match(canvasSource, /edgeTypeForLinkConnectionStyle/);
  assert.match(canvasSource, /style === "angled" \? "smoothstep" : "default"/);
  assert.match(canvasSource, /loadUiSettings\(\)/);
  assert.match(canvasSource, /activeConnectionStyle = uiSettings\.linkConnectionStyle/);
  assert.match(canvasSource, /applyEdgeStyle\(edge, activeConnectionStyle\)/);
  assert.match(canvasSource, /applyEdgeStyle\([^;]+linkConnectionStyle\)/s);
  assert.match(canvasSource, /setEdges\(\(currentEdges\) => currentEdges\.map\(\(edge\) => applyEdgeStyle\(edge, style\)\)\)/);
});

test("interface settings expose default node size controls and canvas uses them", async () => {
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const uiSettingsSource = await readFile(new URL("../src/side-panel/settings/ui-settings-storage.ts", import.meta.url), "utf8");
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "settings.defaultNodeSize",
    "settings.defaultNodeWidth",
    "settings.defaultNodeHeight",
    "settings.defaultNodePromptRatio"
  ]) {
    assert.match(settingsSource, new RegExp(key.replaceAll(".", "\\.")));
    assert.match(i18nSource, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
  }
  assert.match(uiSettingsSource, /DEFAULT_NODE_SIZE_SETTINGS/);
  assert.match(uiSettingsSource, /defaultNodeWidth:\s*280/);
  assert.match(uiSettingsSource, /defaultNodeHeight:\s*220/);
  assert.match(uiSettingsSource, /defaultNodePromptRatio:\s*0\.25/);
  assert.match(uiSettingsSource, /normalizeDefaultNodePromptRatio/);
  assert.match(settingsSource, /min="0"\s*max="1"\s*step="0\.25"/s);
  assert.match(canvasSource, /nodeSizeSettings/);
  assert.match(canvasSource, /settings\.defaultNodeWidth/);
  assert.match(canvasSource, /settings\.defaultNodeHeight/);
  assert.match(canvasSource, /settings\.defaultNodePromptRatio/);
  assert.match(canvasSource, /withInitialContentFittingDimensions\(\{[\s\S]*nodeSizeSettings/);
});

test("settings page groups controls by target object", async () => {
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/settings-page/settings-page.css", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "settings.group.appearance",
    "settings.group.mapDefaults",
    "settings.group.pageHelpers",
    "settings.group.languagePacks"
  ]) {
    assert.match(settingsSource, new RegExp(key.replaceAll(".", "\\.")));
    assert.match(i18nSource, new RegExp(`"${key.replaceAll(".", "\\.")}"`));
  }

  assert.match(settingsSource, /className="settings-setting-group"/);
  assert.match(settingsSource, /className="settings-control-grid"/);
  assert.match(settingsSource, /className="settings-check-grid"/);
  assert.match(stylesSource, /\.settings-setting-group/);
  assert.match(stylesSource, /\.settings-control-grid/);
  assert.match(stylesSource, /\.settings-check-grid/);
});

test("prompt workbench settings textareas follow the selected theme", async () => {
  const stylesSource = await readFile(new URL("../src/settings-page/settings-page.css", import.meta.url), "utf8");

  assert.match(stylesSource, /\.prompt-workbench-settings textarea\s*\{[\s\S]*background:\s*var\(--cm-surface\)/);
  assert.match(stylesSource, /\.prompt-workbench-settings textarea\s*\{[\s\S]*color:\s*var\(--cm-text\)/);
  assert.match(stylesSource, /\.prompt-workbench-settings textarea\s*\{[\s\S]*border:\s*1px solid var\(--cm-border\)/);
  assert.match(stylesSource, /\.prompt-workbench-settings textarea:focus-visible\s*\{[\s\S]*border-color:\s*var\(--cm-primary\)/);
  assert.match(stylesSource, /\.prompt-workbench-settings textarea::selection\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--cm-primary\)/);
});

test("default node size refreshes are idempotent to avoid graph reload loops", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(canvasSource, /function sameDefaultNodeSizeSettings/);
  assert.match(canvasSource, /setNodeSizeSettings\(\(current\) =>/);
  assert.match(canvasSource, /sameDefaultNodeSizeSettings\(current,\s*nextSettings\)\s*\?\s*current\s*:\s*nextSettings/);
  assert.doesNotMatch(canvasSource, /setNodeSizeSettings\(activeNodeSizeSettings\);/);
});

test("retired scrolling and fallback-search settings are absent from active UI and content code", async () => {
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const jumpSource = await readFile(new URL("../src/content/jump-controller.ts", import.meta.url), "utf8");
  const webAdapterSource = await readFile(new URL("../src/content/web-adapter-core.ts", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const debugReportSource = await readFile(new URL("../src/side-panel/debug-report.ts", import.meta.url), "utf8");
  const turnMergeSource = await readFile(new URL("../src/side-panel/turn-merge.ts", import.meta.url), "utf8");

  for (const key of [
    "settings.readingJumping",
    "settings.scrollSpeedMultiplier",
    "settings.scrollSpeedMultiplierHint",
    "settings.edgeWaitSeconds",
    "settings.edgeWaitSecondsHint",
    "settings.jumpSearchStrength",
    "settings.jumpSearchStrengthHint",
    "settings.restoreReadingDefaults",
    "settings.readingDefaultsRestored",
    "settings.saveReadingJumping",
    "settings.loadingReadingJumping"
  ]) {
    assert.doesNotMatch(settingsSource, new RegExp(key.replaceAll(".", "\\.")));
    assert.doesNotMatch(i18nSource, new RegExp(`"${key.replaceAll(".", "\\.")}":`));
  }

  assert.doesNotMatch(settingsSource, /edgeWaitSecondsToSliderValue|edgeWaitSliderValueToSeconds/);
  assert.doesNotMatch(settingsSource, /READING_BEHAVIOR_DEFAULTS|normalizeJumpSearchStrength|normalizeScrollSpeedMultiplier/);
  assert.doesNotMatch(jumpSource, /loadReadingBehaviorSettings/);
  assert.doesNotMatch(jumpSource, /settings\.jumpSearchStrength/);
  assert.match(jumpSource, /resolveChatGptOphelTarget/);
  assert.doesNotMatch(webAdapterSource, /loadReadingBehaviorSettings|smartHarvestByScrolling|scrollToWebTurn/);
  assert.match(i18nSource, /"app\.action\.refreshIndex":/);
  assert.doesNotMatch(i18nSource, /"app\.action\.deepScan":/);
  assert.doesNotMatch(appSource, /loadReadingBehaviorSettings|readingBehavior|"deep-scan"/);
  assert.doesNotMatch(debugReportSource, /Reading and Jumping|Deep scan steps|Scroll speed multiplier|readingBehavior/);
  assert.doesNotMatch(turnMergeSource, /"deep-scan"/);
});

test("collapsed node action writes compact automatic dimensions", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(canvasSource, /function originalContentDimensions/);
  assert.match(canvasSource, /function compactCollapsedDimensions/);
  assert.match(canvasSource, /function expandedContentDimensions/);
  assert.match(canvasSource, /function withContentFittingDimensions/);
  assert.match(canvasSource, /const compactWidth = Math\.max\(node\.data\.isConversationRoot \? 182 : 168, Math\.round\(defaultWidth \* 0\.7\)\)/);
  assert.match(canvasSource, /const badgeRows = tagRowCount\(node\.data\.tags, compactWidth\)/);
  assert.match(canvasSource, /width: compactWidth/);
  assert.match(canvasSource, /updateNodeExpansion\(nodeId, \(expansion\) => updateMiniNode/);
  assert.match(canvasSource, /withContentFittingDimensions\(node,\s*\{\s*[\s\S]*collapsed: shouldCollapse/);
  assert.match(canvasSource, /withContentFittingDimensions\(node,\s*\{\s*[\s\S]*displayMode/);
  assert.match(canvasSource, /collapsed: shouldCollapse/);
  assert.match(canvasSource, /dimensions/);
});

test("manual node text editing does not auto-resize nodes or leak editor events", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const turnNodeSource = await readFile(new URL("../src/side-panel/graph/TurnNode.tsx", import.meta.url), "utf8");
  const updateStart = canvasSource.indexOf("const updateNodeText = useCallback");
  const updateEnd = canvasSource.indexOf("const updateNodeDimensions = useCallback", updateStart);
  const updateBody = canvasSource.slice(updateStart, updateEnd);

  assert.doesNotMatch(updateBody, /withContentFittingDimensions/);
  assert.match(updateBody, /\.\.\.updates/);
  assert.match(turnNodeSource, /trimmed !== nodeData\[field\]\.trim\(\)/);
  assert.match(turnNodeSource, /const stopEditorEvent/);
  assert.match(turnNodeSource, /className="turn-node__editor turn-node__editor--title nodrag nopan nowheel"/);
  assert.match(turnNodeSource, /className="turn-node__editor nodrag nopan nowheel"/);
  assert.match(turnNodeSource, /onPointerDown=\{stopEditorEvent\}/);
  assert.match(turnNodeSource, /onDoubleClick=\{stopEditorEvent\}/);
});

test("debug panel and running task status use compact multi-row layout", async () => {
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");

  assert.match(appSource, /const runningTasks = useMemo/);
  assert.match(appSource, /\.filter\(\(entry\) => entry\.status === "running"\)/);
  assert.match(appSource, /\.slice\(0, 3\)/);
  assert.match(appSource, /status-bar--stacked/);
  assert.match(appSource, /debug-panel__grid/);
  assert.match(appSource, /debug-panel__actions/);

  assert.match(stylesSource, /\.status-bar--stacked/);
  assert.match(stylesSource, /\.status-bar__tasks/);
  assert.match(stylesSource, /\.status-bar__task/);
  assert.match(stylesSource, /\.debug-panel__grid/);
  assert.match(stylesSource, /\.debug-panel__item/);
  assert.match(stylesSource, /\.debug-panel__actions/);
});

test("node resize edge hit areas do not enlarge corner handles", async () => {
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");

  assert.match(
    stylesSource,
    /\.turn-node \.react-flow__resize-control\.line\.left,\s*\.turn-node \.react-flow__resize-control\.line\.right\s*\{\s*width:\s*14px;/s
  );
  assert.match(
    stylesSource,
    /\.turn-node \.react-flow__resize-control\.line\.bottom\s*\{\s*height:\s*22px;/s
  );
  assert.match(
    stylesSource,
    /\.turn-node \.react-flow__resize-control\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*opacity:\s*0;/s
  );
  assert.match(
    stylesSource,
    /\.turn-node \.react-flow__resize-control\.handle\s*\{[^}]*height:\s*5px;[^}]*width:\s*5px;/s
  );
  assert.doesNotMatch(stylesSource, /\.turn-node:hover \.react-flow__resize-control/);
  assert.doesNotMatch(stylesSource, /\.turn-node\.is-selected \.react-flow__resize-control/);
  assert.doesNotMatch(stylesSource, /\.turn-node \.react-flow__resize-control\.left,\s*\.turn-node \.react-flow__resize-control\.right/s);
  assert.doesNotMatch(stylesSource, /\.turn-node \.react-flow__resize-control\.bottom\s*\{\s*(?:bottom|height):/s);
});

test("nodes use side connection handles with resize blind zones near handles", async () => {
  const turnNodeSource = await readFile(new URL("../src/side-panel/graph/TurnNode.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");

  assert.match(turnNodeSource, /<Handle id="target-left" type="target" position=\{Position\.Left\}/);
  assert.match(turnNodeSource, /<Handle id="source-right" type="source" position=\{Position\.Right\}/);
  assert.doesNotMatch(turnNodeSource, /<Handle type="target" position=\{Position\.Top\}/);
  assert.doesNotMatch(turnNodeSource, /<Handle type="source" position=\{Position\.Bottom\}/);
  assert.match(stylesSource, /\.turn-node \.react-flow__resize-control\.line\.left,\s*\.turn-node \.react-flow__resize-control\.line\.right\s*\{[^}]*top:\s*calc\(50% \+ 22px\);[^}]*height:\s*calc\(50% - 22px\);/s);
  assert.match(stylesSource, /\.turn-node \.react-flow__handle-left,\s*\.turn-node \.react-flow__handle-right\s*\{[^}]*z-index:\s*2;/s);
});

test("node panel keeps theme color in the swatch row and exposes reset actions", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  assert.match(i18nSource, /"action\.expandAnswer": "Generate Mini Map"/);
  assert.match(i18nSource, /"action\.expandAnswer": "生成迷你导图"/);
  assert.match(canvasSource, /resetSelectedNodeSize/);
  assert.match(canvasSource, /rebuildSelectedNode/);
  assert.match(canvasSource, /action\.restoreNodeSize/);
  assert.match(canvasSource, /action\.rebuildNode/);
  assert.match(i18nSource, /"action\.restoreNodeSize"/);
  assert.match(i18nSource, /"action\.rebuildNode"/);
  assert.match(canvasSource, /withContentFittingDimensions\(node,[\s\S]*nodeSizeSettings\)/);
  assert.match(canvasSource, /titleFromTurn\(node\.data\.turn\)/);
  assert.match(canvasSource, /summaryFromTurn\(node\.data\.turn\)/);
  assert.match(canvasSource, /color-swatch-button--theme/);
  assert.match(canvasSource, /<span className="color-swatch-button__label">\{t\("color\.theme"\)\}<\/span>/);
  assert.doesNotMatch(canvasSource, /<button type="button" onClick=\{\(\) => updateSelectedNodeAppearance\(\{ color: undefined \}\)\}>\s*\{t\("color\.theme"\)\}\s*<\/button>/);
  assert.match(stylesSource, /\.color-swatch-button--theme/);
  assert.match(stylesSource, /\.color-swatch-button__label/);
});

test("newly mapped turn and custom nodes default to collapsed", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");

  assert.match(canvasSource, /collapsed:\s*rootOverride\?\.collapsed \?\? true/);
  assert.match(canvasSource, /collapsed:\s*nodeOverrides\[turn\.id\]\?\.collapsed \?\? true/);
  assert.match(canvasSource, /collapsed:\s*nodeOverrides\[node\.id\]\?\.collapsed \?\? node\.collapsed \?\? true/);
  assert.match(canvasSource, /collapsed:\s*snapshot\?\.collapsed \?\? true/);
  assert.ok([...canvasSource.matchAll(/collapsed:\s*true,\s*isCustomNode:\s*true/g)].length >= 4);
  assert.match(canvasSource, /function withInitialContentFittingDimensions/);
  assert.match(canvasSource, /if \(nodeWithDisplayLines\.data\.dimensions\) return nodeWithDisplayLines/);
  assert.match(canvasSource, /withContentFittingDimensions\(nodeWithDisplayLines,\s*nodeWithDisplayLines\.data,\s*settings\)/);
  assert.ok([...canvasSource.matchAll(/withInitialContentFittingDimensions\(\{/g)].length >= 3);
});

test("conversation graph uses settings-page layout controls and persistent color swatches", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../src/settings-page/main.tsx", import.meta.url), "utf8");
  const stylesSource = await readFile(new URL("../src/side-panel/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(canvasSource, /layout-picker/);
  assert.match(settingsSource, /settings\.graphLayout\.title/);
  assert.match(settingsSource, /settings\.graphLayout\.columns/);
  assert.match(canvasSource, /color-swatch-button__preview/);
  assert.match(stylesSource, /\.color-swatch-button__preview\s*\{/);
});

test("link suggestion progress and review actions are visible in the status bar", async () => {
  const canvasSource = await readFile(new URL("../src/side-panel/graph/TurnMapCanvas.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../src/localization/catalogs.ts", import.meta.url), "utf8");

  for (const key of [
    "task.suggestLinksRequesting",
    "task.suggestLinksFiltering",
    "suggestions.acceptedStatus",
    "suggestions.acceptedAllStatus",
    "suggestions.rejectedStatus",
    "suggestions.clearedStatus"
  ]) {
    assert.match(i18nSource, new RegExp(`"${key}":`));
    assert.match(canvasSource, new RegExp(key.replaceAll(".", "\\.")));
  }

  assert.match(canvasSource, /progress:\s*45/);
  assert.match(canvasSource, /progress:\s*85/);
  assert.doesNotMatch(canvasSource, /pendingSuggestedEdges\.forEach\(\(edge\) => acceptPendingSuggestion/);
});
