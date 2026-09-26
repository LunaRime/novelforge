/**
 * NovelForge IPC 频道定义 — 渲染进程与主进程的类型安全通信契约
 * 所有 IPC 调用都通过此文件定义频道名和参数/返回值类型
 */

// ===== 全局配置 =====
export interface ConfigChannels {
  'config:get': {
    args: []
    return: GlobalConfig
  }
  'config:set': {
    args: [config: Partial<GlobalConfig>]
    return: { success: boolean; error?: string }
  }
  'config:get-vela-home': {
    args: []
    return: string
  }
}

/**
 * 本地向量档配置（T4 单一真源）—— 本地 Ollama 向量化（`/api/embed`）。
 *
 * ⚠️ 本接口是**主进程与渲染进程共用**的唯一类型定义：`electron/knowledge-base.ts`（降级链读配置）
 * 与设置页 UI 都从这里 import（主进程侧用 `import type`，纯类型文件 → 零运行时依赖）。
 * 默认值同样只有一份：`electron/utils/config-utils.ts` 的 `DEFAULT_LOCAL_EMBEDDING`
 * （`DEFAULT_GLOBAL_CONFIG.localEmbedding` 与 `readLocalEmbeddingConfig()` 共用它，避免双份漂移）。
 */
export interface LocalEmbeddingConfig {
  /** 是否启用本地档（默认 false → 降级链退回改造前的 api → llm → fts 三级） */
  enabled: boolean
  /** Ollama 服务地址（默认 http://localhost:11434） */
  baseUrl: string
  /** 本地向量模型名（默认 bge-m3） */
  model: string
  /** true=本地优先（local → api → llm → fts）；false=API 优先（api → local → llm → fts） */
  preferLocal: boolean
}

export interface GlobalConfig {
  theme: string
  defaultModelId: string | null
  defaultEmbeddingModelId?: string | null
  editorFontSize: number
  editorFontFamily: string
  autoSaveInterval: number
  /** Agent 空状态显示的最近会话条数（默认 3） */
  recentConversationCount?: number
  proxy?: {
    enabled: boolean
    type: 'http' | 'socks5'
    host: string
    port: number
  }
  /** 最近项目列表（打开项目时由渲染进程同步，活动聚合/历史导航读取） */
  recentProjects?: Array<{ name: string; path: string; updatedAt?: number }>
  /** 日志保留策略（双约束：数量 + 时间窗；设置 → 开发者 → 日志保留） */
  logRetention?: { files: number; days: number }
  /** LLM 并发配置（主进程启动时恢复，重启不丢） */
  concurrency?: { maxConcurrent: number; maxQueueSize: number }
  /** 模型路由三层配置（elite/standard/budget 模型 id 列表，重启不丢） */
  modelRoutes?: { elite: string[]; standard: string[]; budget: string[]; strategy?: 'static' | 'dynamic' }
  /**
   * 本地 Ollama 向量档（T4）。可选字段：缺字段/读失败 → 回退
   * `DEFAULT_GLOBAL_CONFIG.localEmbedding`（既有 GlobalConfig 可选字段模式）。
   */
  localEmbedding?: LocalEmbeddingConfig
  /** 开发者模式：接入外部程序 API（如本地浏览器服务），AI 工具 call_external_api 可调用 */
  devMode?: {
    enabled: boolean
    /** 外部 API 基础地址（http/https，如 http://localhost:9223） */
    apiBaseUrl: string
    /** 请求头（JSON 对象，如 {"Authorization": "Bearer xxx"}） */
    headers: Record<string, string>
    /** 请求超时（ms，默认 15000） */
    timeoutMs: number
  }
  /** 浏览器接入（内置 CDP 桥接）：Chrome/Edge 开 --remote-debugging-port 后开箱即用 */
  devBrowser?: {
    enabled: boolean
    /** CDP 调试端口（默认 9222，仅回环 127.0.0.1） */
    cdpPort: number
  }
}

// ===== 项目管理 =====
export interface ProjectChannels {
  'project:create': {
    args: [config: { name: string; path: string; genre: string; targetAudience: string }]
    return: { success: boolean; projectId: string; projectPath?: string; error?: string }
  }
  'project:open': {
    args: [projectPath: string]
    return: { success: boolean; project: ProjectData | null; error?: string }
  }
  'project:save': {
    args: [projectId: string, data: Partial<ProjectData>]
    return: { success: boolean; error?: string }
  }
  'project:update-config': {
    // ⚠️ novelConfig 是**部分字段**语义：主进程 `project:update-config` 逐字段判 `!== undefined`
    //   再做列更新（project-controller.ts）。契约必须写成 Partial，否则调用方会被类型逼着
    //   传整份配置 —— 而整份配置一旦来自**过期缓存**，就会把别的字段写回旧值（丢更新，真机实测：
    //   连续改 genre/subGenre/writingStyle 后前两个退回旧值）。
    args: [projectId: string, data: Partial<Omit<ProjectData, 'novelConfig'>> & { novelConfig?: Partial<NovelConfig> }]
    return: { success: boolean; error?: string }
  }
  'project:recent-list': {
    args: []
    return: Array<{ name: string; path: string; updatedAt: number }>
  }
  'project:delete-folder': {
    args: [projectPath: string]
    return: { success: boolean; error?: string }
  }
  'project:remove-recent': {
    args: [projectPath: string]
    return: { success: boolean }
  }
  'dialog:select-folder': {
    args: []
    return: string | null
  }
  'dialog:save-file': {
    args: [opts?: { defaultName?: string; title?: string }]
    return: string | null
  }
  'project:get-summary': {
    args: [projectPath: string]
    return: ProjectSummary | null
  }
}

export interface ProjectSummary {
  name: string
  path: string
  totalChapters: number
  /** 已定稿章节列表 */
  chapters: Array<{ chapterNumber: number; title: string; draftId?: number }>
  /** 有草稿的章节列表 */
  draftChapters: Array<{ chapterNumber: number; draftCount: number; hasFinalized: boolean; chapterTitle?: string }>
  /** 蓝图完成数 */
  blueprintCount: number
  /** 故事架构已生成数（premise/worldbuilding/characters_arch/synopsis 共 4 项） */
  archGenerated: number
}

