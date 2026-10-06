import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "../side-panel/i18n/useI18n";
import {
  getDefaultPromptWorkbenchOptimizerPrompts,
  exportPromptWorkbenchBackup,
  importPromptWorkbenchBackup,
  localizePromptWorkbenchLibrary,
  loadPromptWorkbenchLibrary,
  promptWorkbenchLocaleFromLanguageMode,
  savePromptWorkbenchLibrary,
  createPromptWorkbenchId,
  type PromptApplyMode,
  type PromptFolder,
  type PromptItem,
  type PromptOptimizeFormat,
  type PromptWorkbenchLibrary,
  type PromptWorkbenchPanelSide
} from "../shared/prompt-workbench-storage";

type PromptWorkbenchSettingsPanelProps = {
  onStatus: (message: string) => void;
};

type ImportMode = "merge-overwrite" | "merge-skip" | "replace";

const APPLY_MODES: PromptApplyMode[] = ["smart", "insert", "append", "replace", "wrapSelection"];
const PANEL_SIDES: PromptWorkbenchPanelSide[] = ["auto", "left", "right"];
const OPTIMIZE_FORMATS: PromptOptimizeFormat[] = ["simple-polish", "strict-planning"];

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

function textToTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function orderBySort<T extends { sortOrder: number; title?: string; name?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const delta = left.sortOrder - right.sortOrder;
    if (delta !== 0) return delta;
    return (left.title ?? left.name ?? "").localeCompare(right.title ?? right.name ?? "");
  });
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function newPrompt(folderId: string | null, sortOrder: number): PromptItem {
  const timestamp = Date.now();
  return {
    id: createPromptWorkbenchId("prm"),
    title: "New prompt",
    content: "{{input}}",
    folderId,
    tags: [],
    enabled: true,
    pinned: false,
    sortOrder,
    useCount: 0,
    lastUsedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    note: ""
  };
}

