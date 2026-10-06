import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "../side-panel/i18n/useI18n";
import type { I18nKey } from "../localization/index.ts";
import {
  createCustomSiteProfile,
  exportCustomSiteProfiles,
  importCustomSiteProfiles,
  loadCustomSiteProfiles,
  saveCustomSiteProfiles,
  validateCustomSiteProfileDraft,
  type CustomSiteDisabledReason,
  type CustomSiteProfile,
  type CustomSiteProfileDraft
} from "../shared/custom-site-profiles";
import { previewCustomSiteOnActiveTab, requestExactHostAccess } from "../shared/messaging";
import type { CustomSitePreviewResult } from "../shared/types";

const EMPTY_DRAFT: CustomSiteProfileDraft = {
  displayName: "",
  origin: "",
  pathPattern: "/*",
  conversationRootSelector: "main",
  userSelector: "[data-role='user']",
  assistantSelector: "[data-role='assistant']",
  titleSelector: "",
  scrollContainerSelector: "",
  messageIdAttributes: ["data-message-id", "data-turn-id", "data-id", "id"]
};

function copyDraft(draft: CustomSiteProfileDraft): CustomSiteProfileDraft {
  return { ...draft, messageIdAttributes: [...(draft.messageIdAttributes ?? [])] };
}

const DISABLED_REASON_KEYS = {
  "permission-required": "settings.customSites.reason.permission-required",
  "preview-required": "settings.customSites.reason.preview-required",
  "permission-denied": "settings.customSites.reason.permission-denied",
  "preview-failed": "settings.customSites.reason.preview-failed"
} satisfies Record<CustomSiteDisabledReason, I18nKey>;

