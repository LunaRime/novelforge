/**
 * LLM 全局常量与运行时钳制 — 纯函数，无依赖可单测
 *
 * 背景：设置页 ModelForm 保存时已钳制 maxTokens ∈ [1, 131072]（SettingsModal），
 * 但旧配置/直改 models.json 的模型仍可超限 → 请求 max_tokens 超模型上限 →
 * API 400（"This endpoint's max tokens is..."）。主进程 llm-controller
 * 在此收口运行时钳制（所有请求通道唯一入口）。
 */
import type { ModelProfile } from './ipc-channels'

/** 全局模型输出 token 上限（与设置页 ModelForm 钳制一致，防数字漂移） */
export const MAX_TOKENS_CAP = 131072

/**
 * 钳制 maxTokens 请求参数到 [1, MAX_TOKENS_CAP]。
 * requested 缺失时回退模型配置值（fallback 同样钳制）；
 * 非有限值（NaN/Infinity）回退 fallback。返回整数。
 */
export function clampMaxTokens(requested: number | undefined, fallback: number): number {
  const n = Number.isFinite(requested) ? (requested as number) : fallback
  return Math.min(Math.max(Math.floor(n), 1), MAX_TOKENS_CAP)
}

/** 磁盘 / IPC 里来的模型配置：`contextWindow` 是 2026-09-25 新增的，旧配置没有 */
type StoredModelProfile = Omit<ModelProfile, 'contextWindow'> & { contextWindow?: number }

/**
 * 迁移归一化：补齐 `contextWindow`（旧配置缺该字段）。
 *
 * ⚠️ 兜底取 **`maxTokens`**，而不是某个常量 —— 拆字段之前，上下文占用条与压缩预算
 * 读的就是 `maxTokens`，映射后**取到的值完全相同 ⇒ 零行为变化**。
 * 这是**忠实搬运，不代表它是真实窗口**；真值需按厂商文档另批核对（那批会真的改变
 * 占用条分母，必须单独验）。
 *
 * 两个值都非法时回落 `MAX_TOKENS_CAP`，与旧消费点 `?.maxTokens ?? 131072` 的行为等价。
 *
 * ⚠️ **调用点只有一个**：`llm-store.loadModels()` —— 那里是全仓 `models` 的唯一写入点
 * （增删改模型后都会重新加载）。别在消费点各自兜底，否则分散且容易漏。
 */
export function normalizeModelProfile(m: StoredModelProfile): ModelProfile {
  const cw = m.contextWindow
  if (typeof cw === 'number' && Number.isFinite(cw) && cw > 0) return { ...m, contextWindow: cw }

  const fallback = Number.isFinite(m.maxTokens) && m.maxTokens > 0 ? m.maxTokens : MAX_TOKENS_CAP
  return { ...m, contextWindow: fallback }
}
