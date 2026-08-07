/**
 * 连载监控分析 — 纯函数，可单测
 *
 * 手动导入平台章节正文（不自动抓取——本地优先产品边界），与本地定稿对比：
 * 1. 相似度：字符频率 Dice 系数（与 ThreeWayMerge 同思路的简化版）——平台删改/大幅续写可检出
 * 2. 审计：复用内容审计纯函数（术语统一 + 水文检测）
 * 存储与 UI 由 publication-repository / ProjectTree 提供。
 */

import { terminologyAudit, waterAudit, type AuditIssue } from './audit/audits'

export interface ExternalChapterReport {
  /** 与本地定稿的相似度（0-1，字符频率 Dice） */
  similarity: number
  /** 是否存在本地同章定稿 */
  localFound: boolean
  /** 外部章节字数 */
  wordCount: number
  /** 审计告警（术语/水文） */
  auditIssues: AuditIssue[]
}

/** 字符频率 Dice 相似度（0-1） */
function charDiceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const fa = new Map<string, number>()
  const fb = new Map<string, number>()
  for (const ch of a) fa.set(ch, (fa.get(ch) ?? 0) + 1)
  for (const ch of b) fb.set(ch, (fb.get(ch) ?? 0) + 1)
  let common = 0
  for (const [ch, n] of fa) common += Math.min(n, fb.get(ch) ?? 0)
  return (common * 2) / (a.length + b.length)
}

/** 分析外部章节：相似度 + 审计告警（无本地定稿时 similarity=0） */
export function analyzeExternalChapter(external: string, local: string | null, terms: string[]): ExternalChapterReport {
  const ext = external?.trim() ?? ''
  if (!ext) return { similarity: 0, localFound: false, wordCount: 0, auditIssues: [] }

  const localText = local?.trim() ?? ''
  const similarity = localText ? charDiceSimilarity(ext, localText) : 0

  // 审计：术语统一（外部章节与本地术语不一致预警）+ 水文检测（单章默认阈值）
  const auditIssues: AuditIssue[] = []
  if (terms.length > 0) {
    const t = terminologyAudit(ext, terms)
    if (t.issues.length > 0) auditIssues.push(...t.issues)
  }
  const w = waterAudit(ext)
  if (w.issues.length > 0) auditIssues.push(...w.issues)

  return {
    similarity: Math.round(similarity * 1000) / 1000,
    localFound: !!localText,
    wordCount: ext.length,
    auditIssues,
  }
}