/** 单日活动数据（本地时区按天聚合，GitHub 风格活动图数据源） */
export interface DailyActivityRow {
  day: string                  // 'YYYY-MM-DD'
  writtenWords: number         // 当天人工/导入写作字数
  writtenCount: number         // 当天创建草稿版本数
  revisedWords: number         // 当天修改字数（AI 重写 + 修稿）
  revisedCount: number         // 当天修改次数
  llmCalls: number             // 当天成功模型调用次数
  llmTokens: number            // 当天模型调用消耗 tokens
  llmCost: number              // 当天模型调用费用（美元）
  projectPath: string          // 来源项目路径
  projectName: string          // 来源项目名
}

/** 每日活动查询结果（跨项目聚合，days 带项目来源标记） */
export interface DailyActivityData {
  days: DailyActivityRow[]
  projects: Array<{ path: string; name: string }>
  startDay: string
  endDay: string
  dayCount: number
}

/** 用量统计 — 用途维度行 */
export interface UsageStatsByPurposeRow {
  purpose: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
}

/** 用量统计 — 模型维度行 */
export interface UsageStatsByModelRow {
  model: string
  calls: number
  cost: number
}

/** 用量统计查询结果（当前项目维度，success=1 口径，与 getStats 一致） */
export interface UsageStatsData {
  byPurpose: UsageStatsByPurposeRow[]
  byModel: UsageStatsByModelRow[]
  total: { calls: number; cost: number }
}

/** 全局用量统计 — 项目维度行（跨项目聚合；degraded=旧库缺 cached_tokens 列按 0 统计） */
export interface GlobalUsageProjectRow {
  path: string
  name: string
  calls: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
  degraded: boolean
}

/** 全局用量统计查询结果（所有最近项目 + 当前项目，success=1 口径；主进程 60s 缓存） */
export interface GlobalUsageStatsData {
  projects: GlobalUsageProjectRow[]
  total: { calls: number; cost: number; cachedTokens: number }
  degradedProjects: string[]
}

// ===== 文件系统 =====

/**
 * fs:read-file / fs:read-external-file 可选窗口读参数（C1，CC §三.9 剩余）：
 * 提供有效 offset/limit 时主进程走 [offset, offset+limit) 窗口读——超大文件流式扫描
 * （只累计窗口内内容，窗口外仅计数，RSS 有界），不受单次全量读取上限约束。
 * 窗口口径 = JS string.length（UTF-16 code unit），与渲染层 read_file offset/limit 契约一致。
 */
export interface ReadFileRangeOptions {
  /** 起始字符偏移（0 = 文件头）；<0 视为 0 */
  offset?: number
  /** 窗口长度（字符）；<1 视为未指定（回退全量读路径） */
  limit?: number
}

export interface FileChannels {
  'fs:read-file': {
    args: [filePath: string, options?: ReadFileRangeOptions]
    /**
     * 无 options：全文（≤ 全量上限安全网）；带 options：窗口切片。
     * totalChars：窗口扫描扫到文件尾时 = 文件总字符数（精确）；超大文件窗口早停截断时缺省。
     * beyond：主进程已证明 offset ≥ 文件总长（无内容返回）。
     */
    return: { success: boolean; content: string; totalChars?: number; beyond?: boolean; error?: string }
  }
  /**
   * 项目外文件只读（Agent 添加外部文件专用；扩展名 + 1MB 限制）。
   * L4 S8：**授权改由主进程签发** —— 原先渲染层可调 `fs:grant-external-file` 自报任意路径
   * （等于自己给自己发通行证），该通道已删除；现在由 `dialog:select-files` 等处理器
   * 在对话框结果处登记（见 electron/security/grants.ts）。
   */
  'fs:read-external-file': {
    args: [filePath: string, options?: ReadFileRangeOptions]
    return: { success: boolean; content: string; totalChars?: number; beyond?: boolean; error?: string }
  }
  'fs:write-file': {
    args: [filePath: string, content: string]
    return: { success: boolean; error?: string }
  }
  'fs:write-buffer': {
    args: [filePath: string, content: Uint8Array]
    return: { success: boolean; error?: string }
  }
  'fs:list-dir': {
    args: [dirPath: string]
    return: FileNode[]
  }
  'fs:mkdir': {
    args: [dirPath: string]
    return: { success: boolean; error?: string }
  }
  'fs:check-exists': {
    args: [filePath: string]
    return: boolean
  }
  'fs:delete-file': {
    args: [filePath: string]
    return: { success: boolean; error?: string }
  }
  'fs:read-json': {
    args: [filePath: string]
    return: { success: boolean; data: unknown; error?: string }
  }
  'fs:write-json': {
    args: [filePath: string, data: unknown]
    return: { success: boolean; error?: string }
  }
  'fs:agent-archive-list': {
    args: [];
    return: { id: string; title: string; updatedAt: number }[];
  },
  'fs:agent-archive-read': {
    args: [id: string];
    return: string | null;
  },
  'fs:agent-archive-write': {
    args: [id: string, content: string];
    return: { success: boolean };
  },
  'fs:agent-archive-delete': {
    args: [id: string];
    return: { success: boolean };
  },
  /** Agent 长工具结果落盘（P0-1 写盘引用）：主进程 sha1-12 哈希命名 + wx 防重；返回落盘绝对路径 */
  'fs:agent-result-write': {
    args: [content: string];
    return: { success: boolean; path?: string; error?: string };
  },
  /**
   * 工作流任务输出落盘（M2，CC 对比 §三.4）——渲染层在既有 100ms 共享 flush 点把步骤流式
   * 文本镜像到 `{VELA_HOME}/workflow-output/<runId>/<stepIndex>.txt`（补充通道，双轨）。
   * 主进程 open 'w'（截断）+ 显式字节偏移追加；同 key 串行队列保证字节序。
   */
  'fs:workflow-output-append': {
    args: [runId: string, stepIndex: number, text: string];
    return: { success: boolean; error?: string };
  },
  /** 读步骤输出文件尾部窗口（UI 1s 轮询 / 崩溃恢复续读） */
  'fs:workflow-output-tail': {
    args: [runId: string, stepIndex: number, options?: WorkflowOutputTailOptions];
    return: WorkflowOutputTailData;
  },
  /** 任务级清理：删除整 run 输出目录（完成/取消后调用；崩溃恢复前保留） */
  'fs:workflow-output-delete-run': {
    args: [runId: string];
    return: { success: boolean };
  },
}

