import type { PromptItem, PromptWorkbenchLocale } from "./prompt-workbench-storage";

export type ImagePromptMenuGroupId =
  | "visualType"
  | "coreSubject"
  | "actionEmotion"
  | "environment"
  | "compositionCamera"
  | "lighting"
  | "colorPalette"
  | "styleReference"
  | "materialDetails"
  | "quality"
  | "negativePrompt"
  | "outputSpec";

export type ImagePromptMenuOption = {
  id: string;
  en: string;
  zh: string;
};

export type ImagePromptMenuGroup = {
  id: ImagePromptMenuGroupId;
  title: {
    en: string;
    zh: string;
  };
  promptLabel: {
    en: string;
    zh: string;
  };
  options: ImagePromptMenuOption[];
};

export type ImagePromptMenuDraftRequest = {
  concept: string;
  selections: Partial<Record<ImagePromptMenuGroupId, string[]>>;
  customSelections?: Partial<Record<ImagePromptMenuGroupId, string[]>>;
  locale?: PromptWorkbenchLocale;
};

export type ImagePromptPresetRequest = {
  title: string;
  draft: string;
  folderId: string | null;
  sortOrder: number;
  now?: number;
  idFactory?: (prefix?: string) => string;
};

export const IMAGE_PROMPT_MENU_GROUPS: ImagePromptMenuGroup[] = [
  {
    id: "visualType",
    title: { en: "Visual Type", zh: "画面类型" },
    promptLabel: { en: "Visual type", zh: "画面类型" },
    options: [
      { id: "photo", en: "Photo", zh: "照片" },
      { id: "illustration", en: "Illustration", zh: "插画" },
      { id: "poster", en: "Poster", zh: "海报" },
      { id: "concept-design", en: "Concept design", zh: "概念设计" },
      { id: "ui-visual", en: "UI visual mockup", zh: "UI 视觉稿" },
      { id: "character-sheet", en: "Character design sheet", zh: "角色设定图" },
      { id: "environment-sheet", en: "Environment design sheet", zh: "场景设定图" },
      { id: "3d-render", en: "3D render", zh: "3D 渲染" },
      { id: "storyboard", en: "Storyboard frame", zh: "分镜画面" }
    ]
  },
  {
    id: "coreSubject",
    title: { en: "Core Subject", zh: "核心主体" },
    promptLabel: { en: "Core subject", zh: "核心主体" },
    options: [
      { id: "character", en: "Character identity and role", zh: "角色身份" },
      { id: "object", en: "Important object or product", zh: "关键物体" },
      { id: "scene", en: "Scene or location as the main subject", zh: "场景主体" },
      { id: "age-temperament", en: "Age, temperament, and social identity", zh: "年龄、气质与身份" },
      { id: "appearance", en: "Distinctive appearance and silhouette", zh: "外观特征与轮廓" },
      { id: "costume", en: "Costume, styling, and accessories", zh: "服装与配饰" },
      { id: "material", en: "Material and surface characteristics", zh: "材质特征" }
    ]
  },
  {
    id: "actionEmotion",
    title: { en: "Action and Emotion", zh: "动作与情绪" },
    promptLabel: { en: "Action and emotion", zh: "动作与情绪" },
    options: [
      { id: "static-display", en: "Static display", zh: "静态展示" },
      { id: "interaction", en: "Meaningful interaction", zh: "互动状态" },
      { id: "story-moment", en: "Story moment", zh: "故事瞬间" },
      { id: "dramatic-conflict", en: "Dramatic conflict", zh: "戏剧冲突" },
      { id: "climax", en: "Climactic scene", zh: "高潮场面" },
      { id: "lonely", en: "Lonely", zh: "孤独" },
      { id: "mysterious", en: "Mysterious", zh: "神秘" },
      { id: "romantic", en: "Romantic", zh: "浪漫" },
      { id: "solemn", en: "Solemn", zh: "庄严" },
      { id: "tense", en: "Tense", zh: "紧张" }
    ]
  },
  {
    id: "environment",
    title: { en: "Scene Environment", zh: "场景环境" },
    promptLabel: { en: "Scene environment", zh: "场景环境" },
    options: [
      { id: "location", en: "Specific place, space, era, or worldbuilding", zh: "地点、空间、时代或世界观" },
      { id: "props", en: "Key props and background elements", zh: "关键道具与背景元素" },
      { id: "architecture", en: "Architectural style", zh: "建筑风格" },
      { id: "nature", en: "Natural elements", zh: "自然元素" },
      { id: "stage", en: "Stage elements", zh: "舞台元素" },
      { id: "grand", en: "Grand atmosphere", zh: "宏大氛围" },
      { id: "intimate", en: "Private intimate atmosphere", zh: "私密氛围" },
      { id: "dreamlike", en: "Dreamlike atmosphere", zh: "梦幻氛围" },
      { id: "oppressive", en: "Oppressive atmosphere", zh: "压迫氛围" },
      { id: "ruined", en: "Ruined and decayed atmosphere", zh: "破败氛围" }
    ]
  },
  {
    id: "compositionCamera",
    title: { en: "Composition and Camera", zh: "构图与镜头" },
    promptLabel: { en: "Composition and camera", zh: "构图与镜头" },
    options: [
      { id: "close-up", en: "Close-up", zh: "特写" },
      { id: "half-body", en: "Half-body shot", zh: "半身" },
      { id: "full-body", en: "Full-body shot", zh: "全身" },
      { id: "wide-shot", en: "Wide shot", zh: "远景" },
      { id: "bird-eye", en: "Bird's-eye view", zh: "鸟瞰" },
      { id: "low-angle", en: "Low-angle shot", zh: "低角度仰拍" },
      { id: "center", en: "Center composition", zh: "中心构图" },
      { id: "symmetry", en: "Symmetrical composition", zh: "对称构图" },
      { id: "thirds", en: "Rule of thirds", zh: "三分法" },
      { id: "cinematic-wide", en: "Wide cinematic composition", zh: "宽银幕电影构图" },
      { id: "shallow-depth", en: "Shallow depth of field", zh: "浅景深" },
      { id: "wide-perspective", en: "Wide-angle perspective", zh: "广角透视" }
    ]
  },
  {
    id: "lighting",
    title: { en: "Lighting Design", zh: "光影设计" },
    promptLabel: { en: "Lighting design", zh: "光影设计" },
    options: [
      { id: "spotlight", en: "Spotlight", zh: "聚光灯" },
      { id: "moonlight", en: "Moonlight", zh: "月光" },
      { id: "neon", en: "Neon light", zh: "霓虹灯" },
      { id: "candlelight", en: "Candlelight", zh: "烛光" },
      { id: "morning-sun", en: "Morning sunlight", zh: "清晨阳光" },
      { id: "screen-light", en: "Screen light", zh: "屏幕光" },
      { id: "backlight", en: "Backlight", zh: "逆光" },
      { id: "high-contrast", en: "High contrast", zh: "高对比" },
      { id: "soft-diffuse", en: "Soft diffuse light", zh: "柔和漫反射" },
      { id: "rim-light", en: "Strong rim light", zh: "强烈轮廓光" },
      { id: "dark-low-key", en: "Low-key dark lighting", zh: "低调暗光" },
      { id: "dream-glow", en: "Dreamlike glow", zh: "梦幻辉光" }
    ]
  },
  {
    id: "colorPalette",
    title: { en: "Color Palette", zh: "色彩方案" },
    promptLabel: { en: "Color palette", zh: "色彩方案" },
    options: [
      { id: "high-saturation", en: "High saturation", zh: "高饱和" },
      { id: "low-saturation", en: "Low saturation", zh: "低饱和" },
      { id: "warm", en: "Warm colors", zh: "暖色" },
      { id: "cool", en: "Cool colors", zh: "冷色" },
      { id: "black-gold", en: "Black and gold", zh: "黑金" },
      { id: "blue-purple", en: "Blue and purple", zh: "蓝紫" },
      { id: "red-black", en: "Red and black", zh: "红黑" },
      { id: "cream", en: "Cream palette", zh: "奶油色" },
      { id: "sci-fi", en: "Sci-fi mood", zh: "科幻" },
      { id: "retro", en: "Retro mood", zh: "复古" }
    ]
  },
  {
    id: "styleReference",
    title: { en: "Style Reference", zh: "风格参考" },
    promptLabel: { en: "Style reference", zh: "风格参考" },
    options: [
      { id: "cinematography", en: "Cinematic photography", zh: "电影摄影" },
      { id: "broadway", en: "Broadway musical poster", zh: "百老汇音乐剧海报" },
      { id: "fashion-editorial", en: "High-fashion editorial", zh: "高级时装大片" },
      { id: "cyberpunk", en: "Cyberpunk concept art", zh: "赛博朋克概念艺术" },
      { id: "ghibli", en: "Ghibli-like animation feeling", zh: "吉卜力动画感" },
      { id: "dark-fairytale", en: "Dark fairytale", zh: "暗黑童话" },
      { id: "retro-magazine", en: "Retro magazine cover", zh: "复古杂志封面" },
      { id: "premium-web", en: "Premium web visual design", zh: "高端网页视觉设计" },
      { id: "realistic", en: "Realistic texture", zh: "写实质感" },
      { id: "commercial", en: "High-end commercial visual", zh: "高级商业视觉" }
    ]
  },
  {
    id: "materialDetails",
    title: { en: "Materials and Details", zh: "材质与细节" },
    promptLabel: { en: "Materials and details", zh: "材质与细节" },
    options: [
      { id: "fabric", en: "Fabric and costume material", zh: "服装材质" },
      { id: "skin", en: "Skin texture", zh: "皮肤质感" },
      { id: "metal", en: "Metal", zh: "金属" },
      { id: "glass", en: "Glass", zh: "玻璃" },
      { id: "fog", en: "Fog and mist", zh: "雾气" },
      { id: "rain", en: "Rainwater", zh: "雨水" },
      { id: "paper", en: "Paper texture", zh: "纸张" },
      { id: "wood", en: "Wood grain", zh: "木纹" },
      { id: "glasmorphism", en: "UI glassmorphism", zh: "UI 玻璃拟态" }
    ]
  },
  {
    id: "quality",
    title: { en: "Image Quality", zh: "画面质量" },
    promptLabel: { en: "Image quality", zh: "画面质量" },
    options: [
      { id: "high-detail", en: "High detail", zh: "高细节" },
      { id: "finished", en: "Highly finished", zh: "高完成度" },
      { id: "clear-subject", en: "Clear subject", zh: "清晰主体" },
      { id: "refined-light", en: "Refined lighting", zh: "精致光影" },
      { id: "professional-composition", en: "Professional composition", zh: "专业构图" },
      { id: "cinematic-texture", en: "Cinematic texture", zh: "电影级质感" },
      { id: "visual-impact", en: "Strong visual impact", zh: "视觉冲击力强" }
    ]
  },
  {
    id: "negativePrompt",
    title: { en: "Negative Prompt", zh: "负面提示" },
    promptLabel: { en: "Negative prompt", zh: "负面提示" },
    options: [
      { id: "deformed-limbs", en: "Deformed limbs", zh: "畸形肢体" },
      { id: "extra-fingers", en: "Extra fingers", zh: "多余手指" },
      { id: "blur", en: "Blur", zh: "模糊" },
      { id: "low-res", en: "Low resolution", zh: "低清晰度" },
      { id: "overexposure", en: "Overexposure", zh: "过曝" },
      { id: "garbled-text", en: "Garbled text", zh: "文字乱码" },
      { id: "watermark", en: "Watermark", zh: "水印" },
      { id: "logo", en: "Logo", zh: "logo" },
      { id: "clutter", en: "Cluttered image", zh: "画面杂乱" },
      { id: "unclear-subject", en: "Unclear subject", zh: "主体不清晰" }
    ]
  },
  {
    id: "outputSpec",
    title: { en: "Output Spec", zh: "输出规格" },
    promptLabel: { en: "Output spec", zh: "输出规格" },
    options: [
      { id: "1-1", en: "1:1", zh: "1:1" },
      { id: "16-9", en: "16:9", zh: "16:9" },
      { id: "9-16", en: "9:16", zh: "9:16" },
      { id: "3-4", en: "3:4", zh: "3:4" },
      { id: "4-5", en: "4:5", zh: "4:5" },
      { id: "21-9", en: "21:9", zh: "21:9" },
      { id: "avatar", en: "Avatar", zh: "头像" },
      { id: "poster-use", en: "Poster", zh: "海报" },
      { id: "hero", en: "Website hero", zh: "网页首屏" },
      { id: "ppt-cover", en: "PPT cover", zh: "PPT 封面" },
      { id: "short-video-cover", en: "Short-video cover", zh: "短视频封面" }
    ]
  }
];

