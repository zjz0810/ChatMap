export type PromptApplyMode = "smart" | "insert" | "append" | "replace" | "wrapSelection";
export type PromptWorkbenchPanelSide = "auto" | "left" | "right";
export type PromptOptimizeFormat = "simple-polish" | "strict-planning";

export type PromptWorkbenchSettings = {
  enabled: boolean;
  aiOptimizePreview: boolean;
  aiOptimizeFormat: PromptOptimizeFormat;
  defaultApplyMode: PromptApplyMode;
  panelSide: PromptWorkbenchPanelSide;
};

export type PromptOptimizerPrompts = {
  simplePolish: string;
  strictPlanning: string;
};

export type PromptFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type PromptItem = {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  tags: string[];
  enabled: boolean;
  pinned: boolean;
  sortOrder: number;
  useCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
  note?: string;
};

export type PromptWorkbenchLibrary = {
  schemaVersion: 1;
  folders: PromptFolder[];
  prompts: PromptItem[];
  settings: PromptWorkbenchSettings;
  optimizerPrompts: PromptOptimizerPrompts;
  examplesSeeded: boolean;
};

export type PromptWorkbenchBackup = {
  schemaVersion: 1;
  app: "ChatMap" | "TurnMap";
  kind: "prompt-workbench";
  exportedAt: number;
  folders: PromptFolder[];
  prompts: PromptItem[];
  settings: PromptWorkbenchSettings;
  optimizerPrompts: PromptOptimizerPrompts;
};

export type PromptWorkbenchImportOptions = {
  mode: "merge" | "replace";
  titleConflict?: "overwrite" | "skip";
  importSettings?: boolean;
  importOptimizerPrompts?: boolean;
  locale?: PromptWorkbenchLocale;
  now?: number;
  idFactory?: IdFactory;
};

export type PromptWorkbenchImportSummary = {
  added: number;
  updated: number;
  skipped: number;
};

export type PromptWorkbenchImportResult = {
  library: PromptWorkbenchLibrary;
  summary: PromptWorkbenchImportSummary;
};

type IdFactory = (prefix?: string) => string;
export type PromptWorkbenchLocale = "en" | "zh";

export const PROMPT_WORKBENCH_STORAGE_KEY = "turnmap.promptWorkbench";
export const PROMPT_WORKBENCH_SCHEMA_VERSION = 1;

export const DEFAULT_PROMPT_WORKBENCH_SETTINGS: PromptWorkbenchSettings = {
  enabled: true,
  aiOptimizePreview: true,
  aiOptimizeFormat: "simple-polish",
  defaultApplyMode: "smart",
  panelSide: "auto"
};

export const DEFAULT_SIMPLE_POLISH_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer. Rewrite only the user's current input into a clearer final prompt while preserving intent, language, constraints, and tone. Return only the improved prompt. Make the goal, input materials, output contract, boundaries, assumptions, technical route, acceptance criteria, and verification method explicit when they are implied. Do not answer or complete the task described by the input; only improve the prompt that would ask a future assistant to do it. Do not invent unrelated requirements; mark uncertainty as something to confirm inside the prompt.";

export const DEFAULT_STRICT_PLANNING_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer. Analyze only the user's current input and return an English Markdown table with columns: | Area | Current interpretation | User needs to fill or confirm | Verification check |. Cover goal, input materials, desired output, boundaries, assumptions, technical route, data/tools, acceptance criteria, verification method, risks, and open questions. Mark each interpretation as Provided, Suggested, Missing, or Confirm. Do not perform the task described by the input; only identify how the prompt should be clarified before a future assistant performs it. You may propose a direction, but never present inferred requirements as user-provided facts.";

const ZH_SIMPLE_POLISH_OPTIMIZER_PROMPT =
  "你是一名经验丰富的提示词工程师。只改写用户当前输入，让它成为更清晰、可直接使用的最终提示词，同时保留原意、语言、约束和语气。只输出优化后的提示词。请在原文已有或明显暗示时，明确目标、输入材料、输出形式、边界、假设、技术路线、验收标准和验证方法。不要回答或完成输入中描述的任务；只优化未来助手要执行该任务时使用的提示词。不要编造无关需求；不确定的内容写成需要确认的问题。";

