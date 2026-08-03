# LLM 生成小说外部工具模块 — 实施计划书

> 日期：2026-08-03 · 状态：已实施（2026-08-03 晚，含修复记录）
> 目标：用"外部工具"封堵 LLM 生成小说的 6+ 类已知缺陷，全部基于 NovelForge 现有架构
> （Agent 工具系统 toolRegistry / 工作流钩子 / 后处理管道）实现，零外部服务依赖。

---

## 一、深度检查结论：现有代码运行链支持矩阵

| # | 问题 | 现有能力（代码现状） | 缺口 |
|---|------|---------------------|------|
| 1 | 数学智障 | ❌ 无任何计算工具 | Agent 可加 calculator；工作流（纯生成）数字运算场景少 |
| 2 | 记忆遗忘 | ✅ **已基本具备**：generate-draft 写稿前已调 `kb:search`（line 93-105，检索 5 片注入 prompt）；Agent 有自动 RAG（`retrieveContextForQuery`） | 检索是"相关性 Top-K"，非"强制记忆核对"；无"本章必须引用 X 设定"的硬约束 |
| 3 | 逻辑伏笔断裂 | ⚠️ **伏笔引擎已存在**：`foreshadowing-manager.ts`（277 行）——finalize 后处理已扫描新伏笔/回收旧伏笔（`scanNewForeshadowing`/`detectResolvedForeshadowing`），数据含 `resolved`/`resolvedChapter` | **写稿 prompt 未注入"未回收伏笔清单"**——generate-draft 的上下文里完全没有伏笔数据，LLM 不知道前 10 章的伏笔 |
| 4 | 角色 OOC | ⚠️ 角色卡已分级注入：tier1 完整档案 + tier2 精简（`readCharacterStates`）；`character-voice-analyzer.ts` 已有声音档案（topWords/口头禅）并写入角色 notes `[VOICE:]` 标记 | **voice 档案未注入写稿 prompt**——`formatVoiceForPrompt()` 已存在但零调用；OOC 检测（生成后对照性格核对）缺失 |
| 5 | 重复水文 | ❌ 无词频/重复审计 | 生成后无"苦笑×5 次"类检测 |
| 6 | 创意撞车 | ⚠️ 知识库检索按相关性（同质内容会反复命中） | 无"随机/多样性"采样，越写越套路 |
| — | 衔接断裂 | ✅ 已注入上一章结尾 800 字（`previousEnding`）+ 过渡引擎（`chapter-transition-engine.ts`） | 生成后无"开头是否接上"校验 |
| — | 字数失准 | ✅ **本次已修**：`text-stats.ts` + `count_characters` 工具 + wordCount 统一口径 | — |

**结论**：现有架构天然支持工具化（Agent 工具系统 + 工作流钩子 + 后处理管道三个接入点），6 类问题中 2 类已具备、2 类有引擎但未接通、2 类需新建。

---

## 二、工具设计（6 个目标工具 + 5 个补充）

### 工具接入的三个层次

| 层次 | 说明 | 适用 |
|------|------|------|
| A. Agent 工具 | toolRegistry 注册，LLM ReAct 循环主动调用 | 对话场景（`count_characters` 已落位） |
| B. 工作流钩子 | 生成前/后固定注入（命令层调用，无需 ReAct） | 写稿/修稿/定稿主流程（即时生效，零模型兼容风险） |
| C. 后处理步骤 | PostProcessPipeline 步骤（可重试、状态持久化） | 生成后审计类（与 kb_import 等并列） |

### 工具 1：Calculator 计算器（对应"数学智障"）

- **实现**：`src/services/agent/tools/calculator.tool.ts`，输入 `expression` 字符串 → 校验白名单（仅 `0-9 + - * / ( ) . %`，**禁用 eval**）→ 用 `Function` 构造或手写四则解析器求值
- **接入**：A（Agent 工具，注册进 builtinTools）；B 可选（工作流无计算场景）
- **运行链**：LLM 需要数值（如"每章 3000 字 × 30 章"）→ `<tool_call>{"name":"calculator"...}</tool_call>` → 返回精确结果 → 继续生成
- **风险**：正则白名单必须严格（防注入），建议 `new Function('return (' + expr + ')')` + 白名单预检

### 工具 2：retrieve_memory 强制记忆检索（对应"记忆遗忘"）

- **实现**：复用 `rag-context-provider.ts` 的 `retrieveContextForQuery`，封装为：
  - Agent 工具 `retrieve_memory`（输入 `query` + 可选 `chapter_scope`，返回 Top-K 相关片段 + 来源）
  - 工作流钩子：generate-draft 现有 `kb:search` 升级——检索词改为 `buildChapterRAGQuery()`（标题+关键事件+角色组合），**并把检索结果标注为"本章必须遵循的设定事实"**（现为弱提示"知识库资料（如有）"）