/** 步骤输出文件 tail 读参数（M2；与 CC TaskOutput tail 4KB + 最近 1000 行对齐） */
export interface WorkflowOutputTailOptions {
  /** 尾部字节窗口（默认 4096；full=true 时忽略） */
  maxBytes?: number
  /** 窗口内行数上限（默认 1000；full=true 时忽略） */
  maxLines?: number
  /** true = 整文件读（崩溃恢复续读填充 step.result；忽略 maxBytes/maxLines） */
  full?: boolean
}

/** 步骤输出文件 tail 读结果 */
export interface WorkflowOutputTailData {
  success: boolean
  /** 文件是否存在（false 时 content 为空串——未落盘步骤/已清理任务） */
  exists: boolean
  /** 窗口内容（默认尾部 4KB / 最近 1000 行；full=true 时为全文） */
  content: string
  /** 文件当前总字节数（轮询增量判等 / 环形缓冲去重用） */
  totalBytes: number
  /** 是否因字节/行窗口发生截断（UI 可据此提示「仅显示尾部」） */
  truncated: boolean
  error?: string
}

// ===== LLM 调用 =====
export interface LLMChannels {
  'llm:generate': {
    args: [request: LLMRequest]
    return: LLMResponse
  }
  'llm:generate-stream': {
    args: [requestId: string, request: LLMRequest]
    return: { requestId: string; started: boolean }
  }
  'llm:cancel': {
    args: [requestId: string]
    return: { success: boolean }
  }
  'llm:concurrency-status': {
    args: []
    return: { activeCount: number; queueLength: number; maxConcurrent: number; maxQueueSize: number }
  }
  'llm:concurrency-config': {
    args: [config: { maxConcurrent?: number; maxQueueSize?: number }]
    return: { success: boolean }
  }
  'llm:set-routes': {
    args: [routes: { elite: string[]; standard: string[]; budget: string[] }]
    return: { success: boolean }
  }
  'llm:get-routes': {
    args: []
    return: { elite: string[]; standard: string[]; budget: string[] }
  }
  'llm:list-models': {
    args: []
    return: ModelProfile[]
  }
  'llm:save-model': {
    args: [model: ModelProfile]
    return: { success: boolean }
  }
  'llm:delete-model': {
    args: [modelId: string]
    // error 字段此前**没有声明**（而主进程一直会返回它）→ 渲染层即使想提示也无从取用；
    // 真机回归修复时一并补上。
    return: { success: boolean; error?: string }
  }
  'llm:set-default-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  // ===== 供应商账户（2026-09-25）：一份凭据挂多个模型 =====
  'llm:list-providers': {
    args: []
    /** apiKey 已解密（与 llm:list-models 同一约定：盘上密文、渲染层明文） */
    return: ProviderAccount[]
  }
  'llm:save-provider': {
    args: [account: ProviderAccount]
    /** 保存账户的同时，按其 modelNames 同步 models.json 里的派生条目 */
    return: { success: boolean; error?: string }
  }
  'llm:delete-provider': {
    args: [accountId: string]
    /** 删除账户及其全部派生模型条目。⚠️ 调用方须先做引用检查（见 provider-accounts.findModelReferences） */
    return: { success: boolean; error?: string }
  }
  'llm:list-provider-models': {
    args: [credentials: { provider: string; protocol: 'openai' | 'gemini'; apiKey: string; baseUrl: string }]
    /** 拉取供应商可用模型。中转/自建服务未实现该端点属预期 → success:false + 可操作 error */
    return: { success: boolean; models?: string[]; error?: string }
  }
  'llm:get-default-model': {
    args: []
    return: string | null
  }
  'llm:set-default-embedding-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-embedding-model': {
    args: []
    return: string | null
  }
  'llm:test-connection': {
    args: [model: ModelProfile]
    return: { success: boolean; error?: string }
  }
}

export interface LLMStreamEvents {
  'llm:stream-chunk': { requestId: string; chunk: string }
  'llm:stream-done': { requestId: string; fullText: string; usage?: TokenUsage }
  'llm:stream-error': { requestId: string; error: string }
}

// ===== 公共数据类型 =====
export interface ProjectData {
  id: string
  name: string
  path: string
  novelConfig: NovelConfig
  characterStates: string
  createdAt: number
  updatedAt: number
}

export interface NovelConfig {
  genre: string
  subGenre: string
  targetAudience: string
  totalChapters: number
  wordsPerChapter: number
  plotStructure: 'three_act' | 'heros_journey' | 'save_the_cat' | 'kishotenketsu' | 'multi_thread' | 'freeform'
  narrativePOV: 'third_limited' | 'first_person' | 'third_omniscient' | 'multi_pov'
  coreOutline: string
  worldSetting: string
  goldenFinger: string
  protagonistProfile: string
  globalGuidance: string
  writingStyle?: string
  referenceWorks?: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface LLMRequest {
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  stream?: boolean
  responseFormat?: { type: 'json_object' | 'text' }
  thinking?: boolean
  priority?: number
}

export interface LLMResponse {
  success: boolean
  content: string
  usage?: TokenUsage
  error?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** API 返回的真实缓存命中输入 token 数（OpenAI cached_tokens / DeepSeek prompt_cache_hit_tokens） */
  cachedTokens?: number
}

export interface ModelProfile {
  id: string
  name: string
  provider: 'openai' | 'gemini' | 'deepseek' | 'ollama' | 'bigmodel' | 'custom'
  protocol: 'openai' | 'gemini'
  modelName: string
  apiKey: string
  baseUrl: string
  temperature: number
  /** 单次请求最大**输出** token 数 —— 会作为 `max_tokens` 发给 API */
  maxTokens: number
  /**
   * 上下文窗口：输入 + 输出**总容量** —— 上下文占用条的分母、动态压缩预算用。
   *
   * ⚠️ 与 `maxTokens` 是**两件事，不可互相推导**。2026-09-25 之前二者是同一个字段，
   * 于是「占用条分母」和「发给 API 的输出上限」用了同一个数（预设一律写 131072）。
   * 旧配置缺本字段时由 `normalizeModelProfile`（llm-constants）补齐。
   */
  contextWindow: number
  purposes: Array<'generation' | 'refinement' | 'summary' | 'embedding'>
}

/**
 * 模型供应商账户 —— 一份凭据可挂多个模型（2026-09-25）。
 *
 * **存储位置**：`~/.novelforge/providers.json`。
 * **为什么是派生层而不是改 models.json 的形状**：`models.json` 有 10 个读点、
 * 凭据字段有 91 处引用；而路由/默认模型/会话**只按 id 引用模型** —— 故保持
 * `ModelProfile[]` 形状不变、由账户派生出条目，读点与引用一行都不用改。
 */
export interface ProviderAccount {
  id: string
  /** 与 `ModelProfile.provider` 同一个封闭联合 —— UI 从同一组选项里选，故是良性约束 */
  provider: ModelProfile['provider']
  protocol: 'openai' | 'gemini'
  apiKey: string
  baseUrl: string
  /** 已勾选的模型名 —— 勾选清单的唯一真相（逐个模型的显示名等设置住在 ModelProfile 上） */
  modelNames: string[]
}

// ===== 引入 DB 类型 =====
import type { ProjectCoreData } from '../../electron/repositories/project-core-repository'
import type { BlueprintData } from '../../electron/repositories/blueprint-repository'
import type { CharacterData, CharacterStateData } from '../../electron/repositories/character-repository'
import type { DraftMeta, DraftFull } from '../../electron/repositories/draft-repository'
import type { RevisionMeta, RevisionFull } from '../../electron/repositories/revision-repository'
import type { ReviewMeta, ReviewFull } from '../../electron/repositories/review-repository'
import type { PostProcessRunData, PostProcessStepData } from '../../electron/repositories/post-process-repository'
import type { VolumeData } from '../../electron/repositories/volume-repository'
import type { PreferenceData } from '../../electron/repositories/preference-repository'
import type { PublicationEntry } from '../../electron/repositories/publication-repository'
// L4 S1：health: 通道（类型仅用于 HealthChannels；`import type` 会被完全擦除，不产生运行时依赖）
import type { HealthStatus } from '../../electron/controllers/health-check'

// ===== 数据库操作 =====
export interface DatabaseChannels {
  'db:close': { args: []; return: { success: boolean } }

