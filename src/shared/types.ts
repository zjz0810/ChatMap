export type SourceAnchor = {
  turnIndex: number;
  userMessageId?: string;
  assistantMessageId?: string;
  userAttachmentNames?: string[];
  userHash: string;
  assistantHash: string;
  userPreview: string;
  assistantPreview: string;
};

export type TurnNavigation = {
  kind: "ophel_notSourceAnchor";
  site: string;
  navigationId: string;
  identitySource?: "native-message-id" | "mounted-dom-id";
  messageId?: string;
  turnId?: string;
  parentMessageId?: string;
  branchId?: string;
  nativeTocIndex?: number;
  turnIndex?: number;
  textHash?: string;
  userPreview?: string;
};

export type NativeConversationCapabilities = {
  userIndex: "verified-native" | "mounted-dom";
  targetIdentity: "verified-native" | "mounted-dom";
  directJump: "verified-native" | "mounted-only";
  shellRevive: "bounded-native" | "unavailable";
  assistantText: "best-effort";
  limitations: string[];
};

export type Turn = {
  id: string;
  turnIndex: number;
  userText: string;
  assistantText: string;
  sourceAnchor: SourceAnchor;
  navigation?: TurnNavigation;
  /** Source message creation time in epoch milliseconds, when the site exposes it. */
  createdAt?: number;
  extractedAt: number;
};

export type ConversationInfo = {
  id: string;
  title: string;
};

export type ConversationSite = {
  id: string;
  displayName: string;
};

export type ExtractedTurnsMessage = {
  type: "TURNMAP_TURNS_UPDATED";
  turns: Turn[];
  conversationTitle: string;
  conversationId: string;
  sourceTabId?: number;
  site?: ConversationSite;
  harvestMeta?: {
    attempted: boolean;
    complete?: boolean;
    source: "conversation-api" | "structured" | "web-storage" | "indexeddb" | "native-navigation" | "dom";
    scrollContainer: string;
    scrollHeight: number;
    clientHeight: number;
    scannedSteps: number;
    scanError?: string;
    diagnostics?: {
      selectorBlocks?: number;
      selectorTurns?: number;
      fallbackSelectorCandidates?: number;
      fallbackTextCandidates?: number;
      fallbackBlocks?: number;
      fallbackTurns?: number;
    };
  };
};

export type RequestTurnsMessage = {
  type: "TURNMAP_REQUEST_TURNS";
  harvest?: boolean;
  ensureFull?: boolean;
};

export type JumpToTurnMessage = {
  type: "TURNMAP_JUMP_TO_TURN";
  navigation?: TurnNavigation;
  anchor?: SourceAnchor;
  promptText?: string;
};

export type SetFloatingPanelMessage = {
  type: "TURNMAP_SET_FLOATING_PANEL";
  enabled: boolean;
};

export type SyncLauncherMessage = {
  type: "TURNMAP_SYNC_LAUNCHER";
};

export type OpenSidePanelMessage = {
  type: "TURNMAP_OPEN_SIDE_PANEL";
};

export type OpenSettingsMessage = {
  type: "TURNMAP_OPEN_SETTINGS";
};

export type CustomSiteProfileDraftPayload = {
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

export type CustomSitePreviewResult = {
  ok: boolean;
  reason?: string;
  title: string;
  conversationRoots: number;
  userMessages: number;
  assistantMessages: number;
  userSamples: string[];
  assistantSamples: string[];
};

export type ValidateCustomSiteMessage = {
  type: "TURNMAP_VALIDATE_CUSTOM_SITE";
  profile: CustomSiteProfileDraftPayload;
};

export type JumpToTurnResult = {
  ok: boolean;
  reason?: string;
};

export type FetchConversationApiMessage = {
  type: "TURNMAP_FETCH_CONVERSATION_API";
  conversationId: string;
};

export type FetchConversationApiResult = {
  ok: boolean;
  root?: unknown;
  status?: number;
  reason?: string;
};

export type TurnMapMessage =
  | ExtractedTurnsMessage
  | RequestTurnsMessage
  | JumpToTurnMessage
  | SetFloatingPanelMessage
  | SyncLauncherMessage
  | OpenSidePanelMessage
  | OpenSettingsMessage
  | ValidateCustomSiteMessage
  | FetchConversationApiMessage;
