import type { TextKey } from '../../shared/locale'

export const markdownFormats = [
  ['heading', 'editor.markdownHeading', '# '],
  ['bold', 'editor.bold', '**', '**'],
  ['italic', 'editor.markdownItalic', '*', '*'],
  ['strike', 'editor.markdownStrike', '~~', '~~'],
  ['quote', 'editor.markdownQuote', '> '],
  ['list', 'editor.markdownList', '- '],
  ['code', 'editor.markdownCode', '`', '`'],
  ['link', 'editor.markdownLink', '[', '](https://)'],
] as const satisfies ReadonlyArray<readonly [string, TextKey, string, string?]>

export type MarkdownFormat = typeof markdownFormats[number][0]

/** 两种编辑器都保存 Markdown 源文。块格式按整行操作，行内格式保留原选区。 */
export function markdownFormatChange(doc: string, from: number, to: number, id: MarkdownFormat) {
  const [, , open, close] = markdownFormats.find(format => format[0] === id)!
  if (!close) {
    const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1
    const next = doc.indexOf('\n', to > from && doc[to - 1] === '\n' ? to - 1 : to)
    const end = next < 0 ? doc.length : next
    const lines = doc.slice(start, end).split('\n')
    const remove = lines.every(line => line.startsWith(open))
    const insert = lines.map(line => remove ? line.slice(open.length) : open + line).join('\n')
    const anchor = from === to ? Math.max(start, from + (remove ? -open.length : open.length)) : start
    return { from: start, to: end, insert, anchor, head: from === to ? anchor : start + insert.length }
  }

  const selected = doc.slice(from, to)
  if (id !== 'link' && selected.length > open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
    const insert = selected.slice(open.length, -close.length)
    return { from, to, insert, anchor: from, head: from + insert.length }
  }
  if (id !== 'link' && selected && from >= open.length && doc.slice(from - open.length, from) === open && doc.startsWith(close, to)) {
    return { from: from - open.length, to: to + close.length, insert: selected, anchor: from - open.length, head: to - open.length }
  }
  return { from, to, insert: open + selected + close, anchor: from + open.length, head: to + open.length }
}

/** 触发原生输入事件，让 React 受控表单继续走原有校验与保存流程。 */
export function formatTextarea(field: HTMLTextAreaElement, format: MarkdownFormat) {
  if (field.disabled || field.readOnly) return
  const { from, to, insert, anchor, head } = markdownFormatChange(field.value, field.selectionStart, field.selectionEnd, format)
  const next = field.value.slice(0, from) + insert + field.value.slice(to)
  if (field.maxLength >= 0 && next.length > field.maxLength) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(field, next)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
  field.setSelectionRange(anchor, head)
}