  // 1. project_core
  'db:project-core-get': { args: []; return: ProjectCoreData | null }
  'db:project-core-update': { args: [data: Partial<ProjectCoreData>]; return: { success: boolean; error?: string } }

  // 2. blueprints
  'db:blueprint-get-all': { args: []; return: BlueprintData[] }
  'db:blueprint-get-all-sorted': { args: [config: { key: string; direction: string }]; return: BlueprintData[] }
  'db:blueprint-get': { args: [chapterNumber: number]; return: BlueprintData | null }
  'db:blueprint-upsert': { args: [data: BlueprintData]; return: { success: boolean; error?: string } }
  'db:blueprint-upsert-many': { args: [items: BlueprintData[]]; return: { success: boolean; error?: string } }
  'db:blueprint-update-notes': { args: [chapterNumber: number, notes: string]; return: { success: boolean; error?: string } }
  'db:blueprint-delete': { args: [chapterNumber: number]; return: { success: boolean; error?: string } }
  'db:blueprint-get-gaps': { args: [totalChapters: number]; return: number[] }
  'db:blueprint-update-sort-order': { args: [orders: Array<{ chapterNumber: number; sortOrder: number }>]; return: { success: boolean; error?: string } }
  'db:blueprint-update-priority': { args: [chapterNumber: number, priority: number]; return: { success: boolean; error?: string } }
  'db:blueprint-update-priority-batch': { args: [items: Array<{ chapterNumber: number; priority: number }>]; return: { success: boolean; error?: string } }

  // 3. characters
  'db:character-get-all': { args: []; return: CharacterData[] }
  'db:character-upsert': { args: [data: CharacterData]; return: { success: boolean; error?: string } }
  'db:character-save-all': { args: [items: CharacterData[]]; return: { success: boolean; error?: string } }
  'db:character-delete': { args: [name: string]; return: { success: boolean; error?: string } }
  'db:character-merge': { args: [target: string, source: string]; return: { success: boolean; error?: string } }
  'db:character-update-appearance-stats': { args: [name: string, stats: { appearCount: number; firstChapter: number; lastChapter: number }]; return: { success: boolean; error?: string } }
  'db:character-update-state': { args: [name: string, state: CharacterStateData, extra?: { tags?: string | null; motivation?: string | null }]; return: { success: boolean; error?: string } }
  'db:character-merge-fields': { args: [name: string, fields: Record<string, string>]; return: { success: boolean; error?: string } }

  // 4. drafts
  'db:draft-create': { args: [params: { chapterNumber: number; version: number; source: 'write' | 'rewrite' | 'translation'; content: string; wordCount: number }]; return: { success: boolean; id?: number; error?: string } }
  'db:publication-list': { args: []; return: PublicationEntry[] }
  'db:publication-save': { args: [input: { chapterNumber: number; title: string; content: string; terms?: string[] }]; return: { success: boolean; error?: string } }
  'db:publication-delete': { args: [chapterNumber: number]; return: { success: boolean } }
  'db:draft-list': { args: [chapterNumber: number]; return: DraftMeta[] }
  'db:draft-get-meta': { args: [id: number]; return: DraftMeta | null }
  'db:draft-get-full': { args: [id: number]; return: DraftFull | null }
  'db:draft-get-latest': { args: [chapterNumber: number]; return: DraftMeta | null }
  'db:draft-get-finalized': { args: [chapterNumber: number]; return: DraftMeta | null }
  'db:draft-get-max-finalized-chapter': { args: []; return: number }
  'db:draft-get-all-chapter-numbers': { args: []; return: number[] }
  'db:draft-next-version': { args: [chapterNumber: number]; return: number }
  'db:draft-update-status': { args: [id: number, status: string, wordCount?: number]; return: { success: boolean; error?: string } }
  'db:draft-update-content': { args: [id: number, content: string, wordCount: number]; return: { success: boolean; error?: string } }

  // 5. revisions
  'db:revision-create': { args: [params: { baseDraftId: number; revisionIndex: number; revisionType: 'refine' | 'review-fix'; userPrompt?: string; reviewSourceId?: number; content: string; wordCount: number }]; return: { success: boolean; id?: number; error?: string } }
  'db:revision-list': { args: [baseDraftId: number]; return: RevisionMeta[] }
  'db:revision-get-pending': { args: [baseDraftId: number]; return: RevisionMeta[] }
  'db:revision-get-full': { args: [id: number]; return: RevisionFull | null }
  'db:revision-next-index': { args: [baseDraftId: number]; return: number }
  'db:revision-mark-merged': { args: [id: number, mergedToDraftId: number]; return: { success: boolean; error?: string } }
  'db:revision-mark-discarded': { args: [id: number]; return: { success: boolean; error?: string } }

