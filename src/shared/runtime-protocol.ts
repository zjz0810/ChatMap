import type {
  FetchConversationApiMessage,
  JumpToTurnMessage,
  OpenSettingsMessage,
  OpenSidePanelMessage,
  RequestTurnsMessage,
  SetFloatingPanelMessage,
  SyncLauncherMessage,
  TurnMapMessage,
  ValidateCustomSiteMessage
} from "./types.ts";

export type ContentCommand =
  | RequestTurnsMessage
  | JumpToTurnMessage
  | SetFloatingPanelMessage
  | SyncLauncherMessage
  | ValidateCustomSiteMessage;

export type BackgroundCommand = FetchConversationApiMessage | OpenSidePanelMessage | OpenSettingsMessage;

const CONTENT_COMMAND_TYPES = new Set<ContentCommand["type"]>([
  "TURNMAP_REQUEST_TURNS",
  "TURNMAP_JUMP_TO_TURN",
  "TURNMAP_SET_FLOATING_PANEL",
  "TURNMAP_SYNC_LAUNCHER",
  "TURNMAP_VALIDATE_CUSTOM_SITE"
]);

const BACKGROUND_COMMAND_TYPES = new Set<BackgroundCommand["type"]>([
  "TURNMAP_FETCH_CONVERSATION_API",
  "TURNMAP_OPEN_SIDE_PANEL",
  "TURNMAP_OPEN_SETTINGS"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalRecord(value: unknown): boolean {
  return value === undefined || isRecord(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validCustomSiteProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    "displayName",
    "origin",
    "pathPattern",
    "conversationRootSelector",
    "userSelector",
    "assistantSelector"
  ].every((key) => typeof value[key] === "string");
}

export function isTurnMapMessage(value: unknown): value is TurnMapMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "TURNMAP_TURNS_UPDATED":
      return (
        Array.isArray(value.turns) &&
        typeof value.conversationTitle === "string" &&
        typeof value.conversationId === "string"
      );
    case "TURNMAP_REQUEST_TURNS":
      return optionalBoolean(value.harvest) && optionalBoolean(value.ensureFull);
    case "TURNMAP_JUMP_TO_TURN":
      return optionalRecord(value.navigation) && optionalRecord(value.anchor) && optionalString(value.promptText);
    case "TURNMAP_SET_FLOATING_PANEL":
      return typeof value.enabled === "boolean";
    case "TURNMAP_SYNC_LAUNCHER":
    case "TURNMAP_OPEN_SIDE_PANEL":
    case "TURNMAP_OPEN_SETTINGS":
      return true;
    case "TURNMAP_VALIDATE_CUSTOM_SITE":
      return validCustomSiteProfile(value.profile);
    case "TURNMAP_FETCH_CONVERSATION_API":
      return typeof value.conversationId === "string" && value.conversationId.trim().length > 0;
    default:
      return false;
  }
}

export function isContentCommand(value: unknown): value is ContentCommand {
  return isTurnMapMessage(value) && CONTENT_COMMAND_TYPES.has(value.type as ContentCommand["type"]);
}

export function isBackgroundCommand(value: unknown): value is BackgroundCommand {
  return isTurnMapMessage(value) && BACKGROUND_COMMAND_TYPES.has(value.type as BackgroundCommand["type"]);
}
