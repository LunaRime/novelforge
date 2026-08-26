# Agent 对话升级：意图预路由 + fork/rewind 分支 + 编辑器修复群（2026-08-26）

> 状态：设计定稿，待实施
> 阶段顺序：**C 群（修复群，先行）→ A（对话即生成）→ B（分支）**
> 关联评审：外部评审 + 内部深度评审（用户逐节裁决），三个裁决点见 §8

## 1. 背景与目标

- **A**：Agent 对话升级为「对话即生成小说」——输入「写第三章」等自然语言直接触发创作工作流，而非依赖 LLM 自主决定是否调工具
- **B**：对话分支——fork（从某消息派生新会话）与 rewind（回退重写）
- **C**：5 个 UI/编辑器问题（hover 抖动、加粗显示、撤销、思考折叠+工具可见性、历史条数配置）

## 2. 范围与阶段

| 阶段 | 内容 | 类型 | 工期估计 |
|---|---|---|---|
| C | C1-C5 修复群 | bounded | 1-2 天 |
| A | 意图预路由 + 直接触发工作流 | architectural | 2-3 天 |
| B | fork + rewind 分支 | architectural | 2-3 天 |

C 先行（独立 bounded）；A 次之（核心价值）；B 最后（C4 先动消息结构后 B 改动面更小）。

## 3. 阶段 C：修复群

### C1 历史项 hover 抖动（`src/components/panels/agent/AgentConversation.tsx` RecentConversationItem）

**根因**：悬停时右侧「时间 ↔ 删除按钮」display 切换（`hidden group-hover:flex` / `group-hover:hidden`），两者宽度不同（时间文本可变长度 vs 24px 按钮），hover 时布局跳动。

**方案**：
- 右侧容器固定宽度 = 时间文本最大宽度（`formatRelativeTime` 最长形态如「3 天前」按当前 locale 估算，约 64px；实现时取常量 + 注释来源）
- 时间与删除按钮**绝对定位重叠**于固定容器内，hover 时 opacity 渐变（`transition-opacity`），无 display 切换 → 零布局跳动
- 组件被 EmptyState 与 AgentHistoryPanel 共用，一处修改两处受益
- 背景色 JS onMouseEnter/Leave 逻辑保留（仅 backgroundColor 变化不引起布局变动）

### C2 加粗显示 `**文字**`（`src/components/editor/CodeMirrorEditor.tsx`）

**根因**：写作模式（`mode="prose"`，DraftEditor/EditorArea 均用）未启用 markdown 扩展（`markdown()` 仅在 `mode === 'document'` 添加，第 306-308 行），加粗按钮也仅 document 模式显示（第 597 行）。插入的 `**` 为字面文本。

**方案**（Markdown 标记 + 即见粗体，已裁决）：
- prose 模式也启用 `markdown({ base: markdownLanguage, codeLanguages: languages })` 扩展
- 主题（cmTheme）显式补充 strong/em 样式：`.cm-strong { fontWeight: 'bold' }`、`.cm-em { fontStyle: 'italic' }`（`@codemirror/lang-markdown` 默认 highlightStyle 在自定义 theme 下可能被覆盖，需显式声明，实现时验证）
- 加粗按钮条件改为 `mode === 'document' || mode === 'prose'`
- 存储格式不变（`**` 源码），仅视觉渲染

**风险**：prose 启用 markdown 高亮后中文正文展示不受影响（高亮仅装饰 token）；需验证写作场景无闪烁/样式冲突。

### C3 撤销异常（`CodeMirrorEditor.tsx` + `DraftEditor.tsx:375` + `ArchFileViewer.tsx:104`）— C 群第一项

**候选根因**：`onChange` → `updateTabContent` → store 更新 → content prop 变化 → `setEditorContent` → ReactCodeMirror value 同步 dispatch（可能进 undo 历史栈），用户 undo 时先撤销「外部回写」而非自身编辑。

**流程（先验证后修复，不硬套方案）**：
1. 复现：编辑器连做 2 次编辑 → Ctrl+Z 一次 → 观察撤销内容
2. 验证 updateTabContent 链路是否造成 value 回写 dispatch 进历史栈（`@uiw/react-codemirror` 的 value 同步行为）
3. 若确为根因：优先方案「外部回写 dispatch 不进历史」——ReactCodeMirror 无法直接控制时，改用「编辑器内部变更与外部回写区分」：handleUpdate 中 docChanged 时若 `view.state.doc.toString() === content`（外部欲回写的值）则跳过 onChange 上行（外部值已一致）
4. 若验证后非根因：回到 systematic-debugging 流程重查（history 扩展注册、IME 输入、Bubble Menu 焦点等），不得硬套

