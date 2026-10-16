/**
 * mention-refs — 消息正文里的 `@` 引用切分（约束④「上下文引用可点击跳转」）
 *
 * 纯函数，无 React / 无 store / 无 IPC：只负责把**已落盘的用户正文**切成
 * `text` / `ref` 段落，交调用方渲染为可点 chip。
 *
 * 为什么不复用 `intent-router.parseMentions`：
 * - 那个是**发送前意图解析**，按当时的 `getAllMentionTargets()` / `searchProjectFiles`
 *   做目标解析，**解析不到就不返回**；而渲染期要的是「用户敲了什么就显示什么」，
 *   历史消息（换项目、文件改名、目标已删）也必须照原样可见可点，故不能依赖目标解析；
 * - 且它返回的是 `{target, start, end}` 偏移，不含未匹配的文本段。
 * 本模块**复用它的两条正则与终止规则**（见下）以保证「输入侧算引用 → 显示侧也算引用」
 * 口径一致，避免同一串字符在输入框里是引用、发出去却成了死文本。
 *
 * ⚠️ 正则与 `intent-router.ts:260`（绝对路径）/ `:277`（通用提及）**逐字对齐**——
 * 两处若将来调整，必须同步改这里（反之亦然）。
 */

import { READABLE_EXTS } from './intent-router'

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; raw: string; target: string }

/** 绝对路径提及（项目外文件）：路径可含空格/括号/中文，以中文句读或行尾结束 */
const ABS_RE = /@((?:[a-zA-Z]:[\\/]|\\\\)[^，。！？；：\r\n@]*)/g
/** 通用提及：排除空格与常见中文标点（`@故事架构，` 不被吞标点） */
const GENERIC_RE = /@([^\s，。！？；：、（）《》【】·—…""'']+)/g

/**
 * 去掉绝对路径后的尾随文字（与 `intent-router.ts:194` 的 `trimPathTail` 同算法）。
 *
 * 该函数在 intent-router 里是**私有**的，此处按同算法重写而非导出它——
 * 导出会改动 `intent-router` 的公开接口（本档硬约束之二禁止）。
 * 扩展名集合**复用其已导出的 `READABLE_EXTS`**（`intent-router.ts:181`），不另立清单，
 * 避免两处扩展名漂移导致「输入侧算引用、显示侧不算」。
 */
function trimPathTail(value: string): string {
  const exts = [...READABLE_EXTS, '.markdown'].map(e => e.slice(1)).join('|')
  const m = value.match(new RegExp(`^(.+?\\.(?:${exts}))\\s.*$`, 'i'))
  return m ? m[1] : value
}

/**
 * 把正文按 `@` 引用切成段落。返回的段落**首尾相接、拼回后与输入逐字相等**
 * （调用方据此可安全替换渲染，不丢字符）。
 */
export function splitMentionRefs(content: string): MessageSegment[] {
  if (!content || !content.includes('@')) return [{ kind: 'text', text: content }]

  type Hit = { start: number; end: number; target: string }
  const hits: Hit[] = []

  // 阶段 1：绝对路径（先占位，阶段 2 跳过其区间——避免 `@C:\My Documents\a.md` 在空格处被截断后误匹配）
  const absSpans: Array<[number, number]> = []
  ABS_RE.lastIndex = 0
  let m: RegExpExecArray | null = null
  while ((m = ABS_RE.exec(content)) !== null) {
    const target = trimPathTail(m[1])
    if (!target) continue
    // 同阶段 2：`@` 前必须是行首或空白（防 `x@C:\a` 之类被误切）
    if (m.index > 0 && !/\s/.test(content[m.index - 1])) continue
    const end = m.index + 1 + target.length
    hits.push({ start: m.index, end, target })
    absSpans.push([m.index, end])
  }

  // 阶段 2：通用提及
  GENERIC_RE.lastIndex = 0
  while ((m = GENERIC_RE.exec(content)) !== null) {
    const start = m.index
    if (absSpans.some(([s, e]) => start >= s && start < e)) continue
    // `@` 必须是行首或紧跟空白——否则邮箱（`foo@bar.com`）会被切成引用。
    // 注意：intent-router 的正则**没有**这条约束（它靠「解析不到目标就不返回」兜住），
    // 而渲染侧不依赖目标解析，故必须在此显式收紧。
    if (start > 0 && !/\s/.test(content[start - 1])) continue
    hits.push({ start, end: start + m[0].length, target: m[1] })
  }

  if (hits.length === 0) return [{ kind: 'text', text: content }]

  hits.sort((a, b) => a.start - b.start)
  const out: MessageSegment[] = []
  let cursor = 0
  for (const hit of hits) {
    // 阶段 1/2 理论上不重叠（absSpans 已排除），仍加防御：跳过任何与前一段重叠的命中
    if (hit.start < cursor) continue
    if (hit.start > cursor) out.push({ kind: 'text', text: content.slice(cursor, hit.start) })
    out.push({ kind: 'ref', raw: content.slice(hit.start, hit.end), target: hit.target })
    cursor = hit.end
  }
  if (cursor < content.length) out.push({ kind: 'text', text: content.slice(cursor) })
  return out
}