  // checkpoint — 工作流 checkpoint（L2：迁 DB，跨项目隔离）
  'db:checkpoint-save': { args: [data: unknown]; return: { success: boolean; error?: string } },
  'db:checkpoint-load': { args: []; return: { success: boolean; data?: unknown; error?: string } },
  'db:checkpoint-clear': { args: []; return: { success: boolean; error?: string } },

  // automation — 写作自动化（D 档：任务 / 收件箱 / 运行记录）
  // 返回以 unknown 承载实体（shared 层不依赖 services 的类型定义，与 checkpoint 通道同风格；
  // 渲染层在 automation-store 侧断言为 AutomationTask / InboxItem / AutomationRun）
  'db:automation-list': { args: []; return: { success: boolean; tasks?: unknown[]; error?: string } },
  'db:automation-save': { args: [task: unknown]; return: { success: boolean; error?: string } },
  'db:automation-delete': { args: [id: string]; return: { success: boolean; error?: string } },
  'db:automation-set-enabled': { args: [id: string, enabled: boolean]; return: { success: boolean; error?: string } },
  'db:automation-trigger-states': { args: []; return: { success: boolean; states?: Record<string, unknown>; error?: string } },
  'db:automation-apply-outcome': { args: [input: unknown]; return: { success: boolean; error?: string } },
  'db:automation-inbox-list': { args: []; return: { success: boolean; items?: unknown[]; error?: string } },
  'db:automation-inbox-update': { args: [id: string, patch: unknown]; return: { success: boolean; error?: string } },
  'db:automation-run-append': { args: [run: unknown]; return: { success: boolean; error?: string } },
  'db:automation-run-update': { args: [id: string, patch: unknown]; return: { success: boolean; error?: string } },
  'db:automation-running-runs': { args: []; return: { success: boolean; runs?: unknown[]; error?: string } },
  'db:automation-finalized-chapters': { args: []; return: { success: boolean; chapters?: Array<{ number: number; title: string; wordCount: number }>; error?: string } },
  'db:automation-chapter-texts': { args: []; return: { success: boolean; texts?: Record<string, string>; error?: string } },

  // 6. reviews
  'db:review-create': { args: [params: { baseDraftId: number; reviewIndex: number; content: string }]; return: { success: boolean; id?: number; error?: string } }
  'db:review-list': { args: [baseDraftId: number]; return: ReviewMeta[] }
  'db:review-get-latest': { args: [baseDraftId: number]; return: ReviewFull | null }
  'db:review-get-full': { args: [id: number]; return: ReviewFull | null }
  'db:review-next-index': { args: [baseDraftId: number]; return: number }

  // 互评评价
  'db:evaluation-create': {
    args: [params: {
      draftId: number
      perspective: string
      scores: string
      overallScore: number
      strengths: string
      weaknesses: string
      suggestions: string
      rawResponse: string
      tokensUsed: number
    }]
    return: { success: boolean; id?: number; error?: string }
  }
  'db:evaluation-list-by-draft': { args: [draftId: number]; return: unknown[] }

  // 7. post_process
  'db:post-process-create-run': { args: [params: { triggerSourceType: string; triggerSourceId: string; sourceLabel: string; steps: Array<{ key: string; label: string; critical: boolean }> }]; return: { success: boolean; id?: string; error?: string } }
  'db:post-process-get-latest-run': { args: [sourceType: string, sourceId: string]; return: PostProcessRunData | null }
  'db:post-process-get-steps': { args: [runId: string]; return: PostProcessStepData[] }
  'db:post-process-mark-step-ok': { args: [runId: string, stepKey: string]; return: { success: boolean; error?: string } }
  'db:post-process-mark-step-failed': { args: [runId: string, stepKey: string, errorMsg: string]; return: { success: boolean; error?: string } }
  'db:post-process-is-all-passed': { args: [sourceType: string, sourceId: string]; return: boolean }

  // 沿用旧表
  'db:log-llm-call': { args: [call: Record<string, unknown>]; return: { success: boolean } }
  'db:get-llm-stats': { args: []; return: { totalCalls: number; totalTokens: number; totalPromptTokens: number; totalCompletionTokens: number } }
  'db:get-llm-history': { args: [limit?: number]; return: unknown[] }
  // 用量统计（当前项目维度：purpose/模型两维度 + 合计；区间过滤毫秒时间戳）
  'db:usage-stats': { args: [range: { from: number; to: number }]; return: UsageStatsData }
  // 全局用量统计（跨项目聚合：项目维度表 + 合计；旧库缺 cached_tokens 列按 0 统计并标记 degraded）
  'db:usage-stats-global': { args: []; return: GlobalUsageStatsData }
  'db:get-daily-activity': { args: [days?: number, projectPath?: string, currentProjectPath?: string]; return: DailyActivityData }
  'config:set-locale': { args: [locale: 'zh-CN' | 'en-US' | 'ru-RU']; return: { success: boolean } }
  'db:save-summary-snapshot': { args: [chapterNumber: number, characterStates: string]; return: { success: boolean } }
  'db:get-latest-summary': { args: []; return: { characterStates: string; chapterNumber: number } | null }

  // 13. volumes — 分卷
  'db:volume-get-all': { args: []; return: VolumeData[] }
  'db:volume-get-by-chapter': { args: [chapterNumber: number]; return: VolumeData | null }
  'db:volume-upsert': { args: [data: VolumeData]; return: { success: boolean; error?: string } }
  'db:volume-delete': { args: [volumeNumber: number]; return: { success: boolean; error?: string } }

