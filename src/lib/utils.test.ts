/**
 * cn() —— 类名合并（2026-09-25 修复存量静默失效）
 *
 * 背景：`cn` 用裸 `twMerge`，而 twMerge 不认识项目在 `@theme` 里自定义的字号档
 * （`--text-2xs` / `--text-micro`）。它把 `text-micro` 当成**文字颜色**类
 * （`text-<任意值>` 的兜底规则），于是 `cn('text-micro', 'text-white')` 里
 * 两者被判为同类冲突 → **后者胜、字号被静默丢弃**。
 *
 * 批次 2a 引入这两档并迁移 262 处之后，凡是在 `cn()` 里与文字颜色同现的调用点
 * 都丢了字号（实测 4 处：ChapterCardEditor / KnowledgeOverview / CharactersView /
 * ui/Select），且**不报错、不警告**——只是字比预期大一号。
 */
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('同类工具类冲突时后者胜', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('非冲突类全部保留', () => {
    const out = cn('flex items-center', 'gap-2')
    expect(out).toContain('flex')
    expect(out).toContain('items-center')
    expect(out).toContain('gap-2')
  })

  it('支持条件与数组入参（clsx 语义）', () => {
    expect(cn('a', false && 'b', ['c', null, undefined])).toBe('a c')
  })

  describe('自定义字号档（项目特有，必须教会 twMerge）', () => {
    it('text-micro 与文字颜色共存，不被吞掉', () => {
      const out = cn('text-micro', 'text-white')
      expect(out).toContain('text-micro')
      expect(out).toContain('text-white')
    })

    it('text-2xs 与令牌颜色共存', () => {
      const out = cn('text-2xs', 'text-[var(--color-text-muted)]')
      expect(out).toContain('text-2xs')
      expect(out).toContain('--color-text-muted')
    })

    it('字号档与颜色先后顺序无关', () => {
      expect(cn('text-white', 'text-micro')).toContain('text-micro')
      expect(cn('text-micro', 'text-white')).toContain('text-micro')
    })

    it('字号档之间仍是同类，互斥且后者胜', () => {
      expect(cn('text-micro', 'text-xs')).toBe('text-xs')
      expect(cn('text-2xs', 'text-micro')).toBe('text-micro')
    })
  })
})
