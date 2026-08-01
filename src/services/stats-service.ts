/**
 * stats-service — LLM 调用统计数据访问服务
 *
 * 封装 BottomPanel 活动视图（ActivityView）中的 IPC 调用。
 */

import { ipc } from './ipc-client'
import type { DailyActivityData } from '../shared/ipc-channels'

/** LLM 调用统计 */
export interface LLMStats {
  totalCalls: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
}

/** LLM 调用记录 */
export interface LLMCallRecord {
  id: number
  modelName: string
  purpose: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  success: boolean
  createdAt: string
}

/** 获取 LLM 调用统计 */
export async function getLLMStats(): Promise<LLMStats> {
  return ipc.invoke('db:get-llm-stats')
}

/** 获取最近 LLM 调用记录 */
export async function getLLMHistory(limit = 30): Promise<LLMCallRecord[]> {
  return (await ipc.invoke('db:get-llm-history', limit)) as unknown as LLMCallRecord[]
}

/** 同时加载统计和历史（常用组合） */
export async function loadLLMData(limit = 30): Promise<{ stats: LLMStats; history: LLMCallRecord[] }> {
  const [stats, history] = await Promise.all([
    getLLMStats(),
    getLLMHistory(limit),
  ])
  return { stats, history }
}

// ===== 每日活动（GitHub 风格活动图） =====

/** 获取每日活动数据（写作字数 / 修改量 / 模型调用 / 费用，跨项目按天聚合） */
export async function getDailyActivity(days = 90, projectPath?: string, currentProjectPath?: string): Promise<DailyActivityData> {
  return ipc.invoke('db:get-daily-activity', days, projectPath, currentProjectPath)
}
