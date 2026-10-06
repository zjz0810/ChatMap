import type { Turn } from "./types.ts";

const placeholders = new Set(["", "No text response", "No assistant text captured", "无文字回复"]);
const promptKey = (turn: Turn) => turn.userText.replace(/\s+/g, " ").trim();
function userId(turn: Turn): string | undefined {
  const explicitId = turn.sourceAnchor.userMessageId ?? turn.navigation?.messageId ?? turn.navigation?.turnId;
  if (explicitId) return explicitId;

  const navigationId = turn.navigation?.navigationId;
  // The generated native-query id embeds a viewport-local index and prompt hash,
  // so it changes when a prompt is edited or the virtualized window shifts.
  if (navigationId && !navigationId.startsWith("chatgpt-native-user-query:")) return navigationId;
  return undefined;
}

export function reindexChatGptTurns(turns: Turn[]): Turn[] {
  const ids = new Set<string>();
  return turns.map((turn, turnIndex) => {
    let id = turn.id;
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${turn.id}-${suffix}`;
    ids.add(id);
    return {
      ...turn, id, turnIndex,
      sourceAnchor: { ...turn.sourceAnchor, turnIndex },
      navigation: turn.navigation ? { ...turn.navigation, turnIndex } : undefined
    };
  });
}

function enrich(existing: Turn, incoming: Turn): Turn {
  const useIncomingAnswer = !placeholders.has(incoming.assistantText.trim()) &&
    (placeholders.has(existing.assistantText.trim()) || incoming.assistantText.length >= existing.assistantText.length);
  const answer = useIncomingAnswer ? incoming : existing;
  return {
    ...incoming,
    id: existing.id,
    createdAt: incoming.createdAt ?? existing.createdAt,
    assistantText: answer.assistantText,
    sourceAnchor: {
      ...incoming.sourceAnchor,
      assistantHash: answer.sourceAnchor.assistantHash,
      assistantPreview: answer.sourceAnchor.assistantPreview,
      assistantMessageId: answer.sourceAnchor.assistantMessageId
    },
    navigation: incoming.navigation ?? existing.navigation
  };
}

// DOM turn indexes restart at zero for each mounted window. Overlapping messages,
// not those local indexes or discovery time, establish where a window belongs.
export function mergeChatGptWindows(
  existing: Turn[],
  incoming: Turn[],
  disjointPlacement: boolean | "prepend" = false
): Turn[] {
  if (!existing.length) return reindexChatGptTurns(incoming);
  if (!incoming.length) return existing;
  const matchWindow = (window: Turn[]) => {
    const matches = new Map<number, Turn>();
    const used = new Set<Turn>();
    window.forEach((turn, index) => {
      const identity = userId(turn);
      let candidates = identity ? existing.filter((old) => userId(old) === identity) : [];
      if (candidates.length !== 1) {
        const key = promptKey(turn);
        candidates = key && window.filter((entry) => promptKey(entry) === key).length === 1
          ? existing.filter((old) => promptKey(old) === key) : [];
      }
      if (candidates.length === 1 && !used.has(candidates[0])) {
        matches.set(index, candidates[0]);
        used.add(candidates[0]);
      }
    });
    return { matches, used };
  };
  let window = incoming;
  let { matches, used } = matchWindow(window);
  const matchedOrder = [...matches.values()].map((turn) => existing.indexOf(turn));
  let ascending = 0;
  let descending = 0;
  for (let index = 1; index < matchedOrder.length; index += 1) {
    if (matchedOrder[index] > matchedOrder[index - 1]) ascending += 1;
    else if (matchedOrder[index] < matchedOrder[index - 1]) descending += 1;
  }
  // A recycled virtual list can return its visible window in reverse order.
  // Existing overlap anchors reveal the true direction; normalize before splicing.
  if (descending > ascending) {
    window = [...incoming].reverse();
    ({ matches, used } = matchWindow(window));
  }
  // Modern ChatGPT can omit message ids. If an equal-length mounted window has
  // one changed prompt while every other prompt still anchors at the same
  // position, it is an edited turn, not a new turn to append beside the old one.
  if (window.length === existing.length && matches.size === window.length - 1) {
    const anchorsStayInPlace = [...matches].every(([windowIndex, existingTurn]) =>
      existing.indexOf(existingTurn) === windowIndex
    );
    const changedIndex = window.findIndex((_turn, index) => !matches.has(index));
    if (anchorsStayInPlace && changedIndex >= 0 && !used.has(existing[changedIndex])) {
      matches.set(changedIndex, existing[changedIndex]);
      used.add(existing[changedIndex]);
    }
  }
  // Repeated prompts may have no DOM ids. An unchanged, unique answer anchors
  // an otherwise identical mounted window while a neighbouring answer streams.
  const sameWindow = existing.length === window.length &&
    existing.every((old, index) => promptKey(old) === promptKey(window[index])) &&
    existing.some((old, index) => !placeholders.has(old.assistantText.trim()) &&
      old.assistantText === window[index].assistantText &&
      existing.filter((entry) => promptKey(entry) === promptKey(old) && entry.assistantText === old.assistantText).length === 1);
  if (sameWindow) {
    return reindexChatGptTurns(window.map((turn, index) => enrich(existing[index], turn)));
  }
  if (!matches.size) {
    if (disjointPlacement === "prepend") return reindexChatGptTurns([...window, ...existing]);
    return disjointPlacement ? reindexChatGptTurns([...existing, ...window]) : existing;
  }

  // A fresh window covering every known message also repairs a previously wrong order.
  if (used.size === existing.length) {
    return reindexChatGptTurns(window.map((turn, index) => {
      const old = matches.get(index);
      return old ? enrich(old, turn) : turn;
    }));
  }
  const result = [...existing];
  let previous: Turn | undefined;
  window.forEach((turn, index) => {
    const old = matches.get(index);
    if (old) {
      const updated = enrich(old, turn);
      result[result.indexOf(old)] = updated;
      previous = updated;
      return;
    }
    const next = [...matches.entries()].find(([nextIndex]) => nextIndex > index)?.[1];
    const position = previous ? result.indexOf(previous) + 1 : next ? result.indexOf(next) : result.length;
    result.splice(position, 0, turn);
    previous = turn;
  });
  return reindexChatGptTurns(result);
}
