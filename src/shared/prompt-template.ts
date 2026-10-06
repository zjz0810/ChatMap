export type PromptTemplateVariable = {
  name: string;
  defaultValue: string;
  required: boolean;
};

export type PromptTemplateContext = {
  input?: string;
  selection?: string;
};

export type PromptTemplateRenderResult =
  | {
      ok: true;
      text: string;
      missingVariables: [];
    }
  | {
      ok: false;
      text: string;
      missingVariables: string[];
    };

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SPECIAL_VARIABLES = new Set(["input", "selection"]);

function parseToken(rawToken: string): PromptTemplateVariable {
  const separatorIndex = rawToken.indexOf("=");
  const name = (separatorIndex >= 0 ? rawToken.slice(0, separatorIndex) : rawToken).trim();
  const defaultValue = separatorIndex >= 0 ? rawToken.slice(separatorIndex + 1).trim() : "";
  return {
    name,
    defaultValue,
    required: separatorIndex < 0
  };
}

export function extractPromptTemplateVariables(template: string): PromptTemplateVariable[] {
  const variables: PromptTemplateVariable[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const variable = parseToken(match[1] ?? "");
    if (!variable.name || SPECIAL_VARIABLES.has(variable.name) || seen.has(variable.name)) continue;
    variables.push(variable);
    seen.add(variable.name);
  }
  return variables;
}

export function hasPromptTemplateVariables(template: string): boolean {
  return extractPromptTemplateVariables(template).length > 0;
}

export function templateUsesSelection(template: string): boolean {
  return /\{\{\s*selection\s*\}\}/.test(template);
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string> = {},
  context: PromptTemplateContext = {}
): PromptTemplateRenderResult {
  const missingVariables: string[] = [];
  const text = template.replace(TEMPLATE_VARIABLE_PATTERN, (_fullMatch, token: string) => {
    const variable = parseToken(token);
    if (variable.name === "input") return context.input ?? "";
    if (variable.name === "selection") return context.selection ?? "";

    const value = values[variable.name]?.trim() ?? "";
    if (value) return value;
    if (variable.defaultValue) return variable.defaultValue;
    if (!missingVariables.includes(variable.name)) missingVariables.push(variable.name);
    return "";
  });

  return missingVariables.length > 0
    ? { ok: false, text, missingVariables }
    : { ok: true, text, missingVariables: [] };
}

export function applySelectionWrapFallback(template: string, selection: string, label = "Selected text"): string {
  if (templateUsesSelection(template)) {
    return template.replace(/\{\{\s*selection\s*\}\}/g, selection);
  }
  return `${template.trim()}\n\n${label}:\n${selection}`.trim();
}
