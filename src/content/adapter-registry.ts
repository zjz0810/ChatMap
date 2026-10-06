import {
  BUILT_IN_CONVERSATION_SITES,
  CHATGPT_SITE,
  siteMatchesUrl,
  type ConversationSite
} from "../shared/built-in-sites.ts";

export type { ConversationSite } from "../shared/built-in-sites.ts";

export type DetectableConversationAdapter = {
  site: ConversationSite;
  detectSite(url: URL): boolean;
};

export const chatGptSite = CHATGPT_SITE;
export const adapterSites = BUILT_IN_CONVERSATION_SITES;
export { siteMatchesUrl };

export function isChatGptUrl(url: URL): boolean {
  return siteMatchesUrl(chatGptSite, url);
}

export function selectAdapter<TAdapter extends DetectableConversationAdapter>(
  adapters: TAdapter[],
  url: URL
): TAdapter | null {
  return adapters.find((adapter) => adapter.detectSite(url)) ?? null;
}
