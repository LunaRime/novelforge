/**
 * 容量 K/M 文本 ↔ token 数（模型管理 v3 §5，2026-10-01）。
 *
 * 目录区的「上下文窗口 / 最大输出 token」是两个**大整数**输入框。让人逐位敲
 * `131072` 既慢又容易多敲一个 0，所以支持 `256K` / `1M` 这类业界惯用写法：
 * **`K` = 1000、`M` = 1e6**（不是 1024/1048576 —— 模型容量在业界就是按 10 进制报的）。
 *
 * 三个取值必须可分辨（目录区的行级校验全靠它）：
 *   - 空串/纯空白 → `undefined` = **继承**（placeholder 显示继承值）
 *   - 解析不出来 → `NaN` = **非法**（行级红字 + 禁应用）
 *   - 数字 → 显式值
 *
 * ⚠️ 把「非法」并进「继承」是最容易犯的错：用户在框里敲了 `256KK`，界面既没有任何提示、
 * 提交时又被当成「没改过」静默丢弃 —— 看起来像保存成功了，实际值还是旧的。
 *
 * `formatCapacity` 是它的逆：**最短且能原样解析回来**的写法（占位符与回填共用一套词表）。
 */
/** 数字 + 可选 k/m 后缀；不接受负数、指数、千分位 */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** 后缀倍率 —— `1M` 就是 1000K */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * 读一个手敲的容量。
 *
 * @param text 输入框原文
 * @returns token 数；空 → `undefined`（继承）；读不出来 → `NaN`（非法）
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  // 小数倍率「意图是整数但二进制浮点有误差」（2.3 * 1e6 会高出几个 ULP）→ 落回整数
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * 把一个存的容量拼回文本：整百万 → `1M`、整千 → `256K`，其余原样。
 *
 * 只在「整千/整百万」时缩写：`parseCapacity` 能原样读回来，往返无损。
 * 非整数（如 1500.5）与 0/负数原样输出 —— 它们不该被写成 `0.5K` 这类看着像另一回事的形式。
 *
 * @param value 已存的 token 数
 * @returns 输入框里显示的文本（供 placeholder 与回填）
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}
