import type {
  CustomSitePreviewResult,
  ExtractedTurnsMessage,
  JumpToTurnMessage,
  JumpToTurnResult
} from "./types";
import { validateCustomSiteProfileDraft, type CustomSiteProfileDraft } from "./custom-site-profiles.ts";

export { isTurnMapMessage } from "./runtime-protocol.ts";

export async function requestTurnsFromActiveTab(options?: {
  harvest?: boolean;
  ensureFull?: boolean;
  tabId?: number;
}): Promise<ExtractedTurnsMessage | null> {
  const tab = await getTargetTab(options?.tabId);
  const tabId = tab?.id;
  if (!tabId) return null;

  const firstResponse = await requestTurns(tabId, options?.harvest ?? false, options?.ensureFull ?? false);
  if (firstResponse) {
    void syncLauncherInTab(tabId, tab?.url);
    return { ...firstResponse, sourceTabId: tabId };
  }

  const injected = await injectContentScript(tabId, tab?.url);
  if (!injected) return null;

  await delay(150);
  const response = await requestTurns(tabId, options?.harvest ?? false, options?.ensureFull ?? false);
  void syncLauncherInTab(tabId, tab?.url);
  return response ? { ...response, sourceTabId: tabId } : null;
}

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

async function getTargetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return { id: tabId } as chrome.tabs.Tab;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function requestTurns(
  tabId: number,
  harvest: boolean,
  ensureFull: boolean
): Promise<ExtractedTurnsMessage | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "TURNMAP_REQUEST_TURNS",
      harvest,
      ensureFull
    });
    return response?.type === "TURNMAP_TURNS_UPDATED" ? response : null;
  } catch {
    return null;
  }
}

async function injectContentScript(tabId: number, tabUrl?: string): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/index.js"]
    });
    return true;
  } catch {
    const granted = await requestHostAccess(tabUrl);
    if (!granted) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"]
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function syncLauncherInTab(tabId: number, tabUrl?: string): Promise<boolean> {
  const send = async () => {
    await chrome.tabs.sendMessage(tabId, {
      type: "TURNMAP_SYNC_LAUNCHER"
    });
  };

  try {
    await send();
    return true;
  } catch {
    const injected = await injectContentScript(tabId, tabUrl);
    if (!injected) return false;
    await delay(150);
    try {
      await send();
      return true;
    } catch {
      return false;
    }
  }
}

async function requestHostAccess(tabUrl?: string): Promise<boolean> {
  if (!tabUrl || !chrome.permissions?.request) return false;

  let origin: string;
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    origin = `${url.origin}/*`;
  } catch {
    return false;
  }

  return requestExactHostAccess(origin);
}

export async function requestExactHostAccess(permissionPattern: string): Promise<boolean> {
  try {
    const originText = permissionPattern.endsWith("/*") ? permissionPattern.slice(0, -2) : "";
    const url = new URL(originText);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || permissionPattern !== `${url.origin}/*`) return false;
    const alreadyGranted = await chrome.permissions.contains({ origins: [permissionPattern] });
    if (alreadyGranted) return true;
    return await chrome.permissions.request({ origins: [permissionPattern] });
  } catch {
    return false;
  }
}

export async function previewCustomSiteOnActiveTab(
  profile: CustomSiteProfileDraft,
  tabId?: number
): Promise<CustomSitePreviewResult> {
  const validation = validateCustomSiteProfileDraft(profile);
  const empty = (reason: string): CustomSitePreviewResult => ({
    ok: false,
    reason,
    title: "",
    conversationRoots: 0,
    userMessages: 0,
    assistantMessages: 0,
    userSamples: [],
    assistantSamples: []
  });
  if (!validation.ok) return empty(validation.errors.map((error) => error.message).join(" "));

  const tab = await getTargetTab(tabId);
  if (!tab?.id || !tab.url) return empty("No active page is available for custom-site validation.");
  try {
    if (new URL(tab.url).origin !== validation.normalized.origin) {
      return empty(`Open ${validation.normalized.origin} in the active tab before validating this profile.`);
    }
  } catch {
    return empty("The active tab URL is not a valid http/https page.");
  }

  if (!(await requestExactHostAccess(validation.normalized.permissionPattern))) {
    return empty("Host permission was not granted. The profile remains saved but disabled.");
  }
  if (!(await injectContentScript(tab.id, tab.url))) return empty("TurnMap could not inject the fixed validation bridge.");
  await delay(150);
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "TURNMAP_VALIDATE_CUSTOM_SITE",
      profile
    });
    return response as CustomSitePreviewResult;
  } catch {
    return empty("TurnMap could not read the validation result from the active page.");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function jumpToTurnInActiveTab(
  message: JumpToTurnMessage,
  tabId?: number
): Promise<JumpToTurnResult> {
  const targetTabId = tabId ?? (await getActiveTabId());
  if (!targetTabId) return { ok: false, reason: "No active supported AI conversation tab was found." };

  try {
    await chrome.tabs.update(targetTabId, { active: true });
    return await chrome.tabs.sendMessage(targetTabId, message);
  } catch {
    return {
      ok: false,
      reason: "TurnMap could not communicate with the conversation page."
    };
  }
}

export async function setFloatingPanelInTab(enabled: boolean, tabId?: number): Promise<boolean> {
  const targetTab = await getTargetTab(tabId);
  const targetTabId = targetTab?.id;
  if (!targetTabId) return false;

  const send = async () => {
    await chrome.tabs.sendMessage(targetTabId, {
      type: "TURNMAP_SET_FLOATING_PANEL",
      enabled
    });
  };

  try {
    await send();
    return true;
  } catch {
    const injected = await injectContentScript(targetTabId, targetTab?.url);
    if (!injected) return false;
    await delay(150);
    try {
      await send();
      return true;
    } catch {
      return false;
    }
  }
}
