# NovelForge 引入 Python 的可行性分析

> 分析日期：基于当前代码库（v0.1.5 / 非测试 TS/TSX 约 60,865 行）
> 结论先行：**不建议大规模替换，推荐"定点引入"——用 Python sidecar 补强 3 个能力缺口（本地向量化、中文 NLP 后处理、docx/epub 导入导出），其余部分保持 TypeScript 不动。**

---

## 1. 现状约束（决定一切的背景）

| 约束 | 事实 |
|------|------|
| 分发形态 | NSIS 安装包分发到**终端用户**，用户机器上**不保证有 Python** |
| 原生模块 | better-sqlite3 + @lancedb/lancedb + apache-arrow + flatbuffers 已需 `asarUnpack`，打包是公认痛点（CLAUDE.md 高频坑位） |
| 运行时 | 主进程 Node（IPC/DB/LLM/向量库），渲染进程 React + Zustand（工作流引擎、Agent、prompt、审计逻辑都在这里） |
| 子进程先例 | MCP 管理器已用 `spawn + stdio + JSON-lines` 管理外部进程 —— **sidecar 模式在本项目已有成熟先例** |
| 质量门禁 | typecheck / lint（--max-warnings 0）/ 449 测试，任何引入必须过门禁 |

---

## 2. 逐模块评估矩阵

### 🟢 A 档：推荐引入（Python 生态优势是决定性的）

#### A1. 本地向量化（离线 Embedding）—— 收益最大的一项

现状（`electron/embedding-service.ts` / `electron/embedding.ts`）：
- 只有两条路：专用 Embedding API（付费、需联网）或 **"用 Chat LLM 生成向量"**（贵、慢、质量差）
- 整个 RAG/知识库/混合检索依赖它

Python 方案：`sentence-transformers` / `onnxruntime` 跑 BGE-M3 / bge-small-zh（中文效果好的本地模型）+ `lancedb` Python 写入。

收益：
- **离线可用**（写作工具核心场景：无网/内网）
- **零增量成本**（现在每次嵌入都在烧 token/钱）
- **隐私**（正文不出本机）

⚠️ 重要说明：如果目标只是"本地嵌入"这个**能力**，`transformers.js`（WASM/ONNX，纯 JS）也能实现，不必引入 Python。Python 路线的优势在中文分词质量、与 lancedb python 的整合、以及后续 NLP 管道共用同一运行时。建议先做能力验证，再决定语言。

#### A2. 中文 NLP 后处理管道（文风/声音/伏笔/角色名纠错/审计）

现状（`src/services/`）——全部是**手写正则 + 启发式**，效果天花板低：
- `character-voice-analyzer.ts`：语气靠 `tonePatterns` 正则硬匹配
- `character-name-repair.ts`：模糊匹配手写实现
- `publication-analysis.ts`：字符频率 Dice 系数
- `audit/audits.ts`：术语/水文检测正则
- 章节后处理 DAG（剧情提取/角色更新/伏笔扫描/声音分析/文风学习）

Python 方案：`jieba`/`pkuseg`（中文分词）→ `rapidfuzz`（模糊匹配，比 JS 手写快 10–100 倍）→ `textstat`（句长/可读性）→ TF-IDF/词频画像。

收益：
- 角色声音指纹、文风画像、伏笔扫描的**效果质变**（分词后的词频/句式统计 vs 正则）
- 角色名纠错/合并的召回率提升
- 这些是**离线批量任务**（定稿后 DAG），天然适配 sidecar，不要求实时往返

#### A3. 新增导入/导出格式（docx / epub）

现状：导入只支持 `.txt/.md/.text`（`import-controller.ts` `NOVEL_EXTS`），导出只支持 md/txt（`export-service.ts`）。

Python 方案：`python-docx`（docx 导入/导出）、`ebooklib`（epub）、`weasyprint`（PDF）。

收益：**新功能**而非替换——网文作者从 Word 稿件导入、导出 epub 到阅读器，是高频刚需。Python 是这些格式最务实的实现路径（JS 侧库普遍不成熟）。

### 🟡 B 档：可选（收益中等，成本不低）

#### B1. LanceDB 操作层迁移到 Python

现状：JS 版 `@lancedb/lancedb` + `apache-arrow` + `flatbuffers` 三套原生模块进 `asarUnpack`，打包与版本升级都有痛点（CLAUDE.md 已记十次 package.json 被覆盖事件）。

Python 侧 `lancedb` + `pyarrow` 生态更成熟（hybrid search、rerank、pandas 集成）。

