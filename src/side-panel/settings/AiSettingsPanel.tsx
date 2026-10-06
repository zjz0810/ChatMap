import { AiSettingsForm } from "./AiSettingsForm";
import { useI18n } from "../i18n/useI18n";

type AiSettingsPanelProps = {
  onClose: () => void;
};

export function AiSettingsPanel({ onClose }: AiSettingsPanelProps) {
  const { t } = useI18n();

  return (
    <aside className="settings-panel">
      <div className="settings-panel__header">
        <strong>{t("ai.title")}</strong>
        <button type="button" onClick={onClose}>
          {t("settings.close")}
        </button>
      </div>
      <AiSettingsForm compact />
    </aside>
  );
}