const ZH_STRICT_PLANNING_OPTIMIZER_PROMPT =
  "你是一名经验丰富的提示词工程师。只分析用户当前输入，并返回中文 Markdown 表格，表头必须是：| 项目 | 当前判断 | 用户需要补充或确认 | 验证检查 |。覆盖目标、输入材料、期望输出、边界、假设、技术路线、数据/工具、验收标准、验证方法、风险和开放问题。每个当前判断都标注 Provided、Suggested、Missing 或 Confirm。不要执行输入中描述的任务；只指出未来助手执行前，这个提示词还应如何澄清。你可以提出建议方向，但不要把推断内容当作用户已经给出的事实。";

export const DEFAULT_OPTIMIZER_PROMPTS: PromptOptimizerPrompts = {
  simplePolish: DEFAULT_SIMPLE_POLISH_OPTIMIZER_PROMPT,
  strictPlanning: DEFAULT_STRICT_PLANNING_OPTIMIZER_PROMPT
};

const PROMPT_WORKBENCH_LANGUAGE_PACKS = {
  en: {
    examplesFolder: "Examples",
    optimizerPrompts: DEFAULT_OPTIMIZER_PROMPTS,
    prompts: [
      {
        key: "translation",
        title: "Translation",
        content:
          "Act as a careful translator. Translate the input into {{language=English}}.\n\nInput:\n{{input}}\n\nOutput requirements:\n- Preserve terminology, formatting, code blocks, links, tables, and proper nouns.\n- Keep ambiguous source terms in parentheses after the translation.\n- Do not summarize or add new claims.\n\nQuality checks:\n- Every source paragraph has a corresponding translated paragraph.\n- Code and quoted identifiers remain unchanged unless translation is explicitly needed.",
        tags: ["translation"],
        note: "Translate with preservation checks."
      },
      {
        key: "projectPlanning",
        title: "Project planning",
        content:
          "Act as an experienced product manager and technical lead. Turn the following idea into an executable project plan.\n\nIdea:\n{{input}}\n\nReturn:\n1. Goal and non-goals.\n2. User workflows and module boundaries.\n3. Technical route and dependency assumptions.\n4. Milestones with deliverables.\n5. Risks and decision points.\n6. Acceptance criteria and validation steps for each critical workflow.\n\nDo not expand scope beyond the stated idea; list open questions separately.",
        tags: ["planning"],
        note: "Convert a rough idea into a validated plan."
      },
      {
        key: "literatureSearch",
        title: "Literature search",
        content:
          "Act as an academic research methodologist. Design a reproducible literature search plan for {{topic}}.\n\nReturn:\n- Research question and scope.\n- Keyword matrix with synonyms and Boolean query drafts.\n- Target databases and date/language limits.\n- Inclusion and exclusion criteria.\n- Screening workflow with duplicate handling.\n- Evidence extraction table fields.\n- Synthesis outline and quality checks.\n\nMake the process clear enough for another reviewer to rerun it.",
        tags: ["research"],
        note: "Prepare reproducible academic search strategy."
      },
      {
        key: "documentFormatting",
        title: "Document formatting",
        content:
          "Act as a document editor. Improve the structure and formatting of the document below while preserving the original meaning.\n\nDocument:\n{{input}}\n\nReturn an editable Markdown version plus a short formatting checklist covering headings, list hierarchy, table consistency, terminology consistency, and unresolved ambiguities. Do not remove important details.",
        tags: ["writing"],
        note: "Clean up document structure with checks."
      },
      {
        key: "bugReproduction",
        title: "Bug reproduction",
        content:
          "Act as a senior debugging partner. Convert this bug report into a reproducible investigation plan.\n\nBug report:\n{{input}}\n\nReturn:\n1. Environment and preconditions.\n2. Minimal reproduction steps.\n3. Expected result vs actual result.\n4. Suspected failure boundary and ranked hypotheses.\n5. Required logs, screenshots, or fixtures.\n6. Verification commands or browser steps.\n7. Regression test proposal that would fail before the fix and pass after it.",
        tags: ["debug"],
        note: "Make bug reports reproducible and testable."
      }
    ]
  },
  zh: {
    examplesFolder: "示例",
    optimizerPrompts: {
      simplePolish: ZH_SIMPLE_POLISH_OPTIMIZER_PROMPT,
      strictPlanning: ZH_STRICT_PLANNING_OPTIMIZER_PROMPT
    },
    prompts: [
      {
        key: "translation",
        title: "翻译",
        content:
          "请作为严谨的译者，将输入内容翻译为 {{language=中文}}。\n\n输入：\n{{input}}\n\n输出要求：\n- 保留术语、格式、代码块、链接、表格和专有名词。\n- 对含义不确定的原文词语，在译文后用括号保留原词。\n- 不要总结，也不要添加新事实。\n\n质量检查：\n- 每个原文段落都有对应译文段落。\n- 代码和被引用的标识符保持不变，除非用户明确要求翻译。",
        tags: ["翻译"],
        note: "在保留格式和术语的前提下翻译。"
      },
      {
        key: "projectPlanning",
        title: "项目规划",
        content:
          "请作为经验丰富的产品经理和技术负责人，把下面的想法整理成可执行项目计划。\n\n想法：\n{{input}}\n\n请返回：\n1. 目标与非目标。\n2. 用户流程与模块边界。\n3. 技术路线与依赖假设。\n4. 里程碑和交付物。\n5. 风险与决策点。\n6. 每个关键流程的验收标准与验证步骤。\n\n不要扩大原始想法的范围；开放问题单独列出。",
        tags: ["规划"],
        note: "把粗略想法转换成可验证计划。"
      },
      {
        key: "literatureSearch",
        title: "文献检索",
        content:
          "请作为学术研究方法顾问，为 {{topic}} 设计一份可复现的文献检索方案。\n\n请返回：\n- 研究问题与范围。\n- 关键词矩阵，包括同义词和布尔检索式草案。\n- 目标数据库以及时间/语言限制。\n- 纳入与排除标准。\n- 筛选流程和重复文献处理方式。\n- 证据提取表字段。\n- 综合分析大纲与质量检查。\n\n方案要清晰到另一位研究者可以重复执行。",
        tags: ["研究"],
        note: "准备可复现的学术检索策略。"
      },
      {
        key: "documentFormatting",
        title: "文档排版优化",
        content:
          "请作为文档编辑，优化下面文档的结构和排版，同时保留原意。\n\n文档：\n{{input}}\n\n请返回可编辑的 Markdown 版本，并附上一份简短排版检查清单，覆盖标题层级、列表层级、表格一致性、术语一致性和仍需确认的歧义。不要删除重要细节。",
        tags: ["写作"],
        note: "清理文档结构并保留检查点。"
      },
      {
        key: "bugReproduction",
        title: "缺陷复现",
        content:
          "请作为资深调试伙伴，把这份 bug 报告转换成可复现的排查计划。\n\nBug 报告：\n{{input}}\n\n请返回：\n1. 环境与前置条件。\n2. 最小复现步骤。\n3. 预期结果与实际结果。\n4. 可疑故障边界与排序后的假设。\n5. 需要补充的日志、截图或 fixture。\n6. 验证命令或浏览器操作步骤。\n7. 一个回归测试建议，要求修复前失败、修复后通过。",
        tags: ["调试"],
        note: "把 bug 报告整理成可复现、可验证的排查方案。"
      }
    ]
  }
} satisfies Record<
  PromptWorkbenchLocale,
  {
    examplesFolder: string;
    optimizerPrompts: PromptOptimizerPrompts;
    prompts: Array<Pick<PromptItem, "title" | "content" | "tags" | "note"> & { key: string }>;
  }
