/**
 * 前缀基线（跨轮 prompt-cache 记账用的模块级状态）——P0-1 修复抽出。
 *
 * 为什么独立成模块：基线是**跨轮**状态，却必须随**会话生命周期**重置。此前它以两个裸变量
 * 留在 agent-store 模块作用域（`lastPrefixText` / `lastCachedTokens`），只有写入没有重置，
 * 于是**切换会话后的首轮**拿上一个会话的 system 段作比较 —— 面板会显示「前缀：已变化（共享
 * N 字符）」，日志会报「缓存命中归零」，两者都是假的（观测面反而在说谎）。
 *
 * 抽出后：重置点是显式的 `resetPrefixBaseline()`（createConversation / selectConversation /
 * deleteConversation / clearAll 四处，与 `clearReadState()` 同址），且本模块可被单测直接锁定。
 * ⚠️ `/clear` **不重置**：同一会话内 system 段确实变了（M1 摘要被清），如实报告才是对的。
 */
import { comparePrefix } from './prefix-accounting'

let lastPrefixText = ''
let lastCachedTokens = 0

/** 上一轮已发出的 system 段（空串 = 无基线，观测不渲染前缀行） */
export function getLastPrefixText(): string {
  return lastPrefixText
}

/** 上一轮的真实缓存命中 tokens（用于「命中归零」告警的判据） */
export function getLastCachedTokens(): number {
  return lastCachedTokens
}

/** 记录本轮 system 段与缓存命中数（生成成功后调用一次） */
export function updatePrefixBaseline(systemText: string, cachedTokens: number): void {
  lastPrefixText = systemText
  lastCachedTokens = cachedTokens
}

/** 会话生命周期切换时重置（否则跨会话比较 = 面板/日志说谎） */
export function resetPrefixBaseline(): void {
  lastPrefixText = ''
  lastCachedTokens = 0
}

/**
 * 本轮观测用的前缀比较结果：`undefined` = 无基线（首轮 / 刚切会话），调用方据此不渲染前缀行。
 * 只读，不推进基线——基线推进由 `updatePrefixBaseline` 在**请求真的发出后**完成。
 */
export function peekPrefixChange(systemText: string): { changed: boolean; sharedChars: number } | undefined {
  return lastPrefixText ? comparePrefix(lastPrefixText, systemText) : undefined
}
