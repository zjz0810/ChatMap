export const DEFAULT_USER_EDGE_WEIGHT = 0.7;
export const DEFAULT_AI_EDGE_WEIGHT = 0.72;
export const DEFAULT_TOPIC_ANALYSIS_EDGE_WEIGHT = 0.68;
export const DEFAULT_AUTO_TOPIC_EDGE_WEIGHT = 0.42;
export const DEFAULT_AUTO_SEQUENCE_EDGE_WEIGHT = 0.36;
export const DEFAULT_TOPIC_PROXY_EDGE_WEIGHT = 0.55;

export function normalizeEdgeWeight(value: unknown, fallback = DEFAULT_USER_EDGE_WEIGHT): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, Math.round(numeric * 100) / 100));
}

export function weightFromConfidence(confidence: unknown, fallback = DEFAULT_AI_EDGE_WEIGHT): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return fallback;
  return normalizeEdgeWeight(0.35 + confidence * 0.6, fallback);
}

export function edgeStrokeWidth(weight: unknown, important = false): number {
  const normalized = normalizeEdgeWeight(weight);
  const base = 1.2 + normalized * 3.4;
  return Math.round((important ? base + 1.2 : base) * 20) / 10;
}

export function edgeStrokeOpacity(weight: unknown, important = false): number {
  const normalized = normalizeEdgeWeight(weight);
  const opacity = 0.28 + normalized * 0.62 + (important ? 0.08 : 0);
  return Math.max(0.24, Math.min(0.98, Math.round(opacity * 100) / 100));
}

export function weightPercent(weight: unknown): number {
  return Math.round(normalizeEdgeWeight(weight) * 100);
}
