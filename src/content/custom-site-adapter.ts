import type { CustomSitePreviewResult, NativeConversationCapabilities } from "../shared/types.ts";
import {
  customSiteProfileMatchesUrl,
  loadCustomSiteProfiles,
  validateCustomSiteProfileDraft,
  type CustomSiteProfile,
  type CustomSiteProfileDraft
} from "../shared/custom-site-profiles.ts";
import type { ConversationAdapter, TurnsListener } from "./conversation-adapters.ts";
import {
  extractTurnsFromDocument,
  getLastWebExtractionDiagnostics,
  getWebConversationId,
  getWebConversationTitle,
  type WebConversationProfile
} from "./web-adapter-core.ts";
import { attachNativeWebNavigation, mergeNativeWebTurns, resolveNativeWebTarget } from "./native-web-navigation.ts";

const CUSTOM_SITE_CAPABILITIES: NativeConversationCapabilities = {
  userIndex: "mounted-dom",
  targetIdentity: "mounted-dom",
  directJump: "mounted-only",
  shellRevive: "unavailable",
  assistantText: "best-effort",
  limitations: [
    "Custom profiles read only currently mounted DOM turns.",
    "Unmounted targets fail explicitly; custom profiles cannot declare native TOC, API, route-state, or shell-revive behavior."
  ]
};

export function customSiteProfileToWebProfile(profile: CustomSiteProfile): WebConversationProfile {
  return {
    site: {
      id: `custom:${profile.id}`,
      displayName: profile.displayName,
      hostPatterns: [new URL(profile.origin).hostname]
    },
    conversationRootSelector: profile.conversationRootSelector,
    messageIdAttributes: [...(profile.messageIdAttributes ?? [])],
    userSelectors: [profile.userSelector],
    assistantSelectors: [profile.assistantSelector],
    messageRootSelector: `${profile.userSelector}, ${profile.assistantSelector}`,
    titleSelectors: profile.titleSelector ? [profile.titleSelector] : [],
    scrollContainerSelectors: profile.scrollContainerSelector ? [profile.scrollContainerSelector] : [],
    suppressEmptyObserverRefresh: true
  };
}

export function createCustomSiteAdapter(profile: CustomSiteProfile): ConversationAdapter {
  const webProfile = customSiteProfileToWebProfile(profile);
  const capabilities = {
    ...CUSTOM_SITE_CAPABILITIES,
    limitations: [...CUSTOM_SITE_CAPABILITIES.limitations]
  };
  let latestTurns: ReturnType<typeof attachNativeWebNavigation> = [];
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;

  const refresh = async () => {
    latestTurns = mergeNativeWebTurns(
      latestTurns,
      attachNativeWebNavigation(extractTurnsFromDocument(webProfile), webProfile.site.id)
    );
    return latestTurns;
  };

  const startObserver = (listener: TurnsListener) => {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void refresh().then(listener), 350);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  return {
    site: webProfile.site,
    capabilities,
    detectSite(url) {
      return customSiteProfileMatchesUrl(profile, url);
    },
    getLatestTurns() {
      if (latestTurns.length === 0) {
        latestTurns = attachNativeWebNavigation(extractTurnsFromDocument(webProfile), webProfile.site.id);
      }
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) return { ok: false, reason: `${profile.displayName} turn has no navigation identity.` };
      return resolveNativeWebTarget(target.navigation, webProfile);
    },
    startObserver,
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(webProfile),
        conversationId: getWebConversationId(webProfile),
        site: webProfile.site,
        harvestMeta: {
          attempted: false,
          source: "dom",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(webProfile)
        }
      };
    }
  };
}

export function selectCustomConversationAdapterFromProfiles(
  url: URL,
  profiles: CustomSiteProfile[]
): ConversationAdapter | null {
  const profile = profiles.find((candidate) => candidate.enabled && customSiteProfileMatchesUrl(candidate, url));
  return profile ? createCustomSiteAdapter(profile) : null;
}

export async function selectConversationAdapterAsync(
  url: URL = new URL(window.location.href),
  builtInAdapter: ConversationAdapter | null = null
): Promise<ConversationAdapter | null> {
  if (builtInAdapter) return builtInAdapter;
  return selectCustomConversationAdapterFromProfiles(url, await loadCustomSiteProfiles());
}

function sampleText(elements: Element[]): string[] {
  return elements
    .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 3);
}

export function previewCustomSiteProfile(
  draft: CustomSiteProfileDraft,
  pageUrl: URL = new URL(window.location.href),
  pageDocument: Document = document
): CustomSitePreviewResult {
  const validation = validateCustomSiteProfileDraft(draft);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.errors.map((error) => error.message).join(" "),
      title: "",
      conversationRoots: 0,
      userMessages: 0,
      assistantMessages: 0,
      userSamples: [],
      assistantSamples: []
    };
  }

  const profile = validation.normalized;
  if (pageUrl.origin !== profile.origin) {
    return {
      ok: false,
      reason: `The active page origin is ${pageUrl.origin}; expected ${profile.origin}.`,
      title: "",
      conversationRoots: 0,
      userMessages: 0,
      assistantMessages: 0,
      userSamples: [],
      assistantSamples: []
    };
  }

  const roots = Array.from(pageDocument.querySelectorAll(profile.conversationRootSelector));
  const root = roots[0];
  const users = root ? Array.from(root.querySelectorAll(profile.userSelector)) : [];
  const assistants = root ? Array.from(root.querySelectorAll(profile.assistantSelector)) : [];
  const title = profile.titleSelector
    ? (pageDocument.querySelector(profile.titleSelector)?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120)
    : pageDocument.title.slice(0, 120);

  return {
    ok: roots.length === 1 && users.length > 0,
    reason:
      roots.length !== 1
        ? `Expected exactly one conversation root; found ${roots.length}.`
        : users.length === 0
          ? "No user messages matched the configured selector."
          : undefined,
    title,
    conversationRoots: roots.length,
    userMessages: users.length,
    assistantMessages: assistants.length,
    userSamples: sampleText(users),
    assistantSamples: sampleText(assistants)
  };
}