function localeOrDefault(locale?: PromptWorkbenchLocale): PromptWorkbenchLocale {
  return locale === "zh" ? "zh" : "en";
}

function uniqueClean(values: string[] | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function idFromFactory(idFactory: ImagePromptPresetRequest["idFactory"]): string {
  return idFactory ? idFactory("prm") : `prm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildImagePromptMenuDraft(request: ImagePromptMenuDraftRequest): string {
  const locale = localeOrDefault(request.locale);
  const lines: string[] = [];
  const conceptLabel = locale === "zh" ? "一句话概念描述" : "One-line concept";
  lines.push(`${conceptLabel}: ${request.concept.trim() || (locale === "zh" ? "根据当前输入补全" : "Infer from current input")}`);

  for (const group of IMAGE_PROMPT_MENU_GROUPS) {
    const selected = uniqueClean(request.selections[group.id]);
    const custom = uniqueClean(request.customSelections?.[group.id]);
    const combined = [...selected, ...custom];
    if (combined.length === 0) continue;
    lines.push(`${group.promptLabel[locale]}: ${combined.join(", ")}`);
  }

  return lines.join("\n");
}

export function buildImagePromptPresetItem(request: ImagePromptPresetRequest): PromptItem {
  const now = typeof request.now === "number" && Number.isFinite(request.now) ? request.now : Date.now();
  return {
    id: idFromFactory(request.idFactory),
    title: request.title.trim() || "Image prompt preset",
    content: `Image prompt menu preset.\n\nUse the following image-prompt menu selections and the user's current input to draft a professional image generation prompt.\n\nCurrent input:\n{{input}}\n\nSelected menu:\n${request.draft}`,
    folderId: request.folderId,
    tags: ["image-prompt", "preset"],
    enabled: true,
    pinned: false,
    sortOrder: request.sortOrder,
    useCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    note: "Saved from the image prompt optimizer menu."
  };
}
