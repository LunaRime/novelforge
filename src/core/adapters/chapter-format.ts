import { createHash } from 'node:crypto'
import { assertChapter, ChapterError, type Chapter } from '../domain/chapter'

const fields = ['projectId', 'id', 'number', 'title', 'status', 'createdAt', 'updatedAt'] as const
export const fileRevision = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** JSON scalar frontmatter is a YAML subset; no unescaped titles or timestamps. */
export function serializeChapter(chapter: Chapter): string {
  assertChapter(chapter)
  const data: Record<string, unknown> = { ...chapter.metadata }
  if (fields.some(field => Object.hasOwn(data, field))) throw new ChapterError('invalid-chapter', 'Metadata cannot override chapter fields')
  for (const field of fields) data[field] = chapter[field]
  return `---\n${Object.entries(data).map(([k, v]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || v === undefined) throw new ChapterError('invalid-chapter', 'Invalid metadata key or value')
    return `${k}: ${JSON.stringify(v)}`
  }).join('\n')}\n---\n${chapter.content}`
}

export function parseChapter(text: string): Chapter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  if (!match) throw new ChapterError('invalid-chapter', 'Missing frontmatter')
  const data: Record<string, unknown> = Object.create(null)
  try {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z][A-Za-z0-9_]*):\s*(.+)$/.exec(line)
      if (!pair || Object.hasOwn(data, pair[1])) throw new Error('Invalid or duplicate frontmatter field')
      data[pair[1]] = JSON.parse(pair[2])
    }
  } catch {
    throw new ChapterError('invalid-chapter', 'Frontmatter must contain JSON values')
  }
  const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => !fields.includes(key as typeof fields[number])))
  const chapter = { ...Object.fromEntries(fields.map(key => [key, data[key]])), content: text.slice(match[0].length),
    ...(Object.keys(metadata).length ? { metadata } : {}) } as unknown as Chapter
  assertChapter(chapter)
  return chapter
}