>;

const EXAMPLE_PROMPTS = PROMPT_WORKBENCH_LANGUAGE_PACKS.en.prompts;

const LEGACY_SIMPLE_POLISH_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer. Rewrite the user's current input into a clearer prompt while preserving their intent, language, constraints, and tone. Return only the final improved prompt. Clarify the goal, input materials, expected output, boundaries, priorities, and acceptance criteria when they are implied. Do not invent unrelated requirements.";

const LEGACY_STRICT_PLANNING_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer and product-minded technical planner. Analyze only the user's current input. Return a Markdown table with columns: | 项目 | 当前判断 | 需要你补充/修改 |. Cover 目标, 输入材料, 期望输出, 边界限制, 技术路线, 验收标准, 风险点, 仍需确认. Mark each judgment as Provided, Suggested, Missing, or Confirm. You may suggest a direction, but never present inferred requirements as user-provided facts.";

const HARNESS_SIMPLE_POLISH_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer and harness engineer. Rewrite only the user's current input into a clearer final prompt while preserving intent, language, constraints, and tone. Return only the improved prompt. Make the goal, input materials, output contract, boundaries, assumptions, technical route, acceptance checks, and verification harness explicit when they are implied. Do not invent unrelated requirements; mark uncertainty as something to confirm inside the prompt.";

