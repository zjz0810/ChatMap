function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
}

type ExtractJsonOptions = {
  looseStringFields?: string[];
};

const FIELD_ALIASES: Record<string, string[]> = {
  title: ["title", "标题", "標題"],
  summary: ["summary", "摘要", "总结", "總結"]
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldLabelPattern(field: string): string {
  const aliases = FIELD_ALIASES[field] ?? [field];
  return aliases.map(escapeRegExp).join("|");
}

function extractLooseStringFields(text: string, fields: string[]): Record<string, string> | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const result: Record<string, string> = {};

  for (const [index, field] of fields.entries()) {
    const currentPattern = fieldLabelPattern(field);
    const nextPatterns = fields.slice(index + 1).map(fieldLabelPattern);
    const nextLookahead =
      nextPatterns.length > 0 ? `(?=\\s*(?:[-*]\\s*)?(?:${nextPatterns.join("|")})\\s*[:：])` : "$";
    const match = normalized.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${currentPattern})\\s*[:：]\\s*([\\s\\S]*?)${nextLookahead}`, "i"));
    const value = match?.[1]?.trim().replace(/\s+/g, " ");
    if (!value) return null;
    result[field] = value;
  }

  return result;
}

export function extractJsonObject(text: string, options: ExtractJsonOptions = {}): unknown {
  const trimmed = stripMarkdownFence(text);

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Surface a useful diagnostic below.
      }
    }
  }

  if (options.looseStringFields?.length) {
    const looseFields = extractLooseStringFields(trimmed, options.looseStringFields);
    if (looseFields) return looseFields;
  }

  throw new Error(`Model did not return valid JSON. Response started with: ${preview(text) || "(empty)"}`);
}

export function tryExtractJsonObject(text: string, options: ExtractJsonOptions = {}): unknown | null {
  try {
    return extractJsonObject(text, options);
  } catch {
    return null;
  }
}