export function CustomSitesSettingsPanel() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<CustomSiteProfile[]>([]);
  const [draft, setDraft] = useState<CustomSiteProfileDraft>(() => copyDraft(EMPTY_DRAFT));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<CustomSitePreviewResult | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadCustomSiteProfiles().then(setProfiles);
  }, []);

  const persist = async (nextProfiles: CustomSiteProfile[]) => {
    await saveCustomSiteProfiles(nextProfiles);
    setProfiles(nextProfiles);
  };

  const resetDraft = () => {
    setDraft(copyDraft(EMPTY_DRAFT));
    setEditingId(null);
  };

  const saveDraft = async () => {
    const validation = validateCustomSiteProfileDraft(draft);
    if (!validation.ok) {
      setStatus(`${t("settings.customSites.invalid")} ${validation.errors.map((error) => error.message).join(" ")}`);
      return;
    }

    const now = Date.now();
    const nextProfile = editingId
      ? {
          ...profiles.find((profile) => profile.id === editingId)!,
          ...validation.normalized,
          enabled: false,
          disabledReason: "preview-required" as const,
          updatedAt: now
        }
      : createCustomSiteProfile(validation.normalized, { now });
    const nextProfiles = editingId
      ? profiles.map((profile) => (profile.id === editingId ? nextProfile : profile))
      : [...profiles, nextProfile];
    await persist(nextProfiles);
    resetDraft();
    setPreview(null);
    setStatus(t("settings.customSites.savedDisabled"));
  };

  const validateAndEnable = async (profile: CustomSiteProfile) => {
    setStatus(t("settings.customSites.validating"));
    setPreview(null);
    if (!(await requestExactHostAccess(profile.permissionPattern))) {
      const next = profiles.map((item) =>
        item.id === profile.id
          ? { ...item, enabled: false, disabledReason: "permission-denied" as const, updatedAt: Date.now() }
          : item
      );
      await persist(next);
      setStatus(t("settings.customSites.permissionDenied"));
      return;
    }

    const result = await previewCustomSiteOnActiveTab(profile);
    setPreview(result);
    if (!result.ok) {
      const next = profiles.map((item) =>
        item.id === profile.id
          ? { ...item, enabled: false, disabledReason: "preview-failed" as const, updatedAt: Date.now() }
          : item
      );
      await persist(next);
      setStatus(`${t("settings.customSites.previewFailed")} ${result.reason ?? ""}`.trim());
      return;
    }

    const next = profiles.map((item) =>
      item.id === profile.id
        ? { ...item, enabled: true, disabledReason: undefined, updatedAt: Date.now() }
        : item
    );
    await persist(next);
    setStatus(t("settings.customSites.enabled"));
  };

  const disableProfile = async (profile: CustomSiteProfile) => {
    await persist(
      profiles.map((item) =>
        item.id === profile.id
          ? { ...item, enabled: false, disabledReason: "preview-required" as const, updatedAt: Date.now() }
          : item
      )
    );
    setStatus(t("settings.customSites.disabled"));
  };

  const deleteProfile = async (profile: CustomSiteProfile) => {
    if (!window.confirm(t("settings.customSites.deleteConfirm"))) return;
    await persist(profiles.filter((item) => item.id !== profile.id));
    if (editingId === profile.id) resetDraft();
    setPreview(null);
  };

  const editProfile = (profile: CustomSiteProfile) => {
    setEditingId(profile.id);
    setDraft(copyDraft(profile));
    setPreview(null);
  };

  const exportProfiles = () => {
    const backup = exportCustomSiteProfiles(profiles);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "turnmap-custom-sites.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus(t("settings.customSites.exportDone"));
  };

  const importProfiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const result = importCustomSiteProfiles(JSON.parse(await file.text()), profiles, importMode);
      await persist(result.profiles);
      setStatus(t("settings.customSites.importDone", { count: result.added + result.updated }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("settings.customSites.importFailed"));
    }
  };

  const updateDraft = (field: keyof CustomSiteProfileDraft, value: string | string[]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="settings-section custom-sites-settings">
      <div className="settings-section__header">
        <strong>{t("settings.customSites.title")}</strong>
        <span>{t("settings.customSites.hint")}</span>
      </div>

      <div className="settings-setting-group custom-sites-settings__editor">
        <div className="settings-control-grid">
          <label>
            {t("settings.customSites.name")}
            <input value={draft.displayName} onChange={(event) => updateDraft("displayName", event.currentTarget.value)} />
          </label>
          <label>
            {t("settings.customSites.origin")}
            <input
              value={draft.origin}
              placeholder="https://example.com"
              onChange={(event) => updateDraft("origin", event.currentTarget.value)}
            />
          </label>
          <label>
            {t("settings.customSites.pathPattern")}
            <input value={draft.pathPattern} onChange={(event) => updateDraft("pathPattern", event.currentTarget.value)} />
          </label>
          <label>
            {t("settings.customSites.conversationRoot")}
            <input
              value={draft.conversationRootSelector}
              onChange={(event) => updateDraft("conversationRootSelector", event.currentTarget.value)}
            />
          </label>
          <label>
            {t("settings.customSites.userSelector")}
            <input value={draft.userSelector} onChange={(event) => updateDraft("userSelector", event.currentTarget.value)} />
          </label>
          <label>
            {t("settings.customSites.assistantSelector")}
            <input
              value={draft.assistantSelector}
              onChange={(event) => updateDraft("assistantSelector", event.currentTarget.value)}
            />
          </label>
          <label>
            {t("settings.customSites.titleSelector")}
            <input value={draft.titleSelector ?? ""} onChange={(event) => updateDraft("titleSelector", event.currentTarget.value)} />
          </label>
          <label>
            {t("settings.customSites.scrollContainer")}
            <input
              value={draft.scrollContainerSelector ?? ""}
              onChange={(event) => updateDraft("scrollContainerSelector", event.currentTarget.value)}
            />
          </label>
          <label>
            {t("settings.customSites.messageIdAttributes")}
            <input
              value={(draft.messageIdAttributes ?? []).join(", ")}
              onChange={(event) =>
                updateDraft(
                  "messageIdAttributes",
                  event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean)
                )
              }
            />
          </label>
        </div>
        <p>{t("settings.customSites.selectorHint")}</p>
        <div className="custom-sites-settings__actions">
          <button type="button" onClick={() => void saveDraft()}>{t("settings.customSites.save")}</button>
          {editingId ? <button type="button" onClick={resetDraft}>{t("settings.customSites.cancel")}</button> : null}
        </div>
      </div>

      <div className="settings-setting-group">
        <div className="custom-sites-settings__profiles">
          {profiles.length === 0 ? <p>{t("settings.customSites.empty")}</p> : null}
          {profiles.map((profile) => (
            <article className="custom-sites-settings__profile" key={profile.id}>
              <div>
                <strong>{profile.displayName}</strong>
                <span className={profile.enabled ? "is-enabled" : "is-disabled"}>
                  {profile.enabled
                    ? t("settings.customSites.enabled")
                    : t(DISABLED_REASON_KEYS[profile.disabledReason ?? "preview-required"])}
                </span>
              </div>
              <code>{profile.origin}{profile.pathPattern}</code>
              <div className="custom-sites-settings__actions">
                <button type="button" onClick={() => void validateAndEnable(profile)}>{t("settings.customSites.validateEnable")}</button>
                <button type="button" onClick={() => editProfile(profile)}>{t("settings.customSites.edit")}</button>
                {profile.enabled ? (
                  <button type="button" onClick={() => void disableProfile(profile)}>{t("settings.customSites.disable")}</button>
                ) : null}
                <button type="button" onClick={() => void deleteProfile(profile)}>{t("settings.customSites.delete")}</button>
              </div>
            </article>
          ))}
        </div>
        {preview ? (
          <div className="custom-sites-settings__preview">
            <strong>{t("settings.customSites.previewSummary")}</strong>
            <p>{preview.title || "—"}</p>
            <code>root {preview.conversationRoots} · user {preview.userMessages} · assistant {preview.assistantMessages}</code>
            {[...preview.userSamples, ...preview.assistantSamples].map((sample, index) => <p key={`${index}-${sample}`}>{sample}</p>)}
          </div>
        ) : null}
      </div>

      <div className="settings-setting-group custom-sites-settings__backup">
        <label>
          {t("settings.customSites.importMode")}
          <select value={importMode} onChange={(event) => setImportMode(event.currentTarget.value as "merge" | "replace")}>
            <option value="merge">{t("settings.customSites.merge")}</option>
            <option value="replace">{t("settings.customSites.replace")}</option>
          </select>
        </label>
        <input
          ref={importInputRef}
          className="file-input"
          type="file"
          accept="application/json,.json"
          aria-label={t("settings.customSites.import")}
          onChange={(event) => void importProfiles(event)}
        />
        <button type="button" onClick={() => importInputRef.current?.click()}>{t("settings.customSites.import")}</button>
        <button type="button" onClick={exportProfiles}>{t("settings.customSites.export")}</button>
      </div>
      {status ? <p className="custom-sites-settings__status">{status}</p> : null}
    </section>
  );
}
