import { requestChatCompletion } from "../side-panel/ai/openai-compatible.ts";
import { extractJsonObject } from "../side-panel/ai/json-output.ts";
import { loadAiSettings } from "../side-panel/settings/ai-settings-storage.ts";

import {
  BUILT_IN_TRANSLATIONS,
  EN_TRANSLATIONS,
  type BuiltInLanguage,
  type I18nKey,
  type LanguageMode,
  type TranslationMap
} from "./catalogs.ts";
export {
  BUILT_IN_LANGUAGE_OPTIONS,
  BUILT_IN_TRANSLATIONS,
  EN_TRANSLATIONS,
  ZH_TRANSLATIONS,
  type BuiltInLanguage,
  type I18nKey,
  type LanguageMode,
  type TranslationMap
} from "./catalogs.ts";

export type CustomLanguage = {
  id: string;
  label: string;
  languageName: string;
  languageCode: string;
  schemaVersion: 1;
  sourceLocale: "en";
  translations: Record<string, string>;
  createdAt: string;
  author?: string;
  source?: string;
  version?: string;
};

export type LanguagePack = {
  schemaVersion: 1;
  app: "ChatMap" | "TurnMap";
  languageCode: string;
  languageName: string;
  sourceLocale: "en";
  translations: Record<string, string>;
  createdAt: string;
  author?: string;
  source?: string;
  version?: string;
};

export type LanguagePackValidationResult = {
  ok: boolean;
  pack: LanguagePack;
  errors: string[];
  missingKeys: I18nKey[];
  placeholderMismatches: I18nKey[];
};

export type LanguagePackImportResult = {
  language: CustomLanguage;
  validation: LanguagePackValidationResult;
  conflict: boolean;
};

export const LANGUAGE_STORAGE_KEY = "turnmap.interface.language";
export const CUSTOM_LANGUAGES_STORAGE_KEY = "turnmap.interface.customLanguages";
export const DEFAULT_LANGUAGE: LanguageMode = "browser";
const LANGUAGE_PACK_SCHEMA_VERSION = 1;
const LANGUAGE_PACK_APP = "ChatMap";
const LANGUAGE_PACK_SOURCE_LOCALE = "en";


type LanguageSettings = {
  mode: LanguageMode;
  customLanguages: CustomLanguage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function languageCodePrimarySubtag(languageCode: string): string {
  return languageCode.trim().toLowerCase().split("-")[0] ?? "";
}

function isBuiltInLanguageCode(languageCode: string): boolean {
  const primary = languageCodePrimarySubtag(languageCode);
  return primary === "en" || primary === "zh";
}

function isValidLanguageCode(languageCode: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(languageCode.trim());
}

function extractPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((match) => match[0]))].sort();
}

export function placeholderMismatch(source: string, translated: string): boolean {
  const sourcePlaceholders = extractPlaceholders(source);
  const translatedPlaceholders = extractPlaceholders(translated);
  return (
    sourcePlaceholders.length !== translatedPlaceholders.length ||
    sourcePlaceholders.some((placeholder, index) => placeholder !== translatedPlaceholders[index])
  );
}

export function missingKeys(translations: Record<string, string>): I18nKey[] {
  return (Object.keys(EN_TRANSLATIONS) as I18nKey[]).filter((key) => !translations[key]?.trim());
}

function normalizedTranslations(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    (Object.keys(EN_TRANSLATIONS) as I18nKey[])
      .map((key) => [key, typeof value[key] === "string" ? value[key].trim() : ""] as const)
      .filter(([, translated]) => translated)
  );
}

function defaultLanguagePack(input: unknown): LanguagePack {
  const record = isRecord(input) ? input : {};
  return {
    schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION,
    app: LANGUAGE_PACK_APP,
    languageCode: optionalString(record.languageCode) ?? "",
    languageName: optionalString(record.languageName) ?? optionalString(record.label) ?? "",
    sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE,
    translations: normalizedTranslations(record.translations),
    createdAt: optionalString(record.createdAt) ?? new Date().toISOString(),
    author: optionalString(record.author),
    source: optionalString(record.source),
    version: optionalString(record.version)
  };
}

function unwrapLanguagePack(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.languagePack)) return value.languagePack;
  if (isRecord(value.pack)) return value.pack;
  if (isRecord(value.data)) return value.data;
  return value;
}