const HARNESS_STRICT_PLANNING_OPTIMIZER_PROMPT =
  "You are an experienced prompt engineer and harness engineer. Analyze only the user's current input and return an English Markdown table with columns: | Area | Current interpretation | User needs to fill or confirm | Harness / acceptance check |. Cover goal, input materials, desired output, boundaries, assumptions, technical route, data/tools, acceptance criteria, verification harness, risks, and open questions. Mark each interpretation as Provided, Suggested, Missing, or Confirm. You may propose a direction, but never present inferred requirements as user-provided facts.";

const LEGACY_EXAMPLE_PROMPT_CONTENT_BY_TITLE = new Map<string, string>([
  [
    "Translation",
    "Translate the following content into {{language=English}}. Preserve terminology, formatting, code blocks, and proper nouns. If a phrase is ambiguous, keep the original in parentheses.\n\n{{input}}"
  ],
  [
    "Project planning",
    "Act as an experienced product manager and technical lead. Turn the following idea into a scoped project plan with goals, non-goals, modules, milestones, risks, and acceptance criteria.\n\n{{input}}"
  ],
  [
    "Literature search",
    "Help me design a literature search plan for {{topic}}. Include keywords, inclusion criteria, exclusion criteria, target databases, screening steps, and a synthesis outline."
  ],
  [
    "Document formatting",
    "Improve the structure and formatting of the following document. Keep the original meaning, make headings clearer, fix list hierarchy, and return an editable Markdown version.\n\n{{input}}"
  ],
  [
    "Bug reproduction",
    "Convert this bug report into a clear reproduction report with environment, steps to reproduce, expected result, actual result, suspected area, missing evidence, and verification commands.\n\n{{input}}"
  ]
]);

const HARNESS_EXAMPLE_PROMPT_CONTENT_BY_TITLE = new Map<string, string>([
  [
    "Translation",
    "Act as a careful translation harness engineer. Translate the input into {{language=English}}.\n\nInput:\n{{input}}\n\nOutput contract:\n- Preserve terminology, formatting, code blocks, links, tables, and proper nouns.\n- Keep ambiguous source terms in parentheses after the translation.\n- Do not summarize or add new claims.\n\nAcceptance checks:\n- Every source paragraph has a corresponding translated paragraph.\n- Code and quoted identifiers remain unchanged unless translation is explicitly needed."
  ],
  [
    "Project planning",
    "Act as an experienced product manager, technical lead, and harness engineer. Turn the following idea into an executable project plan.\n\nIdea:\n{{input}}\n\nReturn:\n1. Goal and non-goals.\n2. User workflows and module boundaries.\n3. Technical route and dependency assumptions.\n4. Milestones with deliverables.\n5. Risks and decision points.\n6. Acceptance tests and a minimal validation harness for each critical workflow.\n\nDo not expand scope beyond the stated idea; list open questions separately."
  ],
  [
    "Literature search",
    "Act as a research-methods harness engineer. Design a reproducible literature search plan for {{topic}}.\n\nReturn:\n- Research question and scope.\n- Keyword matrix with synonyms and Boolean query drafts.\n- Target databases and date/language limits.\n- Inclusion and exclusion criteria.\n- Screening workflow with duplicate handling.\n- Evidence extraction table fields.\n- Synthesis outline and quality checks.\n\nMake the process reproducible enough for another reviewer to rerun it."
  ],
  [
    "Document formatting",
    "Act as a document-quality harness engineer. Improve the structure and formatting of the document below while preserving the original meaning.\n\nDocument:\n{{input}}\n\nReturn an editable Markdown version plus a short formatting checklist covering headings, list hierarchy, table consistency, terminology consistency, and unresolved ambiguities. Do not remove important details."
  ],
  [
    "Bug reproduction",
    "Act as a debugging harness engineer. Convert this bug report into a reproducible investigation plan.\n\nBug report:\n{{input}}\n\nReturn:\n1. Environment and preconditions.\n2. Minimal reproduction steps.\n3. Expected result vs actual result.\n4. Suspected failure boundary and ranked hypotheses.\n5. Required logs, screenshots, or fixtures.\n6. Verification commands or browser steps.\n7. Regression test proposal that would fail before the fix and pass after it."
  ]
]);

