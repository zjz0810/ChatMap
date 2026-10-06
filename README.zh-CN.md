# ChatMap

[English](README.md) | [中文](README.zh-CN.md)

把 AI 长对话转换成可编辑、可跳转、可导出的思维导图。

> ChatMap 是基于 [Zhaimiaoyizhi/TurnMap](https://github.com/Zhaimiaoyizhi/TurnMap) 的衍生项目，继续保留 upstream 的 MIT License 与原版权声明。

> **ChatGPT 专项版。** 当前重点是 ChatGPT 网页版长对话的索引、顺序和跳转。其他 LLM 网站也有适配，但长对话和跳转没有同等程度的验证。需要支持其他 LLM 网站或服务，欢迎在本仓库开 Issue 联系我。

ChatMap 是一个面向 Chrome 与 Edge 的 Chromium Manifest V3 浏览器扩展，主要用于把 ChatGPT 网页长对话映射成可视化节点图。每一轮问答成为一个节点，可跳回原消息、编辑、链接、染色、折叠、导出并在之后恢复整理。

> 状态：ChatMap 1.0.0 GitHub 预览版。尚未发布到 Edge Add-ons 或 Chrome Web Store。可以从源码手动安装，或从 GitHub Release 下载扩展包。

## 适用场景

ChatMap 适合：

- 个人学习、复习和知识整理。
- 长 AI 对话导航。
- 在单个对话内做研究、写作和资料组织。

当前版本服务于当前打开的已支持 AI 对话网页。跨多个对话的全局知识图谱不属于首发版本范围。

## 功能亮点

- **对话地图**：把当前 AI 对话转换成节点图。
- **ChatGPT 专项导航**：ChatGPT 使用已验证的原生索引与直接跳转；其他内置 LLM 网页适配仍保留各自的能力限制。
- **跳回原文**：通过节点回到来源网页中对应的问答位置。
- **身份优先导航**：使用稳定站点/消息身份区分重复问题；无法解析精确目标时安全失败。
- **悬浮导航与收藏**：从页面启动器浏览用户轮次，刷新时保持悬浮列表位置，并按导航身份保存收藏轮次。
- **Prompt Workbench**：在 ChatGPT 输入框旁管理本地复用提示词、填写动态变量、仅优化当前输入，并构建图片提示词，不发送完整对话。
- **可编辑图谱**：编辑标题、摘要、标签、状态、笔记、隐藏节点和关系链接。
- **节点外观自定义**：节点可染色、折叠、标记重要；节点染色支持渐变或底色渲染，并可调节渲染程度。
- **链接操作**：链接颜色与类型统一，链接权重会影响线条粗细与透明度，重要链接仍会额外强调；不同关系可以用更清晰的颜色区分。
- **连接样式偏好**：可在界面设置中选择普通节点连接使用“曲线”或“折线”，mini 节点内部连接不受影响。
- **图谱卫生检查**：导入、导出、布局切换和主题折叠代理会进行本地检查，自动修正常见默认值、丢弃无效悬空边/代理边，并写入状态栏与任务日志。
- **主题分析 MVP**：先在本地根据节点标题、摘要、标签和距离预分类高信号候选链接，再由用户审阅。
- **更多外观选择**：支持日间、夜间、护眼和跟随浏览器主题，支持多种布局与显示偏好。
- **选项卡优化**：Side Panel、Full Page、Float、页面悬浮启动器等入口被整合到更清爽的视图与设置结构中。
- **多种视图**：Side Panel、Full Page 和 Float。
- **设置页面**：在图谱工作区之外管理 AI、界面默认值、主题、语言、启动器、Float 和更新偏好。
- **页面悬浮启动器**：在已支持 AI 页面右侧显示小启动球，左键打开 ChatMap，右键打开设置。
- **多种布局**：Single-side、Radial、Matrix 和 Two-sided。
- **导入导出**：ChatMap JSON、Obsidian Canvas、OPML、Obsidian vault Markdown、Markdown、SVG 和 PNG。需要完整恢复时请优先使用 ChatMap JSON，它会保留回答展开、当前显示模式、主题组、链接权重和图谱元数据。
- **本地优先存储**：每个对话的图谱状态保存在浏览器本地扩展存储中。
- **安全自定义站点**：仅支持选择器配置；必须通过精确来源权限和当前页面预览后才可启用，并与图谱分开备份。

## 与上游 TurnMap 的区别

本发布基于 [Zhaimiaoyizhi/TurnMap v0.9.2](https://github.com/Zhaimiaoyizhi/TurnMap/tree/v0.9.2)。保留上游 MIT License 与原版权声明，也延续其可编辑图谱、导出格式和站点适配基础。ChatMap 是独立维护的衍生项目，不代表原作者发布。

本版 ChatMap 的改动：

- **ChatGPT 历史顺序**：通过稳定消息身份合并虚拟列表的重叠窗口；向上加载的旧消息插到新消息之前，并重新计算轮次。修复前几条消息卡住、加载旧消息却追加到队尾、最新消息插到中间等顺序问题。
- **重复问题与重复读取**：内容相同但身份不同的问题仍保留为不同轮次；流式回答更新到原节点；过期或不完整的读取不能悄悄覆盖更新且更完整的索引。
- **刷新索引**：完整扫描 ChatGPT 历史，再按扫描结果重建有序图谱；扫描后恢复聊天页面原来的滚动位置。刷新索引会重新生成图谱节点；需要保留手工编辑时，请先导出 ChatMap JSON。
- **跳回原文**：按稳定消息身份定位；无法找到精确目标时明确失败，不根据相似文本猜测节点。
- **画布调整**：降低最小缩放，让较大的图谱可以缩小适配屏幕；默认浅色主题改为白、灰、蓝的克制配色。

以上专项修复针对 ChatGPT。其他 LLM 网页适配不代表具备同等长对话验证；需要适配其他平台或服务，欢迎在本仓库开 Issue 联系维护者。

## 自 0.7.2 以来的变更

### Chrome 迁移与 ChatGPT 导航（0.8.0–0.8.2）

- 迁移到 Chrome/Edge Manifest V3，以 Chrome 116+ Side Panel 为基线，加入类型化 manifest 生成、安全重复注入和解压安装包构建流程。
- 以 clean-room 方式重写 ChatGPT 长对话导航：使用稳定轮次/消息锚点、精确目标解析和有界 shell 唤醒，不再进行旧式提取滚动。
- 加入悬停触发的对话悬浮导航器，并修复刷新导致来源页面或悬浮列表意外移动的问题。
- 在 ChatGPT 输入框旁加入本地 Prompt Workbench：提示词模板、动态变量、导入导出、仅重写当前输入的 AI 优化、图片提示词控件、本地化和主题适配设置。

### 多站点身份优先导航（0.8.3）

- 为 13 个内置适配器加入站点作用域导航身份和多站点悬浮导航。
- 用不滚动的已挂载 DOM 刷新、精确身份解析和显式安全失败，替代非 ChatGPT 站点的长距离提取滚动与 SourceAnchor 文本搜索跳转。
- 保留重复问题为独立轮次，在不改变身份的前提下补全流式回答，并加入基于导航身份的悬浮收藏。

### 证据注册表与安全自定义站点（0.8.4）

- 加入仓库内能力注册表、逐站带日期 QA 报告、截图和证据门控等级，避免把普通 DOM smoke 结果写成原生支持。
- 将 Deep Scan 改名为 Refresh Index，移除废弃的读取/跳转控件，同时保留不搜索、不滚动的缺失中间轮次合并。
- 加入仅选择器型自定义站点：精确来源权限、受限路径匹配、选择器校验、当前页面预览、默认禁用存储和独立 JSON 导入导出。

### 静默结构化索引（0.9.0–0.9.2）

- 为 Gemini、豆包、DeepSeek、Qwen、Claude、Kimi、Grok 和 Z.ai 加入被动结构化索引，复用页面已经获得的会话响应或客户端状态。
- 加入稳定会话/消息身份、重复问题分离、活动分支处理、流式补全、SPA/会话隔离和精确已挂载目标校验，提取阶段不滚动页面。
- 在站点提供确定性控制器时，仅于用户主动跳转后唤醒目标：DeepSeek keyed virtual item、豆包虚拟行和 Kimi 历史 segment。目标不支持或身份不匹配时安全失败，不做模糊文本匹配或滚动搜索。
- 加入站点专项正确性处理：Kimi segment/附件聚合、Grok prompt 回显与嵌套响应去重、Claude UUID 分支处理，以及按 host 隔离的 ChatGLM/Z.ai 前端。
- 将八个保留高频站点的适配成果统一集成到 `0.9.2`，同时保持能力注册表中的真实浏览器证据边界。

## 支持站点能力表

ChatGPT 是 ChatMap 已验证的原生参考路径。其余内置适配器现已采用同样的身份优先安全规则，但在真实长对话浏览器证据证明站点原生完整索引与离屏重挂载路径前，仍标记为 DOM fallback。普通 DOM 提取成功不等同于原生支持。

| 站点 | 提取等级 | 跳转等级 | 助手文本 | 已知限制 |
| --- | --- | --- | --- | --- |
| ChatGPT | 已验证原生用户问题索引 | 已验证原生直接跳转 + 有界 shell 唤醒 | 尽力补全 | 页面未必低成本暴露全部助手回答。 |
| DeepSeek | 已实现证据门控结构化历史索引；能力等级仍为已挂载 DOM | 精确强 ID 跳转；原生唤醒仍受证据门控 | 尽力补全 | 登录长对话与离屏验收仍受阻。 |
| Kimi | 已实现证据门控分页消息索引；能力等级仍为已挂载 DOM | 精确强 ID 跳转；原生历史 segment 唤醒仍受证据门控 | 尽力补全 | 登录长对话与离屏验收仍受阻。 |
| 豆包 | 已实现证据门控结构化消息索引；能力等级仍为已挂载 DOM | 精确强 ID 跳转；确定性虚拟目标仍受证据门控 | 尽力补全 | 登录长对话与离屏验收仍受阻。 |
| Qwen | 已实现证据门控结构化索引；能力等级仍为已挂载 DOM | 精确已挂载强身份跳转 | 尽力补全 | 已完成两个同文已挂载轮次 smoke；未验证离屏重挂载，不声明原生能力。 |
| Gemini | 已实现证据门控结构化会话索引；能力等级仍为已挂载 DOM | 精确已挂载强 ID 跳转 | 尽力补全 | 已完成两个同文已挂载轮次 smoke；不声明离屏/原生能力。 |
| Google AI Studio | 身份优先的已挂载 DOM fallback | 精确已挂载身份跳转 | 尽力补全 | 未挂载目标安全失败，不做滚动/文本搜索。 |
| Claude | 已实现证据门控结构化 UUID 索引；能力等级仍为已挂载 DOM | 精确已挂载 UUID 跳转 | 尽力补全 | Cloudflare 阻断了登录长对话与离屏验收。 |
| Perplexity | 身份优先的已挂载 DOM fallback | 精确已挂载身份跳转 | 尽力补全 | 未挂载目标安全失败，不做滚动/文本搜索。 |
| Grok | 已实现证据门控响应图索引；能力等级仍为已挂载 DOM | 精确已挂载 response ID 跳转 | 尽力补全 | 尚无登录长对话与离屏验收。 |
| GLM / Z.ai | 按 host 隔离两套前端；Z.ai 结构化索引仍受证据门控 | 精确已挂载 Z.ai message ID 跳转 | 尽力补全 | ChatGLM 与 Z.ai 分别保留证据边界，不声明原生能力。 |
| Mistral Le Chat | 身份优先的已挂载 DOM fallback | 精确已挂载身份跳转 | 尽力补全 | 未挂载目标安全失败，不做滚动/文本搜索。 |
| Arena / LMArena | 身份优先的已挂载 DOM fallback | 精确已挂载身份跳转 | 尽力补全 | 对战模式读取选定回答侧；未挂载目标安全失败。 |

ChatMap 的 ChatGPT 路径是 clean-room 实现。ophel 仅作为产品行为与架构参考，ChatMap 未复制其 GPL 代码。

## 当前视图

| 视图 | 用途 |
| --- | --- |
| Side Panel | 在浏览器侧边栏中与已支持 AI 对话网页并排使用。 |
| Full Page | 使用更大的图谱画布，同时保持与来源对话标签页联动。 |
| Float | 在已支持 AI 页面内使用紧凑的悬浮导航器。 |
| Page Launcher | 在已支持 AI 页面右侧快速打开 ChatMap 或设置。 |

## 从源码安装

要求：

- Node.js
- Google Chrome 116+ 或 Microsoft Edge 116+
- 已支持的网页端 AI 会话

构建：

```powershell
npm install
npm.cmd run build
```

在 Chrome 或 Edge 中加载：

1. 在 Chrome 中打开 `chrome://extensions`，或在 Edge 中打开 `edge://extensions`。
2. 启用 Developer mode。
3. 点击 Load unpacked。
4. 选择 `<project-root>\dist`。
5. 打开一个已支持的 AI 对话。
6. 从扩展按钮或浏览器侧边栏打开 ChatMap。

## 从 GitHub Release 安装

对于预览版，可以从 GitHub Releases 下载 zip，解压后在 Chrome 或 Edge 开发者模式中加载解压后的文件夹。

GitHub/unpacked 安装需要手动更新。真正适合普通用户自动更新的路径是浏览器插件商店分发。

本地发布包：`release/chatmap-v1.0.0.zip`。ChatGPT 是此版本的主要适配目标；其他内置站点的能力限制见上方能力表。长期备份或迁移时，请优先导出 ChatMap JSON，因为它比视觉格式更完整地保留 ChatMap 专有编辑状态。

## 基础使用

1. 打开一个已支持的 AI 对话网页。
2. 打开 ChatMap。
3. 点击 Refresh 读取当前可用的对话索引。ChatGPT 使用已验证原生路径；部分站点也会复用证据门控结构化索引，但是否达到浏览器实证原生能力仍以能力表为准。
4. 选择布局：Single-side、Radial、Matrix 或 Two-sided。
5. 单击节点选中节点，使用 Node Actions 编辑、染色、折叠、标记重要或批量操作。
6. 右键节点正文可跳回来源网页原文。
7. 选择链接后使用 Link Actions 调整链接颜色/类型、权重、重要程度和说明；多选链接可批量设置同一权重。
8. 使用 Files 导出或导入图谱。

## 外观与界面设置

ChatMap 的设置页面用于管理全局界面偏好：

- **主题**：日间、夜间、护眼或跟随浏览器。
- **语言**：跟随浏览器、英文、中文，以及由 AI 生成并保存在本地的自定义界面翻译。
- **默认布局**：Single-side、Radial、Matrix 或 Two-sided。
- **节点染色渲染**：可选择渐变或底色，并用滑动条调节渲染程度。
- **连接样式**：可选择普通节点之间的连接为曲线或折线；mini 节点和 mini 思维导图内部连接保持原有紧凑样式。
- **自定义站点**：配置本地 CSS 选择器、请求单一精确来源权限、在当前页面预览验证，并使用独立 JSON 导入导出。
- **AI 输出预算**：调整 `max_tokens`；它限制输出长度，不改变模型上下文窗口。
- **入口显示**：管理 Side Panel、Full Page、Float 和页面悬浮启动器相关偏好。

## AI 功能

ChatMap 支持提供 OpenAI-compatible `/chat/completions` API 的服务商。Provider 预设只是便利用默认值，优先选择较新、快速、省 token、上下文较充足的模型；如果账号、地域或平台 endpoint 要求不同，用户仍可手动修改 base URL 和 model。

内置预设：

- OpenAI
- DeepSeek
- OpenRouter
- Qwen / DashScope
- Kimi / Moonshot
- Doubao / Volcano Ark
- Zhipu / GLM
- Mistral
- Gemini compatible
- Custom OpenAI-compatible endpoint

当前 AI 功能仍处于预览阶段，尚不完全稳定：

- **AI 总结**：用于生成紧凑的节点标题和摘要，但不同 provider 的 JSON / 文本输出格式兼容性仍在完善。
- **分析主题**：本地根据节点标题、摘要、标签、距离和已有链接预分类可能相关的候选链接，用户审阅后才会改变图谱。
- **AI 建议链接**：用于在强相关节点之间建议语义链接，但需要继续优化阈值、置信度和画面整洁度。
- **AI 翻译**：用用户自己的 API key 生成本地 UI 语言包，支持导入/导出标准 JSON 语言包，缺失标签回退英文。

后续版本会继续增强本地主题分析、AI 总结、AI 建议链接、更多 provider 兼容和任务日志辅助排错。

API key 保存在用户本地浏览器扩展存储中，不会提交到本仓库。只粘贴 API key 原文，不要带 `Bearer ` 前缀。部分平台会把 model 字段当作 endpoint ID 使用，base URL 则始终是请求入口，不应混进 API key。

ChatMap 为总结、推荐链接和 AI 界面翻译保留更高的任务级输出预算，同时允许用户把 `maxTokens` 配置到 24000。AI 翻译只发送 ChatMap UI 文案，若模型返回坏 JSON，可能额外调用一次 API 修复格式；生成或导入的语言包保存在本地。Provider 默认值、语言包格式、响应格式与 token 预算说明详见 [AI Provider Guide](docs/ai-provider-guide.md)。

## 隐私

默认情况下，ChatMap 将对话图谱保存在浏览器扩展本地存储中。分析主题功能在本地运行，只使用图谱里已有的节点元数据。AI 功能会把选定的对话文本发送到用户配置的 provider。导出文件由用户自行控制。

详见 [Privacy Statement](docs/privacy-statement.md)。

## 权限

ChatMap 当前预览版请求以下必要权限：

- `activeTab`、`tabs` 和 `scripting`：用于识别当前已支持 AI 对话标签页、必要时注入 content script、打开 Full Page，并跳回原始对话节点。
- `sidePanel`：提供 Edge 侧边栏界面。
- `storage`：在本地保存图谱、设置、AI provider 配置、launcher 位置和 Float 状态。
- `webRequest`：在可用时辅助读取 ChatGPT backend 请求，从而更可靠地提取完整当前对话。
- 已支持 AI 对话网站和内置 AI provider API host 的 host access。
- 自定义 OpenAI-compatible provider 使用 optional host access，仅在用户配置自定义 endpoint 时请求。

详见 [Permission Review](docs/permissions-review.md)。

## 开发

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run build
npm.cmd run package
```

`npm.cmd run package` 会在 `release/` 中生成 zip 包。

## 项目结构

```text
src/content       站点 adapter、提取、跳转、Float、launcher 相关代码
src/side-panel    ChatMap 主界面
src/full-page     Full Page 入口
src/background    MV3 service worker
src/shared        共享消息和类型定义
docs              用户、开发者、隐私和发布文档
scripts           构建和打包辅助脚本
```

## 文档

- [User Guide](docs/user-guide.md)
- [Developer Guide](docs/developer-guide.md)
- [AI Provider Guide](docs/ai-provider-guide.md)
- [Privacy Statement](docs/privacy-statement.md)
- [Permission Review](docs/permissions-review.md)
- [Release Readiness](docs/release-readiness.md)
- [GitHub Release Plan](docs/github-release-plan.html)
- [社交平台宣传文案](docs/social-promo.zh-CN.md)

## 已知限制

- AI 网站页面结构可能随时变化。
- 对话中出现重复问题时，跳转精度可能下降。
- GitHub/unpacked 安装无法由扩展自身静默自动更新。
- 商店发布可能需要额外 PNG 图标和隐私材料。
- AI 翻译、AI 总结和 AI 建议链接依赖 provider 的请求与响应格式，当前仍处于预览增强阶段。

## 路线图

- `0.1.x`：稳定预览版，重点是 AI fallback、Float / Full Page 小屏体验；读取和跳转目前较稳定，暂不重构。
- `0.2.0`：更新提示与 ChatGPT 适配增强，包括 GitHub Release 检查、忽略版本、稍后提醒、脱敏 debug report。
- `0.3.0`：协作与高级导出。OPML 与 Obsidian vault Markdown 已实现；XMind 作为 Anki CSV 之前的下一优先项。
- `0.4.0`：多 AI 对话网页适配，支持 ChatGPT、Gemini、Claude.ai、DeepSeek、Kimi、豆包、Qwen、Google AI Studio、Perplexity、Grok、GLM / Z.ai / 智谱清言、Mistral Le Chat 和 Arena / LMArena。当前计划完成后，继续处理 MiniMax Agent。
- `0.5.0`：更多 API Key / Provider 兼容，面向 OpenAI、DeepSeek、OpenRouter、Qwen、Kimi、Doubao、Zhipu、Mistral、Gemini-compatible Vertex endpoint 和 Custom OpenAI-compatible endpoint 提供省成本、快速、上下文够用的默认预设。
- `0.5.1`：完善 AI 界面翻译语言包，支持生成、导入/导出、坏 JSON 自动修复、本地保存和布局防溢出兜底。
- `0.6.0`：本地主题分析 MVP，预分类高置信候选链接供用户审阅，不做 provider embeddings。
- `0.7.0`：知识整理能力增强，包括更智能的链接、批量接受/拒绝链接、主题折叠、批量标签。
- `0.7.1`：完善 mini 思维导图和外观自定义，同时加固图谱卫生与自动连接可靠性，包括新节点稳定 ID、连接权重、主题代理边元数据和本地修复日志。
- `0.7.2`：稳定 0.7.x 的读取、跳转、悬浮启动器、图谱切换、默认节点尺寸和设置布局，作为下一轮大功能前的维护版。
- `0.8.0`：Chrome 兼容迁移；Firefox 后续需单独适配 sidebar_action。
- `0.8.2`：加入 ChatGPT 原生导航预览、对话悬浮导航器和本地 Prompt Workbench。
- `0.8.3`：将内置站点迁移到身份优先、不滚动刷新和精确已挂载目标导航。
- `0.8.4`：加入证据跟踪能力记录、逐站 QA 报告、Refresh Index 和权限门控的仅选择器型自定义站点。
- `0.9.0`：加入 Gemini 被动原生索引、稳定请求/响应身份、确定性已挂载回合绑定和证据门控跳转。
- `0.9.1`：加入豆包被动原生索引、稳定会话/消息身份、确定性虚拟列表定位和精确 ID 重挂载校验。
- `0.9.2`：上游 TurnMap 基线，集成八个高频站点的证据门控索引与精确身份跳转。
- `1.0.0`：首个 ChatMap 专项版，加入 ChatGPT 长历史顺序合并、更安全的刷新和跳转身份、新品牌、浅色配色与更低画布缩放下限。

发布说明：

- [0.6.0 release notes](docs/release-notes-0.6.0.md) 专门说明相比上一次 GitHub 推送的更新内容。

## 贡献

欢迎通过 GitHub Issues 提交 bug、功能建议和 AI provider 兼容性报告。

提交 pull request 前请运行：

```powershell
npm.cmd run typecheck
npm.cmd run build
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

不要提交 API key、私人对话导出、浏览器配置数据，或包含私人对话内容的截图。

详见 [SECURITY.md](SECURITY.md)。

## 许可

MIT。详见 [LICENSE](LICENSE)。

## 0.7.1 图谱卫生与自动连接可靠性

- **稳定节点 ID**：新生成的对话节点优先使用页面消息 ID，缺失时使用内容 hash，避免普通刷新因轮次序号变化导致新旧节点不易对应。
- **连接权重**：手动链接、AI 建议链接、主题分析候选、自动序列边和主题代理边都会携带权重；Link Actions 单选/多选均可用滑块调整权重。
- **视觉强调**：权重会影响连接线粗细与透明度，重要链接仍会在权重基础上额外增强。
- **连接样式**：新增全局连接样式设置，默认曲线，也可切换为折线；调整权重后会继续遵守该设置。
- **回答展开方向**：新生成或重新生成的节点展开一律向右展开，旧保存数据不做专门迁移。
- **ChatGPT 提取修复**：修复同一条 AI 回答被拆成多个 markdown 块时只抓到第一部分的问题。
- **图谱卫生检查**：布局、导入、导出和主题折叠代理会进行本地检查；可安全修复的默认值会自动修复，悬空边或无效代理边会被丢弃，并写入状态栏与任务日志。
- **导出保真**：ChatMap JSON 升级到 schemaVersion 4，并继续兼容读取 schema 3。请优先导出 JSON 来完整保留链接权重、主题代理元数据、回答展开和当前显示模式。

## 0.7.2 读取跳转与设置稳定性

- **读取与跳转设置**：新增独立设置板块，用滑动条和数值输入控制自动滚动速度、顶部/底部等待时间和跳转搜索强度。
- **悬浮启动器修复**：修复读取/跳转设置被打包为额外脚本块后，content script 可能无法启动，导致页面悬浮球不显示、对话无法读取的问题。
- **刷新/深度扫描保护**：刷新和深度扫描会先确认能加载或建立当前对话图谱，再替换旧图，避免切换网页对话时残留或误清空。
- **默认节点尺寸**：增加默认节点尺寸控制，并修复相关设置刷新可能触发图谱反复重载的问题。
- **mini 导图连线**：优化节点展开后的 mini 导图连线排布，减少错连和凌乱跨线。

## 0.7.0 知识整理与节点编辑

- **节点尺寸**：节点左边、右边、下边，以及左下角、右下角有常驻拖拽点；用户调整后的宽高会随当前对话长期保存。
- **回答展开**：配置 API Key 后，可以在 Node Actions 中把单个 AI 回答展开为节点内的 title-only mini 思维导图。AI 调用失败或结构不合法时不会写入展开结果，原节点保持不变。
- **mini 节点编辑**：展开后的 mini 节点支持改标题、染色、重要标记和删除；展开数据和当前显示模式会随图谱保存。
- **主题折叠**：可把一组选中节点折叠为主题节点，展开后恢复原节点、原连接和布局；主题折叠不允许嵌套，并且不等同于单节点内容折叠。
- **批量操作**：多选节点后可在 Node Actions 中批量添加/移除标签；多选链接后可在 Link Actions 中批量修改类型/颜色/重要性。
- **导出建议**：请优先导出 ChatMap JSON。JSON 会完整保留 expansion 数据、节点尺寸、当前显示模式、主题折叠、标签、颜色、重要性和用户链接；PNG/SVG 更适合视觉分享，Obsidian Canvas 可编辑但不是最完整的 ChatMap 恢复格式。
### 0.7.0 节点展开补充说明

- **结构化 mini 导图**：节点展开用于把单个 AI 长回答整理成 title-only mini 思维导图，不是一个自由子图编辑器。普通回答目标为 8-22 个 mini 节点；信息密度很高的研究背景类回答最多可到 80 个，但不会为了凑上限拆碎内容。
- **清爽编辑入口**：mini 节点内部不放操作按钮。点击 mini 节点后，左下角会显示 Mini Node Actions，可修改标题、染色、标记重要或删除该 mini 节点子树。
- **方向与尺寸**：新生成或重新生成的节点展开一律向右展开。展开区域不做内部滚动，父节点会尽量放大以完整呈现导图。
- **总结收束**：同一分支内多个分点归纳到一个总结时，可以用低调括号收束显示，避免总结关系喧宾夺主。
- **导出建议**：完整保存、恢复和迁移图谱时请优先导出 ChatMap JSON。PNG/SVG 适合视觉分享；Obsidian Canvas 会尽量导出 mini 节点和连接，但 JSON 才是完整保真格式。