代价：双运行时并存、检索链路从"主进程内同步调用"变成"跨进程 RPC"。**JS 版已在正常工作**，此项属于"锦上添花"，建议放到 Python 运行时稳定后再评估。

### 🔴 C 档：不建议（替换反而更差）

| 模块 | 为什么不换 |
|------|-----------|
| LLM provider（`electron/llm/*`） | 薄 HTTP/SSE 封装 + 重试。流式生成走 sidecar 每 token 跨进程，徒增延迟；现有实现已成熟（429/5xx 退避、断流不重试、usage 提取） |
| SQLite 层（`electron/database.ts` + repositories） | `better-sqlite3` 同步 API 是 JS 生态最强项，Python `sqlite3` 无任何优势 |
| 工作流引擎 / Agent 引擎 / Commands（`src/stores/workflow-store.ts`、`src/services/workflows/*`） | 与 Zustand store、IPC、checkpoint（localStorage）深度耦合的**编排逻辑**，迁移=重写，收益为零 |
| 构建脚本（`scripts/*.cjs`） | 体量太小，引入 Python 工具链是负优化 |
| MCP 管理器 | 进程生命周期管理，Python 无优势 |
| 渲染层 UI / Store | 无讨论价值 |

---

## 3. 推荐架构：Python sidecar（不是"重写"，是"外挂"）

与项目现有 MCP 模式完全一致：

```
渲染进程 (React)         主进程 (Node)               Python sidecar (PyInstaller exe)
    │                        │                            │
    │ ipc.invoke('py:*')     │ python-bridge 单例          │
    ├───────────────────────►│  lazily spawn               │
    │                        ├───────────────────────────►│ stdio JSON-lines RPC
    │                        │◄───────────────────────────┤ (与 mcp-manager 同协议)
    │                        │                            │
```

落地要点（全部符合项目既有规范）：
1. **通道白名单**：`py:` 前缀注册进 `electron/preload.ts`，类型定义进 `src/shared/ipc-channels.ts`
2. **懒启动 + 空闲回收**：后处理/导入导出开始时 spawn，空闲 N 分钟回收；`py:ping` health-check
3. **降级策略**：Python 不可用/超时 → 自动回退现有 JS 实现（voice analyzer 等原实现保留）
4. **安全**：与 `dev-controller` 同级审查——输出大小上限、超时、sanitize 错误信息、路径白名单
5. **i18n**：sidecar 返回结构化数据（不返回文案），展示文本仍走渲染层 `t()`

**分发方式决策（关键取舍）**：
- **方案甲：捆绑**（PyInstaller 打进安装包）—— 用户零感知，但安装包 +40~100MB、Windows 杀软误报风险、代码签名流程复杂化
- **方案乙：可选**（检测 PATH 中的 python3，无则提示安装）—— 风险最低，但功能割裂
- 建议：**乙起步、甲后补**。先验证功能价值，再投入打包工程。

---

## 4. 风险清单

| 风险 | 说明 |
|------|------|
| 安装包体积 | onnxruntime + PyInstaller 单文件约 60–120MB |
| 杀软误报 | PyInstaller 产物在 Windows 上是误报重灾区 |
| 内存占用 | Electron 主进程 + Python 常驻双运行时 |
| 冷启动延迟 | 本地模型加载 1–3 秒（懒启动可缓解） |
| 新攻击面 | 子进程注入、路径注入 —— 必须按 dev-controller 标准做白名单 |
| 测试门禁 | 新桥接层需配套单测（mock sidecar），449 测试基线不能回退 |
| 版本兼容 | Python 包升级 vs 应用版本节奏解耦（sidecar 独立于 asar 更佳） |

---

## 5. 结论与建议路线

**Python 不能让这个程序"整体更好"——它只能让三件事"更好"：离线向量化、中文 NLP 效果、文档格式支持。** 其余 90% 的代码（编排、DB、LLM 薄封装、UI）换语言只会更差。

建议分阶段：
- **Phase 0**：本文档定稿 + `py:ping` 空桥接验证 sidecar 模式
- **Phase 1（收益最大）**：本地 embedding（先用 transformers.js 或 Python 验证其一）+ 文风/声音分析批量管道
- **Phase 2**：docx/epub 导入、epub 导出
- **Phase 3**：评估 LanceDB Python 迁移（仅当打包痛点持续时）

> 一句话总结：**"用 Python 替换"应理解为"用 Python 补强"——新增能力用 Python 生态实现，现有稳定的 TS 骨架不动。**
