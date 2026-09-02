/**
 * 输出风格注册中心（渲染层）——零代码注册：styles/*.md 即风格
 *
 * 双层加载：{project}/.novelforge/styles/*.md（项目级）+ {VELA_HOME}/styles/*.md（用户级），
 * 项目覆盖用户（同名取项目）。纯解析/合并逻辑在 electron/utils/style-codec.ts（主进程共享），
 * 本模块经 IPC（styles:list / styles:get）读盘——引擎（workflow command 层）不依赖 electron。
 *
 * v1 激活语义：无 UI 选择 → 写稿/修稿注入默认激活 default.md（若有），否则零变化。
 */
export * from '../../../electron/utils/style-codec'

export type { StyleInfo, StyleMeta } from '../../shared/ipc-channels'
