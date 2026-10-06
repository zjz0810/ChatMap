import { adapterSites, siteMatchesUrl } from "../content/adapter-registry.ts";

export type CustomSiteDisabledReason = "permission-required" | "preview-required" | "permission-denied" | "preview-failed";

export type CustomSiteProfileDraft = {
  displayName: string;
  origin: string;
  pathPattern: string;
  conversationRootSelector: string;
  userSelector: string;
  assistantSelector: string;
  titleSelector?: string;
  scrollContainerSelector?: string;
  messageIdAttributes?: string[];
};

export type CustomSiteProfile = CustomSiteProfileDraft & {
  id: string;
  permissionPattern: string;
  enabled: boolean;
  disabledReason?: CustomSiteDisabledReason;
  createdAt: number;
  updatedAt: number;
};

export type CustomSiteProfileError = {
  field: keyof CustomSiteProfileDraft | "profile";
  code: string;
  message: string;
};

export type CustomSiteValidationResult =
  | { ok: true; errors: []; normalized: CustomSiteProfileDraft & { permissionPattern: string } }
  | { ok: false; errors: CustomSiteProfileError[]; normalized?: undefined };

export type CustomSiteBackup = {
  schemaVersion: 1;
  app: "ChatMap" | "TurnMap";
  kind: "custom-sites";
  exportedAt: number;
  profiles: CustomSiteProfile[];
};

export const CUSTOM_SITE_STORAGE_KEY = "turnmap.customSites";
export const CUSTOM_SITE_SCHEMA_VERSION = 1;

const MAX_SELECTOR_LENGTH = 500;
const MAX_PROFILES = 50;
const DEFAULT_MESSAGE_ID_ATTRIBUTES = ["data-message-id", "data-turn-id", "data-id", "id"];
const BLOCKED_SELECTOR_PATTERN = /:has\s*\(|::|(?:^|[\s>+~,])(script|style|iframe|object|embed)(?:$|[.#[:\s>+~,])/i;
const MESSAGE_ID_ATTRIBUTE_PATTERN = /^(?:id|data-[a-z0-9_-]+)$/i;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function balancedSelector(value: string): boolean {
  let square = 0;
  let round = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "[") square += 1;
    if (character === "]") square -= 1;
    if (character === "(") round += 1;
    if (character === ")") round -= 1;
    if (square < 0 || round < 0) return false;
  }
  return !quote && square === 0 && round === 0;
}

function selectorError(field: keyof CustomSiteProfileDraft, selector: string, required: boolean): CustomSiteProfileError | null {
  if (!selector) {
    return required ? { field, code: "required", message: `${field} is required.` } : null;
  }
  if (selector.length > MAX_SELECTOR_LENGTH) {
    return { field, code: "selector-too-long", message: `${field} must be at most ${MAX_SELECTOR_LENGTH} characters.` };
  }
  if (selector === "*" || BLOCKED_SELECTOR_PATTERN.test(selector) || /[{};]/.test(selector) || !balancedSelector(selector)) {
    return { field, code: "unsafe-selector", message: `${field} contains an unsafe or invalid selector.` };
  }
  if (typeof document !== "undefined") {
    try {
      document.querySelector(selector);
    } catch {
      return { field, code: "invalid-selector", message: `${field} is not valid CSS.` };
    }
  }
  return null;
}

function normalizeMessageIdAttributes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_MESSAGE_ID_ATTRIBUTES];
  return [...new Set(value.map(normalizeText).filter((item) => MESSAGE_ID_ATTRIBUTE_PATTERN.test(item)))].slice(0, 5);
}

function originResult(value: unknown):
  | { ok: true; origin: string; permissionPattern: string }
  | { ok: false; error: CustomSiteProfileError } {
  const input = normalizeText(value);
  if (!input || input.includes("*")) {
    return { ok: false, error: { field: "origin", code: "exact-origin-required", message: "An exact origin is required." } };
  }

  try {
    const url = new URL(input);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== "/")
    ) {
      return { ok: false, error: { field: "origin", code: "exact-origin-required", message: "Use only an exact http/https origin." } };
    }
    if (adapterSites.some((site) => siteMatchesUrl(site, url))) {
      return { ok: false, error: { field: "origin", code: "built-in-origin", message: "This origin belongs to a built-in adapter." } };
    }
    return { ok: true, origin: url.origin, permissionPattern: `${url.origin}/*` };
  } catch {
    return { ok: false, error: { field: "origin", code: "invalid-origin", message: "The origin is not a valid URL." } };
  }
}