### C4 对话思考折叠 + 工具/文件可见性（AgentMessage.tsx + ToolCallBlock.tsx）

**现状**：agent-engine 把思考拼进 content（`_思考过程_\n> xxx` 引用块，agent-engine.ts:205-206），平铺不折叠；ToolCallBlock 头部只有工具名。

**方案**：
- **思考折叠（渲染层解析，存储不动——对旧归档兼容最稳，不动 archive-codec）**：
  - AgentMessage.tsx 渲染时检测思考前缀块（正则 `/^_[^_\n]+_\n>/`，对任意 locale 的思考前缀可匹配；检测不到即按普通 markdown 渲染，容错），抽取为独立 ThinkingCollapse 组件（默认折叠，头部「思考过程 ▸ 展开」样式，与 AIOutputPanel 的 ThinkingBlock 风格一致）
  - 注意：thinkingContent 为空时 agent-engine 不拼思考块（agent-engine.ts:205 有条件），渲染层无需处理空思考
  - 新格式消息不改（未来如加结构化 thinking 字段再做，本期不做）
- **工具/文件可见性**：
  - ToolCallBlock 头部增强：`arguments.file_path` / `arguments.path` 存在时显示 `📄 文件名` 摘要（文件名取 basename）；read_drafts 的 chapter 参数、read_characters 的 name 参数同样映射摘要
  - 头部保持默认折叠（现有 expanded 状态），仅头部信息增强

### C5 历史条数可配置（EmptyState）

**根因**：`recentConvs = conversations.filter(...).slice(0, 3)` 硬编码（AgentConversation.tsx:52-54）。

**方案（已裁决：全局 config.json）**：
- `~/.vela/config.json` 新增 `recentConversationCount`（与 logRetention 同级），默认 3
- 读全局配置的现有工具：`ipc.invoke('config:get', ...)`（验证 electron/controllers/config 相关通道名后实现）
- 无配置/读取失败 → 默认 3
- 空状态列表渲染改为 `slice(0, count)`；「加载更多」显示条件同步（`> count` 时显示）

## 4. 阶段 A：对话即生成（意图预路由 + 直接触发）

### 4.1 架构

```
sendMessage(content)
  → parseSlashCommand / parseMentions（现有，不变）
  → 未命中 → detectWritingIntent(content, ctx)（新，writing-intent.ts，本地零 LLM 成本）
      ├─ 强命中 → 直接触发工作流（跳过 LLM 决策轮）→ 进度/结果注入对话
      ├─ 弱命中 → 注入一条 assistant 澄清消息（agent 对话追问一轮，复用现有消息通道）
      └─ 未命中 → 原样进 ReAct 循环（LLM 自主调工具 = 兜底，行为不变）
```

**已裁决：强命中直接触发工作流（非经 LLM 调 start-workflow）**——预路由核心价值是确定性；LLM 自主调用保留为兜底通道。

### 4.2 模式库（新文件 `src/services/agent/writing-intent.ts`，不塞入 intent-router.ts）

判定原则：**执行成本/破坏性**——写稿/修稿/建角色/大纲都会触发工作流或写库，LLM 自主决策不可靠且出错代价高，值得预路由；查询类（文风/设定/聊天）ReAct 兜底即可，不加。

| 意图 | 示例输入 | 提取 | 动作 |
|---|---|---|---|
| chapter_creation | 「写第三章」「创作 5-8 章」（「继续写」无章节号 → 弱命中澄清） | chapter_number（单章）或 range（批量） | 直接触发写稿工作流（guardChapterWriting + createChapterWorkflow） |
| refine | 「把这段润色」「修一下第 2 节」 | chapter 定位（若可解析） | refine 工作流（有 review 走 createRefineFromReviewWorkflow） |
| character | 「创建一个叫苏晚晴的角色」 | 角色名 + **新建 vs 修改分支**（实体解析：查角色库是否存在——新建走角色工具链、修改走 update_character_cards 合并语义） | 按分支路由 |
| architecture | 「生成大纲」「重新规划剧情」「生成架构」 | — | createDirectoryWorkflow（蓝图目录生成，directory-workflow.ts:315，type 'directory'）/ createArchitectureWorkflow（架构生成），均带 guard |