export function validateLanguagePack(value: unknown): LanguagePackValidationResult {
  const raw = unwrapLanguagePack(value);
  const record = isRecord(raw) ? raw : {};
  const errors: string[] = [];

  if (record.schemaVersion !== LANGUAGE_PACK_SCHEMA_VERSION) {
    errors.push("Language pack schemaVersion must be 1.");
  }
  if (record.app !== LANGUAGE_PACK_APP && record.app !== "TurnMap") {
    errors.push("Language pack app must be ChatMap or legacy TurnMap.");
  }
  if (record.sourceLocale !== LANGUAGE_PACK_SOURCE_LOCALE) {
    errors.push("Language pack sourceLocale must be en.");
  }
  if (!optionalString(record.languageName)) {
    errors.push("Language pack languageName is required.");
  }
  const languageCode = optionalString(record.languageCode) ?? "";
  if (!languageCode) {
    errors.push("Language pack languageCode is required.");
  } else if (!isValidLanguageCode(languageCode)) {
    errors.push("Language pack languageCode must be a BCP-47 style code.");
  } else if (isBuiltInLanguageCode(languageCode)) {
    errors.push("Language pack cannot override a built-in language.");
  }
  if (!isRecord(record.translations)) {
    errors.push("Language pack translations must be an object.");
  }

  const pack = defaultLanguagePack(record);
  const placeholderMismatches = (Object.keys(pack.translations) as I18nKey[]).filter(
    (key) => key in EN_TRANSLATIONS && placeholderMismatch(EN_TRANSLATIONS[key], pack.translations[key])
  );
  if (placeholderMismatches.length > 0) {
    errors.push(`Translations must preserve placeholders: ${placeholderMismatches.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    pack,
    errors,
    missingKeys: missingKeys(pack.translations),
    placeholderMismatches
  };
}

export function exportLanguagePack(language: CustomLanguage): LanguagePack {
  return {
    schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION,
    app: LANGUAGE_PACK_APP,
    languageCode: language.languageCode,
    languageName: language.languageName,
    sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE,
    translations: normalizedTranslations(language.translations),
    createdAt: language.createdAt,
    author: language.author,
    source: language.source,
    version: language.version
  };
}

function languageFromPack(pack: LanguagePack): CustomLanguage {
  const id = customLanguageId(pack.languageName, pack.languageCode);
  return {
    id,
    label: pack.languageName,
    languageName: pack.languageName,
    languageCode: pack.languageCode,
    schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION,
    sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE,
    translations: pack.translations,
    createdAt: pack.createdAt,
    author: pack.author,
    source: pack.source,
    version: pack.version
  };
}

export function importLanguagePack(value: unknown, existingLanguages: CustomLanguage[] = []): LanguagePackImportResult {
  const validation = validateLanguagePack(value);
  if (!validation.ok) {
    throw new Error(`Language pack is invalid: ${validation.errors.join(" ")}`);
  }
  const language = languageFromPack(validation.pack);
  const conflict = existingLanguages.some(
    (existing) =>
      existing.id === language.id ||
      existing.languageCode.trim().toLowerCase() === language.languageCode.trim().toLowerCase()
  );
  return { language, validation, conflict };
}

function languagePackFromGeneratedPayload(value: unknown, languageName: string, languageCode: string): unknown {
  const unwrapped = unwrapLanguagePack(value);
  if (isRecord(unwrapped) && isRecord(unwrapped.translations)) {
    return {
      ...unwrapped,
      schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION,
      app: LANGUAGE_PACK_APP,
      languageCode,
      languageName,
      sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE
    };
  }
  if (isRecord(unwrapped) && Object.keys(unwrapped).some((key) => key in EN_TRANSLATIONS)) {
    return {
      schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION,
      app: LANGUAGE_PACK_APP,
      languageCode,
      languageName,
      sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE,
      createdAt: new Date().toISOString(),
      translations: unwrapped
    };
  }
  return unwrapped;
}

function parseLanguagePackFromText(content: string, languageName: string, languageCode: string): LanguagePack {
  const parsed = extractJsonObject(content);
  const validation = validateLanguagePack(languagePackFromGeneratedPayload(parsed, languageName, languageCode));
  if (!validation.ok) {
    throw new Error(`Language pack is invalid: ${validation.errors.join(" ")}`);
  }
  return validation.pack;
}

export function normalizeLanguageMode(value: unknown): LanguageMode {
  if (value === "browser" || value === "en" || value === "zh") return value;
  if (typeof value === "string" && value.startsWith("custom:")) return value as `custom:${string}`;
  return DEFAULT_LANGUAGE;
}

export function browserLanguage(): BuiltInLanguage {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export function customLanguageId(languageName: string, languageCode?: string): string {
  const base = (languageCode || languageName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `custom-${Date.now()}`;
}

function stableLanguageHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedLanguageCode(languageName: string): string {
  const slug = languageName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 8))
    .slice(0, 3)
    .join("-");
  return `und-${slug || stableLanguageHash(languageName)}`;
}

function normalizeCustomLanguages(value: unknown): CustomLanguage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      label: typeof item.label === "string" ? item.label : "",
      languageName: typeof item.languageName === "string" ? item.languageName : "",
      languageCode:
        typeof item.languageCode === "string" && item.languageCode.trim()
          ? item.languageCode
          : typeof item.id === "string"
            ? item.id
            : "",
      schemaVersion: LANGUAGE_PACK_SCHEMA_VERSION as 1,
      sourceLocale: LANGUAGE_PACK_SOURCE_LOCALE as "en",
      translations: isRecord(item.translations)
        ? Object.fromEntries(
            Object.entries(item.translations).filter((entry): entry is [string, string] => typeof entry[1] === "string")
          )
        : {},
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      author: optionalString(item.author),
      source: optionalString(item.source),
      version: optionalString(item.version)
    }))
    .filter((item) => item.id && item.label);
}

export async function loadLanguageSettings(): Promise<LanguageSettings> {
  const stored = await chrome.storage.local.get([LANGUAGE_STORAGE_KEY, CUSTOM_LANGUAGES_STORAGE_KEY]);
  return {
    mode: normalizeLanguageMode(stored[LANGUAGE_STORAGE_KEY]),
    customLanguages: normalizeCustomLanguages(stored[CUSTOM_LANGUAGES_STORAGE_KEY])
  };
}

export async function saveLanguageMode(mode: LanguageMode): Promise<void> {
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: mode });
}

export async function saveCustomLanguage(language: CustomLanguage): Promise<void> {
  const settings = await loadLanguageSettings();
  const next = [language, ...settings.customLanguages.filter((item) => item.id !== language.id)].slice(0, 12);
  await chrome.storage.local.set({
    [CUSTOM_LANGUAGES_STORAGE_KEY]: next,
    [LANGUAGE_STORAGE_KEY]: `custom:${language.id}` satisfies LanguageMode
  });
}

export function translationsFor(mode: LanguageMode, customLanguages: CustomLanguage[]): TranslationMap {
  if (mode === "browser") return BUILT_IN_TRANSLATIONS[browserLanguage()];
  if (mode === "en" || mode === "zh") return BUILT_IN_TRANSLATIONS[mode];

  const id = mode.slice("custom:".length);
  const custom = customLanguages.find((language) => language.id === id);
  return { ...EN_TRANSLATIONS, ...(custom?.translations ?? {}) };
}

export function formatTranslation(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}

async function repairGeneratedLanguagePack(
  rawContent: string,
  languageName: string,
  languageCode: string
): Promise<LanguagePack> {
  const settings = await loadAiSettings();
  const content = await requestChatCompletion(
    settings,
    [
      {
        role: "system",
        content:
          "Repair this ChatMap UI translation into one valid JSON language pack. Return only JSON. Preserve placeholders like {count}, {current}, {total}, {steps}, {source}, and keep ChatMap product names unchanged."
      },
      {
        role: "user",
        content: JSON.stringify({
          targetSchema: {
            schemaVersion: 1,
            app: "ChatMap",
            languageCode,
            languageName,
            sourceLocale: "en",
            createdAt: "ISO timestamp",
            translations: "object whose keys are ChatMap UI translation keys and whose values are short translated strings"
          },
          sourceLanguage: "English",
          targetLanguage: languageName,
          languageCode,
          labels: EN_TRANSLATIONS,
          invalidModelResponse: rawContent
        })
      }
    ],
    { temperature: 0, maxTokens: 6000, jsonMode: true }
  );
  return parseLanguagePackFromText(content, languageName, languageCode);
}

export async function generateCustomLanguage(languageName: string, languageCode?: string): Promise<CustomLanguage> {
  const trimmedLanguageName = languageName.trim();
  if (!trimmedLanguageName) throw new Error("Target language is required.");
  const trimmedLanguageCode = languageCode?.trim() || generatedLanguageCode(trimmedLanguageName);
  const settings = await loadAiSettings();
  const content = await requestChatCompletion(
    settings,
    [
      {
        role: "system",
        content:
          "You translate browser extension UI labels. Return only one valid JSON language pack object. Keep placeholders such as {count}, {current}, {total}, {steps}, and {source} unchanged. Keep product names like ChatMap and ChatGPT unchanged. Prefer concise labels that fit buttons, tabs, menus, and graph nodes."
      },
      {
        role: "user",
        content: JSON.stringify({
          expectedSchema: {
            schemaVersion: 1,
            app: "ChatMap",
            languageCode: trimmedLanguageCode,
            languageName: trimmedLanguageName,
            sourceLocale: "en",
            createdAt: "ISO timestamp",
            translations: "object with every ChatMap UI key translated from labels"
          },
          targetLanguage: trimmedLanguageName,
          languageCode: trimmedLanguageCode,
          sourceLanguage: "English",
          labels: EN_TRANSLATIONS
        })
      }
    ],
    { temperature: 0.1, maxTokens: 6000, jsonMode: true }
  );

  try {
    return languageFromPack(parseLanguagePackFromText(content, trimmedLanguageName, trimmedLanguageCode));
  } catch {
    return languageFromPack(await repairGeneratedLanguagePack(content, trimmedLanguageName, trimmedLanguageCode));
  }
}