const BUILT_IN_PROMPT_KEY_BY_CONTENT = new Map<string, string>();

for (const pack of Object.values(PROMPT_WORKBENCH_LANGUAGE_PACKS)) {
  for (const prompt of pack.prompts) {
    BUILT_IN_PROMPT_KEY_BY_CONTENT.set(prompt.content, prompt.key);
  }
}

for (const [title, content] of LEGACY_EXAMPLE_PROMPT_CONTENT_BY_TITLE) {
  const key = PROMPT_WORKBENCH_LANGUAGE_PACKS.en.prompts.find((prompt) => prompt.title === title)?.key;
  if (key) BUILT_IN_PROMPT_KEY_BY_CONTENT.set(content, key);
}

for (const [title, content] of HARNESS_EXAMPLE_PROMPT_CONTENT_BY_TITLE) {
  const key = PROMPT_WORKBENCH_LANGUAGE_PACKS.en.prompts.find((prompt) => prompt.title === title)?.key;
  if (key) BUILT_IN_PROMPT_KEY_BY_CONTENT.set(content, key);
}

function normalizePromptWorkbenchLocale(locale?: PromptWorkbenchLocale): PromptWorkbenchLocale {
  return locale === "zh" ? "zh" : "en";
}

function promptWorkbenchLanguagePack(locale?: PromptWorkbenchLocale) {
  return PROMPT_WORKBENCH_LANGUAGE_PACKS[normalizePromptWorkbenchLocale(locale)];
}

export function promptWorkbenchLocaleFromLanguageMode(mode: string, browserLocale = globalThis.navigator?.language ?? "en"): PromptWorkbenchLocale {
  if (mode === "zh" || (mode === "browser" && browserLocale.toLowerCase().startsWith("zh"))) return "zh";
  return "en";
}

export function getDefaultPromptWorkbenchOptimizerPrompts(locale: PromptWorkbenchLocale = "en"): PromptOptimizerPrompts {
  return { ...promptWorkbenchLanguagePack(locale).optimizerPrompts };
}

function nowOrDefault(now?: number): number {
  return typeof now === "number" && Number.isFinite(now) ? now : Date.now();
}

export function createPromptWorkbenchId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeId(idFactory: IdFactory | undefined, prefix: string): string {
  return idFactory ? idFactory(prefix) : createPromptWorkbenchId(prefix);
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((tag) => normalizeString(tag))
        .filter(Boolean)
        .map((tag) => tag.slice(0, 48))
    )
  );
}

export function createDefaultPromptWorkbenchLibrary(
  options: { now?: number; idFactory?: IdFactory; locale?: PromptWorkbenchLocale } = {}
): PromptWorkbenchLibrary {
  const timestamp = nowOrDefault(options.now);
  const languagePack = promptWorkbenchLanguagePack(options.locale);
  const examplesFolder: PromptFolder = {
    id: makeId(options.idFactory, "fld"),
    name: languagePack.examplesFolder,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const prompts = languagePack.prompts.map((prompt, index): PromptItem => ({
    id: makeId(options.idFactory, "prm"),
    title: prompt.title,
    content: prompt.content,
    folderId: examplesFolder.id,
    tags: prompt.tags,
    enabled: true,
    pinned: false,
    sortOrder: index,
    useCount: 0,
    lastUsedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    note: prompt.note
  }));

  return {
    schemaVersion: PROMPT_WORKBENCH_SCHEMA_VERSION,
    folders: [examplesFolder],
    prompts,
    settings: { ...DEFAULT_PROMPT_WORKBENCH_SETTINGS },
    optimizerPrompts: getDefaultPromptWorkbenchOptimizerPrompts(options.locale),
    examplesSeeded: true
  };
}

export function normalizePromptWorkbenchSettings(value: unknown): PromptWorkbenchSettings {
  const source = value && typeof value === "object" ? (value as Partial<PromptWorkbenchSettings>) : {};
  const aiOptimizeFormat =
    source.aiOptimizeFormat === "strict-planning" || source.aiOptimizeFormat === "simple-polish"
      ? source.aiOptimizeFormat
      : DEFAULT_PROMPT_WORKBENCH_SETTINGS.aiOptimizeFormat;
  const defaultApplyMode: PromptApplyMode =
    source.defaultApplyMode === "insert" ||
    source.defaultApplyMode === "append" ||
    source.defaultApplyMode === "replace" ||
    source.defaultApplyMode === "wrapSelection" ||
    source.defaultApplyMode === "smart"
      ? source.defaultApplyMode
      : DEFAULT_PROMPT_WORKBENCH_SETTINGS.defaultApplyMode;
  const panelSide: PromptWorkbenchPanelSide =
    source.panelSide === "left" || source.panelSide === "right" || source.panelSide === "auto"
      ? source.panelSide
      : DEFAULT_PROMPT_WORKBENCH_SETTINGS.panelSide;

  return {
    enabled: source.enabled !== false,
    aiOptimizePreview: source.aiOptimizePreview !== false,
    aiOptimizeFormat,
    defaultApplyMode,
    panelSide
  };
}

function normalizeFolder(value: unknown, index: number, options: { now: number; idFactory?: IdFactory }): PromptFolder | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PromptFolder>;
  const name = normalizeString(source.name);
  if (!name) return null;
  return {
    id: normalizeString(source.id) || makeId(options.idFactory, "fld"),
    name,
    sortOrder: Number.isFinite(source.sortOrder) ? Number(source.sortOrder) : index,
    createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : options.now,
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : options.now
  };
}