细节：
- 单章 vs 批量区分：`chapter_creation` 检测「数字」或「数字-数字」范围；批量 = 多章连续触发
- 弱命中判定：意图动词命中但参数缺失（如「写」无章节号）→ 澄清追问，模板：「你想写第几章？」
- 置信度阈值：强命中 = 意图动词 + 关键参数齐全；仅意图动词 = 弱命中
- 所有触发走 workflow-guards 前置校验（与工具层一致，guard 失败 → 错误信息注入对话）

### 4.3 直接触发的接线（复用 executor，不做新执行路径）

**现状**：`start-workflow.tool.ts` 的 buildXxxWorkflow（:204-275）是 **async 组装函数**（内部读 DB、调 guard），非纯函数；启动 = `useWorkflowStore.getState().startWorkflow(definition)`。

**⚠️ 失败语义不统一（提取时必须统一接口）**：buildDraftWorkflow guard 失败是 **throw**（:209），buildReviewWorkflow 无草稿是 **返回 null**（:224）。提取时统一为「全部 throw 带错误 key」（如 `ERR_GUARD` / `ERR_NO_DRAFT` / `ERR_NO_BLUEPRINT`），调用方单路 catch 即可注入对话，避免「错误信息注入对话」分两路处理。

**方案**：
1. 把 `buildDraftWorkflow` / `buildReviewWorkflow` / `buildRefineWorkflow` / `buildFinalizeWorkflow` 及其辅助（getChapterInfoFromBlueprint / getLatestDraft / getLatestReview）从 `start-workflow.tool.ts` 提取到新 service 模块 `src/services/workflows/workflow-starter.ts`（统一导出 `startChapterWorkflow(workflow, chapterNumber)` 等），**统一失败语义为 throw 带错误 key**；工具层改为调用该模块（行为等价，null 分支改由 catch 处理）
2. `writing-intent.ts` 强命中路径直接调 `startChapterWorkflow`：
   - 成功 → 对话注入 assistant 消息「已开始{工作流名} 第{章}章，进度见任务面板/AI 输出」（含 ArtifactCard workflow_started 类型，与工具层一致）
   - 失败 → 统一 catch 错误 key（ERR_GUARD / ERR_NO_DRAFT / ERR_NO_BLUEPRINT）→ 错误信息注入对话（不抛给 LLM 重试，确定性路径）
3. 步进模式/用户确认：复用 workflow-store 现有 waitingRuns / confirmContinue 机制（不新增）
4. 工具层 start_workflow 保留原样（LLM 兜底通道）

### 4.4 上下文预载

强命中触发前，用现有 `buildAgentSystemSegmentsAsync(mode)` + RAG（retrieveContextForQuery）组装上下文写入对话消息（与 @提及预取链路同模式：预取内容注入本轮 user 消息，不存库）。工作流本身自带上下文组装（createChapterWorkflow 内部），预载仅服务「对话汇报」质量，不做双份注入。

## 5. 阶段 B：fork + rewind 分支

### 5.1 数据模型（agent-store.ts 扩展，向后兼容 archive-codec）

```ts
AgentConversation {
  ...现有字段
  parentId?: string            // fork 自哪个会话
  forkMessageId?: string       // fork 起点消息 id（fork 时该消息之前的历史已复制）
  rewound?: RewoundBranch[]    // rewind 归档（可恢复）
}
type RewoundBranch = { messageId: string; messages: AgentMessage[]; rewoundAt: number }
```

- 新字段（parentId/forkMessageId/rewound）**自动透传**：serializeArchive 是全量 JSON.stringify、parseArchive 是展开式，无白名单机制——只需改 agent-store.ts 的类型定义，archive-codec 不动，旧归档 parse 天然兼容（无新字段则 undefined）
- fork 复制：messages（起点前含起点）、compressed（CCR 批次）、rollingSummary、mode、modelId、roleplayCharacter、projectPath、projectName；**rewound 不复制**（新会话无归档）；新会话独立 id，title 加「(分支)」后缀或保持继承

### 5.2 v1 边界（已裁决：fork/rewind 起点限制在未压缩区）

