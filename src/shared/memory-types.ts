/**
 * 记忆分层共享类型（C 档第一轮）—— load_mode 三值：常驻 / 自动 / 手动。
 *
 * 主进程（electron/utils/memory-codec.ts）与渲染层（装配 / UI）共用；零运行时依赖，
 * 可被 preload 侧安全引用。缺省与非法值一律回落 auto（fail-safe：坏 frontmatter 不该让
 * 记忆整体失效，也不该悄悄变成「每轮全量进上下文」）。
 */
export type MemoryLoadMode = 'resident' | 'auto' | 'manual'

/** 三值枚举（UI 选择器与解析共用的单一真源） */
export const MEMORY_LOAD_MODES: readonly MemoryLoadMode[] = ['resident', 'auto', 'manual']

/** 缺省分层：进名字目录，正文按需取（与「不写 load_mode 键」等价） */
export const DEFAULT_MEMORY_LOAD_MODE: MemoryLoadMode = 'auto'

export function normalizeLoadMode(raw: string | null | undefined): MemoryLoadMode {
  const v = (raw ?? '').trim().toLowerCase()
  return (MEMORY_LOAD_MODES as readonly string[]).includes(v)
    ? (v as MemoryLoadMode)
    : DEFAULT_MEMORY_LOAD_MODE
}
