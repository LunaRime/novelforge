/**
 * 输出风格文件 codec —— 纯函数层（零 electron 依赖，主进程 styles-controller 与渲染层共享）
 *
 * 风格文件 = {项目}/.novelforge/styles/*.md 或 {VELA_HOME}/styles/*.md（用户级）
 * 零代码注册语义：文件名 = 风格名（去 .md），frontmatter = 描述（可选），正文 = prompt（写作风格指令）。
 *
 * frontmatter 格式（与 parseMemoryFile 同风格的简单 YAML 行解析）：
 *   ---
 *   description: 一句话描述（可选；值为首个 ':' 之后内容，保留内部冒号）
 *   ---
 *   正文（写作风格指令，保持原文不翻译）
 *
 * 解析规则（本 codec 的登记契约，测试锁定）：
 * - 无 frontmatter（不以 --- 开头）→ 描述为空，整文件为正文（default.md 零代码可直接扔纯文本）；
 * - 以 --- 开头但无闭合 --- → 非法 frontmatter → null（跳过，列表不崩）；
 * - frontmatter 闭合但正文为空 → null（无 prompt 可注入，跳过）；
 * - 空/纯空白文件 → null。
 */
import type { StyleInfo, StyleMeta } from '../../src/shared/ipc-channels'

/** v1 激活语义：无 UI 选择时默认激活名为 default 的风格（文件 default.md） */
export const DEFAULT_STYLE_NAME = 'default'

const FM_OPEN = /^---\r?\n/
const FM_CLOSE = /\r?\n---\r?\n?/

/**
 * 解析风格 .md 内容（纯函数；非法文件返回 null——调用方在列表/获取时跳过）。
 *
 * @param raw 文件完整内容
 * @param fallbackName 文件名（去 .md 后作为风格名——登记点决策：风格名 = 文件名）
 */
export function parseStylePromptFile(raw: string, fallbackName: string): StyleMeta | null {
  const text = raw ?? ''
  if (!text.trim()) return null

  let description = ''
  let body = text

  if (FM_OPEN.test(text)) {
    // 以 --- 开头 → 必须有闭合 ---，否则视为非法 frontmatter
    const closeMatch = text.match(FM_CLOSE)
    if (!closeMatch || closeMatch.index === undefined) return null
    const fmEnd = closeMatch.index + closeMatch[0].length
    const fmLines = text.slice(3, closeMatch.index).split(/\r?\n/)
    body = text.slice(fmEnd)
    for (const line of fmLines) {
      const idx = line.indexOf(':')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      if (key === 'description') description = line.slice(idx + 1).trim()
    }
  }

  const promptBody = body.trim()
  if (!promptBody) return null
  const name = styleNameFromFile(fallbackName).trim()
  if (!name) return null
  return { name, description: description || '', promptBody }
}

/** 文件名 → 风格名（去 .md 后缀；非法输入原样返回，由上层过滤） */
export function styleNameFromFile(fileName: string): string {
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}

/**
 * 双层合并：项目级覆盖用户级（同名取项目——登记契约）。
 * 输入已含解析/损坏过滤后的 StyleMeta；返回按 name 排序（localeCompare，与 skill/templates 列表口径一致）。
 */
export function mergeStyleLayers(project: StyleMeta[], user: StyleMeta[]): StyleMeta[] {
  const map = new Map<string, StyleMeta>()
  for (const s of user) map.set(s.name, s)
  for (const s of project) map.set(s.name, s) // 项目覆盖用户
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 列表载荷：剥去 promptBody（列表只返回元信息） */
export function toStyleInfo(meta: StyleMeta): StyleInfo {
  return { name: meta.name, description: meta.description }
}

/**
 * 写稿注入拼接：激活风格正文追加到既有 novelConfig.writingStyle 值之后（两者以空行分隔）。
 * - 风格正文空 → 原值逐字返回（无风格目录/无 default.md 时行为与现状完全一致）；
 * - 既有值为空但有风格 → 仅返回风格正文（不带前导分隔）；
 * - 两者皆空 → 空。
 */
export function appendWritingStyle(existing: string, stylePrompt: string): string {
  const prompt = (stylePrompt ?? '').trim()
  if (!prompt) return existing ?? ''
  const base = (existing ?? '').trim()
  if (!base) return prompt
  return `${base}\n\n${prompt}`
}