  // 14. preferences — 偏好记忆
  'db:preference-record': { args: [aiText: string, userText: string, chapterNumber?: number]; return: { success: boolean; error?: string } }
  'db:preference-get-top': { args: [limit: number, recentChapters?: number]; return: PreferenceData[] }
}

// ===== 知识库频道 =====
export interface KnowledgeBaseChannels {
  'kb:import-document': { args: [filePath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string } }
  'kb:import-folder': { args: [folderPath: string]; return: { success: boolean; importedCount: number; failedFiles: string[]; error?: string } }
  'kb:import-text': { args: [text: string, fileName: string, projectPath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string } }
  'kb:search': { args: [query: string, topK?: number]; return: Array<{ text: string; score: number; fileName: string }> }
  'kb:search-with-scope': { args: [query: string, fromChapter: number, toChapter: number, topK?: number]; return: Array<{ text: string; score: number; fileName: string }> }
  'kb:list-documents': { args: []; return: Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string }> }
  'kb:remove-document': { args: [docId: string]; return: { success: boolean } }
  'kb:stats': { args: []; return: { documentCount: number; totalChunks: number; vectorDimension: number } }
  'dialog:select-files': { args: []; return: string[] | null }
  'dialog:select-import-folder': { args: []; return: string | null }
  'kb:get-vectorless-count': { args: []; return: { count: number } }
  'kb:backfill-vectors': {
    args: []
    /**
     * `errorCode: 'dim-mismatch'`（T4/A4.2）= 维度不匹配的**终态**错误：调用方（与渲染层日志）
     * 据此判定「不得降级到别的写入路径」，而不是把它当成可重试/可降级的一般失败。
     */
    return: { success: boolean; processed: number; failed: number; error?: string; errorCode?: 'dim-mismatch' }
  }
  'kb:backfill-tokens': { args: []; return: { success: boolean; processed: number; failed: number; error?: string } }
}

// ===== 向量嵌入 =====
export interface EmbeddingChannels {
  'embedding:generate': {
    args: [text: string]
    return: { success: boolean; vector?: number[]; tokens?: number; error?: string }
  }
  'embedding:generate-batch': {
    args: [texts: string[]]
    return: { success: boolean; vectors?: number[][]; tokens?: number; error?: string }
  }
  'embedding:compare': {
    args: [query: string, candidates: string[]]
    return: { success: boolean; similarities?: Array<{ text: string; score: number }>; error?: string }
  }
  'embedding:similarity-search': {
    args: [queryVector: number[], candidates: Array<{ vector: number[]; metadata: unknown }>, topK: number, threshold?: number]
    return: { success: boolean; results?: Array<{ similarity: number; metadata: unknown; index: number }>; error?: string }
  }
  'embedding:get-model': {
    args: []
    return: { modelId: string; protocol: string; modelName: string; baseUrl: string; apiKey: string; dimensions: number } | null
  }
  'embedding:set-model': {
    args: [config: { modelId: string; protocol: string; modelName: string; baseUrl: string; apiKey: string; dimensions: number }]
    return: { success: boolean; error?: string }
  }
  'embedding:list-models': {
    args: []
    return: Array<{ id: string; name: string; modelName: string; protocol: string; purposes?: string[] }>
  }
  'embedding:cache-stats': {
    args: []
    return: { size: number; hits: number; misses: number; hitRate: number }
  }
  'embedding:clear-cache': {
    args: []
    return: { success: boolean }
  }
  // LLM 向量化
  'embedding:get-llm-config': {
    args: []
    return: { enabled: boolean; model: ModelProfile | null; dimensions: number; promptTemplate: string }
  }
  'embedding:set-llm-config': {
    args: [config: { enabled?: boolean; model?: ModelProfile | null; dimensions?: number; promptTemplate?: string }]
    return: { success: boolean; error?: string }
  }
  'embedding:test-llm': {
    args: [text: string]
    return: { success: boolean; vector?: number[]; dimensions?: number; tokens?: number; error?: string }
  }
  'embedding:generate-with-llm': {
    args: [texts: string[]]
    return: { success: boolean; vectors?: number[][]; tokens?: number; error?: string }
  }
  'embedding:list-llm-candidates': {
    args: []
    return: ModelProfile[]
  }
  // L4 S1 声明补齐：此前已注册（embedding-controller.ts:153/158）但无类型声明
  'embedding:dedup-stats': {
    args: []
    return: { size: number; totalHits: number }
  }
  'embedding:clear-dedup': {
    args: []
    return: { success: boolean }
  }
  // ===== 本地 Ollama 向量档（T4）=====
  // ⚠️ 四条探测/拉取通道**不收任何渲染层入参**：baseUrl/model 一律由主进程从全局配置读取。
  //    若允许渲染层传 baseUrl，被 XSS 的渲染层就能让主进程向任意内网地址发请求
  //    （与 L4 S10 对 mcp:connect 的收紧同一理由）。
  /** 探测 Ollama 是否可用（三态不抛） */
  'embedding:local-detect': {
    args: []
    return: { ok: boolean; version?: string; error?: string }
  }
  /** 列出本地已安装模型 */
  'embedding:local-list-models': {
    args: []
    return: Array<{ name: string; size: number }>
  }
  /**
   * 拉取/更新本地模型：**仅发起**，立即返回（不 await 下载完成——规避 30s IPC 超时）。
   * 下载进度经事件 `embedding:local-pull-progress` 推送。
   */
  'embedding:local-pull': {
    args: []
    return: { started: boolean; error?: string }
  }
  /** 用配置的模型实测一次向量化，返回向量维度（设置页「测试」按钮） */
  'embedding:local-test': {
    args: []
    return: { success: boolean; dim?: number; error?: string }
  }
  /**
   * 读本地向量档配置。返回值**恒为完整配置**（缺字段/损坏时已由主进程回退默认值）——
   * 因此比 `GlobalConfig['localEmbedding']`（含 undefined）更窄，渲染层无需再处理 undefined。
   */
  'embedding:local-get-config': {
    args: []
    return: LocalEmbeddingConfig
  }
  /** 写本地向量档配置（部分更新，合并写回；不覆盖其它全局配置字段） */
  'embedding:local-set-config': {
    args: [config: Partial<LocalEmbeddingConfig>]
    return: { success: boolean; error?: string }
  }
}

// ===== 导入小说 =====
export interface ImportChannels {
  'dialog:select-novel-files': { args: []; return: string[] | null }
  'import:split-chapters': {
    args: [filePaths: string[], options?: { separator?: string }]
    return: {
      success: boolean
      chapters: Array<{ number: number; title: string; content: string; wordCount: number }>
      totalWords: number
      error?: string
    }
  }
}

