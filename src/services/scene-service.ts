/**
 * scene-service — 场景卡读写（侧栏「卷 → 章 → 场景」层级用）
 *
 * 只做 IPC 收敛：组件不直接 invoke，便于单测与错误归一。
 * 场景卡是章节内部的节拍单元（计划书 工作流 E），与草稿版本无关。
 */

import { ipc } from './ipc-client'

export type SceneStatus = 'planned' | 'writing' | 'done'

export interface SceneItem {
  id: number
  chapterNumber: number
  title: string
  summary: string
  status: string
  sortOrder: number
  wordCount: number
  contentId: number | null
}

export async function listScenes(chapterNumber: number): Promise<SceneItem[]> {
  // 不吞异常：列表要区分「空」与「失败」（失败态必须有重试入口）
  return ipc.invoke('db:scene-list', chapterNumber)
}

export async function upsertScene(data: {
  id?: number
  chapterNumber: number
  title: string
  summary: string
  status: string
  sortOrder: number
  wordCount: number
  contentId?: number | null
}): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    return await ipc.invoke('db:scene-upsert', data)
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function deleteScene(id: number): Promise<{ success: boolean; error?: string }> {
  try {
    return await ipc.invoke('db:scene-delete', id)
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function reorderScenes(chapterNumber: number, orderedIds: number[]): Promise<{ success: boolean; error?: string }> {
  try {
    return await ipc.invoke('db:scene-reorder', { chapterNumber, orderedIds })
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/** 数组内移动（拖拽/键盘共用；越界返回原数组引用，便于调用方跳过写库） */
export function moveScene(ids: number[], fromIndex: number, toIndex: number): number[] {
  if (fromIndex === toIndex) return ids
  if (fromIndex < 0 || fromIndex >= ids.length) return ids
  const clamped = Math.max(0, Math.min(ids.length - 1, toIndex))
  if (clamped === fromIndex) return ids
  const next = ids.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(clamped, 0, moved)
  return next
}
