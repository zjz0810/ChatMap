import { useCallback, useEffect, useState } from "react";
import { testAiConnection } from "../ai/openai-compatible";
import type { I18nKey } from "../../localization/index.ts";
import { useI18n } from "../i18n/useI18n";
import { recordApiTaskLog } from "../task-log";
import {
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  aiProviderOptions,
  defaultsForProvider,
  loadAiSettings,
  metadataForProvider,
  normalizeMaxTokens,
  saveAiSettings,
  type AiProvider,
  type AiSettings
} from "./ai-settings-storage";

type AiSettingsFormProps = {
  compact?: boolean;
  onSaved?: (message: string) => void;
};

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "missing-host";
  }
}

export function AiSettingsForm({ compact = false, onSaved }: AiSettingsFormProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AiSettings>(defaultsForProvider("openai"));
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);
  const providerMetadata = metadataForProvider(settings.provider);

  useEffect(() => {
    void loadAiSettings().then(setSettings);
  }, []);

  useEffect(() => {
    setStatus((current) => current || t("ai.status.local"));
  }, [t]);

  const updateProvider = useCallback((provider: AiProvider) => {
    setSettings((current) => ({
      ...defaultsForProvider(provider),
      apiKey: "",
      maxTokens: current.maxTokens,
      autoSummarize: current.autoSummarize,
      provider
    }));
  }, []);

  const updateField = useCallback((field: keyof AiSettings, value: string | number | boolean) => {
    setSettings((current) => ({
      ...current,
      [field]: value
    }));
  }, []);

  const save = useCallback(async () => {
    await saveAiSettings(settings);
    setStatus(t("ai.status.saved"));
    onSaved?.(t("ai.status.aiSaved"));
  }, [onSaved, settings, t]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    const taskId = `test-connection-${settings.provider}-${Date.now()}`;
    const host = hostFromBaseUrl(settings.baseUrl);
    const testingMessage = t("ai.status.testing");
    setStatus(testingMessage);
    void recordApiTaskLog({
      id: taskId,
      kind: "test-connection",
      status: "running",
      message: testingMessage,
      progress: 25
    });

    try {
      await testAiConnection(settings);
      await saveAiSettings(settings);
      const message = t("ai.status.connectionSaved");
      setStatus(message);
      onSaved?.(t("ai.status.connectionSavedGlobal"));
      void recordApiTaskLog({
        id: taskId,
        kind: "test-connection",
        status: "success",
        message: `${message} provider=${settings.provider} host=${host} model=${settings.model}`,
        progress: 100
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("ai.status.failed");
      setStatus(message);
      void recordApiTaskLog({
        id: taskId,
        kind: "test-connection",
        status: "error",
        message,
        progress: 100
      });
    } finally {
      setTesting(false);
    }
  }, [onSaved, settings, t]);

  return (
    <section className={compact ? "settings-section settings-section--compact" : "settings-section"}>
      <div className="settings-section__header">
        <strong>{t("ai.title")}</strong>
        <span>{t("ai.subtitle")}</span>
      </div>

      <label>
        {t("ai.provider")}
        <select
          value={settings.provider}
          onChange={(event) => updateProvider(event.currentTarget.value as AiProvider)}
        >
          {aiProviderOptions.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <p>
        {t(providerMetadata.providerNoteKey as I18nKey)}
        <br />
        {t("ai.providerPresetLimit")}
      </p>

      <label>
        {t("ai.baseUrl")}
        <input
          value={settings.baseUrl}
          onChange={(event) => updateField("baseUrl", event.currentTarget.value)}
          placeholder={t("ai.baseUrlPlaceholder")}
        />
      </label>

      <label>
        {t("ai.model")}
        <input
          value={settings.model}
          onChange={(event) => updateField("model", event.currentTarget.value)}
          placeholder={t("ai.modelPlaceholder")}
        />
      </label>

      <label>
        {t("ai.apiKey")}
        <input
          type="password"
          value={settings.apiKey}
          onChange={(event) => updateField("apiKey", event.currentTarget.value)}
          placeholder={t("ai.apiKeyPlaceholder")}
        />
      </label>
      <p>{t("ai.apiKeyRawHint")}</p>

      <label>
        {t("ai.maxTokens")}
        <input
          type="number"
          min={MIN_MAX_TOKENS}
          max={MAX_MAX_TOKENS}
          step={128}
          value={settings.maxTokens}
          onChange={(event) => updateField("maxTokens", normalizeMaxTokens(event.currentTarget.value))}
          placeholder={t("ai.maxTokensPlaceholder")}
        />
      </label>

      <p>
        {t("ai.maxTokensHint")}
        <br />
        {t("ai.privacy")}
      </p>

      <label className="settings-panel__check">
        <input
          type="checkbox"
          checked={settings.autoSummarize}
          onChange={(event) => updateField("autoSummarize", event.currentTarget.checked)}
        />
        {t("ai.autoSummarize")}
      </label>

      <p>{status}</p>

      <div className="settings-panel__actions">
        <button type="button" onClick={save}>
          {t("ai.save")}
        </button>
        <button type="button" onClick={testConnection} disabled={testing}>
          {testing ? t("ai.testing") : t("ai.test")}
        </button>
      </div>
    </section>
  );
}
