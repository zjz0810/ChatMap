export type ContentLifecyclePhase = "ui" | "storage" | "theme" | "messages" | "observer";

export type ContentLifecycleState = {
  started: Partial<Record<ContentLifecyclePhase, boolean>>;
};

const CONTENT_LIFECYCLE_KEY = "__turnMapContentLifecycleV1";

export function getContentLifecycleState(host: object): ContentLifecycleState {
  const record = host as Record<string, unknown>;
  const existing = record[CONTENT_LIFECYCLE_KEY] as ContentLifecycleState | undefined;
  if (existing?.started) return existing;

  const state: ContentLifecycleState = { started: {} };
  record[CONTENT_LIFECYCLE_KEY] = state;
  return state;
}

export function startContentPhase(
  state: ContentLifecycleState,
  phase: ContentLifecyclePhase,
  start: () => void
): boolean {
  if (state.started[phase]) return false;

  state.started[phase] = true;
  try {
    start();
    return true;
  } catch (error) {
    delete state.started[phase];
    throw error;
  }
}