function newFolder(sortOrder: number): PromptFolder {
  const timestamp = Date.now();
  return {
    id: createPromptWorkbenchId("fld"),
    name: "New folder",
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function PromptWorkbenchSettingsPanel({ onStatus }: PromptWorkbenchSettingsPanelProps) {
  const { mode, t } = useI18n();
  const promptLocale = promptWorkbenchLocaleFromLanguageMode(mode);
  const [library, setLibrary] = useState<PromptWorkbenchLibrary | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("merge-overwrite");
  const [importSettings, setImportSettings] = useState(false);
  const [importOptimizerPrompts, setImportOptimizerPrompts] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadPromptWorkbenchLibrary({ locale: promptLocale }).then((loaded) => {
      setLibrary(loaded);
      setSelectedFolderId(loaded.folders[0]?.id ?? null);
      setSelectedPromptId(orderBySort(loaded.prompts)[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    setLibrary((current) => (current ? localizePromptWorkbenchLibrary(current, { locale: promptLocale }) : current));
  }, [promptLocale]);

  const selectedPrompt = useMemo(
    () => library?.prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [library?.prompts, selectedPromptId]
  );

  const sortedFolders = useMemo(() => orderBySort(library?.folders ?? []), [library?.folders]);

  const visiblePrompts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orderBySort(library?.prompts ?? []).filter((prompt) => {
      if (selectedFolderId && prompt.folderId !== selectedFolderId) return false;
      if (!normalizedQuery) return true;
      const haystack = `${prompt.title} ${prompt.content} ${prompt.tags.join(" ")} ${prompt.note ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [library?.prompts, query, selectedFolderId]);

  const updateLibrary = useCallback((updater: (current: PromptWorkbenchLibrary) => PromptWorkbenchLibrary) => {
    setLibrary((current) => (current ? updater(current) : current));
  }, []);

  const updateSelectedPrompt = useCallback(
    (updates: Partial<PromptItem>) => {
      if (!selectedPromptId) return;
      updateLibrary((current) => ({
        ...current,
        prompts: current.prompts.map((prompt) =>
          prompt.id === selectedPromptId ? { ...prompt, ...updates, updatedAt: Date.now() } : prompt
        )
      }));
    },
    [selectedPromptId, updateLibrary]
  );

  const save = useCallback(async () => {
    if (!library) return;
    await savePromptWorkbenchLibrary(library, { locale: promptLocale });
    onStatus(t("promptWorkbench.status.saved"));
  }, [library, onStatus, promptLocale, t]);

  const addFolder = useCallback(() => {
    updateLibrary((current) => {
      const folder = newFolder(current.folders.length);
      setSelectedFolderId(folder.id);
      return { ...current, folders: [...current.folders, folder] };
    });
  }, [updateLibrary]);

  const addPrompt = useCallback(() => {
    updateLibrary((current) => {
      const prompt = newPrompt(selectedFolderId, current.prompts.length);
      setSelectedPromptId(prompt.id);
      return { ...current, prompts: [...current.prompts, prompt] };
    });
  }, [selectedFolderId, updateLibrary]);

  const deleteSelectedPrompt = useCallback(() => {
    if (!selectedPromptId || !window.confirm(t("promptWorkbench.confirm.deletePrompt"))) return;
    updateLibrary((current) => {
      const remaining = current.prompts.filter((prompt) => prompt.id !== selectedPromptId);
      setSelectedPromptId(orderBySort(remaining)[0]?.id ?? null);
      return { ...current, prompts: remaining };
    });
  }, [selectedPromptId, t, updateLibrary]);

  const deleteSelectedFolder = useCallback(() => {
    if (!selectedFolderId || !window.confirm(t("promptWorkbench.confirm.deleteFolder"))) return;
    updateLibrary((current) => ({
      ...current,
      folders: current.folders.filter((folder) => folder.id !== selectedFolderId),
      prompts: current.prompts.map((prompt) => (prompt.folderId === selectedFolderId ? { ...prompt, folderId: null } : prompt))
    }));
    setSelectedFolderId(null);
  }, [selectedFolderId, t, updateLibrary]);

  const movePrompt = useCallback(
    (direction: -1 | 1) => {
      if (!selectedPromptId) return;
      updateLibrary((current) => {
        const prompts = orderBySort(current.prompts);
        const index = prompts.findIndex((prompt) => prompt.id === selectedPromptId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= prompts.length) return current;
        const currentOrder = prompts[index].sortOrder;
        prompts[index].sortOrder = prompts[nextIndex].sortOrder;
        prompts[nextIndex].sortOrder = currentOrder;
        return { ...current, prompts: prompts.map((prompt) => ({ ...prompt, updatedAt: Date.now() })) };
      });
    },
    [selectedPromptId, updateLibrary]
  );

  const moveFolder = useCallback(
    (direction: -1 | 1) => {
      if (!selectedFolderId) return;
      updateLibrary((current) => {
        const folders = orderBySort(current.folders);
        const index = folders.findIndex((folder) => folder.id === selectedFolderId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= folders.length) return current;
        const currentOrder = folders[index].sortOrder;
        folders[index].sortOrder = folders[nextIndex].sortOrder;
        folders[nextIndex].sortOrder = currentOrder;
        return { ...current, folders: folders.map((folder) => ({ ...folder, updatedAt: Date.now() })) };
      });
    },
    [selectedFolderId, updateLibrary]
  );

  const exportBackup = useCallback(() => {
    if (!library) return;
    downloadJson("turnmap-prompt-workbench.json", exportPromptWorkbenchBackup(library, { locale: promptLocale }));
    onStatus(t("promptWorkbench.status.exported"));
  }, [library, onStatus, promptLocale, t]);

  const importBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file || !library) return;
      setImportFileName(file.name);
      try {
        const parsed = JSON.parse(await file.text());
        if (importMode === "replace" && !window.confirm(t("promptWorkbench.confirm.replace"))) return;
        const result = importPromptWorkbenchBackup(library, parsed, {
          mode: importMode === "replace" ? "replace" : "merge",
          titleConflict: importMode === "merge-skip" ? "skip" : "overwrite",
          importSettings,
          importOptimizerPrompts,
          locale: promptLocale,
          now: Date.now()
        });
        setLibrary(result.library);
        setSelectedPromptId(orderBySort(result.library.prompts)[0]?.id ?? null);
        setSelectedFolderId(result.library.folders[0]?.id ?? null);
        await savePromptWorkbenchLibrary(result.library, { locale: promptLocale });
        onStatus(
          t("promptWorkbench.status.imported", {
            added: result.summary.added,
            updated: result.summary.updated,
            skipped: result.summary.skipped
          })
        );
      } catch (error) {
        onStatus(error instanceof Error ? error.message : t("promptWorkbench.status.importFailed"));
      }
    },
    [importMode, importOptimizerPrompts, importSettings, library, onStatus, promptLocale, t]
  );

  if (!library) {
    return (
      <section className="settings-section">
        <div className="settings-section__header">
          <strong>{t("promptWorkbench.title")}</strong>
          <span>{t("promptWorkbench.loading")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-section prompt-workbench-settings">
      <div className="settings-section__header">
        <strong>{t("promptWorkbench.title")}</strong>
        <span>{t("promptWorkbench.subtitle")}</span>
      </div>

      <div className="settings-setting-group">
        <div className="settings-setting-group__header">
          <strong>{t("promptWorkbench.group.behavior")}</strong>
          <p>{t("promptWorkbench.group.behaviorHint")}</p>
        </div>
        <div className="settings-check-grid">
          <label className="settings-panel__check">
            <input
              type="checkbox"
              checked={library.settings.enabled}
              onChange={(event) =>
                setLibrary({
                  ...library,
                  settings: { ...library.settings, enabled: event.currentTarget.checked }
                })
              }
            />
            {t("promptWorkbench.enabled")}
          </label>
          <label className="settings-panel__check">
            <input
              type="checkbox"
              checked={library.settings.aiOptimizePreview}
              onChange={(event) =>
                setLibrary({
                  ...library,
                  settings: { ...library.settings, aiOptimizePreview: event.currentTarget.checked }
                })
              }
            />
            {t("promptWorkbench.preview")}
          </label>
        </div>
        <div className="settings-control-grid">
          <label>
            {t("promptWorkbench.format")}
            <select
              value={library.settings.aiOptimizeFormat}
              onChange={(event) =>
                setLibrary({
                  ...library,
                  settings: { ...library.settings, aiOptimizeFormat: event.currentTarget.value as PromptOptimizeFormat }
                })
              }
            >
              {OPTIMIZE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`promptWorkbench.format.${format}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("promptWorkbench.applyMode")}
            <select
              value={library.settings.defaultApplyMode}
              onChange={(event) =>
                setLibrary({
                  ...library,
                  settings: { ...library.settings, defaultApplyMode: event.currentTarget.value as PromptApplyMode }
                })
              }
            >
              {APPLY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`promptWorkbench.apply.${mode}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("promptWorkbench.panelSide")}
            <select
              value={library.settings.panelSide}
              onChange={(event) =>
                setLibrary({
                  ...library,
                  settings: { ...library.settings, panelSide: event.currentTarget.value as PromptWorkbenchPanelSide }
                })
              }
            >
              {PANEL_SIDES.map((side) => (
                <option key={side} value={side}>
                  {t(`promptWorkbench.panelSide.${side}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="settings-setting-group">
        <div className="settings-setting-group__header">
          <strong>{t("promptWorkbench.group.library")}</strong>
          <p>{t("promptWorkbench.group.libraryHint")}</p>
        </div>
        <div className="prompt-workbench-settings__library">
          <aside>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("promptWorkbench.search")}
            />
            <div className="prompt-workbench-settings__toolbar">
              <button type="button" onClick={addFolder}>
                {t("promptWorkbench.folder.add")}
              </button>
              <button type="button" onClick={addPrompt}>
                {t("promptWorkbench.prompt.new")}
              </button>
            </div>
            <div className="prompt-workbench-settings__folders">
              <button
                type="button"
                className={selectedFolderId === null ? "is-active" : ""}
                onClick={() => setSelectedFolderId(null)}
              >
                {t("promptWorkbench.allPrompts")}
              </button>
              {sortedFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={selectedFolderId === folder.id ? "is-active" : ""}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  {folder.name}
                </button>
              ))}
            </div>
            <div className="prompt-workbench-settings__toolbar">
              <button type="button" onClick={() => moveFolder(-1)} disabled={!selectedFolderId}>
                {t("promptWorkbench.moveUp")}
              </button>
              <button type="button" onClick={() => moveFolder(1)} disabled={!selectedFolderId}>
                {t("promptWorkbench.moveDown")}
              </button>
              <button type="button" onClick={deleteSelectedFolder} disabled={!selectedFolderId}>
                {t("promptWorkbench.folder.delete")}
              </button>
            </div>
            <div className="prompt-workbench-settings__prompts">
              {visiblePrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  className={selectedPromptId === prompt.id ? "is-active" : ""}
                  onClick={() => setSelectedPromptId(prompt.id)}
                >
                  <strong>{prompt.pinned ? `* ${prompt.title}` : prompt.title}</strong>
                  <span>{prompt.tags.join(", ") || t("promptWorkbench.noTags")}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="prompt-workbench-settings__editor">
            {selectedPrompt ? (
              <>
                <div className="settings-control-grid">
                  <label>
                    {t("promptWorkbench.prompt.title")}
                    <input value={selectedPrompt.title} onChange={(event) => updateSelectedPrompt({ title: event.currentTarget.value })} />
                  </label>
                  <label>
                    {t("promptWorkbench.prompt.folder")}
                    <select
                      value={selectedPrompt.folderId ?? ""}
                      onChange={(event) => updateSelectedPrompt({ folderId: event.currentTarget.value || null })}
                    >
                      <option value="">{t("promptWorkbench.noFolder")}</option>
                      {sortedFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  {t("promptWorkbench.prompt.content")}
                  <textarea
                    value={selectedPrompt.content}
                    onChange={(event) => updateSelectedPrompt({ content: event.currentTarget.value })}
                  />
                </label>
                <div className="settings-control-grid">
                  <label>
                    {t("promptWorkbench.prompt.tags")}
                    <input
                      value={tagsToText(selectedPrompt.tags)}
                      onChange={(event) => updateSelectedPrompt({ tags: textToTags(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    {t("promptWorkbench.prompt.note")}
                    <input value={selectedPrompt.note ?? ""} onChange={(event) => updateSelectedPrompt({ note: event.currentTarget.value })} />
                  </label>
                </div>
                <div className="settings-check-grid">
                  <label className="settings-panel__check">
                    <input
                      type="checkbox"
                      checked={selectedPrompt.enabled}
                      onChange={(event) => updateSelectedPrompt({ enabled: event.currentTarget.checked })}
                    />
                    {t("promptWorkbench.prompt.enabled")}
                  </label>
                  <label className="settings-panel__check">
                    <input
                      type="checkbox"
                      checked={selectedPrompt.pinned}
                      onChange={(event) => updateSelectedPrompt({ pinned: event.currentTarget.checked })}
                    />
                    {t("promptWorkbench.prompt.pinned")}
                  </label>
                </div>
                <div className="prompt-workbench-settings__toolbar">
                  <button type="button" onClick={() => movePrompt(-1)}>
                    {t("promptWorkbench.moveUp")}
                  </button>
                  <button type="button" onClick={() => movePrompt(1)}>
                    {t("promptWorkbench.moveDown")}
                  </button>
                  <button type="button" onClick={deleteSelectedPrompt}>
                    {t("promptWorkbench.prompt.delete")}
                  </button>
                </div>
              </>
            ) : (
              <p>{t("promptWorkbench.prompt.empty")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="settings-setting-group">
        <div className="settings-setting-group__header">
          <strong>{t("promptWorkbench.group.optimizer")}</strong>
          <p>{t("promptWorkbench.group.optimizerHint")}</p>
        </div>
        <label>
          {t("promptWorkbench.optimizer.simple")}
          <textarea
            value={library.optimizerPrompts.simplePolish}
            onChange={(event) =>
              setLibrary({
                ...library,
                optimizerPrompts: { ...library.optimizerPrompts, simplePolish: event.currentTarget.value }
              })
            }
          />
        </label>
        <label>
          {t("promptWorkbench.optimizer.strict")}
          <textarea
            value={library.optimizerPrompts.strictPlanning}
            onChange={(event) =>
              setLibrary({
                ...library,
                optimizerPrompts: { ...library.optimizerPrompts, strictPlanning: event.currentTarget.value }
              })
            }
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setLibrary({
              ...library,
              optimizerPrompts: getDefaultPromptWorkbenchOptimizerPrompts(promptLocale)
            })
          }
        >
          {t("promptWorkbench.optimizer.restoreDefault")}
        </button>
      </div>

      <div className="settings-setting-group">
        <div className="settings-setting-group__header">
          <strong>{t("promptWorkbench.group.backup")}</strong>
          <p>{t("promptWorkbench.group.backupHint")}</p>
        </div>
        <div className="settings-section__inline">
          <label>
            {t("promptWorkbench.importMode")}
            <select value={importMode} onChange={(event) => setImportMode(event.currentTarget.value as ImportMode)}>
              <option value="merge-overwrite">{t("promptWorkbench.import.mergeOverwrite")}</option>
              <option value="merge-skip">{t("promptWorkbench.import.mergeSkip")}</option>
              <option value="replace">{t("promptWorkbench.import.replace")}</option>
            </select>
          </label>
          <label className="settings-panel__check">
            <input type="checkbox" checked={importSettings} onChange={(event) => setImportSettings(event.currentTarget.checked)} />
            {t("promptWorkbench.import.settings")}
          </label>
          <label className="settings-panel__check">
            <input
              type="checkbox"
              checked={importOptimizerPrompts}
              onChange={(event) => setImportOptimizerPrompts(event.currentTarget.checked)}
            />
            {t("promptWorkbench.import.optimizer")}
          </label>
        </div>
        <div className="settings-section__inline">
          <div className="settings-file-picker">
            <span>{t("promptWorkbench.import.file")}</span>
            <input
              ref={importInputRef}
              className="file-input"
              type="file"
              accept="application/json,.json"
              aria-label={t("promptWorkbench.import.file")}
              onChange={(event) => void importBackup(event)}
            />
            <button type="button" onClick={() => importInputRef.current?.click()}>
              {t("promptWorkbench.import.choose")}
            </button>
            <span className="settings-file-picker__name" title={importFileName}>
              {importFileName || t("promptWorkbench.import.noFile")}
            </span>
          </div>
          <button type="button" onClick={exportBackup}>
            {t("promptWorkbench.export")}
          </button>
        </div>
      </div>

      <div className="settings-panel__actions">
        <button type="button" onClick={() => void save()}>
          {t("promptWorkbench.save")}
        </button>
      </div>
    </section>
  );
}