**坑（评审确认）**：CCR 超预算时旧消息移入 `compressed[].original`（agent-store.ts:521-551），3 代外 original 丢弃只留摘要（:539-541）。压缩区内消息无法还原完整历史。

**v1 规则**：**所有可见消息均可 fork/rewind**——CCR 压缩时旧消息已被移出 messages（agent-store.ts:543-549，set messages = rest），messages 中不存在 compressed.original 内的消息，压缩区内消息本来就没有 UI 入口。因此无需「消息 id 在 compressed original 中 → 禁用」判定（该判定恒 false，是 dead code，已删除）；压缩区操作记为 deferred（不阻塞本期，将来若要操作压缩区再做判定）。

### 5.3 行为

- **forkFromMessage(messageId)**：复制历史 → 新会话（parentId + forkMessageId 标记）→ 激活新会话
- **rewindToMessage(messageId)**：截断本会话 messages 到 messageId（含）→ 被截断消息存入 `rewound` 归档 → 恢复时 append 回 messages（简单正确，评审确认）
- 压缩批在 rewind 后：若截断点在压缩批之后，compressed 保留不变（历史仍可展开）

### 5.4 UI

- AgentMessage 消息 hover 出「分支」按钮（fork 图标）+ 会话菜单「回退到此处」（或消息 hover 菜单，实现时定）
- AgentHistoryPanel 列表项增强（**降级方案，已裁决**）：fork 子会话缩进 + 分支图标 + 「来自『父标题』」小字；不建完整树视图（后续可选）
- 压缩区消息的按钮禁用态 + 提示

## 6. 测试计划

| 模块 | 测试 |
|---|---|
| writing-intent.ts（新） | 模式库命中表单测：单章/批量/角色新建/角色修改/弱命中澄清/未命中回落；中文与混合输入 |
| workflow-starter.ts（提取） | 与工具层等价性：guard 失败、无草稿、正常触发（复用工具层现有覆盖思路） |
| agent-store fork/rewind（新） | fork 复制完整性（messages/compressed/mode/roleplay，rewound 不复制）；rewind 截断 + rewound 归档 + 恢复；所有可见消息均可操作 |
| AgentConversation C1/C5 | hover 无布局跳动（视觉断言）；条数配置生效（mock config 返回值） |
| CodeMirrorEditor C2/C3 | prose 模式 markdown 高亮生效（strong token）；加粗插入 `**` 包裹；撤销行为（连做多步后逐步撤销） |
| ToolCallBlock C4 | 文件/路径参数显示摘要；无参数不显示 |
| archive 兼容 | 旧归档（无新字段）parse 后 fork 可用；新归档序列化含新字段 |

## 7. 风险与兼容

- **C2**：prose 启 markdown 高亮——需回归写作场景（中文正文、大文档性能、搜索/替换面板）
- **C3**：撤销根因未验证前不硬改；若 value 回写是根因，改动限 CodeMirrorEditor 内部
- **A**：预路由误命中（如「我写了个想法」命中写稿）——弱命中澄清兜底；强命中要求参数齐全
- **B**：新字段经 serializeArchive/parseArchive 全量透传天然兼容（无白名单机制），仅需 agent-store.ts 类型定义；rewind 后 CCR 批次不重组（压缩区 deferred 的代价）
- **i18n**：所有新增用户可见文本走 t()（agent.* / tool.* 键），对照 i18n-standard
- **save-feedback-standard**：新保存/触发动作带 toast + 日志

## 8. 决策记录（已裁决）

| # | 决策 | 结论 |
|---|---|---|
| D1 | A 强命中执行路径 | **直接触发工作流**（跳过 LLM 决策轮），executor 提升 service 层复用；LLM 自主调用保留为兜底 |
| D2 | B 压缩区操作 | v1 限制 fork/rewind 起点在未压缩区，压缩区操作 deferred |
| D3 | C5 配置位置 | 全局 `~/.vela/config.json`（`recentConversationCount`，默认 3） |
| D4 | A 模式库范围 | 4 类（写稿/修稿/角色/大纲），按执行成本原则；查询类不预路由；将来优先补批量生成 |
| D5 | B 分支树视图 | 降级为缩进 + 图标 + 父会话标注；完整树视图后续可选 |
| D6 | C4 思考拆分 | 渲染层解析（存储不动），ToolCallBlock 头部加 📄 文件摘要 |
