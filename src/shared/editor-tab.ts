import type { DiffSession } from '../services/diff/hunk-model'

/** 编辑器 Tab 数据 */
export interface EditorTab {
  id: string
  name: string
  type: 'chapter' | 'outline' | 'character' | 'config' | 'diff' | 'chapter-card' | 'world-building' | 'arch-file' | 'version-history' | 'review-report' | 'memory' | 'publication' | 'manuscript-board' | 'world-timeline'
  filePath?: string
  content?: string
  /** diff 视图的原始内容 */
  originalContent?: string
  dirty?: boolean
  /** 固定 Tab，不可关闭 */
  pinned?: boolean
  /** 修稿文件路径（三栏合并用） */
  revisionPath?: string
  /** 审稿报告内容（供「根据意见修稿」使用） */
  reviewReport?: string
  /** 草稿所属章节号 */
  chapterNumber?: number
  /** 审稿报告存放路径 */
  reportPath?: string
  /** L1 inline 接受会话（决策态随 tab 持久；正文文本仍走 content） */
  inlineSession?: DiffSession
}

