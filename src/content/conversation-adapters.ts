import type { ExtractedTurnsMessage, JumpToTurnResult, SourceAnchor, Turn } from "../shared/types";
import { adapterSites, chatGptSite, isChatGptUrl, selectAdapter, siteMatchesUrl, type ConversationSite } from "./adapter-registry";
import type { JumpToTurnMessage } from "../shared/types";
import type { NativeConversationCapabilities } from "../shared/types";
import { hashText } from "../shared/hash";
import {
  extractBlocksFromDocument,
  extractTurnsFromDocument,
  getLastWebExtractionDiagnostics,
  getWebChatScrollElement,
  getWebConversationId,
  getWebConversationTitle,
  revealWebTurnElement,
  type WebConversationProfile
} from "./web-adapter-core";
import {
  getLatestTurns,
  harvestTurnsByScrolling,
  refreshCompleteTurns,
  refreshLatestTurns,
  startChatGptObserver,
  toTurnsMessage
} from "./chatgpt-observer";
import { jumpToTurn } from "./jump-controller";
import { capabilitiesForBuiltInSite } from "./native-capability-registry";
import {
  attachNativeWebNavigation,
  mergeNativeWebTurns,
  resolveNativeWebTarget
} from "./native-web-navigation";
import {
  bindGeminiNativeTurns,
  findGeminiMountedTurnIndex,
  geminiConversationIdFromUrl,
  geminiNativeIndex,
  startGeminiNativeObserver
} from "./gemini-native-navigation";
import {
  doubaoConversationIdFromUrl,
  doubaoNativeIndex,
  findMountedDoubaoMessageElement,
  navigateDoubaoTarget,
  requestDoubaoVirtualTarget,
  startDoubaoNativeObserver,
  waitForMountedDoubaoMessageElement
} from "./doubao-native-navigation";
import {
  findMountedQwenTurnElement,
  mergeQwenNativeTurns,
  navigateQwenTarget,
  qwenConversationIdFromUrl,
  qwenNativeIndex,
  startQwenNativeObserver
} from "./qwen-native-navigation";
import {
  findMountedGrokResponseElement,
  grokConversationContextFromUrl,
  grokNativeIndex,
  navigateGrokTarget,
  startGrokNativeObserver
} from "./grok-native-navigation";
import {
  findMountedGlmMessageElement,
  glmConversationIdFromUrl,
  glmNativeIndex,
  glmVariantFromUrl,
  mergeGlmNativeTurns,
  navigateGlmTarget,
  startGlmNativeObserver
} from "./glm-native-navigation";
import {
  bindClaudeNativeTurns,
  claudeConversationIdFromUrl,
  claudeNativeIndex,
  findClaudeMountedTurnIndex,
  findMountedClaudeMessageElement,
  startClaudeNativeObserver
} from "./claude-native-navigation";
import {
  bindDeepSeekNativeTurns,
  deepSeekConversationIdFromUrl,
  deepSeekNativeIndex,
  findMountedDeepSeekMessageElement,
  navigateDeepSeekTarget,
  requestDeepSeekNativeTarget,
  startDeepSeekNativeObserver,
  waitForMountedDeepSeekMessageElement
} from "./deepseek-native-navigation";
import {
  bindKimiNativeTurns,
  findMountedKimiMessageElement,
  kimiConversationIdFromUrl,
  kimiNativeIndex,
  navigateKimiTarget,
  requestKimiNativeTarget,
  startKimiNativeObserver,
  waitForMountedKimiMessageElement
} from "./kimi-native-navigation";

export type TurnsListener = (turns: Turn[]) => void;
type HarvestMeta = NonNullable<ExtractedTurnsMessage["harvestMeta"]>;

export type ConversationAdapter = {
  site: ConversationSite;
  capabilities: NativeConversationCapabilities;
  detectSite(url: URL): boolean;
  getLatestTurns(): Turn[];
  refreshLatestTurns(): Promise<Turn[]>;
  refreshCompleteTurns(): Promise<Turn[]>;
  harvestTurnsByScrolling(): Promise<Turn[]>;
  jumpToTurn(target: Pick<JumpToTurnMessage, "navigation" | "anchor" | "promptText">): Promise<JumpToTurnResult>;
  startObserver(listener: TurnsListener): void;
  toTurnsMessage(turns: Turn[]): ExtractedTurnsMessage;
};

export const chatGptAdapter: ConversationAdapter = {
  site: {
    ...chatGptSite
  },
  capabilities: capabilitiesForBuiltInSite("chatgpt"),
  detectSite: isChatGptUrl,
  getLatestTurns,
  refreshLatestTurns,
  refreshCompleteTurns,
  harvestTurnsByScrolling,
  jumpToTurn,
  startObserver: startChatGptObserver,
  toTurnsMessage(turns) {
    return {
      ...toTurnsMessage(turns),
      site: this.site
    };
  }
};

function siteById(id: string): ConversationSite {
  const site = adapterSites.find((candidate) => candidate.id === id);
  if (!site) throw new Error(`Unknown TurnMap adapter site: ${id}`);
  return site;
}

const sharedWebSelectors = {
  messageRootSelector:
    "[data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
  textSelectors: [
    "[data-testid*='content' i]",
    "[class*='content' i]",
    "[class*='markdown' i]",
    "[class*='text' i]",
    "p",
    "pre",
    "code"
  ],
  excludeSelectors: [
    "[class*='toolbar' i]",
    "[class*='actions' i]",
    "[class*='citation' i]",
    "[class*='source' i]",
    "[class*='reference' i]"
  ]
};

