export interface CheckpointData {
  activeRuns: WorkflowRun[]
  waitingRuns: Record<string, { waitingForConfirm: boolean; waitingAfterStepIndex: number }>
  savedAt: string
  /** runId → 重建信息（type + params 快照）；L2 迁 DB 起持久化，供 rehydrateWorkflow 重建 definition */
  runDefs?: Record<string, { type: WorkflowType; params: WorkflowParams }>
  /** runId → context.data 快照（executor 跨步骤共享数据；无则省略） */
  contextData?: Record<string, Record<string, unknown>>
}

/** 工作流步骤状态 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 工作流运行状态 */
export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused' | 'waiting'

/** 工作流步骤 */
export interface WorkflowStep {
  id: string
  name: string
  description: string
  status: StepStatus
  progress?: number
  result?: string
  error?: string
  startedAt?: string
  completedAt?: string
  logs: string[]
  /** 允许命令注入额外属性（如 commandId, params 等） */
  [extra: string]: unknown
}

/** 工作流运行实例 */
export interface WorkflowRun {
  id: string
  type: WorkflowType
  title: string
  status: WorkflowStatus
  steps: WorkflowStep[]
  currentStepIndex: number
  createdAt: string
  completedAt?: string
  /** L2：可重建参数快照（rehydrateParams；Task 5 save 消费；confirmContinue 跨重启重放读） */
  rehydrateParams?: WorkflowParams
}

/** 工作流类型 */
export type WorkflowType =
  | 'new_project_setup'       // 新项目初始化（配置→架构→目录）
  | 'architecture_generation' // 架构生成（故事前提→角色图谱→世界观→情节大纲）
  | 'directory'               // 目录/蓝图生成
  | 'chapter_creation'        // 章节创作（写稿→修稿→审稿→定稿）
  | 'book_pipeline'           // 整本流水线（逐章写稿→自审→定稿→索引/记忆）
  | 'batch_generate'          // 批量生成
  | 'config_generation'       // 智能配置生成
  | 'post_process'            // 后处理任务（角色卡提取等）
  | 'novel_import'            // 导入已有小说（逆向推演全流程）

/** 工作流步骤执行器 */
export type StepExecutor = (
  step: WorkflowStep,
  context: WorkflowContext,
  callbacks: StepCallbacks,
) => Promise<string | void>

/** 工作流上下文（共享数据） */
export interface WorkflowContext {
  /** 步骤间传递的数据 */
  data: Record<string, unknown>
  /** 是否已取消 */
  cancelled: boolean
}

/** 步骤回调 */
export interface StepCallbacks {
  /** 追加日志 */
  log: (message: string) => void
  /** 更新进度 (0-100) */
  setProgress: (progress: number) => void
  /** 流式文本追加 */
  appendText: (text: string) => void
}

// ===== 工作流定义 =====

/** 工作流完成后的通知/跳转动作 */
export interface WorkflowCompleteAction {
  /** 通知策略：open=直接打开 | silent=仅内部状态不额外动作 */
  mode: 'open' | 'silent'
  /** 成功时的提示文案（备用，供日志用） */
  message?: string
  /** 打开结果的回调（open 模式直接调用） */
  openResult?: () => void | Promise<void>
}

export type WorkflowParams = Record<string, unknown>

export interface WorkflowDefinition {
  type: WorkflowType
  title: string
  steps: Array<{
    name: string
    description: string
    executor: StepExecutor
  }>
  /** 工作流完成后的通知/跳转动作（可选） */
  onComplete?: WorkflowCompleteAction
  /** L2：可重建参数快照（type + 此 params → rehydrateWorkflow 重建定义；零改动调用点，方案 ii） */
  rehydrateParams?: WorkflowParams
}

// ===== Store =====