function normalizePrompt(
  value: unknown,
  index: number,
  validFolderIds: Set<string>,
  options: { now: number; idFactory?: IdFactory }
): PromptItem | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PromptItem>;
  const title = normalizeString(source.title);
  const content = normalizeString(source.content);
  if (!title || !content) return null;
  const folderId = source.folderId && validFolderIds.has(source.folderId) ? source.folderId : null;
  return {
    id: normalizeString(source.id) || makeId(options.idFactory, "prm"),
    title,
    content,
    folderId,
    tags: normalizeTags(source.tags),
    enabled: source.enabled !== false,
    pinned: Boolean(source.pinned),
    sortOrder: Number.isFinite(source.sortOrder) ? Number(source.sortOrder) : index,
    useCount: Number.isFinite(source.useCount) ? Math.max(0, Number(source.useCount)) : 0,
    lastUsedAt: Number.isFinite(source.lastUsedAt) ? Number(source.lastUsedAt) : null,
    createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : options.now,
    updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : options.now,
    note: normalizeString(source.note) || undefined
  };
}

export function normalizeOptimizerPrompts(value: unknown, options: { locale?: PromptWorkbenchLocale } = {}): PromptOptimizerPrompts {
  const source = value && typeof value === "object" ? (value as Partial<PromptOptimizerPrompts>) : {};
  const defaults = getDefaultPromptWorkbenchOptimizerPrompts(options.locale);
  return {
    simplePolish: normalizeString(source.simplePolish) || defaults.simplePolish,
    strictPlanning: normalizeString(source.strictPlanning) || defaults.strictPlanning
  };
}

