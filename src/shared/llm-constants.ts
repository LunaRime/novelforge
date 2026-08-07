/**
 * LLM 全局常量与运行时钳制 — 纯函数，无依赖可单测
 *
 * 背景：设置页 ModelForm 保存时已钳制 maxTokens ∈ [1, 131072]（SettingsModal），
 * 但旧配置/直改 models.json 的模型仍可超限 → 请求 max_tokens 超模型上限 →
 * API 400（"This endpoint's max tokens is..."）。主进程 llm-controller
 * 在此收口运行时钳制（所有请求通道唯一入口）。
 */

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