- **运行链**：写稿前 → 组合查询 → 检索 → 注入 prompt"本章事实锚点"区 → LLM 生成时引用
- **风险**：低（纯增强）；需控制注入量（≤800 tokens，现有预算内）

### 工具 3：query_foreshadowing 伏笔查询（对应"逻辑伏笔断裂"）★P0

- **实现**：`src/services/agent/tools/query-foreshadowing.tool.ts` + 工作流钩子
  - 读 `foreshadowing-manager.loadAllForeshadowing()` → 过滤 `resolved === false` 且 `plantedChapter <= 当前章 - 2`（至少埋了 2 章）→ 格式化"未回收伏笔清单"
  - generate-draft：注入 prompt 新区块**【未回收伏笔（本章可回应 1-2 个，不可一次性回收全部）】**
- **运行链**：写稿 → 读伏笔库 → 未回收清单注入 → LLM 生成时可自然回应/推进 → finalize 后处理自动回收（已有）
- **工作量**：小（引擎已存在，只接管道）
- **风险**：低；伏笔过多时截断（限 5 条）

### 工具 4：角色 OOC 防护（对应"角色 OOC"）★P0

- **实现**：两个动作
  1. **写稿注入**：`character-voice-analyzer.formatVoiceForPrompt()` 已存在——在 generate-draft 的 `readCharacterStates` 之后追加 voice 档案（从角色 notes 解析 `[VOICE:]` JSON，tier1 角色必注入）
  2. **生成后 OOC 抽查**（可选）：后处理步骤 `character_ooc_audit`——取本章对话行 + tier1 角色性格必填项（personality/motivation）→ LLM 一次性核对"有无违和台词"→ 结果写入步骤日志（非关键步骤，失败不阻断）
- **运行链**：写稿（注入）→ 生成 → 审计（核对）→ 草稿可修订
- **风险**：注入成本可控（voice 档案很小）；OOC 审计额外一次 LLM 调用（可并入修稿流程避免重复计费）

### 工具 5：repetition_audit 重复词审计（对应"重复水文"）★P0

- **实现**：**纯函数零 LLM**——`src/services/audit/repetition-audit.ts`
  - 对文本做 2-3 字词组滑动窗口统计（jieba 太重，用正则切词 + 高频词检测：`/[一-鿿]{2,3}/g` 频次 Top 10）
  - 规则：词频 ≥ 3 且出现在正文非对话区 → 报告"「苦笑」出现 5 次（第 3/7/12/18/25 段）"
  - 阈值可配置（默认 3 次）
- **接入**：C（后处理步骤 `repetition_audit`，挂 chapter_finalize 后处理）+ B（生成命令完成后日志提示）
- **运行链**：草稿落库 → 审计步骤 → 命中则步骤标记"建议重写"（非关键）→ 用户看到提示可触发修稿
- **工作量**：小（纯函数 + 测试）
- **风险**：低；误报（对话中的口头禅）需"非对话区"过滤（`「」`/`“”`内跳过）

### 工具 6：setting_sampler 设定采样器（对应"创意撞车"）

- **实现**：`src/services/agent/tools/setting-sampler.tool.ts` + 工作流钩子
  - 从知识库随机采样 N 条"冷门"片段：`kb:search` 传**低相关度查询**（如随机关键词）+ 取尾部结果，或按 docId 随机取块
  - 注入 prompt 新区块**【创意多样性提示（可选参考，非强制）】**：1-2 条冷门设定，提示"如有合适的契机可化用，避免套话"
- **运行链**：写稿 → 随机采样 → 弱提示注入 → 生成
- **风险**：中——随机采样质量不可控，须"可选参考"措辞 + 限 1-2 条

### 补充工具（用户所问"还可以添加哪些"）

| # | 工具 | 问题 | 实现要点 | 优先级 |
|---|------|------|---------|--------|
| 7 | **chapter_continuity_check** 衔接检查 | 开头跳戏 | 生成后取章节首 100 字 vs 上章末 200 字做关键词重叠检测（纯函数）；或 LLM 一次性核对 | P1 |
| 8 | **terminology_unify** 术语统一 | 人名/地名/招式名不一致 | 维护专有名词表（从蓝图/角色卡提取），生成后扫描变异写法（同音/错字） | P1 |
| 9 | **blueprint_completion_check** 蓝图完成度 | 漏写关键事件 | 生成后对比本章 blueprints.key_events 逐条核对是否出现在正文（纯函数包含性检查） | P2 |
| 10 | **sensitive_word_filter** 违禁词过滤 | 平台合规 | 内置违禁词表（可配置 `~/.vela/audit/forbidden.txt`），生成后扫描命中段 | P2 |
| 11 | **timeline_check** 时间线一致性 | 时序错乱 | 从章节内容提取时间词（第X天/次日/三月后），跨章比对是否矛盾 | P3 |