function migrateBuiltInPromptContent(
  library: PromptWorkbenchLibrary,
  timestamp: number,
  locale: PromptWorkbenchLocale = "en"
): PromptWorkbenchLibrary {
  const languagePack = promptWorkbenchLanguagePack(locale);
  const optimizerDefaults = getDefaultPromptWorkbenchOptimizerPrompts(locale);
  const optimizerPrompts = { ...library.optimizerPrompts };
  const knownSimplePolishPrompts = new Set([
    LEGACY_SIMPLE_POLISH_OPTIMIZER_PROMPT,
    HARNESS_SIMPLE_POLISH_OPTIMIZER_PROMPT,
    PROMPT_WORKBENCH_LANGUAGE_PACKS.en.optimizerPrompts.simplePolish,
    PROMPT_WORKBENCH_LANGUAGE_PACKS.zh.optimizerPrompts.simplePolish
  ]);
  const knownStrictPlanningPrompts = new Set([
    LEGACY_STRICT_PLANNING_OPTIMIZER_PROMPT,
    HARNESS_STRICT_PLANNING_OPTIMIZER_PROMPT,
    PROMPT_WORKBENCH_LANGUAGE_PACKS.en.optimizerPrompts.strictPlanning,
    PROMPT_WORKBENCH_LANGUAGE_PACKS.zh.optimizerPrompts.strictPlanning
  ]);
  if (knownSimplePolishPrompts.has(optimizerPrompts.simplePolish)) {
    optimizerPrompts.simplePolish = optimizerDefaults.simplePolish;
  }
  if (knownStrictPlanningPrompts.has(optimizerPrompts.strictPlanning)) {
    optimizerPrompts.strictPlanning = optimizerDefaults.strictPlanning;
  }

  const prompts = library.prompts.map((prompt) => {
    const key = BUILT_IN_PROMPT_KEY_BY_CONTENT.get(prompt.content);
    const nextDefault = languagePack.prompts.find((item) => item.key === key);
    if (!nextDefault) return prompt;
    return {
      ...prompt,
      title: nextDefault.title,
      content: nextDefault.content,
      tags: nextDefault.tags,
      note: nextDefault.note,
      updatedAt: timestamp
    };
  });

  const knownFolderNames = new Set(Object.values(PROMPT_WORKBENCH_LANGUAGE_PACKS).map((pack) => pack.examplesFolder));
  const folders = library.folders.map((folder) =>
    knownFolderNames.has(folder.name)
      ? {
          ...folder,
          name: languagePack.examplesFolder,
          updatedAt: timestamp
        }
      : folder
  );

  return { ...library, folders, optimizerPrompts, prompts };
}

export function localizePromptWorkbenchLibrary(
  library: PromptWorkbenchLibrary,
  options: { now?: number; locale?: PromptWorkbenchLocale } = {}
): PromptWorkbenchLibrary {
  return migrateBuiltInPromptContent(library, nowOrDefault(options.now), normalizePromptWorkbenchLocale(options.locale));
}

export function normalizePromptWorkbenchLibrary(
  value: unknown,
  options: { now?: number; idFactory?: IdFactory; locale?: PromptWorkbenchLocale } = {}
): PromptWorkbenchLibrary {
  const timestamp = nowOrDefault(options.now);
  const locale = normalizePromptWorkbenchLocale(options.locale);
  if (!value || typeof value !== "object") {
    return createDefaultPromptWorkbenchLibrary({ now: timestamp, idFactory: options.idFactory, locale });
  }
  const source = value as Partial<PromptWorkbenchLibrary>;
  const folders = (Array.isArray(source.folders) ? source.folders : [])
    .map((folder, index) => normalizeFolder(folder, index, { now: timestamp, idFactory: options.idFactory }))
    .filter((folder): folder is PromptFolder => Boolean(folder))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const prompts = (Array.isArray(source.prompts) ? source.prompts : [])
    .map((prompt, index) => normalizePrompt(prompt, index, validFolderIds, { now: timestamp, idFactory: options.idFactory }))
    .filter((prompt): prompt is PromptItem => Boolean(prompt))
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return left.sortOrder - right.sortOrder;
    });

  const defaultLibrary =
    folders.length === 0 && prompts.length === 0
      ? createDefaultPromptWorkbenchLibrary({ now: timestamp, idFactory: options.idFactory, locale })
      : null;
  if (defaultLibrary) return defaultLibrary;

  return migrateBuiltInPromptContent(
    {
    schemaVersion: PROMPT_WORKBENCH_SCHEMA_VERSION,
    folders,
    prompts,
    settings: normalizePromptWorkbenchSettings(source.settings),
    optimizerPrompts: normalizeOptimizerPrompts(source.optimizerPrompts, { locale }),
    examplesSeeded: Boolean(source.examplesSeeded)
    },
    timestamp,
    locale
  );
}

export async function loadPromptWorkbenchLibrary(options: { locale?: PromptWorkbenchLocale } = {}): Promise<PromptWorkbenchLibrary> {
  const result = await chrome.storage.local.get(PROMPT_WORKBENCH_STORAGE_KEY);
  return normalizePromptWorkbenchLibrary(result[PROMPT_WORKBENCH_STORAGE_KEY], options);
}

export async function savePromptWorkbenchLibrary(
  library: PromptWorkbenchLibrary,
  options: { locale?: PromptWorkbenchLocale } = {}
): Promise<void> {
  await chrome.storage.local.set({
    [PROMPT_WORKBENCH_STORAGE_KEY]: normalizePromptWorkbenchLibrary(library, options)
  });
}