// ===== MCP =====
export interface MCPChannels {
  'mcp:load-config': { args: [configPath?: string]; return: { success: boolean; configs: unknown[]; error?: string } }
  /**
   * 连接 MCP 服务器。
   * L4 S10：参数由**完整配置**改为 **serverId** —— command/args/env 必须来自主进程落盘的
   * 配置文件（改造前渲染层可传任意 command，直通 spawn = 任意代码执行）。
   */
  'mcp:connect': { args: [serverId: string]; return: { success: boolean; error?: string } }
  'mcp:disconnect': { args: [serverId: string]; return: { success: boolean; error?: string } }
  'mcp:disconnect-all': { args: []; return: { success: boolean; error?: string } }
  'mcp:list-tools': { args: []; return: unknown[] }
  'mcp:list-resources': { args: []; return: unknown[] }
  'mcp:call-tool': { args: [serverId: string, toolName: string, args: Record<string, unknown>]; return: { success: boolean; content: string; error?: string } }
  'mcp:get-servers-status': { args: []; return: unknown[] }
  'mcp:get-config-path': { args: []; return: string },
  'mcp:add-server': {
    args: [{ id: string; command: string; args?: string[]; env?: Record<string, string> }]
    return: { success: boolean; error?: string }
  },
  'mcp:remove-server': {
    args: [serverId: string]
    return: { success: boolean; error?: string }
  },
  'skill:list': {
    args: []
    return: Array<{ name: string; description: string }>
  },
  'skill:import': {
    args: [{ name: string; content: string }]
    return: { success: boolean; error?: string }
  },
  'skill:delete': {
    args: [name: string]
    return: { success: boolean; error?: string }
  },
  'dialog:select-skill-file': {
    args: []
    return: { name: string; content: string } | null
  }
}

// ===== 应用更新 =====
export interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

export interface UpdateInfo {
  version: string
  releaseDate: string
  releaseNotes?: string
  files: Array<{ url: string; size: number }>
}

