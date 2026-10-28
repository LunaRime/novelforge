/**
 * 架构文件路径 → 步骤 key（纯函数，独立成文件以满足 react-refresh「组件文件只导出组件」）
 *
 * 侧栏走 DB 化路径 `vela://core/{key}`；只认 `.md` 时 stepKey 恒为 null，
 * 导致 AI 生成/角色提取入口整块不渲染（审计 P0-1）。
 */

export type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

const STEP_KEYS: readonly ArchStepKey[] = ['premise', 'characters', 'worldbuilding', 'synopsis']

export function detectStepKey(filePath: string): ArchStepKey | null {
  const coreMatch = filePath.match(/^vela:\/\/core\/([A-Za-z]+)\/?$/)
  if (coreMatch) {
    const key = coreMatch[1] as ArchStepKey
    return STEP_KEYS.includes(key) ? key : null
  }
  if (filePath.endsWith('premise.md')) return 'premise'
  if (filePath.endsWith('characters.md')) return 'characters'
  if (filePath.endsWith('worldbuilding.md')) return 'worldbuilding'
  if (filePath.endsWith('synopsis.md')) return 'synopsis'
  return null
}
