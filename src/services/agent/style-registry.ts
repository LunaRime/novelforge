/**
 * 输出风格注册中心（渲染层）——零代码注册：styles/*.md 即风格
 *
 * 双层加载：{project}/.novelforge/styles/*.md（项目级）+ {VELA_HOME}/styles/*.md（用户级），
 * 项目覆盖用户（同名取项目）。解析/合并纯逻辑在 electron/utils/style-codec.ts（与主进程共享，
 * 此处 re-export——渲染层经同一模块取纯函数与类型），本模块经 IPC（styles:list / styles:get）读盘
 * ——引擎（workflow command 层）不依赖 electron。
 *
 * v1 激活语义：无 UI 选择 → 写稿注入默认激活 default.md（若有），否则零变化。
 * （默认风格名 = DEFAULT_STYLE_NAME 'default'；用户放一个 default.md 即生效）
 */
export * from '../../../electron/utils/style-codec'

import { ipc } from '../ipc-client'
import { DEFAULT_STYLE_NAME } from '../../../electron/utils/style-codec'
import type { StyleInfo, StyleMeta } from '../../shared/ipc-channels'

export type { StyleInfo, StyleMeta }
export { DEFAULT_STYLE_NAME }

/** 合并风格列表（项目覆盖用户；按 name 排序；不含 promptBody）。无风格目录 → []。 */
export async function listStyles(projectPath: string): Promise<StyleInfo[]> {
  try {
    return await ipc.invoke('styles:list', projectPath)
  } catch {
    return [] // 读盘失败 → 空列表（行为兼容：无风格目录与现状一致）
  }
}

/** 单个完整风格（含 promptBody，注入用）；不存在/非法名/读盘失败 → null。 */
export async function getStyle(name: string, projectPath: string): Promise<StyleMeta | null> {
  try {
    return await ipc.invoke('styles:get', projectPath, name)
  } catch {
    return null
  }
}

/**
 * 当前激活风格（v1 = default.md；双层查找，项目覆盖用户）。
 * 无 default.md / 读盘失败 → null（调用方零变化回退）。
 */
export async function getActiveStyle(projectPath: string): Promise<StyleMeta | null> {
  return getStyle(DEFAULT_STYLE_NAME, projectPath)
}
