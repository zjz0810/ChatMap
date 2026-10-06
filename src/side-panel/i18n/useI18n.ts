import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CUSTOM_LANGUAGES_STORAGE_KEY,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  type CustomLanguage,
  type I18nKey,
  type LanguageMode,
  formatTranslation,
  browserLanguage,
  loadLanguageSettings,
  normalizeLanguageMode,
  translationsFor
} from "../../localization/index.ts";

type I18nState = {
  mode: LanguageMode;
  customLanguages: CustomLanguage[];
};

export function useI18n() {
  const [state, setState] = useState<I18nState>({ mode: DEFAULT_LANGUAGE, customLanguages: [] });
  const [browserTick, setBrowserTick] = useState(0);

  useEffect(() => {
    void loadLanguageSettings().then(setState);

    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (!changes[LANGUAGE_STORAGE_KEY] && !changes[CUSTOM_LANGUAGES_STORAGE_KEY]) return;
      void loadLanguageSettings().then(setState);
    };

    const languageListener = () => setBrowserTick((value) => value + 1);
    window.addEventListener("languagechange", languageListener);
    chrome.storage.onChanged.addListener(storageListener);
    return () => {
      window.removeEventListener("languagechange", languageListener);
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  const dictionary = useMemo(
    () => translationsFor(state.mode, state.customLanguages),
    [browserTick, state.customLanguages, state.mode]
  );

  useEffect(() => {
    document.documentElement.lang =
      state.mode === "browser" ? browserLanguage() : state.mode === "zh" || state.mode === "en" ? state.mode : "en";
  }, [browserTick, state.mode]);

  const t = useCallback(
    (key: I18nKey, values?: Record<string, string | number>) =>
      formatTranslation(dictionary[key] ?? key, values),
    [dictionary]
  );

  return { ...state, t };
}
