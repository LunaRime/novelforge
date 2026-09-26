/**
 * 压缩保留偏好（§7.1-C2 的「Checkpoint 保留偏好」）。
 *
 * 把压缩的三个策略旋钮从硬编码常量变成用户偏好。语义边界（Denova 参照）：
 * **只影响之后的压缩** —— 不重算已压批次、不重写历史、不动已落盘的分卷原文；
 * 唯一的例外是 `keepBatches > 0` 时显式裁剪**更旧的**批次（连同其分卷原文释放），
 * 这一条默认关闭（0 = 不裁剪，维持 B 档第二轮「原文永不删」的承诺）。
 */
export interface CompactionPrefs {
  /** 历史超它才触发压缩（默认 4000 = 原 HISTORY_MAX_TOKENS） */
  historyMaxTokens: number
  /** 压完降幅低于它就跳过（B 档 B2 可证明性阈值，默认 200 = 原 MINIMUM_CHANGE_TOKENS） */
  minimumChangeTokens: number
  /** 保留最近 N 批（连同分卷原文）；0 = 不裁剪 */
  keepBatches: number
}

/** 历史预算的钳制下限（= 任何偏好下都不可能触发压缩的阈值；供调用方**省掉无谓的配置读取**） */
export const COMPACTION_HISTORY_MIN_TOKENS = 1000

/** 缺省 = 现状常量（行为零变化的前提） */
export const DEFAULT_COMPACTION_PREFS: CompactionPrefs = {
  historyMaxTokens: 4000,
  minimumChangeTokens: 200,
  keepBatches: 0,
}

/** 字段范围 [min, max]（越界钳制；非法值回默认——fail-safe，绝不抛） */
const RANGES: Record<keyof CompactionPrefs, readonly [number, number]> = {
  historyMaxTokens: [1000, 32000],
  minimumChangeTokens: [0, 2000],
  keepBatches: [0, 20],
}

function pick(raw: unknown, key: keyof CompactionPrefs): number {
  const [min, max] = RANGES[key]
  // 只认真正的数字：手工编辑配置写成 "8000" 字符串不算（回默认而不是猜）
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_COMPACTION_PREFS[key]
  return Math.min(max, Math.max(min, Math.round(raw)))
}

/** 从 GlobalConfig（或其片段）解析；缺段/坏形状一律回默认 → 老配置零迁移 */
export function resolveCompactionPrefs(config: { compaction?: unknown } | null | undefined): CompactionPrefs {
  const raw = (config?.compaction ?? {}) as Record<string, unknown>
  return {
    historyMaxTokens: pick(raw.historyMaxTokens, 'historyMaxTokens'),
    minimumChangeTokens: pick(raw.minimumChangeTokens, 'minimumChangeTokens'),
    keepBatches: pick(raw.keepBatches, 'keepBatches'),
  }
}