export function exportPromptWorkbenchBackup(
  library: PromptWorkbenchLibrary,
  options: { now?: number; locale?: PromptWorkbenchLocale } = {}
): PromptWorkbenchBackup {
  const normalized = normalizePromptWorkbenchLibrary(library, options);
  return {
    schemaVersion: PROMPT_WORKBENCH_SCHEMA_VERSION,
    app: "ChatMap",
    kind: "prompt-workbench",
    exportedAt: nowOrDefault(options.now),
    folders: normalized.folders,
    prompts: normalized.prompts,
    settings: normalized.settings,
    optimizerPrompts: normalized.optimizerPrompts
  };
}

function folderNameById(folders: PromptFolder[]): Map<string, string> {
  return new Map(folders.map((folder) => [folder.id, folder.name]));
}

function ensureFolderByName(
  library: PromptWorkbenchLibrary,
  folderName: string | null,
  options: { now: number; idFactory?: IdFactory }
): string | null {
  if (!folderName) return null;
  const existing = library.folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase());
  if (existing) return existing.id;
  const folder: PromptFolder = {
    id: makeId(options.idFactory, "fld"),
    name: folderName,
    sortOrder: library.folders.length,
    createdAt: options.now,
    updatedAt: options.now
  };
  library.folders.push(folder);
  return folder.id;
}

export function importPromptWorkbenchBackup(
  currentLibrary: PromptWorkbenchLibrary,
  backup: PromptWorkbenchBackup,
  options: PromptWorkbenchImportOptions
): PromptWorkbenchImportResult {
  if (
    (backup.app !== "ChatMap" && backup.app !== "TurnMap") ||
    backup.kind !== "prompt-workbench" ||
    backup.schemaVersion !== 1
  ) {
    throw new Error("Unsupported prompt workbench backup.");
  }

  const timestamp = nowOrDefault(options.now);
  const locale = normalizePromptWorkbenchLocale(options.locale);
  const imported = normalizePromptWorkbenchLibrary(backup, { now: timestamp, idFactory: options.idFactory, locale });
  if (options.mode === "replace") {
    return {
      library: {
        ...imported,
        settings: options.importSettings === false ? currentLibrary.settings : imported.settings,
        optimizerPrompts: options.importOptimizerPrompts ? imported.optimizerPrompts : currentLibrary.optimizerPrompts
      },
      summary: { added: imported.prompts.length, updated: 0, skipped: 0 }
    };
  }

  const titleConflict = options.titleConflict ?? "skip";
  const library = normalizePromptWorkbenchLibrary(currentLibrary, { now: timestamp, idFactory: options.idFactory, locale });
  if (options.importSettings) library.settings = imported.settings;
  if (options.importOptimizerPrompts) library.optimizerPrompts = imported.optimizerPrompts;

  const importedFolderNames = folderNameById(imported.folders);
  const summary: PromptWorkbenchImportSummary = { added: 0, updated: 0, skipped: 0 };
  const promptByTitle = new Map(library.prompts.map((prompt) => [prompt.title.toLowerCase(), prompt]));

  for (const importedPrompt of imported.prompts) {
    const key = importedPrompt.title.toLowerCase();
    const existing = promptByTitle.get(key);
    const folderName = importedPrompt.folderId ? importedFolderNames.get(importedPrompt.folderId) ?? null : null;
    const folderId = ensureFolderByName(library, folderName, { now: timestamp, idFactory: options.idFactory });

    if (existing) {
      if (titleConflict === "skip") {
        summary.skipped += 1;
        continue;
      }
      Object.assign(existing, {
        title: importedPrompt.title,
        content: importedPrompt.content,
        folderId,
        tags: importedPrompt.tags,
        enabled: importedPrompt.enabled,
        pinned: importedPrompt.pinned,
        note: importedPrompt.note,
        updatedAt: timestamp
      });
      summary.updated += 1;
      continue;
    }

    const added: PromptItem = {
      ...importedPrompt,
      id: makeId(options.idFactory, "prm"),
      folderId,
      sortOrder: library.prompts.length,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    library.prompts.push(added);
    promptByTitle.set(key, added);
    summary.added += 1;
  }

  return { library: normalizePromptWorkbenchLibrary(library, { now: timestamp, idFactory: options.idFactory, locale }), summary };
}