function stripMistralUiTimestamps(text: string): string {
  return text
    .replace(/\b(?:Today|Yesterday)\s+\d{1,2}:\d{2}\s*(?:am|pm)\b/gi, " ")
    .replace(
      /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2},\s+\d{1,2}:\d{2}\s*(?:am|pm)\b/gi,
      " "
    )
    .replace(/(^|\s)\d{1,2}:\d{2}\s*(?:am|pm)(?=\s*$)/gi, " ")
    .replace(/\bWorked for\s+\d+\s*(?:s|sec|secs|seconds)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanGoogleAiStudioText(text: string, role: "user" | "assistant"): string {
  const withoutRoleLabel =
    role === "user"
      ? text.replace(/^\s*(?:User|You)\s*[:\uFF1A]?\s*/i, "")
      : text.replace(/^\s*(?:Model|Assistant)\s*[:\uFF1A]?\s*/i, "");

  if (role !== "assistant") return withoutRoleLabel.replace(/\s+/g, " ").trim();

  return withoutRoleLabel
    .replace(/^\s*(?:\u2728\s*)?Thoughts?\s+Expand to view model thoughts\s*/i, "")
    .replace(/^\s*(?:\u2728\s*)?(?:Thoughts?|Thinking)(?:\s+for\s+\d+\s*(?:s|sec|secs|seconds))?\s*/i, "")
    .replace(/\bExpand to view model thoughts\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDeepSeekConversationText(text: string, role: "user" | "assistant"): string {
  const cleaned = text
    .replace(/\b(?:Copy|Like|Dislike|Share|Regenerate|Edit)\b/gi, " ")
    .replace(/\s*(?:复制|点赞|点踩|分享|重新生成|编辑)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (role !== "assistant") return cleaned;

  const withoutThinkingLabel = cleaned
    .replace(/^已思考\s*(?:[（(].*?[）)])?\s*/i, "")
    .replace(/^深度思考\s*/i, "")
    .replace(/^Thinking\s*(?:for\s+[\d.]+\s*(?:s|sec|secs|seconds))?\s*/i, "")
    .trim();

  const finalAnswerMarkers = [
    "你遇到",
    "这是因为",
    "原因是",
    "解决方法",
    "建议",
    "可以这样",
    "要修复",
    "总结",
    "简而言之",
    "The issue is",
    "This happens because",
    "To fix",
    "You can fix",
    "In short"
  ];
  const firstMarkerIndex = finalAnswerMarkers
    .map((marker) => withoutThinkingLabel.indexOf(marker))
    .filter((index) => index > 0)
    .sort((left, right) => left - right)[0];
  if (firstMarkerIndex) return withoutThinkingLabel.slice(firstMarkerIndex).trim();

  const looksLikeReasoningOnly =
    /^(?:We need|We should|The user|User asks|Let's|I need to|Need to)\b/i.test(withoutThinkingLabel) ||
    /\b(?:the user says|the user is asking|we need to|we should|I should)\b/i.test(withoutThinkingLabel);
  return looksLikeReasoningOnly ? "" : withoutThinkingLabel;
}

function cleanGlmConversationText(text: string, role: "user" | "assistant"): string {
  let cleaned = text
    .replace(/\s*(?:批量操作|重命名|删除对话|复制|分享|重新生成|编辑)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (role === "assistant" && /^理解用户请求[:：]/.test(cleaned)) {
    const answerStart = [
      "总结：",
      "总结:",
      "zhaimiaoyizhi/TurnMap",
      "地图上的",
      "根据",
      "以下",
      "TurnMap 是",
      "1."
    ]
      .map((marker) => cleaned.indexOf(marker))
      .filter((index) => index > 0)
      .sort((left, right) => left - right)[0];

    cleaned = answerStart ? cleaned.slice(answerStart).trim() : "";
  }

  return cleaned;
}

function cleanArenaBattleChromeText(text: string): string {
  return text
    .replace(/\b(?:Assistant|Response|Option)\s+[AB]\b/gi, " ")
    .replace(/\b(?:A is better|B is better|Left is Better|Right is Better)\b/gi, " ")
    .replace(/\b(?:Continue with A|Continue with B|It's a tie|Both are bad|Both are good|Skip)\b/gi, " ")
    .replace(/\b(?:No Sources|Sources)\b/gi, " ")
    .replace(/\b(?:Copy|Retry|Regenerate|Share|Edit|Search|Image|Code|Video|Add files)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const webProfiles: WebConversationProfile[] = [
  {
    ...sharedWebSelectors,
    site: siteById("deepseek"),
    messageIdAttributes: ["data-virtual-list-item-key", "data-message-id", "data-id", "id"],
    messageIdAncestorSelector: "[data-virtual-list-item-key]",
    titleSuffixPattern: /\s*[-|]\s*DeepSeek.*$/i,
    userSelectors: [
      "[data-role='user']",
      "[data-author='user']",
      "[data-testid*='user' i]",
      "[class*='user' i][class*='message' i]",
      "[class*='message' i][class*='user' i]",
      "[class*='user-message' i]",
      "[class*='message-user' i]",
      "[class*='question' i]"
    ],
    assistantSelectors: [
      "[data-role='assistant']",
      "[data-author='assistant']",
      "[data-testid*='assistant' i]",
      "[class*='ds-markdown' i]",
      "[class*='markdown' i]",
      "[class*='assistant' i][class*='message' i]",
      "[class*='message' i][class*='assistant' i]",
      "[class*='assistant-message' i]",
      "[class*='message-assistant' i]",
      "[class*='bot-message' i]"
    ],
    excludeSelectors: [
      "[class*='think' i]",
      "[class*='reason' i]",
      "[class*='thought' i]",
      "[class*='cot' i]",
      "[data-testid*='think' i]",
      "[data-testid*='reason' i]"
    ],
    roleMessageRootSelectors: [
      {
        selector: "div.dad65929, div._4f9bf79, .ds-message-row, .message-row",
        userMarkerSelectors: [".fbb737a4", "[data-role='user']", "[data-author='user']"],
        assistantMarkerSelectors: [".ds-markdown", "[data-role='assistant']", "[data-author='assistant']"],
        userContentSelectors: [".fbb737a4"],
        assistantContentSelectors: [".ds-markdown"]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: ".fbb737a4, [data-role='user'], [data-author='user']",
        rootSelector: "div.dad65929, div._4f9bf79, .ds-message-row, .message-row",
        contentSelectors: [".fbb737a4"]
      },
      {
        role: "assistant",
        selector: ".ds-markdown, [data-role='assistant'], [data-author='assistant']",
        rootSelector: "div.dad65929, div._4f9bf79, .ds-message-row, .message-row",
        contentSelectors: [".ds-markdown"]
      }
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        "[class*='side' i]",
        "[class*='history' i]",
        "[class*='conversation-list' i]",
        "[class*='chat-list' i]",
        "[class*='new-chat' i]",
        "[class*='input' i]",
        "[class*='composer' i]",
        "[class*='textarea' i]"
      ],
      actionTextPatterns: [
        /^\u5df2\u601d\u8003/,
        /^\u601d\u8003/,
        /^\u6df1\u5ea6\u601d\u8003/,
        /^\u590d\u5236$/,
        /^\u70b9\u8d5e$/,
        /^\u70b9\u8e29$/,
        /^\u5206\u4eab$/,
        /\u590d\u5236|\u70b9\u8d5e|\u70b9\u8e29|\u5206\u4eab/
      ]
    },
    cleanText: cleanDeepSeekConversationText
  },
  {
    ...sharedWebSelectors,
    site: siteById("kimi"),
    titleSuffixPattern: /\s*[-|]\s*Kimi.*$/i,
    messageIdAttributes: ["data-turnmap-kimi-message-id"],
    userSelectors: [".segment-user", ".segment.segment-user"],
    assistantSelectors: [".segment-assistant", ".segment.segment-assistant"],
    roleMessageRootSelectors: [
      {
        selector: ".segment-user, .segment-assistant, .segment.segment-user, .segment.segment-assistant",
        userMarkerSelectors: [".segment-user"],
        assistantMarkerSelectors: [".segment-assistant"],
        userContentSelectors: [".segment-content-box > .segment-content", ".segment-content-box > .ext-text", ".segment-content-box"],
        assistantContentSelectors: [
          ".segment-content-box > .segment-content",
          ".segment-content-box > .markdown",
          ".segment-content-box > .ext-text",
          ".segment-content-box"
        ]
      }
    ],
    roleMessageSelectors: [],
    textSelectors: [".segment-content", ".markdown", ".ext-text", ".paragraph", "p", "pre", "code"],
    roleExtraction: {
      excludeAncestorSelectors: [
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]",
        "[class*='editor' i]",
        "[contenteditable='true']"
      ],
      actionTextPatterns: [
        /^\u5f15\u7528$/,
        /^\u590d\u5236$/,
        /^\u91cd\u65b0\u751f\u6210$/,
        /^\u70b9\u8d5e$/,
        /^\u70b9\u8e29$/,
        /\u5f15\u7528|\u590d\u5236|\u91cd\u65b0\u751f\u6210|\u70b9\u8d5e|\u70b9\u8e29/
      ]
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("doubao"),
    titleSuffixPattern: /\s*[-|]\s*豆包.*$/i,
    suppressEmptyObserverRefresh: true,
    userSelectors: [
      "[data-testid='send_message']",
      "[data-testid*='send_message']",
      "[class*='bg-g-send-msg-bubble']",
      "[class*='send-message']"
    ],
    assistantSelectors: [
      "[data-testid='receive_message']",
      "[data-testid*='receive_message']",
      "[class*='bg-g-receive-msg-bubble']",
      "[class*='receive-message']",
      ".flow-markdown-body"
    ],
    messageRootSelector:
      "[class*='message-list-S2Fv2S'] [class*='top-item-'], .container-PvPoAn [class*='top-item-'], .scroll-view-OEiNXD [class*='top-item-'], [data-testid='message-list'] [class*='top-item-'], [class*='inner-item-'], [data-testid='union_message'], [data-testid='message-block-container'], [data-message-id]",
    textSelectors: [
      ".flow-markdown-body",
      "[data-testid='message_text_content']",
      "[data-testid='message_content']",
      "[data-testid*='message_text']",
      "[data-testid*='message_content']",
      "[class*='message-text']",
      "[class*='message-content']",
      "[class*='bg-g-send-msg-bubble']",
      "[class*='bg-g-receive-msg-bubble']",
      "p",
      "pre",
      "code"
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      "[data-testid='flow_chat_sidebar']",
      "[data-testid='chat_input']",
      "[data-testid='flow_chat_guidance_page']",
      "[data-foundation-type*='action-bar']",
      "[class*='action-bar' i]"
    ],
    roleMessageRootSelectors: [
      {
        selector:
          "[class*='message-list-S2Fv2S'] [class*='top-item-'], .container-PvPoAn [class*='top-item-'], .scroll-view-OEiNXD [class*='top-item-'], [data-testid='message-list'] [class*='top-item-'], [class*='inner-item-'], [data-testid='union_message'], [data-testid='message-block-container'], [data-message-id]",
        userMarkerSelectors: [
          "[data-testid='send_message']",
          "[data-testid*='send_message']",
          "[class*='bg-g-send-msg-bubble']",
          "[class*='send-message']",
          "[data-foundation-type='send-message-action-bar']"
        ],
        assistantMarkerSelectors: [
          "[data-testid='receive_message']",
          "[data-testid*='receive_message']",
          "[class*='bg-g-receive-msg-bubble']",
          "[class*='receive-message']",
          "[data-foundation-type='receive-message-action-bar']",
          ".flow-markdown-body"
        ],
        userContentSelectors: [
          "[data-testid='message_text_content']",
          "[data-testid='message_content']",
          "[data-testid*='message_text']",
          "[data-testid*='message_content']",
          "[class*='bg-g-send-msg-bubble']",
          "[class*='message-text']",
          "[class*='message-content']"
        ],
        assistantContentSelectors: [
          ".flow-markdown-body",
          "[data-testid='message_text_content']",
          "[data-testid='message_content']",
          "[data-testid*='message_text']",
          "[data-testid*='message_content']",
          "[class*='bg-g-receive-msg-bubble']",
          "[class*='message-text']",
          "[class*='message-content']"
        ]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector:
          "[data-testid='send_message'], [data-testid*='send_message'], [class*='bg-g-send-msg-bubble'], [class*='send-message']",
        rootSelector:
          "[class*='top-item-'], [class*='inner-item-'], [data-testid='union_message'], [data-testid='message-block-container'], [data-message-id]",
        contentSelectors: [
          "[data-testid='message_text_content']",
          "[data-testid='message_content']",
          "[data-testid*='message_text']",
          "[data-testid*='message_content']",
          "[class*='bg-g-send-msg-bubble']",
          "[class*='message-text']",
          "[class*='message-content']"
        ]
      },
      {
        role: "assistant",
        selector:
          ".flow-markdown-body, [data-testid='receive_message'], [data-testid*='receive_message'], [class*='bg-g-receive-msg-bubble'], [class*='receive-message']",
        rootSelector:
          "[class*='top-item-'], [class*='inner-item-'], [data-testid='union_message'], [data-testid='message-block-container'], [data-message-id]",
        contentSelectors: [
          ".flow-markdown-body",
          "[data-testid='message_text_content']",
          "[data-testid='message_content']",
          "[data-testid*='message_text']",
          "[data-testid*='message_content']",
          "[class*='bg-g-receive-msg-bubble']",
          "[class*='message-text']",
          "[class*='message-content']"
        ]
      }
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        "[data-testid='flow_chat_sidebar']",
        "[data-testid='chat_input']",
        "[data-testid='flow_chat_guidance_page']",
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]"
      ],
      actionTextPatterns: [
        /^\u590d\u5236$/,
        /^\u70b9\u8d5e$/,
        /^\u70b9\u8e29$/,
        /^\u5206\u4eab$/,
        /^\u5f15\u7528$/,
        /^\u91cd\u65b0\u751f\u6210$/,
        /(\u590d\u5236|\u70b9\u8d5e|\u70b9\u8e29|\u5206\u4eab|\u5f15\u7528|\u91cd\u65b0\u751f\u6210)/
      ]
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("qwen"),
    messageIdAttributes: ["data-chat", "data-message-id", "data-turn-id", "data-id", "id"],
    titleSuffixPattern: /\s*[-|]\s*(Qwen|通义|千问).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[data-testid*='conversation-title' i]",
      "[data-testid*='chat-title' i]",
      "[data-testid*='thread-title' i]",
      "[class*='conversation-title' i]",
      "[class*='chat-title' i]",
      "[class*='session-title' i]",
      "aside [aria-current='page']",
      "aside [aria-current='page'] [title]",
      "aside [aria-selected='true']",
      "aside [aria-selected='true'] [title]",
      "aside [class*='active' i] [title]",
      "aside [class*='selected' i] [title]",
      "aside [class*='current' i] [title]",
      "aside [class*='active' i]",
      "aside [class*='selected' i]",
      "aside [class*='current' i]",
      "aside [title]",
      "[aria-current='page']",
      "[aria-current='page'] [class*='title' i]",
      "[aria-current='page'] [class*='name' i]",
      "[aria-selected='true']",
      "[aria-selected='true'] [class*='title' i]",
      "[aria-selected='true'] [class*='name' i]",
      "header h1",
      "main h1"
    ],
    titleBlocklistPatterns: [
      /^Qwen$/i,
      /^Qwen Studio$/i,
      /^Qwen(?:\d+(?:\.\d+)*)?[-\s]*(?:Plus|Max|Turbo|Coder|VL|Omni|Instruct)$/i,
      /^通义$/i,
      /^通义千问$/i,
      /^千问$/i,
      /^New Chat$/i,
      /^New chat$/i,
      /^新建对话$/,
      /^新对话/
    ],
    userSelectors: [
      ".chat-question-wrap",
      "[data-chat-question-wrap]",
      ".chat-question-card-wrap",
      "[data-role='user']",
      "[data-author='user']",
      ".qwen-chat-message-user",
      ".user-message-content",
      "[class*='user-message' i]",
      "[class*='message-user' i]",
      "[class*='human' i]"
    ],
    assistantSelectors: [
      "[data-chat-answers-wrap]",
      ".chat-answers-card-wrap",
      ".qwen-markdown",
      "[data-role='assistant']",
      "[data-author='assistant']",
      "[class*='assistant-message' i]",
      "[class*='message-assistant' i]",
      "[class*='bot' i]"
    ],
    messageRootSelector:
      ".chat-round[data-chat], .chat-message-item[data-chat], [data-chat], .qwen-chat-message, [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
    textSelectors: [
      ".chat-question-wrap",
      "[data-chat-question-wrap]",
      ".chat-question-card-wrap",
      "[data-chat-answers-wrap]",
      ".chat-answers-card-wrap",
      ".qwen-markdown",
      ".markdown",
      "[class*='markdown' i]",
      ".user-message-content",
      "[data-testid*='content' i]",
      "[class*='content' i]",
      "[class*='text' i]",
      "p",
      "pre",
      "code"
    ],
    scrollContainerSelectors: ["#message-list-scroller", ".message-list-scroll-container", "#qwen-message-list-area"],
    turnPairRootSelectors: [
      {
        selector: ".chat-round[data-chat], .chat-message-item[data-chat], [data-chat]",
        userContentSelectors: [".chat-question-wrap", "[data-chat-question-wrap]", ".chat-question-card-wrap"],
        assistantContentSelectors: ["[data-chat-answers-wrap]", ".chat-answers-card-wrap", ".qwen-markdown", ".markdown"]
      }
    ],
    roleMessageRootSelectors: [
      {
        selector: ".chat-question-wrap, [data-chat-question-wrap], .chat-question-card-wrap, [data-chat-answers-wrap], .chat-answers-card-wrap",
        userMarkerSelectors: [".chat-question-wrap", "[data-chat-question-wrap]", ".chat-question-card-wrap"],
        assistantMarkerSelectors: ["[data-chat-answers-wrap]", ".chat-answers-card-wrap"],
        userContentSelectors: [".chat-question-wrap", "[data-chat-question-wrap]", ".chat-question-card-wrap"],
        assistantContentSelectors: ["[data-chat-answers-wrap]", ".chat-answers-card-wrap", ".qwen-markdown", ".markdown"]
      },
      {
        selector: ".qwen-chat-message",
        userMarkerSelectors: [".qwen-chat-message-user"],
        assistantMarkerSelectors: [".qwen-markdown"],
        userContentSelectors: [".user-message-content"],
        assistantContentSelectors: [".qwen-markdown"]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: ".chat-question-wrap, [data-chat-question-wrap], .chat-question-card-wrap, .qwen-chat-message-user, .user-message-content, [data-role='user'], [data-author='user']",
        rootSelector: ".chat-round[data-chat], .chat-message-item[data-chat], [data-chat], .qwen-chat-message",
        contentSelectors: [".chat-question-wrap", "[data-chat-question-wrap]", ".chat-question-card-wrap", ".user-message-content"]
      },
      {
        role: "assistant",
        selector: "[data-chat-answers-wrap], .chat-answers-card-wrap, .qwen-markdown, [data-role='assistant'], [data-author='assistant']",
        rootSelector: ".chat-round[data-chat], .chat-message-item[data-chat], [data-chat], .qwen-chat-message",
        contentSelectors: ["[data-chat-answers-wrap]", ".chat-answers-card-wrap", ".qwen-markdown", ".markdown"]
      }
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      ".chat-message-mask",
      "[class*='operation' i]",
      "[class*='toolbar' i]",
      "[class*='action' i]"
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]"
      ],
      actionTextPatterns: [
        /^\u590d\u5236$/,
        /^\u70b9\u8d5e$/,
        /^\u70b9\u8e29$/,
        /^\u5206\u4eab$/,
        /^\u5f15\u7528$/,
        /^\u91cd\u65b0\u751f\u6210$/,
        /(\u590d\u5236|\u70b9\u8d5e|\u70b9\u8e29|\u5206\u4eab|\u5f15\u7528|\u91cd\u65b0\u751f\u6210)/
      ]
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("gemini"),
    titleSuffixPattern: /\s*[-|]\s*Gemini.*$/i,
    userSelectors: ["user-query", "[data-role='user']", "[class*='user-query' i]", "[class*='user-message' i]"],
    assistantSelectors: [
      "model-response",
      "message-content[class*='model-response-text' i]",
      "[class*='model-response-text' i]",
      "[data-role='assistant']",
      "[class*='model-response' i]",
      "[class*='assistant-message' i]"
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: "user-query, [data-role='user'], [class*='user-query' i]",
        contentSelectors: [
          ".query-text-line",
          "[class*='query-text' i]",
          ".query-content",
          "user-query"
        ]
      },
      {
        role: "assistant",
        selector:
          "model-response, .response-container-content, [data-role='assistant'], [class*='assistant-message' i]",
        contentSelectors: [
          "message-content[class*='model-response-text' i] .markdown",
          ".model-response-text .markdown",
          "message-content .markdown",
          "message-content[class*='model-response-text' i]",
          ".model-response-text",
          "message-content",
          ".markdown"
        ]
      }
    ],
    turnPairRootSelectors: [
      {
        selector: ".conversation-container, [class*='conversation-container' i]",
        userContentSelectors: ["user-query .query-content", "user-query .query-text-line", "user-query"],
        assistantContentSelectors: [
          "model-response .markdown.markdown-main-panel",
          "model-response .markdown-main-panel",
          "model-response message-content .markdown",
          "model-response .model-response-text",
          "model-response message-content",
          "model-response"
        ]
      }
    ],
    scrollContainerSelectors: ["[data-test-id='chat-history-container']", "infinite-scroller"],
    cleanText(text, role) {
      return role === "user" ? text.replace(/^\s*(?:你说|You said)\s*[:：]?\s*/i, "") : text;
    },
    messageRootSelector:
      "user-query, model-response, message-content[class*='model-response-text' i], [class*='model-response-text' i], .conversation-container, [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
    textSelectors: [
      ".query-text-line",
      "[class*='query-text' i]",
      ".model-response-text .markdown",
      "message-content[class*='model-response-text' i] .markdown",
      "[class*='model-response-text' i]",
      "message-content .markdown",
      "message-content",
      ".markdown",
      "p",
      "pre",
      "code"
    ],
    excludeSelectors: [
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='citation' i]",
      "[class*='source' i]",
      "[class*='reference' i]",
      "rich-textarea",
      ".ql-editor",
      "[contenteditable='true']",
      "[class*='input' i]",
      "[class*='composer' i]"
    ]
  },
  {
    ...sharedWebSelectors,
    site: siteById("google-ai-studio"),
    titleSuffixPattern: /\s*[-|]\s*(Google AI Studio|AI Studio).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[data-test-id*='prompt-title' i]",
      "[data-testid*='prompt-title' i]",
      "[class*='prompt-title' i]",
      "[class*='conversation-title' i]",
      "[class*='chat-title' i]",
      "header h1",
      "main h1"
    ],
    titleBlocklistPatterns: [
      /^Google AI Studio$/i,
      /^AI Studio$/i,
      /^Gemini$/i,
      /^Untitled prompt$/i,
      /^New prompt$/i
    ],
    userSelectors: [
      "ms-prompt-input-wrapper",
      "ms-chat-turn[class*='user' i]",
      "[data-test-id*='user' i]",
      "[data-testid*='user' i]",
      "[class*='user-prompt' i]",
      "[class*='user-message' i]"
    ],
    assistantSelectors: [
      "ms-chat-turn[class*='model' i]",
      "ms-chat-turn[class*='assistant' i]",
      "ms-cmark-node",
      "[data-test-id*='model' i]",
      "[data-testid*='model' i]",
      "[class*='model-response' i]",
      "[class*='assistant-message' i]"
    ],
    roleMessageRootSelectors: [
      {
        selector: "ms-chat-turn, [data-test-id*='chat-turn' i], [data-testid*='chat-turn' i]",
        userMarkerSelectors: [
          "ms-prompt-input-wrapper",
          "[data-test-id*='user' i]",
          "[data-testid*='user' i]",
          "[class*='user' i]",
          "[aria-label='User']"
        ],
        assistantMarkerSelectors: [
          "ms-cmark-node:not([class*='thought' i])",
          "[data-test-id*='model' i]",
          "[data-testid*='model' i]",
          "[class*='model-response' i]",
          "[class*='assistant' i]",
          "[aria-label='Model']"
        ],
        userContentSelectors: [
          "ms-prompt-input-wrapper",
          "[class*='user-prompt' i]",
          "[class*='prompt-text' i]",
          "[class*='message-content' i]",
          "p",
          "pre",
          "code"
        ],
        assistantContentSelectors: [
          "ms-cmark-node:not([class*='thought' i])",
          "[class*='model-response' i]",
          "[class*='response-content' i]",
          "[class*='markdown' i]",
          "p",
          "pre",
          "code"
        ]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector:
          "ms-prompt-input-wrapper, [data-test-id*='user' i], [data-testid*='user' i], [class*='user-prompt' i], [class*='user-message' i]",
        rootSelector: "ms-chat-turn, [data-test-id*='chat-turn' i], [data-testid*='chat-turn' i]",
        contentSelectors: [
          "ms-prompt-input-wrapper",
          "[class*='prompt-text' i]",
          "[class*='message-content' i]",
          "p",
          "pre",
          "code"
        ]
      },
      {
        role: "assistant",
        selector:
          "ms-cmark-node, [data-test-id*='model' i], [data-testid*='model' i], [class*='model-response' i], [class*='assistant-message' i]",
        rootSelector: "ms-chat-turn, [data-test-id*='chat-turn' i], [data-testid*='chat-turn' i]",
        contentSelectors: [
          "ms-cmark-node",
          "[class*='model-response' i]",
          "[class*='response-content' i]",
          "[class*='markdown' i]",
          "p",
          "pre",
          "code"
        ]
      }
    ],
    scrollContainerSelectors: [
      "ms-chat-window",
      "ms-chat-panel",
      "[data-test-id*='chat-history' i]",
      "[data-testid*='chat-history' i]",
      "[class*='chat-history' i]"
    ],
    messageRootSelector:
      "ms-chat-turn, ms-prompt-input-wrapper, ms-cmark-node, [data-test-id*='chat-turn' i], [data-testid*='chat-turn' i], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
    textSelectors: [
      "ms-prompt-input-wrapper",
      "ms-cmark-node:not([class*='thought' i])",
      "[class*='model-response' i]",
      "[class*='response-content' i]",
      "[class*='markdown' i]",
      "[class*='message-content' i]",
      "p",
      "pre",
      "code"
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      "form",
      "textarea",
      "rich-textarea",
      "[contenteditable='true']",
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='composer' i]",
      "[class*='input' i]",
      "[class*='settings' i]",
      "[class*='thought' i]",
      "[aria-label*='Thought' i]",
      "ms-thinking",
      "ms-thoughts"
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        "form",
        "textarea",
        "rich-textarea",
        "[contenteditable='true']",
        "nav",
        "[class*='toolbar' i]",
        "[class*='actions' i]",
        "[class*='composer' i]",
        "[class*='input' i]",
        "[class*='settings' i]",
        "[class*='thought' i]",
        "[aria-label*='Thought' i]",
        "ms-thinking",
        "ms-thoughts"
      ],
      actionTextPatterns: [
        /^Run$/i,
        /^Stop$/i,
        /^Copy$/i,
        /^Edit$/i,
        /^Share$/i,
        /^More$/i,
        /^Token count$/i,
        /^(Run|Stop|Copy|Edit|Share|More)$/
      ]
    },
    cleanText(text, role) {
      const withoutRoleLabel =
        role === "user"
          ? text.replace(/^\s*(?:User|You)\s*[:：]?\s*/i, "")
          : text.replace(/^\s*(?:Model|Assistant)\s*[:：]?\s*/i, "");
      return cleanGoogleAiStudioText(withoutRoleLabel, role);
    }
  },
  {
    site: siteById("claude"),
    titleSuffixPattern: /\s*[-|]\s*Claude.*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[data-testid*='conversation-title' i]",
      "[data-testid*='chat-title' i]",
      "[data-testid*='thread-title' i]",
      "[class*='conversation-title' i]",
      "[class*='chat-title' i]",
      "[aria-current='page']",
      "[aria-current='page'] [class*='title' i]",
      "[aria-current='page'] [class*='name' i]",
      "[aria-selected='true']",
      "[aria-selected='true'] [class*='title' i]",
      "[aria-selected='true'] [class*='name' i]",
      "header h1",
      "main h1"
    ],
    titleBlocklistPatterns: [
      /^Claude$/i,
      /^New chat$/i,
      /^New Chat$/i,
      /^Chats$/i,
      /^Projects$/i,
      /^Recents$/i,
      /^Settings$/i
    ],
    userSelectors: [
      "[data-testid*='user' i]",
      "[data-role='user']",
      "[class*='user-message' i]",
      "[class*='human' i]"
    ],
    assistantSelectors: [
      "[data-testid*='assistant' i]",
      "[data-role='assistant']",
      "[class*='assistant-message' i]",
      "[class*='claude' i]"
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: "[data-testid='user-message'], [data-role='user']",
        contentSelectors: ["[data-testid='user-message']"]
      },
      {
        role: "assistant",
        selector:
          ".font-claude-response:not(#markdown-artifact), .font-claude-message, div.font-serif, [data-role='assistant']",
        contentSelectors: [".font-claude-response", ".font-claude-message", "div.font-serif"]
      }
    ],
    messageIdAttributes: ["data-message-uuid", "data-message-id", "data-uuid", "data-turn-id", "data-id", "id"],
    ...sharedWebSelectors
  },
  {
    ...sharedWebSelectors,
    site: siteById("perplexity"),
    titleSuffixPattern: /\s*[-|]\s*Perplexity.*$/i,
    messageRootSelector:
      "h1.group\\/query, .group\\/query, div[id^='markdown-content-'], .prose, [data-testid*='query' i], [data-testid*='answer' i], [data-testid*='thread' i], [data-testid*='conversation' i], article",
    textSelectors: [
      "h1.group\\/query",
      ".group\\/query",
      "div[id^='markdown-content-']",
      ".prose",
      "[data-testid*='query' i]",
      "[data-testid*='answer' i]",
      "p",
      "pre",
      "code"
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      "[class*='related' i]",
      "[class*='source' i]",
      "[class*='sources' i]",
      "[class*='citation' i]",
      "[class*='sidebar' i]",
      "[class*='toolbar' i]"
    ],
    scrollContainerSelectors: [
      "main",
      "[data-testid*='thread' i]",
      "[data-testid*='conversation' i]",
      "[class*='thread' i]",
      "[class*='conversation' i]"
    ],
    userSelectors: [
      "[data-testid*='query' i]",
      "[data-role='user']",
      "[class*='query' i]",
      "[class*='user-message' i]"
    ],
    assistantSelectors: [
      "[data-testid*='answer' i]",
      "[data-role='assistant']",
      "[class*='answer' i]",
      "[class*='assistant-message' i]"
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: "h1.group\\/query, .group\\/query, [data-testid*='query' i]",
        contentSelectors: ["h1.group\\/query", ".group\\/query"]
      },
      {
        role: "assistant",
        selector: "div[id^='markdown-content-'], .prose, [data-testid*='answer' i]",
        contentSelectors: ["div[id^='markdown-content-']", ".prose"]
      }
    ],
    roleExtraction: {
      excludeAncestorSelectors: ["[class*='related' i]", "[class*='sources' i]"]
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("grok"),
    titleSuffixPattern: /\s*[-|]\s*Grok.*$/i,
    userSelectors: [
      ".justify-end .message-bubble",
      ".items-end .message-bubble",
      "[style*='justify-content: flex-end'] .message-bubble",
      "[data-role='user']",
      "[data-author='user']",
      "[class*='user-message' i]",
      "[class*='message-user' i]"
    ],
    assistantSelectors: [
      "[data-testid='grok-response']",
      ".response-content-markdown",
      "div[id^='response-']",
      ".message-bubble.max-w-none:not(.bg-surface-l1)",
      ".message-bubble:has(.response-content-markdown)",
      ".message-bubble:has([data-testid='grok-response'])",
      "[data-role='assistant']",
      "[data-author='assistant']",
      "[class*='assistant-message' i]",
      "[class*='message-assistant' i]"
    ],
    roleMessageRootSelectors: [
      {
        selector: "div[id^='response-']",
        assistantMarkerSelectors: ["[data-testid='grok-response']", ".response-content-markdown", "div[dir='ltr']", "[data-role='assistant']", "[data-author='assistant']"],
        assistantContentSelectors: ["[data-testid='grok-response']", ".response-content-markdown", "div[dir='ltr']", "p", "pre", "code"]
      },
      {
        selector:
          ".message-bubble.max-w-none:not(.bg-surface-l1), .message-bubble:has(.response-content-markdown), .message-bubble:has([data-testid='grok-response'])",
        assistantMarkerSelectors: [".response-content-markdown", "[data-testid='grok-response']", "div[dir='ltr']", "p.break-words"],
        assistantContentSelectors: [".response-content-markdown", "[data-testid='grok-response']", "div[dir='ltr']", "p.break-words", "p", "pre", "code"]
      },
      {
        selector:
          ".justify-end .message-bubble, .items-end .message-bubble, [style*='justify-content: flex-end'] .message-bubble",
        userMarkerSelectors: [".message-bubble"],
        userContentSelectors: ["p.break-words", "[data-testid='code-block']", ".message-bubble"]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector:
          ".justify-end .message-bubble, .items-end .message-bubble, [style*='justify-content: flex-end'] .message-bubble, [data-role='user'], [data-author='user'], [class*='user-message' i], [class*='message-user' i]",
        contentSelectors: ["p.break-words", "[data-testid='code-block']", ".message-bubble"]
      },
      {
        role: "assistant",
        selector:
          "div[id^='response-'], .message-bubble.max-w-none:not(.bg-surface-l1), .message-bubble:has(.response-content-markdown), .message-bubble:has([data-testid='grok-response']), [data-testid='grok-response'], .response-content-markdown, [data-role='assistant'], [data-author='assistant']",
        rootSelector:
          "div[id^='response-'], .message-bubble.max-w-none:not(.bg-surface-l1), .message-bubble:has(.response-content-markdown), .message-bubble:has([data-testid='grok-response'])",
        contentSelectors: ["p.break-words", "[data-testid='code-block']", "[data-testid='grok-response']", ".response-content-markdown", "div[dir='ltr']", "p", "pre", "code"]
      }
    ],
    messageRootSelector:
      ".message-bubble, [data-testid='grok-response'], .response-content-markdown, div[id^='response-'], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
    textSelectors: [
      "[data-testid='grok-response']",
      ".response-content-markdown",
      "div[dir='ltr']",
      "p.break-words",
      "[data-testid='code-block']",
      "[class*='markdown' i]",
      "[class*='text' i]",
      "p",
      "pre",
      "code"
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      ".thinking-container",
      ".inline-media-container",
      ".auth-notification",
      ".action-buttons",
      "[data-sonner-toaster]",
      "[class*='composer' i]",
      "[class*='input' i]"
    ],
    roleExtraction: {
      sameRoleStrategy: "last",
      skipAssistantEchoText: true,
      excludeAncestorSelectors: [
        ".thinking-container",
        ".inline-media-container",
        ".auth-notification",
        ".action-buttons",
        "[data-sonner-toaster]",
        "[class*='composer' i]",
        "[class*='input' i]"
      ]
    }
  },
  {
    ...sharedWebSelectors,
    site: { ...siteById("glm"), hostPatterns: ["chatglm.cn", "www.chatglm.cn"] },
    titleSuffixPattern: /\s*[-|]\s*(智谱清言|ChatGLM).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      ".conversation-title",
      "[class*='conversation-title' i]",
      "[class*='chat-title' i]",
      "[class*='session-title' i]",
      "[class*='session-name' i]",
      "[aria-current='page']",
      "[aria-current='page'] [class*='title' i]",
      "[aria-current='page'] [class*='name' i]",
      "[aria-selected='true']",
      "[aria-selected='true'] [class*='title' i]",
      "[aria-selected='true'] [class*='name' i]",
      ".active [class*='title' i]",
      ".active [class*='name' i]",
      ".selected [class*='title' i]",
      ".selected [class*='name' i]",
      "header h1",
      "main h1"
    ],
    titleBlocklistPatterns: [
      /^智谱清言$/i,
      /^ChatGLM$/i,
      /^New chat$/i,
      /^新建对话$/,
      /^开启新对话$/,
      /^批量操作$/i,
      /^重命名/i,
      /^删除对话$/i
    ],
    userSelectors: [
      ".detail .item .question",
      ".detail .item .question .question-txt"
    ],
    assistantSelectors: [
      ".detail .item .answer",
      ".detail .item .answer .panel",
      ".detail .item .answer .panel .printing"
    ],
    messageRootSelector: ".detail .item .question, .detail .item .answer",
    textSelectors: [
      ".question-txt span",
      ".question-txt",
      ".answer .panel .printing",
      ".answer .panel",
      ".answer .markdown-body",
      ".markdown-body",
      "p",
      "li",
      "span",
      "pre",
      "code"
    ],
    scrollContainerSelectors: [".detail .session-block", ".session-block", "#sessioncontent"],
    roleMessageRootSelectors: [
      {
        selector: ".detail .item .question, .detail .item .answer",
        userMarkerSelectors: [".question", ".question-txt"],
        assistantMarkerSelectors: [".answer", ".panel", ".printing"],
        userContentSelectors: [".question-txt span", ".question-txt"],
        assistantContentSelectors: [".panel .printing", ".panel", ".markdown-body", "p", "pre", "code"]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: ".detail .item .question",
        contentSelectors: [".question-txt span", ".question-txt"]
      },
      {
        role: "assistant",
        selector: ".detail .item .answer",
        contentSelectors: [".panel .printing", ".panel", ".markdown-body", "p", "pre", "code"]
      }
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      ".messageInputContainer",
      ".toolsView",
      ".mcpSidePanel",
      ".detail .search-box",
      ".question .edit-copy",
      ".question .copy_btn",
      ".question .expand",
      ".question .user-img",
      ".answer .robot-img",
      ".answer .robotIcon",
      ".answer .interact",
      ".answer .collectionGuide",
      ".answer .shareGuide",
      ".answer .shareGuideImg",
      "[class*='operation' i]",
      "[class*='operate' i]",
      "[class*='batch' i]",
      "[class*='rename' i]",
      "[class*='delete' i]",
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='input' i]",
      "[class*='composer' i]"
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        ".messageInputContainer",
        ".toolsView",
        ".mcpSidePanel",
        ".detail .search-box",
        "[class*='operation' i]",
        "[class*='operate' i]",
        "[class*='batch' i]",
        "[class*='rename' i]",
        "[class*='delete' i]",
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]"
      ],
      actionTextPatterns: [
        /^Copy$/i,
        /^Regenerate$/i,
        /^Edit$/i,
        /^Share$/i,
        /^复制$/,
        /^重新生成$/,
        /^编辑$/,
        /^分享$/,
        /^批量操作$/,
        /^重命名/,
        /^删除对话$/,
        /(复制|重新生成|编辑|分享|批量操作|重命名|删除对话|理解用户请求)/
      ]
    },
    cleanText(text, role) {
      return cleanGlmConversationText(text, role);
    }
  },
  {
    ...sharedWebSelectors,
    site: { ...siteById("glm"), hostPatterns: ["chat.z.ai", "z.ai"] },
    messageIdAttributes: ["id"],
    messageIdAncestorSelector: "#messages-container [id^='message-']:not([id$='-start'])",
    titleSuffixPattern: /\s*[-|]\s*(Z\.ai|GLM).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[class*='conversation-title' i]",
      "[class*='chat-title' i]",
      "[aria-current='page']",
      "[aria-current='page'] [class*='title' i]",
      "[aria-selected='true']",
      "[aria-selected='true'] [class*='title' i]",
      "header h1",
      "main h1"
    ],
    titleBlocklistPatterns: [
      /^Z\.ai$/i,
      /^GLM$/i,
      /^New chat$/i,
      /^新聊天$/,
      /^新建对话$/,
      /^登录$/
    ],
    userSelectors: [
      "#messages-container .user-message",
      "#messages-container .chat-user"
    ],
    assistantSelectors: [
      "#messages-container .chat-assistant",
      "#messages-container .chat-assistant.markdown-prose"
    ],
    messageRootSelector:
      "#messages-container .user-message, #messages-container .chat-user, #messages-container .chat-assistant",
    textSelectors: [
      ".whitespace-pre-wrap",
      ".markdown-prose",
      ".chat-user",
      ".chat-assistant",
      ".markdown-body",
      "p",
      "li",
      "span",
      "pre",
      "code"
    ],
    scrollContainerSelectors: ["#messages-container", "#chat-container"],
    roleMessageRootSelectors: [
      {
        selector: "#messages-container .user-message, #messages-container .chat-user",
        userMarkerSelectors: [".user-message", ".chat-user"],
        userContentSelectors: [".whitespace-pre-wrap", ".chat-user", ".user-message", "p", "pre", "code"]
      },
      {
        selector: "#messages-container .chat-assistant",
        assistantMarkerSelectors: [".chat-assistant"],
        assistantContentSelectors: [".markdown-prose", ".chat-assistant", "p", "pre", "code"]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector: "#messages-container .user-message, #messages-container .chat-user",
        contentSelectors: [".whitespace-pre-wrap", ".chat-user", ".user-message", "p", "pre", "code"]
      },
      {
        role: "assistant",
        selector: "#messages-container .chat-assistant",
        contentSelectors: [".markdown-prose", ".chat-assistant", "p", "pre", "code"]
      }
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      ".messageInputContainer",
      ".toolsView",
      ".mcpSidePanel",
      "[class*='thinking' i]",
      "[class*='reasoning' i]",
      "[class*='operation' i]",
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='input' i]",
      "[class*='composer' i]"
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        ".messageInputContainer",
        ".toolsView",
        ".mcpSidePanel",
        "[class*='thinking' i]",
        "[class*='reasoning' i]",
        "[class*='operation' i]",
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]"
      ],
      actionTextPatterns: [
        /^Copy$/i,
        /^Regenerate$/i,
        /^Edit$/i,
        /^Share$/i,
        /^复制$/,
        /^重新生成$/,
        /^编辑$/,
        /^分享$/,
        /(复制|重新生成|编辑|分享|理解用户请求|调用工具|整理答案)/
      ]
    },
    cleanText(text, role) {
      return cleanGlmConversationText(text, role);
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("mistral"),
    titleSuffixPattern: /\s*[-|]\s*(Le Chat|Mistral).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[data-testid*='conversation-title' i]",
      "[data-testid*='chat-title' i]",
      "[data-testid*='thread-title' i]",
      "main h1",
      "[aria-current='page']",
      "[aria-current='page'] [class*='title' i]",
      "[aria-current='page'] [class*='name' i]",
      "[aria-selected='true']",
      "[aria-selected='true'] [class*='title' i]",
      "[aria-selected='true'] [class*='name' i]",
      "header h1",
      "main header h1",
      "main header button"
    ],
    titleBlocklistPatterns: [
      /^Le Chat$/i,
      /^Mistral$/i,
      /^Mistral Le Chat$/i,
      /^New chat$/i,
      /^Untitled$/i,
      /^Agents$/i,
      /^Intelligence$/i,
      /^Projects$/i,
      /^Chats$/i,
      /^Upgrade(?: to Pro)?$/i
    ],
    userSelectors: [
      'div[data-message-author-role="user"]',
      'div[data-message-author-role="user"] div[dir="auto"]',
      "[data-role='user']",
      "[data-author='user']",
      "[data-testid*='user' i]",
      "[data-testid*='human' i]",
      "[class*='user-message' i]",
      "[class*='message-user' i]",
      "[class*='human' i]"
    ],
    assistantSelectors: [
      'div[data-message-author-role="assistant"]',
      'div[data-message-author-role="assistant"] div[data-message-part-type="answer"]',
      "[data-role='assistant']",
      "[data-author='assistant']",
      "[data-testid*='assistant' i]",
      "[data-testid*='bot' i]",
      "[class*='assistant-message' i]",
      "[class*='message-assistant' i]",
      "[class*='markdown' i]",
      "[class*='prose' i]"
    ],
    messageRootSelector:
      'div[data-message-author-role="user"], div[data-message-author-role="assistant"], [data-testid*="conversation" i] [data-testid*="message" i], [data-testid*="message" i], [data-message-id], [data-role], [data-author], article, [class*="message" i]',
    textSelectors: [
      'div[data-message-part-type="answer"]',
      'div[dir="auto"] .select-none',
      'div[dir="auto"]',
      "[data-testid*='message-content' i]",
      "[data-testid*='content' i]",
      "[class*='markdown' i]",
      "[class*='prose' i]",
      "[class*='message-content' i]",
      "[class*='content' i]",
      "[class*='text' i]",
      "p",
      "li",
      "pre",
      "code"
    ],
    scrollContainerSelectors: [
      "[data-testid*='conversation' i]",
      "[data-testid*='chat' i]",
      "[class*='conversation' i]",
      "[class*='chat' i]",
      "main.bg-sidebar-subtle",
      "main"
    ],
    roleMessageRootSelectors: [
      {
        selector:
          'div[data-message-author-role="user"], div[data-message-author-role="assistant"], [data-testid*="message" i], [data-message-id], [data-role], [data-author], article, [class*="message" i]',
        userMarkerSelectors: [
          'div[data-message-author-role="user"]',
          "[data-role='user']",
          "[data-author='user']",
          "[data-testid*='user' i]",
          "[class*='user-message' i]",
          "[class*='message-user' i]"
        ],
        assistantMarkerSelectors: [
          'div[data-message-author-role="assistant"]',
          'div[data-message-part-type="answer"]',
          "[data-role='assistant']",
          "[data-author='assistant']",
          "[data-testid*='assistant' i]",
          "[class*='assistant-message' i]",
          "[class*='message-assistant' i]",
          "[class*='markdown' i]",
          "[class*='prose' i]"
        ],
        userContentSelectors: [
          'div[dir="auto"] .select-none',
          'div[dir="auto"]',
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "[class*='text' i]",
          "p",
          "pre",
          "code"
        ],
        assistantContentSelectors: [
          'div[data-message-part-type="answer"]',
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='markdown' i]",
          "[class*='prose' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "p",
          "li",
          "pre",
          "code"
        ]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector:
          'div[data-message-author-role="user"] div[dir="auto"], div[data-message-author-role="user"], [data-role="user"], [data-author="user"], [data-testid*="user" i], [data-testid*="human" i], [class*="user-message" i], [class*="message-user" i]',
        rootSelector:
          'div[data-message-author-role="user"], [data-testid*="message" i], [data-message-id], article, [class*="message" i]',
        contentSelectors: [
          'div[dir="auto"] .select-none',
          'div[dir="auto"]',
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "[class*='text' i]",
          "p",
          "pre",
          "code"
        ]
      },
      {
        role: "assistant",
        selector:
          'div[data-message-author-role="assistant"] div[data-message-part-type="answer"], div[data-message-author-role="assistant"], [data-role="assistant"], [data-author="assistant"], [data-testid*="assistant" i], [data-testid*="bot" i], [class*="assistant-message" i], [class*="message-assistant" i]',
        rootSelector:
          'div[data-message-author-role="assistant"], [data-testid*="message" i], [data-message-id], article, [class*="message" i]',
        contentSelectors: [
          'div[data-message-part-type="answer"]',
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='markdown' i]",
          "[class*='prose' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "p",
          "li",
          "pre",
          "code"
        ]
      }
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      "[class*='sidebar' i]",
      "[class*='history' i]",
      "[class*='composer' i]",
      "[class*='input' i]",
      "[class*='textarea' i]",
      "[contenteditable='true']"
    ],
    roleExtraction: {
      excludeAncestorSelectors: [
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]",
        "[class*='textarea' i]",
        "[contenteditable='true']"
      ],
      actionTextPatterns: [
        /^Copy$/i,
        /^Retry$/i,
        /^Regenerate$/i,
        /^Share$/i,
        /^Edit$/i,
        /Copy|Retry|Regenerate|Share|Edit/
      ]
    },
    cleanText(text) {
      return stripMistralUiTimestamps(text);
    }
  },
  {
    ...sharedWebSelectors,
    site: siteById("arena"),
    titleSuffixPattern: /\s*[-|]\s*(Arena|LMArena|Chatbot Arena|Max).*$/i,
    titleFromFirstUserMessage: true,
    titleSelectors: [
      "[aria-current='page']",
      "[aria-selected='true']",
      "aside a[href*='/c/']",
      "aside a[href*='/chat/']",
      "aside [role='link']",
      "aside [role='button']",
      "[class*='active' i]",
      "[class*='selected' i]"
    ],
    titleBlocklistPatterns: [
      /^Arena$/i,
      /^LMArena$/i,
      /^Chatbot Arena$/i,
      /^Arena AI: The Official AI Ranking & LLM Leaderboard$/i,
      /^New Chat$/i,
      /^Leaderboard$/i,
      /^Search$/i,
      /^Battle Mode$/i
    ],
    userSelectors: [
      "#chat-area [class*='bg-surface-raised'][class*='max-w-prose']",
      "#chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2']",
      "#chat-area [class*='message-user' i]",
      "[data-role='user']",
      "[data-author='user']",
      "[data-testid*='user' i]",
      "[data-testid*='human' i]",
      "[class*='user-message' i]",
      "[class*='message-user' i]",
      "[class*='human' i]",
      "[class*='whitespace-pre-wrap' i]"
    ],
    assistantSelectors: [
      "#chat-area [class*='prose'][class*='break-words']",
      "#chat-area [id][class*='prose']",
      "[data-role='assistant']",
      "[data-author='assistant']",
      "[data-testid*='assistant' i]",
      "[data-testid*='bot' i]",
      "[class*='assistant-message' i]",
      "[class*='message-assistant' i]",
      "[class*='markdown' i]"
    ],
    messageRootSelector:
      "#chat-area [class*='bg-surface-raised'][class*='max-w-prose'], #chat-area [class*='prose'][class*='break-words'], #chat-area [id][class*='prose'], main[role='presentation'], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
    textSelectors: [
      "#chat-area [class*='bg-surface-raised'][class*='max-w-prose']",
      "#chat-area [class*='prose'][class*='break-words']",
      "[data-testid*='message-content' i]",
      "[data-testid*='content' i]",
      "[class*='markdown' i]",
      "[class*='prose' i]",
      "[class*='whitespace-pre-wrap' i]",
      "[class*='message-content' i]",
      "[class*='content' i]",
      "[class*='text' i]",
      "p",
      "li",
      "pre",
      "code"
    ],
    scrollContainerSelectors: [
      "#chat-area main",
      "#chat-area [class*='overflow-y-auto' i]",
      "#chat-area",
      "main[role='presentation']",
      "main",
      "[class*='overflow-y-auto' i]",
      "[class*='conversation' i]",
      "[class*='chat' i]"
    ],
    roleMessageRootSelectors: [
      {
        selector:
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose'], #chat-area [class*='prose'][class*='break-words'], #chat-area [id][class*='prose'], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
        rolePriority: ["assistant", "user"],
        userMarkerSelectors: [
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose']",
          "#chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2']",
          "[data-role='user']",
          "[data-author='user']",
          "[data-testid*='user' i]",
          "[data-testid*='human' i]",
          "[class*='user-message' i]",
          "[class*='message-user' i]",
          "[class*='human' i]"
        ],
        assistantMarkerSelectors: [
          "#chat-area [class*='prose'][class*='break-words']",
          "#chat-area [id][class*='prose']",
          "[data-role='assistant']",
          "[data-author='assistant']",
          "[data-testid*='assistant' i]",
          "[data-testid*='bot' i]",
          "[class*='assistant-message' i]",
          "[class*='message-assistant' i]",
          "[class*='markdown' i]"
        ],
        userContentSelectors: [
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose']",
          "#chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2']",
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='whitespace-pre-wrap' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "[class*='text' i]",
          "p",
          "pre",
          "code"
        ],
        assistantContentSelectors: [
          "#chat-area [class*='prose'][class*='break-words']",
          "#chat-area [id][class*='prose']",
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='markdown' i]",
          "[class*='prose' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "p",
          "li",
          "pre",
          "code"
        ]
      }
    ],
    roleMessageSelectors: [
      {
        role: "user",
        selector:
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose'], #chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2'], [data-role='user'], [data-author='user'], [data-testid*='user' i], [data-testid*='human' i], [class*='user-message' i], [class*='message-user' i]",
        rootSelector:
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose'], #chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2'], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
        contentSelectors: [
          "#chat-area [class*='bg-surface-raised'][class*='max-w-prose']",
          "#chat-area [class*='bg-surface-raised'][class*='rounded-lg'][class*='px-3'][class*='py-2']",
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='whitespace-pre-wrap' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "[class*='text' i]",
          "p",
          "pre",
          "code"
        ]
      },
      {
        role: "assistant",
        selector:
          "#chat-area [class*='prose'][class*='break-words'], #chat-area [id][class*='prose'], [data-role='assistant'], [data-author='assistant'], [data-testid*='assistant' i], [data-testid*='bot' i], [class*='assistant-message' i], [class*='message-assistant' i], [class*='markdown' i]",
        rootSelector:
          "#chat-area [class*='prose'][class*='break-words'], #chat-area [id][class*='prose'], [data-message-id], [data-testid*='message' i], [data-role], [data-author], article, [class*='message' i]",
        contentSelectors: [
          "#chat-area [class*='prose'][class*='break-words']",
          "#chat-area [id][class*='prose']",
          "[data-testid*='message-content' i]",
          "[data-testid*='content' i]",
          "[class*='markdown' i]",
          "[class*='prose' i]",
          "[class*='message-content' i]",
          "[class*='content' i]",
          "p",
          "li",
          "pre",
          "code"
        ]
      }
    ],
    excludeSelectors: [
      ...sharedWebSelectors.excludeSelectors,
      "form",
      "textarea",
      "[contenteditable='true']",
      "[class*='sidebar' i]",
      "[class*='history' i]",
      "[class*='composer' i]",
      "[class*='input' i]",
      "[class*='textarea' i]",
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='source' i]",
      "[class*='citation' i]",
      "[class*='leaderboard' i]",
      "[class*='verification' i]",
      "[class*='menu' i]"
    ],
    roleExtraction: {
      sameRoleStrategy: "first",
      skipAssistantEchoText: true,
      excludeAncestorSelectors: [
        "form",
        "textarea",
        "[contenteditable='true']",
        "nav",
        "header",
        "[class*='sidebar' i]",
        "[class*='history' i]",
        "[class*='composer' i]",
        "[class*='input' i]",
        "[class*='textarea' i]",
        "[class*='toolbar' i]",
        "[class*='actions' i]",
        "[class*='source' i]",
        "[class*='citation' i]",
        "[class*='leaderboard' i]",
        "[class*='verification' i]",
        "[class*='menu' i]"
      ],
      actionTextPatterns: [
        /^Assistant A$/i,
        /^Assistant B$/i,
        /^Response A$/i,
        /^Response B$/i,
        /^Option A$/i,
        /^Option B$/i,
        /^Assistant [AB]$/i,
        /^Response [AB]$/i,
        /^Option [AB]$/i,
        /^No Sources$/i,
        /^Sources$/i,
        /^A is better$/i,
        /^B is better$/i,
        /^Left is Better$/i,
        /^Right is Better$/i,
        /^It's a tie$/i,
        /^Both are bad$/i,
        /^Both are good$/i,
        /^Continue with A$/i,
        /^Continue with B$/i,
        /^Skip$/i,
        /^Copy$/i,
        /^Retry$/i,
        /^Regenerate$/i,
        /^Share$/i,
        /^Edit$/i,
        /^Search$/i,
        /^Image$/i,
        /^Code$/i,
        /^Video$/i,
        /^Add files$/i,
        /Assistant [AB]|Response [AB]|Option [AB]|No Sources|Sources|A is better|B is better|Left is Better|Right is Better|It's a tie|Both are bad|Both are good|Continue with A|Continue with B|Skip|Copy|Retry|Regenerate|Share|Edit|Search|Image|Code|Video|Add files/
      ]
    },
    cleanText(text) {
      return cleanArenaBattleChromeText(text);
    }
  }
];