---

## 三、实施计划（分期）

### P0 — 价值最高、改动最小（约 0.5 天）
| 项 | 改动 |
|----|------|
| 伏笔注入 | `query-foreshadowing.tool.ts`（Agent）+ generate-draft 注入未回收伏笔清单 |
| Voice 注入 | generate-draft 追加 `formatVoiceForPrompt`（tier1 角色） |
| 重复词审计 | `repetition-audit.ts` 纯函数 + 后处理步骤 + 生成后日志 |
| Calculator | Agent 工具（白名单表达式求值） |

### P1 — 强化（约 0.5 天）
- 章节衔接检查（纯函数版）
- 术语统一检查
- 设定采样器（弱提示注入）
- OOC 审计（并入修稿流程）

### P2 — 完整闭环（约 0.5 天）
- 蓝图完成度检查（后处理）
- 违禁词过滤（可配置词表）
- 时间线一致性（跨章）

### 质量与兼容要求
- 每个工具：纯函数核心 + vitest 单测（对齐 text-stats 先例）
- 全部接入三层架构之一（Agent 工具 / 工作流钩子 / 后处理步骤），**不引入新依赖**
- 生成前注入类工具全部受 Token 预算约束（现有 28000 预算内）
- 生成后审计类全部为**非关键步骤**（失败不阻断定稿），报告进步骤日志与 UI

---

## 四、风险与决策点（已拍板）

1. **重复词审计阈值**：✅ 默认"同词 ≥3 次即报警"，对话区口头禅自动豁免；≥6 次升 error
2. **OOC 审计**：❌ **未实施**（需额外一次 LLM 调用，与"零依赖纯函数"目标冲突；写稿注入声音档案已覆盖主要 OOC 风险，留作后续独立议题）
3. **设定采样器**：✅ 随机低频词池检索 + 按相关度升序取尾部（低相关度 = 冷门）
4. **伏笔注入条数上限**：✅ 5 条/章，超出取最近埋设的
5. **推进方式**：✅ 整体推进（P0 注入类 + P1/P2 审计纯函数一次做完）

## 五、实施记录（2026-08-03 晚）

### 已交付

| 项 | 实现 | 接入 |
|----|------|------|
| Calculator | `calculator.tool.ts`（白名单 `^[0-9+\-*/().%\s]+$` + Function 求值，无 eval） | A：builtinTools |
| 伏笔查询 | `query-foreshadowing.tool.ts`（未回收 + 埋设章过滤 + ≤5 条） | A + B |
| 设定采样 | `setting-sampler.tool.ts`（低频词池 12 词随机检索取低相关度尾部） | A + B |
| 字数统计 | `text-stats.ts` + `count-characters.tool.ts` | A + 全链路 |
| 六类审计 | `src/services/audit/audits.ts`（重复词/衔接/术语/蓝图完成度/违禁词/时间线，纯函数） | C：content_audit 后处理步骤（非关键） |
| 写稿注入 | generate-draft：未回收伏笔清单 + 角色声音档案（`formatVoiceForPrompt`）+ 冷门设定采样，全部失败不阻断 | B |
| 声音档案加载 | `character-voice-analyzer.loadCharacterVoiceProfiles()`（解析角色 notes 的 `[VOICE:]` JSON 标记） | B |
| wordCount 口径 | 全部 10 处写库点从 `length` → `computeTextStats().novelWordCount`（汉字+英文词） | 全链路 |

### 修复记录（质量门禁过程中发现）

1. **注入丢失 bug**：generate-draft 曾把注入段追加到 `prompt` 字符串后仍调用 `callLLMWithBuilder(promptBuilder)`——该方法内部 `builder.build()` 重新构建，注入全部丢失。改为 `callLLM(prompt, promptBuilder.getSystemRole(), ...)` 直接传注入后的字符串
2. **动态导入路径**：`setting-sampler` 动态导入需带 `.tool` 后缀（模块文件命名约定）
3. **口径遗漏**：version-service / CodeMirrorEditor / refine-draft / refine-paragraphs / refine-from-review 5 处 `length` 残留统一（上次只改了主链路）

### 质量门禁

tsc 零错误 + eslint 零警告 + 92 测试通过（新增 audits 12 + text-stats 5）

---

*（本文档基于 2026-08-03 代码现状深度检查；改动均在现有 toolRegistry / workflow 钩子 / PostProcessPipeline 架构内）*
