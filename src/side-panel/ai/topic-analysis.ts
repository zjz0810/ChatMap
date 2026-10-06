export type TopicAnalysisNode = {
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  order?: number;
};

export type ExistingTopicLink = {
  source: string;
  target: string;
};

export type TopicCandidatePair = {
  source: string;
  target: string;
  relationship: "related";
  label: string;
  reason: string;
  score: number;
  confidence: number;
  createdBy: "topic-analysis";
};

export type TopicAnalysisOptions = {
  existingLinks?: ExistingTopicLink[];
  maxCandidates?: number;
  maxPairsPerNode?: number;
  minScore?: number;
};

type NodeFeatures = {
  id: string;
  order: number;
  titleTokens: Set<string>;
  tags: Set<string>;
  weights: Map<string, number>;
  totalWeight: number;
};

const DEFAULT_MAX_CANDIDATES = 8;
const DEFAULT_MAX_PAIRS_PER_NODE = 2;
const DEFAULT_MIN_SCORE = 0.74;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "adds",
  "add",
  "keeps",
  "keep",
  "discusses",
  "updates",
  "turn",
  "node",
  "nodes"
]);

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^#+/, "").trim();
}

function textTokens(value: string): string[] {
  const tokens: string[] = [];
  const normalized = value.normalize("NFKC");
  for (const match of normalized.matchAll(/[A-Za-z][A-Za-z0-9_-]*|[0-9]+|[\u4e00-\u9fff]+/g)) {
    const raw = match[0];
    if (/^[\u4e00-\u9fff]+$/.test(raw)) {
      if (raw.length === 1) {
        tokens.push(raw);
      } else {
        for (let index = 0; index < raw.length - 1; index += 1) {
          tokens.push(raw.slice(index, index + 2));
        }
      }
      continue;
    }
    const token = normalizeToken(raw);
    if (token.length >= 2 && !STOP_WORDS.has(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function addWeight(weights: Map<string, number>, token: string, weight: number): void {
  if (!token || STOP_WORDS.has(token)) return;
  weights.set(token, (weights.get(token) ?? 0) + weight);
}

function featuresForNode(node: TopicAnalysisNode, fallbackOrder: number): NodeFeatures {
  const weights = new Map<string, number>();
  const titleTokens = new Set(textTokens(node.title));
  const summaryTokens = textTokens(node.summary);
  const tags = new Set((node.tags ?? []).map(normalizeToken).filter(Boolean));

  for (const token of titleTokens) addWeight(weights, token, 3);
  for (const token of summaryTokens) addWeight(weights, token, 1);
  for (const tag of tags) addWeight(weights, tag, 4);

  return {
    id: node.id,
    order: typeof node.order === "number" ? node.order : fallbackOrder,
    titleTokens,
    tags,
    weights,
    totalWeight: [...weights.values()].reduce((sum, weight) => sum + weight, 0)
  };
}

function linkKey(source: string, target: string): string {
  return source < target ? `${source}:${target}` : `${target}:${source}`;
}

function sharedTerms(left: NodeFeatures, right: NodeFeatures): string[] {
  const terms: Array<{ term: string; weight: number }> = [];
  for (const [term, leftWeight] of left.weights) {
    const rightWeight = right.weights.get(term);
    if (!rightWeight) continue;
    terms.push({ term, weight: Math.min(leftWeight, rightWeight) });
  }
  return terms
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, 4)
    .map((item) => item.term);
}

function pairScore(left: NodeFeatures, right: NodeFeatures, terms: string[]): number {
  const sharedWeight = terms.reduce(
    (sum, term) => sum + Math.min(left.weights.get(term) ?? 0, right.weights.get(term) ?? 0),
    0
  );
  const smallerTotal = Math.max(1, Math.min(left.totalWeight, right.totalWeight));
  const sharedTags = [...left.tags].filter((tag) => right.tags.has(tag)).length;
  const sharedTitleTerms = terms.filter((term) => left.titleTokens.has(term) && right.titleTokens.has(term)).length;
  const rawScore = sharedWeight / smallerTotal + sharedTags * 0.18 + sharedTitleTerms * 0.08;
  return Math.max(0, Math.min(0.99, Number(rawScore.toFixed(2))));
}

function requiredScoreForGap(baseScore: number, intermediateGap: number): number {
  if (intermediateGap <= 1) return Math.max(baseScore, 0.86);
  if (intermediateGap === 2) return Math.max(baseScore, 0.8);
  return baseScore;
}

export function buildTopicCandidatePairs(
  nodes: TopicAnalysisNode[],
  options: TopicAnalysisOptions = {}
): TopicCandidatePair[] {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const maxPairsPerNode = options.maxPairsPerNode ?? DEFAULT_MAX_PAIRS_PER_NODE;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const existingLinks = new Set((options.existingLinks ?? []).map((edge) => linkKey(edge.source, edge.target)));
  const features = nodes
    .filter((node) => node.id !== "conversation-root")
    .map(featuresForNode)
    .filter((node) => node.weights.size > 0);

  const candidates: TopicCandidatePair[] = [];
  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const left = features[leftIndex];
      const right = features[rightIndex];
      if (existingLinks.has(linkKey(left.id, right.id))) continue;

      const intermediateGap = Math.max(0, Math.abs(left.order - right.order) - 1);
      if (intermediateGap < 1) continue;

      const terms = sharedTerms(left, right);
      if (terms.length < 2) continue;

      const score = pairScore(left, right, terms);
      if (score < requiredScoreForGap(minScore, intermediateGap)) continue;

      candidates.push({
        source: left.order <= right.order ? left.id : right.id,
        target: left.order <= right.order ? right.id : left.id,
        relationship: "related",
        label: "topic",
        reason: `Shared terms: ${terms.join(", ")}`,
        score,
        confidence: score,
        createdBy: "topic-analysis"
      });
    }
  }

  const participation = new Map<string, number>();
  const accepted: TopicCandidatePair[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source))) {
    const sourceCount = participation.get(candidate.source) ?? 0;
    const targetCount = participation.get(candidate.target) ?? 0;
    if (sourceCount >= maxPairsPerNode || targetCount >= maxPairsPerNode) continue;
    accepted.push(candidate);
    participation.set(candidate.source, sourceCount + 1);
    participation.set(candidate.target, targetCount + 1);
    if (accepted.length >= maxCandidates) break;
  }

  return accepted;
}