export function createWebAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite(profile.site.id)
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () =>
    attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const refresh = async () => {
    resetCacheForConversation();
    latestTurns = mergeNativeWebTurns(latestTurns, readMountedTurns());
    lastHarvestMeta = {
      attempted: false,
      source: "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readMountedTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: `This ${profile.site.displayName} turn has no native navigation identity.` };
      }
      return resolveNativeWebTarget(target.navigation, profile);
    },
    startObserver(listener) {
      if (observer) return;
      observer = new MutationObserver(() => schedule(listener));
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: {
          ...(lastHarvestMeta ?? {
            attempted: false,
            source: "native-navigation",
            scrollContainer: "document",
            scrollHeight: document.documentElement.scrollHeight,
            clientHeight: document.documentElement.clientHeight,
            scannedSteps: 0,
            diagnostics: getLastWebExtractionDiagnostics(profile)
          })
        }
      };
    }
  };
}

function createGeminiAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("gemini")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    const nativeConversationId = geminiConversationIdFromUrl(window.location.href);
    geminiNativeIndex.activate(nativeConversationId);
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => extractTurnsFromDocument(profile);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const mountedFallbackTurns = attachNativeWebNavigation(mountedTurns, profile.site.id);
    const nativeTurns = geminiNativeIndex.getActiveTurns();
    if (nativeTurns.length === 0) return mountedFallbackTurns;

    const binding = bindGeminiNativeTurns(nativeTurns, mountedTurns);
    if (binding.complete || binding.turns.length > nativeTurns.length) {
      return binding.turns.map((turn, index) => turn.navigation ? turn : mountedFallbackTurns[index] ?? turn);
    }
    return nativeTurns;
  };

  const refresh = async () => {
    resetCacheForConversation();
    latestTurns = mergeNativeWebTurns(latestTurns, readCurrentTurns());
    lastHarvestMeta = {
      attempted: false,
      source: geminiNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then(listener);
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readCurrentTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This Gemini turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("gemini-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }

      const mountedTurns = readMountedTurns();
      const nativeTurns = geminiNativeIndex.getActiveTurns();
      const mountedIndex = findGeminiMountedTurnIndex(target.navigation, nativeTurns, mountedTurns);
      if (mountedIndex == null) {
        return {
          ok: false,
          reason: "The Gemini target is not deterministically mounted. TurnMap did not use text matching or scroll search."
        };
      }
      const userBlocks = extractBlocksFromDocument(profile).filter((block) => block.role === "user" && block.element);
      const element = userBlocks[mountedIndex]?.element;
      if (!element) {
        return { ok: false, reason: "Gemini rebuilt the target element before navigation could complete." };
      }
      revealWebTurnElement(element, getWebChatScrollElement(profile));
      return { ok: true };
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startGeminiNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: geminiNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createDoubaoAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("doubao")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    doubaoNativeIndex.activate(doubaoConversationIdFromUrl(window.location.href));
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const nativeTurns = doubaoNativeIndex.getActiveTurns();
    if (nativeTurns.length === 0) return mountedTurns;

    const nativeMessageIds = new Set(nativeTurns.map((turn) => turn.navigation?.messageId).filter(Boolean));
    const mountedByMessageId = new Map(
      mountedTurns
        .filter((turn) => turn.sourceAnchor.userMessageId)
        .map((turn) => [turn.sourceAnchor.userMessageId, turn] as const)
    );
    const enrichedNative = nativeTurns.map((turn) => {
      const mounted = mountedByMessageId.get(turn.navigation?.messageId ?? "");
      if (!mounted) return turn;
      const userText = mounted.userText.length > turn.userText.length ? mounted.userText : turn.userText;
      const assistantText = mounted.assistantText.length > turn.assistantText.length
        ? mounted.assistantText
        : turn.assistantText;
      if (userText === turn.userText && assistantText === turn.assistantText) return turn;
      return {
        ...turn,
        userText,
        assistantText,
        sourceAnchor: {
          ...turn.sourceAnchor,
          userHash: hashText(userText),
          assistantHash: hashText(assistantText),
          userPreview: userText.slice(0, 120),
          assistantPreview: assistantText.slice(0, 120)
        },
        navigation: turn.navigation ? {
          ...turn.navigation,
          textHash: hashText(userText),
          userPreview: userText.slice(0, 120)
        } : undefined
      };
    });
    const strongMountedExtras = mountedTurns.filter((turn) => {
      const messageId = turn.sourceAnchor.userMessageId;
      return Boolean(messageId && !nativeMessageIds.has(messageId) && findMountedDoubaoMessageElement(messageId));
    });
    return [...enrichedNative, ...strongMountedExtras];
  };

  const refresh = async () => {
    resetCacheForConversation();
    latestTurns = mergeNativeWebTurns(latestTurns, readCurrentTurns());
    lastHarvestMeta = {
      attempted: false,
      source: doubaoNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readCurrentTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This Doubao turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("doubao-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      return navigateDoubaoTarget(target.navigation, {
        findMounted: findMountedDoubaoMessageElement,
        requestVirtualTarget: requestDoubaoVirtualTarget,
        waitForMounted: waitForMountedDoubaoMessageElement,
        reveal(element) {
          revealWebTurnElement(element, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startDoubaoNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: doubaoNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createGrokAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("grok")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationKey = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const context = grokConversationContextFromUrl(window.location.href);
    grokNativeIndex.activate(context.origin, context.conversationId);
    const conversationKey = `${context.origin}|${context.conversationId}|${getWebConversationId(profile)}`;
    if (conversationKey !== latestConversationKey) {
      latestConversationKey = conversationKey;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);
  const readCurrentTurns = () => {
    const nativeTurns = grokNativeIndex.getActiveTurns();
    return nativeTurns.length > 0 ? nativeTurns : readMountedTurns();
  };

  const refresh = async () => {
    resetCacheForConversation();
    latestTurns = mergeNativeWebTurns(latestTurns, readCurrentTurns());
    lastHarvestMeta = {
      attempted: false,
      source: grokNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then(listener);
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readCurrentTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) return { ok: false, reason: "This Grok turn has no native navigation identity." };
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("grok-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      return navigateGrokTarget(target.navigation, {
        findMounted: findMountedGrokResponseElement,
        reveal(element) {
          revealWebTurnElement(element as HTMLElement, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startGrokNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: grokNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createQwenAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("qwen")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    qwenNativeIndex.activate(qwenConversationIdFromUrl(window.location.href));
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const nativeTurns = qwenNativeIndex.getActiveTurns();
    if (nativeTurns.length === 0) return mountedTurns;

    const nativeMessageIds = new Set(nativeTurns.map((turn) => turn.navigation?.messageId).filter(Boolean));
    const enrichedNative = mergeQwenNativeTurns(nativeTurns, mountedTurns);
    const strongMountedExtras = mountedTurns.filter((turn) => {
      const messageId = turn.sourceAnchor.userMessageId;
      return Boolean(messageId && !nativeMessageIds.has(messageId) && findMountedQwenTurnElement(messageId));
    });
    return [...enrichedNative, ...strongMountedExtras];
  };

  const refresh = async () => {
    resetCacheForConversation();
    const currentTurns = readCurrentTurns();
    latestTurns = qwenNativeIndex.getActiveTurns().length > 0
      ? currentTurns
      : mergeNativeWebTurns(latestTurns, currentTurns);
    lastHarvestMeta = {
      attempted: false,
      source: qwenNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readCurrentTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This Qwen turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("qwen-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      return navigateQwenTarget(target.navigation, {
        findMounted: findMountedQwenTurnElement,
        reveal(element) {
          revealWebTurnElement(element, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startQwenNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: qwenNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createGlmAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("glm")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    const variant = glmVariantFromUrl(window.location.href);
    const nativeConversationId = glmConversationIdFromUrl(window.location.href);
    if (variant) {
      glmNativeIndex.activate({
        variant,
        host: window.location.hostname.toLowerCase(),
        conversationId: variant === "z-ai" ? nativeConversationId : conversationId
      });
    }
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    if (glmVariantFromUrl(window.location.href) !== "z-ai") return mountedTurns;
    const nativeTurns = glmNativeIndex.getActiveTurns();
    return nativeTurns.length > 0 ? mergeGlmNativeTurns(nativeTurns, mountedTurns) : mountedTurns;
  };

  const refresh = async () => {
    resetCacheForConversation();
    const currentTurns = readCurrentTurns();
    latestTurns = glmNativeIndex.getActiveTurns().length > 0
      ? currentTurns
      : mergeNativeWebTurns(latestTurns, currentTurns);
    lastHarvestMeta = {
      attempted: false,
      source: glmNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = mergeNativeWebTurns([], readCurrentTurns());
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This GLM / Z.ai turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("glm-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      const variant = glmVariantFromUrl(window.location.href);
      if (!variant) return { ok: false, reason: "The current page is not a recognized GLM variant." };
      return navigateGlmTarget(target.navigation, {
        currentVariant: variant,
        currentHost: window.location.hostname.toLowerCase(),
        currentConversationId: variant === "z-ai"
          ? glmConversationIdFromUrl(window.location.href)
          : getWebConversationId(profile),
        findMounted: findMountedGlmMessageElement,
        reveal(element) {
          revealWebTurnElement(element, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      if (glmVariantFromUrl(window.location.href) === "z-ai") {
        startGlmNativeObserver(() => schedule(listener));
      }
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: glmNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createDeepSeekAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("deepseek")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    deepSeekNativeIndex.activate(deepSeekConversationIdFromUrl(window.location.href));
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () =>
    attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const nativeTurns = deepSeekNativeIndex.getActiveTurns();
    return nativeTurns.length > 0 ? bindDeepSeekNativeTurns(nativeTurns, mountedTurns) : mountedTurns;
  };

  const refresh = async () => {
    resetCacheForConversation();
    const currentTurns = readCurrentTurns();
    latestTurns = deepSeekNativeIndex.getActiveTurns().length > 0
      ? currentTurns
      : mergeNativeWebTurns(latestTurns, currentTurns);
    lastHarvestMeta = {
      attempted: false,
      source: deepSeekNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = readCurrentTurns();
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This DeepSeek turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("deepseek-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      return navigateDeepSeekTarget(target.navigation, {
        findMounted: findMountedDeepSeekMessageElement,
        requestNativeTarget: requestDeepSeekNativeTarget,
        waitForMounted: waitForMountedDeepSeekMessageElement,
        reveal(element) {
          revealWebTurnElement(element, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startDeepSeekNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: deepSeekNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createKimiAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("kimi")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    kimiNativeIndex.activate(kimiConversationIdFromUrl(window.location.href));
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () =>
    attachNativeWebNavigation(extractTurnsFromDocument(profile), profile.site.id);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const nativeTurns = kimiNativeIndex.getActiveTurns();
    return nativeTurns.length > 0 ? bindKimiNativeTurns(nativeTurns, mountedTurns) : mountedTurns;
  };

  const refresh = async () => {
    resetCacheForConversation();
    const currentTurns = readCurrentTurns();
    latestTurns = kimiNativeIndex.getActiveTurns().length > 0
      ? currentTurns
      : mergeNativeWebTurns(latestTurns, currentTurns);
    lastHarvestMeta = {
      attempted: false,
      source: kimiNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = readCurrentTurns();
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This Kimi turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("kimi-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }
      return navigateKimiTarget(target.navigation, {
        findMounted: findMountedKimiMessageElement,
        requestNativeTarget: requestKimiNativeTarget,
        waitForMounted: waitForMountedKimiMessageElement,
        reveal(element) {
          revealWebTurnElement(element, getWebChatScrollElement(profile));
        }
      });
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startKimiNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: kimiNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

function createClaudeAdapter(
  profile: WebConversationProfile,
  capabilities: NativeConversationCapabilities = capabilitiesForBuiltInSite("claude")
): ConversationAdapter {
  let latestTurns: Turn[] = [];
  let latestConversationId = "";
  let observer: MutationObserver | null = null;
  let debounceTimer: number | null = null;
  let lastHarvestMeta: HarvestMeta | undefined;

  const resetCacheForConversation = () => {
    const conversationId = getWebConversationId(profile);
    claudeNativeIndex.activate(claudeConversationIdFromUrl(window.location.href));
    if (conversationId !== latestConversationId) {
      latestConversationId = conversationId;
      latestTurns = [];
      lastHarvestMeta = undefined;
    }
  };

  const readMountedTurns = () => extractTurnsFromDocument(profile);

  const readCurrentTurns = () => {
    const mountedTurns = readMountedTurns();
    const mountedFallbackTurns = attachNativeWebNavigation(mountedTurns, profile.site.id);
    const nativeTurns = claudeNativeIndex.getActiveTurns();
    if (nativeTurns.length === 0) return mountedFallbackTurns;
    return bindClaudeNativeTurns(nativeTurns, mountedTurns).turns;
  };

  const refresh = async () => {
    resetCacheForConversation();
    const currentTurns = readCurrentTurns();
    latestTurns = claudeNativeIndex.getActiveTurns().length > 0
      ? currentTurns
      : mergeNativeWebTurns(latestTurns, currentTurns);
    lastHarvestMeta = {
      attempted: false,
      source: claudeNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
      scrollContainer: "document",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scannedSteps: 0,
      diagnostics: getLastWebExtractionDiagnostics(profile)
    };
    return latestTurns;
  };

  const schedule = (listener: TurnsListener) => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void refresh().then((turns) => {
        if (turns.length === 0 && profile.suppressEmptyObserverRefresh) return;
        listener(turns);
      });
    }, 350);
  };

  return {
    site: profile.site,
    capabilities,
    detectSite(url) {
      return siteMatchesUrl(profile.site, url);
    },
    getLatestTurns() {
      resetCacheForConversation();
      if (latestTurns.length === 0) latestTurns = readCurrentTurns();
      return latestTurns;
    },
    refreshLatestTurns: refresh,
    refreshCompleteTurns: refresh,
    harvestTurnsByScrolling: refresh,
    async jumpToTurn(target) {
      if (!target.navigation) {
        return { ok: false, reason: "This Claude turn has no native navigation identity." };
      }
      resetCacheForConversation();
      if (!target.navigation.navigationId.startsWith("claude-turn:")) {
        return resolveNativeWebTarget(target.navigation, profile);
      }

      const exactElement = target.navigation.messageId
        ? findMountedClaudeMessageElement(target.navigation.messageId)
        : null;
      if (exactElement) {
        revealWebTurnElement(exactElement, getWebChatScrollElement(profile));
        return { ok: true };
      }

      const mountedTurns = readMountedTurns();
      const nativeTurns = claudeNativeIndex.getActiveTurns();
      const mountedIndex = findClaudeMountedTurnIndex(target.navigation, nativeTurns, mountedTurns);
      if (mountedIndex == null) {
        return {
          ok: false,
          reason: "The Claude target is not deterministically mounted. TurnMap did not use text matching or scroll search."
        };
      }
      const userBlocks = extractBlocksFromDocument(profile).filter((block) => block.role === "user" && block.element);
      const element = userBlocks[mountedIndex]?.element;
      if (!element) {
        return { ok: false, reason: "Claude rebuilt the target element before navigation could complete." };
      }
      revealWebTurnElement(element, getWebChatScrollElement(profile));
      return { ok: true };
    },
    startObserver(listener) {
      if (!observer) {
        observer = new MutationObserver(() => schedule(listener));
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      resetCacheForConversation();
      startClaudeNativeObserver(() => schedule(listener));
      schedule(listener);
    },
    toTurnsMessage(turns) {
      return {
        type: "TURNMAP_TURNS_UPDATED",
        turns,
        conversationTitle: getWebConversationTitle(profile),
        conversationId: getWebConversationId(profile),
        site: profile.site,
        harvestMeta: lastHarvestMeta ?? {
          attempted: false,
          source: claudeNativeIndex.getActiveTurns().length > 0 ? "conversation-api" : "native-navigation",
          scrollContainer: "document",
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          scannedSteps: 0,
          diagnostics: getLastWebExtractionDiagnostics(profile)
        }
      };
    }
  };
}

const webAdapters = webProfiles.map((profile) =>
  profile.site.id === "deepseek"
    ? createDeepSeekAdapter(profile)
    : profile.site.id === "kimi"
    ? createKimiAdapter(profile)
    : profile.site.id === "gemini"
    ? createGeminiAdapter(profile)
    : profile.site.id === "doubao"
      ? createDoubaoAdapter(profile)
      : profile.site.id === "qwen"
        ? createQwenAdapter(profile)
        : profile.site.id === "claude"
          ? createClaudeAdapter(profile)
          : profile.site.id === "grok"
            ? createGrokAdapter(profile)
            : profile.site.id === "glm"
              ? createGlmAdapter(profile)
              : createWebAdapter(profile)
);

export const conversationAdapters: ConversationAdapter[] = [chatGptAdapter, ...webAdapters];

export function selectConversationAdapter(url: URL = new URL(window.location.href)): ConversationAdapter | null {
  return selectAdapter(conversationAdapters, url);
}