export interface UpdateChannels {
  'update:check': {
    args: []
    return: { hasUpdate: boolean; info?: UpdateInfo; error?: string }
  }
  'update:download': {
    args: []
    return: { success: boolean; error?: string }
  }
  'update:install': {
    args: []
    return: { success: boolean; error?: string }
  }
  'update:get-version': {
    args: []
    return: { currentVersion: string; appName: string }
  }
  /**
   * 让窗口控件覆盖层（Windows 的 WCO / 标题栏那条）跟随应用主题。
   *
   * ⚠️ 颜色由**渲染层算好推过来**，主进程不复制调色板 —— 否则主题令牌就有了两份定义，
   * 必然漂移（本项目吃过一次「四主题里有个令牌没定义」的亏）。
   * 参数取 `getComputedStyle(document.documentElement)` 的**已解析值**，
   * 所以 CSS 变量改成什么这里就跟着是什么。
   */
  'window:set-titlebar-overlay': {
    args: [overlay: { color: string; symbolColor: string }]
    return: void
  }
  'update:get-status': {
    args: []
    return: { status: UpdateStatus; info?: UpdateInfo; progress?: UpdateProgressInfo; error?: string }
  }
  'uninstall:trigger': {
    args: []
    return: { success: boolean; error?: string }
  }
  'uninstall:clean-user-data': {
    args: []
    return: { success: boolean; error?: string }
  }
  'update:open-releases': {
    args: []
    return: { success: boolean }
  }
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update'

export interface UpdateEvents {
  'update:status-changed': { status: UpdateStatus; info?: UpdateInfo; error?: string }
  'update:download-progress': { progress: UpdateProgressInfo }
}

// ===== 导出频道 =====
export interface ExportChannels {
  'export:export-chapters': {
    args: [params: {
      chapterNumbers?: number[]
      format: 'zip' | 'folder'
      fileFormat: 'md' | 'txt'
      outputPath: string
      projectName: string
    }]
    return: { success: boolean; path?: string; chapterCount?: number; error?: string }
  }
  'export:select-output-dir': {
    args: []
    return: string | null
  }
}

// ===== 开发者模式频道（外部 API 接入） =====

export interface DevApiRequest {
  /** 相对路径（base URL 由主进程从配置读取——LLM 只能调配置的端点，防任意 URL） */
  path: string
  /** HTTP 方法（默认 GET） */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** 请求体（JSON 字符串，POST/PUT/PATCH 时） */
  body?: string
}

export interface DevApiResponse {
  success: boolean
  /** 响应文本（截断至 1MB） */
  content?: string
  /** HTTP 状态码 */
  status?: number
  error?: string
}

export interface DevChannels {
  /** 调用开发者模式配置的外部 API（主进程代理 fetch，绕过渲染 CSP） */
  'dev:invoke': {
    args: [req: DevApiRequest]
    return: DevApiResponse
  }
  /** 测试连接（设置页"测试连接"按钮：GET baseUrl 根路径；apiBaseUrl 可选覆盖——未保存也能测 UI 当前值） */
  'dev:test': {
    args: [override?: { apiBaseUrl?: string }]
    return: { success: boolean; status?: number; error?: string }
  }
}

// ===== 浏览器接入频道（内置 CDP 桥接） =====

/** 浏览器标签页信息（CDP /json 返回精简） */
export interface BrowserTabInfo {
  id: string
  title: string
  url: string
  type: string
}

export interface TemplateChannels {
  /** 模板元信息列表（不含 data） */
  'templates:list': {
    args: []
    return: Array<{ name: string; description: string }>
  }
  /** 获取完整模板 data（应用模板时填充） */
  'templates:get': {
    args: [name: string]
    return: Record<string, unknown> | null
  }
  /** 保存模板（校验 schema + 名称清洗防穿越） */
  'templates:save': {
    args: [input: { name: string; description?: string; data: Record<string, unknown> }]
    return: { success: boolean; error?: string }
  }
  /** 删除模板 */
  'templates:delete': {
    args: [name: string]
    return: { success: boolean }
  }
}

export interface ReportChannels {
  /** 渲染 HTML 并离屏截图（年度报告/分享卡生成链路） */
  'report:render-html': {
    args: [html: string]
    return: { success: boolean; png?: Uint8Array; error?: string }
  }
}

export interface BrowserChannels {
  /** 查询浏览器标签页列表（GET http://127.0.0.1:{port}/json，按 title/url 排序） */
  'browser:list-tabs': {
    args: []
    return: { success: boolean; tabs?: BrowserTabInfo[]; error?: string }
  }
  /** 测试 CDP 连接（GET /json/version；cdpPort 可选覆盖——未保存也能测 UI 当前值） */
  'browser:test': {
    args: [override?: { cdpPort?: number }]
    return: { success: boolean; version?: string; error?: string }
  }
}

// ===== 日志频道 =====

/** 日志环境（对应主进程双环境日志流：dev=开发/内测，release=公测/正式） */
export type LogEnvMode = 'dev' | 'release'

/** 日志文件信息 */
export interface LogFileInfo {
  /** 日志环境 */
  env: LogEnvMode
  /** 文件名（如 vela-2026-08-05.log / vela-dev-2026-08-05.log） */
  name: string
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间戳（ms） */
  mtime: number
}

export interface LogChannels {
  /** 渲染进程写入主进程日志文件（fire-and-forget，调用方自行控制频率） */
  'log:write': {
    args: [level: 'debug' | 'info' | 'warn' | 'error', source: string, message: string]
    return: { success: boolean }
  }
  /** 获取指定环境今天的日志文件内容（默认当前环境） */
  'log:get-today': {
    args: [env?: LogEnvMode, maxLines?: number]
    return: string
  }
  /** 列出两个环境的日志文件（新→旧） */
  'log:list-files': {
    args: []
    return: Array<{ env: LogEnvMode; files: LogFileInfo[] }>
  }
  /** 读取指定环境的日志文件内容（maxLines 截断，只返回尾部 N 行；totalLines 为文件总行数） */
  'log:read-file': {
    args: [env: LogEnvMode, fileName: string, maxLines?: number]
    return: { success: boolean; content?: string; totalLines?: number; error?: string }
  }
  /** 在系统文件管理器中打开日志目录 */
  'log:open-dir': {
    args: []
    return: { success: boolean; error?: string }
  }
}

// ===== 作品记忆频道（三级摘要文件：章节/分卷/全书 + 跨会话共享事实，.novelforge/memory/*.md） =====
export interface MemoryChannels {
  'memory:list': {
    args: []
    return: Array<{ file: string; kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'; range?: string; stale: boolean; mtime: number }>
  }
  'memory:read': {
    args: [file: string]
    return: string | null
  }
  'memory:write': {
    args: [file: string, content: string]
    return: { success: boolean }
  }
  'memory:mark-stale': {
    args: [file: string]
    return: { success: boolean }
  }
  'memory:delete': {
    args: [file: string]
    return: { success: boolean }
  }
}

// ===== 输出风格（写作风格 .md 零代码注册；styles/*.md，项目级覆盖用户级） =====

/** 风格元信息（列表返回，不含 promptBody） */
export interface StyleInfo {
  /** 风格名（= 文件名去 .md） */
  name: string
  /** 描述（frontmatter description，可为空） */
  description: string
}

/** 完整风格（get 返回，含正文 prompt——写稿注入用） */
export interface StyleMeta extends StyleInfo {
  /** 正文（写作风格指令，LLM 注入 writing_style 变量用） */
  promptBody: string
}

export interface StyleChannels {
  /** 合并列表（项目覆盖用户；按 name 排序；不含 promptBody） */
  'styles:list': {
    args: [projectPath: string]
    return: StyleInfo[]
  }
  /** 单风格（含 promptBody；非法名/不存在 → null） */
  'styles:get': {
    args: [projectPath: string, name: string]
    return: StyleMeta | null
  }
}

// ===== 健康检查（L4 S1 声明补齐：此前已注册但零声明，preload 却已放行 health: 前缀） =====
export interface HealthChannels {
  'health:check': { args: [projectPath?: string]; return: HealthStatus }
  'health:check-llm': {
    args: [baseUrl: string, apiKey: string]
    return: { ok: boolean; message: string; detail?: string }
  }
}

// ===== 导入进度事件（L4 S1 补充：此前两侧均未声明） =====
export interface ImportEvents {
  'import:progress': { filePath: string; bytesRead: number; totalBytes: number }
}

// ===== 本地 Ollama 拉取进度事件（T4：主→渲染，payload 同 T2 的 PullProgress） =====
export interface EmbeddingEvents {
  /**
   * 模型下载进度帧（`pullModel` 的 NDJSON 每帧一条；percent 仅在 completed/total 就绪时给出）。
   *
   * `status: 'error'` 是**终态失败帧**（FW-1）：T2 的 `pullModel` 把 Ollama 的 `{"error"}` 帧
   * 消费成返回值后不再 emit（ollama-embedding.ts:174-177），所以「下载跑到一半失败」对渲染层
   * 本来完全不可见（进度条永久停在最后一帧、下载按钮永久 disabled）。该帧由控制器从自己的
   * `.then/.catch` 合成：`error` 为原始技术串（英文），渲染层只放进可折叠「原始详情」，
   * 主文案走 `localEmbedding.pullFailed`。
   */
  /**
   * 智能下载（2026-09-25）新增的可选字段：`path`/`pathLabel` 是当前所用网络路径，
   * `bytesPerSec` 是实测速率，`switchedFrom` 表示**这一帧之前刚发生过换路**（一次性标记，
   * 附在换路后的第一帧上——独立发一帧会把 percent 冲成 0，进度条会跳回起点）。
   * 三个字段都可选：回退到 Ollama 自身 pull 时不会带它们。
   */
  'embedding:local-pull-progress': {
    status: string
    completed?: number
    total?: number
    percent?: number
    error?: string
    path?: 'direct' | 'proxy'
    pathLabel?: string
    bytesPerSec?: number
    switchedFrom?: string
  }
}

// ===== 菜单事件（L4 S1 补充：此前两侧均未声明） =====
export interface MenuEvents {
  'menu:check-update': void
}

// ===== 合并所有频道 =====
export type AllInvokeChannels = ConfigChannels & ProjectChannels & FileChannels & LLMChannels & DatabaseChannels & KnowledgeBaseChannels & EmbeddingChannels & ImportChannels & MCPChannels & UpdateChannels & ExportChannels & LogChannels & DevChannels & BrowserChannels & ReportChannels & TemplateChannels & MemoryChannels & StyleChannels & HealthChannels
export type AllEventChannels = LLMStreamEvents & UpdateEvents & ImportEvents & MenuEvents & EmbeddingEvents

/** 提取 invoke 频道名 */
export type InvokeChannel = keyof AllInvokeChannels

/** 提取 event 频道名 */
export type EventChannel = keyof AllEventChannels
