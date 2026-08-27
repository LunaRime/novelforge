/**
 * audit-context — 审计上下文收集（定稿审计 / 终审自省共用）
 *
 * 收集：上章结尾（衔接）、本章蓝图关键事件（细纲锚点）、豁免词（角色名+世界观专名）、
 * 跨章基线（最近 3 章定稿）、项目级白名单。全部失败降级为空值（审计自动回退）。
 */
import { ipc } from '../ipc-client'
import { buildBaselineFreqs, extractSettingNouns, runAllAudits, type AuditWhitelist } from './audits'
import { DIR_VELA_INTERNAL } from '../../shared/project-paths'

export interface AuditContext {
  /** 上一章结尾（衔接审计用，200 字） */
  prevEnding: string
  /** 本章蓝图关键事件（细纲锚点：强制剧情点） */
  keyEvents: string[]
  /** 豁免词（角色名 + 世界观专名） */
  terms: string[]
  /** 跨章基线词频（最近 3 章定稿） */
  baselineFreqs: Record<string, number>
  /** 项目级水文白名单（audit-whitelist.json） */
  whitelist?: AuditWhitelist
}

/**
 * 收集审计上下文（chapterNumber 的上一章起最近 3 章定稿 + 本章蓝图 + 角色/世界观 + 白名单）。
 * 单点失败不影响整体——各段独立 try/catch 降级。
 */
export async function collectAuditContext(chapterNumber: number): Promise<AuditContext> {
  const ctx: AuditContext = {
    prevEnding: '',
    keyEvents: [],
    terms: [],
    baselineFreqs: {},
    whitelist: undefined,
  }

  // 1. 最近 3 章定稿正文（跨章基线 + 上章结尾）
  const prevChapters: string[] = []
  try {
    for (let n = 1; n <= 3; n++) {
      const prevMeta = await ipc.invoke('db:draft-get-finalized', chapterNumber - n) as { id?: number } | null
      if (!prevMeta || prevMeta.id === undefined) continue
      const full = await ipc.invoke('db:draft-get-full', prevMeta.id) as { content?: string } | null
      const content = full?.content ?? ''
      if (!content) continue
      prevChapters.push(content)
      if (n === 1) ctx.prevEnding = content.slice(-200)
    }
  } catch { /* 忽略 */ }
  ctx.baselineFreqs = buildBaselineFreqs(prevChapters)

  // 2. 本章蓝图关键事件（细纲锚点）
  try {
    const bps = await ipc.invoke('db:blueprint-get-all') as Array<{ chapterNumber?: number; keyEvents?: string }>
    const bp = bps.find(b => b.chapterNumber === chapterNumber)
    if (bp?.keyEvents) {
      ctx.keyEvents = String(bp.keyEvents).split(/[;；\n]/).map(s => s.trim()).filter(Boolean)
    }
  } catch { /* 忽略 */ }

  // 3. 豁免词（角色名 + 世界观引号内/高频专名）
  try {
    const chars = await ipc.invoke('db:character-get-all') as Array<{ name?: string }>
    ctx.terms = chars.map(c => String(c.name ?? '')).filter(Boolean)
  } catch { /* 忽略 */ }
  try {
    const core = await ipc.invoke('db:project-core-get') as { worldbuilding?: string } | null
    const worldText = core?.worldbuilding ?? ''
    if (worldText.trim()) {
      ctx.terms = [...new Set([...ctx.terms, ...extractSettingNouns(worldText)])]
    }
  } catch { /* 忽略 */ }

  // 4. 项目级水文白名单（{project}/.vela/audit-whitelist.json）
  try {
    const { useProjectStore } = await import('../../stores/project-store')
    const project = useProjectStore.getState().currentProject
    if (project) {
      // 登记授权（fs:read-external-file 现仅放行显式授权路径——项目内白名单文件在此登记）
      await ipc.invoke('fs:grant-external-file', `${project.path}/${DIR_VELA_INTERNAL}/audit-whitelist.json`).catch(() => {})
      const wlRes = await ipc.invoke('fs:read-external-file', `${project.path}/${DIR_VELA_INTERNAL}/audit-whitelist.json`) as { success?: boolean; content?: string } | null
      if (wlRes?.success && wlRes.content) {
        const parsed = JSON.parse(wlRes.content) as Record<string, unknown>
        ctx.whitelist = {
          words: Array.isArray(parsed.words) ? parsed.words.map(String) : undefined,
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String) : undefined,
          sentences: Array.isArray(parsed.sentences) ? parsed.sentences.map(String) : undefined,
        }
      }
    }
  } catch { /* 白名单不存在或损坏 → 不使用 */ }

  return ctx
}

/** 用上下文对正文执行全量审计 */
export function auditText(ctx: AuditContext, text: string) {
  return runAllAudits({
    chapterText: text,
    prevChapterEnding: ctx.prevEnding,
    keyEvents: ctx.keyEvents,
    terms: ctx.terms,
    baselineFreqs: ctx.baselineFreqs,
    whitelist: ctx.whitelist,
  })
}