export function validateCustomSiteProfileDraft(value: CustomSiteProfileDraft): CustomSiteValidationResult {
  const errors: CustomSiteProfileError[] = [];
  const displayName = normalizeText(value?.displayName);
  if (!displayName || displayName.length > 80) {
    errors.push({ field: "displayName", code: "invalid-name", message: "Display name must be 1-80 characters." });
  }

  const origin = originResult(value?.origin);
  if (!origin.ok) errors.push(origin.error);

  const pathPattern = normalizeText(value?.pathPattern) || "/*";
  if (!pathPattern.startsWith("/") || pathPattern.length > 240 || /[?#\\]/.test(pathPattern) || pathPattern.includes("**")) {
    errors.push({ field: "pathPattern", code: "invalid-path-pattern", message: "Path pattern must be a bounded pathname glob." });
  }

  const selectors = {
    conversationRootSelector: normalizeText(value?.conversationRootSelector),
    userSelector: normalizeText(value?.userSelector),
    assistantSelector: normalizeText(value?.assistantSelector),
    titleSelector: normalizeText(value?.titleSelector),
    scrollContainerSelector: normalizeText(value?.scrollContainerSelector)
  };
  for (const [field, required] of [
    ["conversationRootSelector", true],
    ["userSelector", true],
    ["assistantSelector", true],
    ["titleSelector", false],
    ["scrollContainerSelector", false]
  ] as const) {
    const error = selectorError(field, selectors[field], required);
    if (error) errors.push(error);
  }

  const rawMessageIdAttributes = Array.isArray(value?.messageIdAttributes) ? value.messageIdAttributes : DEFAULT_MESSAGE_ID_ATTRIBUTES;
  const messageIdAttributes = normalizeMessageIdAttributes(rawMessageIdAttributes);
  if (rawMessageIdAttributes.length > 5 || messageIdAttributes.length !== rawMessageIdAttributes.length) {
    errors.push({ field: "messageIdAttributes", code: "invalid-id-attributes", message: "Message id attributes must be id or data-* names, maximum five." });
  }

  if (errors.length > 0 || !origin.ok) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    normalized: {
      displayName,
      origin: origin.origin,
      permissionPattern: origin.permissionPattern,
      pathPattern,
      ...selectors,
      messageIdAttributes
    }
  };
}

function defaultIdFactory(): string {
  return `custom-site-${crypto.randomUUID()}`;
}

export function createCustomSiteProfile(
  draft: CustomSiteProfileDraft,
  options: { now?: number; idFactory?: () => string } = {}
): CustomSiteProfile {
  const validation = validateCustomSiteProfileDraft(draft);
  if (!validation.ok) throw new Error(validation.errors.map((error) => error.message).join(" "));
  const now = options.now ?? Date.now();
  return {
    id: (options.idFactory ?? defaultIdFactory)(),
    ...validation.normalized,
    enabled: false,
    disabledReason: "permission-required",
    createdAt: now,
    updatedAt: now
  };
}

function pathPatternMatches(pattern: string, pathname: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(pathname);
}

export function customSiteProfileMatchesUrl(profile: CustomSiteProfile, url: URL): boolean {
  return url.origin === profile.origin && pathPatternMatches(profile.pathPattern, url.pathname);
}

export function exportCustomSiteProfiles(profiles: CustomSiteProfile[], exportedAt = Date.now()): CustomSiteBackup {
  return {
    schemaVersion: CUSTOM_SITE_SCHEMA_VERSION,
    app: "ChatMap",
    kind: "custom-sites",
    exportedAt,
    profiles: profiles.map((profile) => ({ ...profile, messageIdAttributes: [...(profile.messageIdAttributes ?? [])] }))
  };
}

function normalizeStoredProfile(value: unknown): CustomSiteProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const validation = validateCustomSiteProfileDraft(record as unknown as CustomSiteProfileDraft);
  if (!validation.ok) return null;
  const id = normalizeText(record.id);
  if (!id) return null;
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
  return {
    id,
    ...validation.normalized,
    enabled: record.enabled === true,
    disabledReason: record.enabled === true ? undefined : ((record.disabledReason as CustomSiteDisabledReason) ?? "permission-required"),
    createdAt,
    updatedAt
  };
}

export function importCustomSiteProfiles(
  value: unknown,
  existing: CustomSiteProfile[],
  mode: "merge" | "replace"
): { profiles: CustomSiteProfile[]; added: number; updated: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid custom sites backup.");
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    (record.app !== "ChatMap" && record.app !== "TurnMap") ||
    record.kind !== "custom-sites" ||
    !Array.isArray(record.profiles)
  ) {
    throw new Error("Invalid custom sites backup format.");
  }

  const imported = record.profiles.map((item) => {
    const profile = normalizeStoredProfile(item);
    if (!profile) {
      const draft = item as CustomSiteProfileDraft;
      const validation = validateCustomSiteProfileDraft(draft);
      const message = validation.ok ? "Invalid custom profile id." : validation.errors.map((error) => error.message).join(" ");
      throw new Error(message);
    }
    return { ...profile, enabled: false, disabledReason: "permission-required" as const };
  });

  const base = mode === "replace" ? [] : existing.map((profile) => ({ ...profile }));
  const merged = new Map(base.map((profile) => [profile.id, profile]));
  let added = 0;
  let updated = 0;
  for (const profile of imported) {
    if (merged.has(profile.id)) updated += 1;
    else added += 1;
    merged.set(profile.id, profile);
  }
  return { profiles: [...merged.values()].slice(0, MAX_PROFILES), added, updated };
}

export async function loadCustomSiteProfiles(): Promise<CustomSiteProfile[]> {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_SITE_STORAGE_KEY);
    const value = stored[CUSTOM_SITE_STORAGE_KEY] as { schemaVersion?: unknown; profiles?: unknown } | undefined;
    if (value?.schemaVersion !== CUSTOM_SITE_SCHEMA_VERSION || !Array.isArray(value.profiles)) return [];
    return value.profiles.map(normalizeStoredProfile).filter((profile): profile is CustomSiteProfile => Boolean(profile)).slice(0, MAX_PROFILES);
  } catch {
    return [];
  }
}

export async function saveCustomSiteProfiles(profiles: CustomSiteProfile[]): Promise<void> {
  const normalized = profiles.map(normalizeStoredProfile).filter((profile): profile is CustomSiteProfile => Boolean(profile)).slice(0, MAX_PROFILES);
  await chrome.storage.local.set({
    [CUSTOM_SITE_STORAGE_KEY]: {
      schemaVersion: CUSTOM_SITE_SCHEMA_VERSION,
      profiles: normalized
    }
  });
}

