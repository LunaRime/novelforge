/**
 * NovelForge Agent 进度追踪器 — 追踪 Agent 任务的执行进度
 *
 * 提供：
 * 1. 阶段追踪（思考 / 工具执行 / 生成）
 * 2. 步骤计数和进度百分比
 * 3. 耗时和 Token 估算
 * 4. 实时状态快照
 */

// ===== 类型定义 =====

/** Agent 执行阶段 */
export type AgentPhase = 'thinking' | 'tool_execution' | 'generating' | 'done'

/** Agent 进度快照 */
export interface AgentProgress {
  /** 当前阶段 */
  phase: AgentPhase
  /** 当前工具名称（tool_execution 阶段） */
  currentTool?: string
  /** 当前工具序号 / 总工具数 */
  toolIndex: number
  totalTools: number
  /** 已完成步骤数 */
  completedSteps: number
  /** 总步骤数 */
  totalSteps: number
  /** 已消耗 Token 估算 */
  tokensUsed: number
  /** 已用时间（毫秒） */
  elapsedMs: number
  /** 进度百分比 (0-100) */
  percentage: number
  /** 状态描述 */
  description: string
}

// ===== 进度追踪器 =====

export class ProgressTracker {
  private startTime = 0
  private phase: AgentPhase = 'thinking'
  private currentTool = ''
  private toolIndex = 0
  private totalTools = 0
  private completedSteps = 0
  private totalSteps = 0
  private tokensUsed = 0
  private description = ''

  /** 开始追踪 */
  start(totalSteps: number): void {
    this.startTime = Date.now()
    this.totalSteps = totalSteps
    this.completedSteps = 0
    this.toolIndex = 0
    this.totalTools = 0
    this.tokensUsed = 0
    this.phase = 'thinking'
    this.description = '正在思考...'
  }

  /** 设置阶段 */
  setPhase(phase: AgentPhase): void {
    this.phase = phase
    switch (phase) {
      case 'thinking':
        this.description = '正在思考...'
        break
      case 'tool_execution':
        this.description = `正在执行工具: ${this.currentTool}`
        break
      case 'generating':
        this.description = '正在生成回复...'
        break
      case 'done':
        this.description = '完成'
        break
    }
  }

  /** 设置当前工具 */
  setCurrentTool(toolName: string, totalTools: number): void {
    this.currentTool = toolName
    this.totalTools = totalTools
    this.toolIndex++
    this.phase = 'tool_execution'
    this.description = `正在执行工具: ${toolName} (${this.toolIndex}/${totalTools})`
  }

  /** 步骤完成 */
  stepCompleted(): void {
    this.completedSteps++
  }

  /** 添加 Token 使用量 */
  addTokens(count: number): void {
    this.tokensUsed += count
  }

  /** 设置描述 */
  setDescription(desc: string): void {
    this.description = desc
  }

  /** 完成追踪 */
  complete(): void {
    this.phase = 'done'
    this.completedSteps = this.totalSteps
    this.description = '完成'
  }

  /** 获取当前进度快照 */
  getProgress(): AgentProgress {
    const elapsedMs = Date.now() - this.startTime
    const percentage =
      this.totalSteps > 0
        ? Math.round((this.completedSteps / this.totalSteps) * 100)
        : 0

    return {
      phase: this.phase,
      currentTool: this.currentTool || undefined,
      toolIndex: this.toolIndex,
      totalTools: this.totalTools,
      completedSteps: this.completedSteps,
      totalSteps: this.totalSteps,
      tokensUsed: this.tokensUsed,
      elapsedMs,
      percentage,
      description: this.description,
    }
  }

  /** 重置 */
  reset(): void {
    this.startTime = 0
    this.phase = 'thinking'
    this.currentTool = ''
    this.toolIndex = 0
    this.totalTools = 0
    this.completedSteps = 0
    this.totalSteps = 0
    this.tokensUsed = 0
    this.description = ''
  }
}
