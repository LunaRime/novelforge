import { cut } from 'jieba-wasm'

export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return []
  const words = cut(text, true)
  return words.filter(w => w && w.trim() !== '')
}

export function tokenizeToSpaceSeparated(text: string): string {
  return tokenize(text).join(' ')
}
