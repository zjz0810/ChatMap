import { StrictMode, useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import { AiSettingsForm } from "../side-panel/settings/AiSettingsForm";
import { PromptWorkbenchSettingsPanel } from "./PromptWorkbenchSettingsPanel";
import { CustomSitesSettingsPanel } from "./CustomSitesSettingsPanel";
import {
  applyNodeColorRendering,
  loadUiSettings,
  normalizeDefaultNodeHeight,
  normalizeDefaultNodePromptRatio,
  normalizeDefaultNodeWidth,
  saveUiSettings,
  type UiSettings
} from "../side-panel/settings/ui-settings-storage";
import {
  normalizeConversationGraphLayoutSettings,
  type ConversationGraphLayoutSettings
} from "../side-panel/graph/graph-layout.ts";
import { THEME_OPTIONS, applyTheme } from "../side-panel/settings/theme-storage";
import { useI18n } from "../side-panel/i18n/useI18n";
import {
  DEFAULT_LANGUAGE,
  customLanguageId,
  type CustomLanguage,
  type I18nKey,
  type LanguageMode,
  exportLanguagePack,
  generateCustomLanguage,
  importLanguagePack,
  loadLanguageSettings,
  saveCustomLanguage,
  saveLanguageMode
} from "../localization/index.ts";
import { recordApiTaskLog } from "../side-panel/task-log";
import "../side-panel/styles.css";
import "./settings-page.css";

const LANGUAGE_OPTIONS: Array<{ value: LanguageMode; labelKey: I18nKey }> = [
  { value: "browser", labelKey: "settings.language.browser" },
  { value: "en", labelKey: "settings.language.english" },
  { value: "zh", labelKey: "settings.language.chinese" }
];

const THEME_LABEL_KEYS = {
  browser: "settings.theme.browser",
  day: "settings.theme.day",
  night: "settings.theme.night",
  "eye-care": "settings.theme.eyeCare"
} satisfies Record<(typeof THEME_OPTIONS)[number]["value"], I18nKey>;

type NumericSliderSettingProps = {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
  normalize: (value: unknown) => number;
};

function NumericSliderSetting({
  label,
  description,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  normalize
}: NumericSliderSettingProps) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  return (
    <label className="settings-range-control">
      <span>{label}</span>
      <div className="settings-range-control__row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(normalize(event.currentTarget.value))}
        />
        <div className="settings-number-input">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draftValue}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setDraftValue(nextValue);
              const numeric = Number(nextValue);
              if (Number.isFinite(numeric)) onChange(numeric);
            }}
            onBlur={(event) => {
              const normalized = normalize(event.currentTarget.value);
              setDraftValue(String(normalized));
              onChange(normalized);
            }}
          />
          <span>{suffix}</span>
        </div>
      </div>
      <p>{description}</p>
    </label>
  );
}

function SettingsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [languageMode, setLanguageMode] = useState<LanguageMode>(DEFAULT_LANGUAGE);
  const [customLanguages, setCustomLanguages] = useState<CustomLanguage[]>([]);
  const [customLanguageName, setCustomLanguageName] = useState("");
  const [languagePackFileName, setLanguagePackFileName] = useState("");
  const [translating, setTranslating] = useState(false);
  const [status, setStatus] = useState("");
  const languagePackInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void Promise.all([loadUiSettings(), loadLanguageSettings()]).then(([loadedSettings, languageSettings]) => {
      setSettings(loadedSettings);
      setLanguageMode(languageSettings.mode);
      setCustomLanguages(languageSettings.customLanguages);
      applyTheme(loadedSettings.theme);
      applyNodeColorRendering(loadedSettings);
    });
  }, []);

  const update = useCallback((updates: Partial<UiSettings>) => {
    setSettings((current) => (current ? { ...current, ...updates } : current));
  }, []);

  const updateGraphLayout = useCallback((updates: Partial<ConversationGraphLayoutSettings>) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            conversationGraphLayout: normalizeConversationGraphLayoutSettings({
              ...current.conversationGraphLayout,
              ...updates
            })
          }
        : current
    );
  }, []);

  useEffect(() => {
    if (settings) {
      applyTheme(settings.theme);
      applyNodeColorRendering(settings);
    }
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const listener = () => {
      if (settings?.theme === "browser") applyTheme("browser");
    };
    media?.addEventListener?.("change", listener);
    return () => media?.removeEventListener?.("change", listener);
  }, [settings?.theme]);

  useEffect(() => {
    setStatus((current) => current || t("settings.status.local"));
  }, [t]);

  useEffect(() => {
    document.title = t("settings.documentTitle");
  }, [t]);

  const save = useCallback(async () => {
    if (!settings) return;
    await saveUiSettings(settings);
    await saveLanguageMode(languageMode);
    setStatus(t("settings.status.interfaceSaved"));
  }, [languageMode, settings, t]);

  const changeLanguage = useCallback(async (mode: LanguageMode) => {
    setLanguageMode(mode);
    await saveLanguageMode(mode);
  }, []);

  const translateLanguage = useCallback(async () => {
    if (!customLanguageName.trim()) {
      setStatus(t("settings.translationNeedsName"));
      return;
    }

    setTranslating(true);
    const taskId = `translate-${customLanguageId(customLanguageName)}`;
    setStatus(t("task.translate", { language: customLanguageName.trim() }));
    void recordApiTaskLog({
      id: taskId,
      kind: "translate",
      status: "running",
      message: t("task.translate", { language: customLanguageName.trim() }),
      progress: 10
    });
    try {
      const language = await generateCustomLanguage(customLanguageName);
      await saveCustomLanguage(language);
      setCustomLanguages((current) => [language, ...current.filter((item) => item.id !== language.id)].slice(0, 12));
      setLanguageMode(`custom:${language.id}`);
      setStatus(t("settings.translationSaved"));
      void recordApiTaskLog({
        id: taskId,
        kind: "translate",
        status: "success",
        message: t("task.translateDone", { language: language.label }),
        progress: 100
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.translationFailed");
      setStatus(message);
      void recordApiTaskLog({
        id: taskId,
        kind: "translate",
        status: "error",
        message,
        progress: 100
      });
    } finally {
      setTranslating(false);
    }
  }, [customLanguageName, t]);

  const importLanguagePackFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      setLanguagePackFileName(file.name);

      try {
        const parsed = JSON.parse(await file.text());
        const result = importLanguagePack(parsed, customLanguages);
        if (result.conflict && !window.confirm(t("settings.languageImportConflict"))) {
          setStatus(t("settings.languageImportCancelled"));
          return;
        }
        await saveCustomLanguage(result.language);
        setCustomLanguages((current) =>
          [result.language, ...current.filter((item) => item.id !== result.language.id)].slice(0, 12)
        );
        setLanguageMode(`custom:${result.language.id}`);
        setStatus(
          t("settings.languageImportDone", {
            language: result.language.label,
            count: result.validation.missingKeys.length
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : t("settings.languageImportFailed");
        setStatus(message);
      }
    },
    [customLanguages, t]
  );

  const exportCurrentLanguagePack = useCallback(() => {
    const id = languageMode.startsWith("custom:") ? languageMode.slice("custom:".length) : "";
    const language = customLanguages.find((item) => item.id === id);
    if (!language) {
      setStatus(t("settings.languageExportNeedsCustom"));
      return;
    }

    const pack = exportLanguagePack(language);
    const blob = new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `turnmap-language-${language.languageCode.toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(t("settings.languageExportDone", { language: language.label }));
  }, [customLanguages, languageMode, t]);

  return (
    <main className="settings-page">
      <header className="settings-page__header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
        <button type="button" onClick={() => window.close()}>
          {t("settings.close")}
        </button>
      </header>

      <section className="settings-page__grid">
        <AiSettingsForm onSaved={setStatus} />
        <PromptWorkbenchSettingsPanel onStatus={setStatus} />
        <CustomSitesSettingsPanel />

        <section className="settings-section">
          <div className="settings-section__header">
            <strong>{t("settings.section.interface")}</strong>
            <span>{t("settings.section.interfaceHint")}</span>
          </div>

          {settings ? (
            <>
              <div className="settings-setting-group">
                <div className="settings-setting-group__header">
                  <strong>{t("settings.group.appearance")}</strong>
                  <p>{t("settings.group.appearanceHint")}</p>
                </div>
                <div className="settings-control-grid">
                  <label>
                    {t("settings.theme")}
                    <select
                      value={settings.theme}
                      onChange={(event) => update({ theme: event.currentTarget.value as UiSettings["theme"] })}
                    >
                      {THEME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(THEME_LABEL_KEYS[option.value])}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    {t("settings.language")}
                    <select value={languageMode} onChange={(event) => void changeLanguage(event.currentTarget.value as LanguageMode)}>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                      {customLanguages.map((language) => (
                        <option key={language.id} value={`custom:${language.id}`}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p>{t("settings.languageHint")}</p>
              </div>

              <div className="settings-setting-group">
                <div className="settings-setting-group__header">
                  <strong>{t("settings.group.languagePacks")}</strong>
                  <p>{t("settings.group.languagePacksHint")}</p>
                </div>
                <div className="settings-section__inline">
                  <label>
                    {t("settings.customLanguage")}
                    <input
                      value={customLanguageName}
                      onChange={(event) => setCustomLanguageName(event.currentTarget.value)}
                      placeholder={t("settings.customLanguagePlaceholder")}
                    />
                  </label>
                  <button type="button" onClick={() => void translateLanguage()} disabled={translating}>
                    {translating ? t("settings.generatingTranslation") : t("settings.generateTranslation")}
                  </button>
                </div>
                <p>{t("settings.customTranslationHint")}</p>
                <p>{t("settings.translationRepairHint")}</p>
                <div className="settings-section__inline">
                  <div className="settings-file-picker">
                    <span>{t("settings.importLanguagePack")}</span>
                    <input
                      ref={languagePackInputRef}
                      className="file-input"
                      type="file"
                      accept="application/json,.json"
                      aria-label={t("settings.importLanguagePack")}
                      onChange={(event) => void importLanguagePackFile(event)}
                    />
                    <button type="button" onClick={() => languagePackInputRef.current?.click()}>
                      {t("settings.languagePackChooseFile")}
                    </button>
                    <span className="settings-file-picker__name" title={languagePackFileName}>
                      {languagePackFileName
                        ? t("settings.languagePackSelected", { filename: languagePackFileName })
                        : t("settings.languagePackNoFile")}
                    </span>
                  </div>
                  <button type="button" onClick={exportCurrentLanguagePack} title={t("settings.exportLanguagePack")}>
                    {t("settings.exportLanguagePack")}
                  </button>
                </div>
              </div>

              <div className="settings-setting-group">
                <div className="settings-setting-group__header">
                  <strong>{t("settings.group.mapDefaults")}</strong>
                  <p>{t("settings.group.mapDefaultsHint")}</p>
                </div>
                <div className="settings-control-grid">
                  <label>
                    {t("settings.linkConnectionStyle")}
                    <select
                      value={settings.linkConnectionStyle}
                      onChange={(event) =>
                        update({ linkConnectionStyle: event.currentTarget.value as UiSettings["linkConnectionStyle"] })
                      }
                    >
                      <option value="curved">{t("settings.linkConnectionStyleCurved")}</option>
                      <option value="angled">{t("settings.linkConnectionStyleAngled")}</option>
                    </select>
                  </label>

                  <label>
                    {t("settings.nodeColorRenderMode")}
                    <select
                      value={settings.nodeColorRenderMode}
                      onChange={(event) =>
                        update({ nodeColorRenderMode: event.currentTarget.value as UiSettings["nodeColorRenderMode"] })
                      }
                    >
                      <option value="gradient">{t("settings.nodeColorRenderGradient")}</option>
                      <option value="solid">{t("settings.nodeColorRenderSolid")}</option>
                    </select>
                  </label>
                </div>
                <div className="settings-fieldset">
                  <div className="settings-fieldset__title">{t("settings.defaultNodeSize")}</div>
                  <NumericSliderSetting
                    label={t("settings.defaultNodeWidth")}
                    description={t("settings.defaultNodeWidthHint")}
                    value={settings.defaultNodeWidth}
                    min={220}
                    max={1200}
                    step={10}
                    suffix="px"
                    onChange={(value) => update({ defaultNodeWidth: normalizeDefaultNodeWidth(value) })}
                    normalize={normalizeDefaultNodeWidth}
                  />
                  <NumericSliderSetting
                    label={t("settings.defaultNodeHeight")}
                    description={t("settings.defaultNodeHeightHint")}
                    value={settings.defaultNodeHeight}
                    min={120}
                    max={900}
                    step={10}
                    suffix="px"
                    onChange={(value) => update({ defaultNodeHeight: normalizeDefaultNodeHeight(value) })}
                    normalize={normalizeDefaultNodeHeight}
                  />
                  <label className="settings-range-control">
                    <span>{t("settings.defaultNodePromptRatio")}</span>
                    <div className="settings-range-control__row">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.25"
                        value={settings.defaultNodePromptRatio}
                        onChange={(event) =>
                          update({ defaultNodePromptRatio: normalizeDefaultNodePromptRatio(event.currentTarget.value) })
                        }
                      />
                      <span>{Math.round(settings.defaultNodePromptRatio * 100)}%</span>
                    </div>
                    <p>{t("settings.defaultNodePromptRatioHint")}</p>
                  </label>
                </div>
                <label className="settings-range-control">
                  <span>{t("settings.nodeColorRenderStrength")}</span>
                  <div className="settings-range-control__row">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={settings.nodeColorRenderStrength}
                      onChange={(event) => update({ nodeColorRenderStrength: Number(event.currentTarget.value) })}
                    />
                    <span>{settings.nodeColorRenderStrength}%</span>
                  </div>
                </label>
              </div>

              <div className="settings-setting-group">
                <div className="settings-setting-group__header">
                  <strong>{t("settings.graphLayout.title")}</strong>
                  <p>{t("settings.graphLayout.hint")}</p>
                </div>
                <div className="settings-control-grid">
                  <label>
                    {t("settings.graphLayout.mode")}
                    <select
                      value={settings.defaultLayout}
                      onChange={(event) => update({ defaultLayout: event.currentTarget.value as UiSettings["defaultLayout"] })}
                    >
                      <option value="snake">{t("layout.snake")}</option>
                      <option value="single">{t("layout.single")}</option>
                      <option value="radial">{t("layout.radial")}</option>
                      <option value="list">{t("layout.matrix")}</option>
                      <option value="two-sided">{t("layout.twoSided")}</option>
                    </select>
                    <p>{t("settings.graphLayout.modeHint")}</p>
                  </label>
                  <NumericSliderSetting
                    label={t("settings.graphLayout.columns")}
                    description={t("settings.graphLayout.columnsHint")}
                    value={settings.conversationGraphLayout.columnsPerRow}
                    min={3}
                    max={15}
                    step={1}
                    suffix=""
                    onChange={(value) => updateGraphLayout({ columnsPerRow: value })}
                    normalize={(value) =>
                      normalizeConversationGraphLayoutSettings({
                        ...settings.conversationGraphLayout,
                        columnsPerRow: Number(value)
                      }).columnsPerRow
                    }
                  />
                  <NumericSliderSetting
                    label={t("settings.graphLayout.horizontalSpacing")}
                    description={t("settings.graphLayout.spacingHint")}
                    value={settings.conversationGraphLayout.horizontalSpacing}
                    min={160}
                    max={1000}
                    step={20}
                    suffix="px"
                    onChange={(value) => updateGraphLayout({ horizontalSpacing: value })}
                    normalize={(value) =>
                      normalizeConversationGraphLayoutSettings({
                        ...settings.conversationGraphLayout,
                        horizontalSpacing: Number(value)
                      }).horizontalSpacing
                    }
                  />
                  <NumericSliderSetting
                    label={t("settings.graphLayout.verticalSpacing")}
                    description={t("settings.graphLayout.spacingHint")}
                    value={settings.conversationGraphLayout.verticalSpacing}
                    min={140}
                    max={800}
                    step={20}
                    suffix="px"
                    onChange={(value) => updateGraphLayout({ verticalSpacing: value })}
                    normalize={(value) =>
                      normalizeConversationGraphLayoutSettings({
                        ...settings.conversationGraphLayout,
                        verticalSpacing: Number(value)
                      }).verticalSpacing
                    }
                  />
                  <label>
                    {t("settings.graphLayout.arrangement")}
                    <select
                      value={settings.conversationGraphLayout.arrangement}
                      onChange={(event) =>
                        updateGraphLayout({
                          arrangement: event.currentTarget.value as ConversationGraphLayoutSettings["arrangement"]
                        })
                      }
                    >
                      <option value="snake">{t("settings.graphLayout.snake")}</option>
                      <option value="left-to-right">{t("settings.graphLayout.leftToRight")}</option>
                    </select>
                  </label>
                </div>
                <label className="settings-panel__check">
                  <input
                    type="checkbox"
                    checked={settings.conversationGraphLayout.showSequenceEdges}
                    onChange={(event) => updateGraphLayout({ showSequenceEdges: event.currentTarget.checked })}
                  />
                  {t("settings.graphLayout.showSequenceEdges")}
                </label>
                <p>{t("settings.graphLayout.applyHint")}</p>
              </div>

              <div className="settings-setting-group">
                <div className="settings-setting-group__header">
                  <strong>{t("settings.group.pageHelpers")}</strong>
                  <p>{t("settings.group.pageHelpersHint")}</p>
                </div>
                <div className="settings-check-grid">
                  <label className="settings-panel__check">
                    <input
                      type="checkbox"
                      checked={settings.launcherEnabled}
                      onChange={(event) => update({ launcherEnabled: event.currentTarget.checked })}
                    />
                    {t("settings.showLauncher")}
                  </label>

                  <label className="settings-panel__check">
                    <input
                      type="checkbox"
                      checked={settings.floatingPanelEnabled}
                      onChange={(event) => update({ floatingPanelEnabled: event.currentTarget.checked })}
                    />
                    {t("settings.enableFloat")}
                  </label>
                </div>
              </div>

              <div className="settings-panel__actions">
                <button type="button" onClick={save}>
                  {t("settings.saveInterface")}
                </button>
              </div>
            </>
          ) : (
            <p>{t("settings.loadingInterface")}</p>
          )}
        </section>

        <section className="settings-section">
          <div className="settings-section__header">
            <strong>{t("settings.section.updates")}</strong>
            <span>{t("settings.section.updatesHint")}</span>
          </div>

          {settings ? (
            <>
              <label className="settings-panel__check">
                <input
                  type="checkbox"
                  checked={settings.updateNoticeEnabled}
                  onChange={(event) => update({ updateNoticeEnabled: event.currentTarget.checked })}
                />
                {t("settings.showUpdates")}
              </label>

              <label className="settings-panel__check">
                <input
                  type="checkbox"
                  checked={settings.includePrereleaseUpdates}
                  onChange={(event) => update({ includePrereleaseUpdates: event.currentTarget.checked })}
                />
                {t("settings.includePrerelease")}
              </label>

              <label>
                {t("settings.ignoredVersion")}
                <input
                  value={settings.ignoredVersion}
                  onChange={(event) => update({ ignoredVersion: event.currentTarget.value })}
                  placeholder={t("settings.ignoredVersionPlaceholder")}
                />
              </label>

              <p>
                {t("settings.updateHint")}
              </p>

              <div className="settings-panel__actions">
                <button type="button" onClick={save}>
                  {t("settings.saveUpdates")}
                </button>
              </div>
            </>
          ) : (
            <p>{t("settings.loadingUpdates")}</p>
          )}
        </section>
      </section>

      <section className="settings-page__status">{status}</section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>
);
