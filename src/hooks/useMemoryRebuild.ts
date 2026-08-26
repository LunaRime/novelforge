/**
 * useMemoryRebuild — 记忆文件手动重建逻辑（侧栏 MemoryGroup 与 AI 面板 AgentMemoryView 共享，P3 Task 3）
 *
 * 卷级：ensureVolumeSummary 扫描全部 chapters-*.md 收集卷内条目 →
 * buildVolumeSummaryFile 组装 → memory:write 覆盖（纯函数聚合，零 LLM，即时完成）
 * 全书：P2 真实重建——rebuildBookState 聚合非 stale 卷（无分卷则聚合最新章节文件）→ 覆盖写
 * 章节/共享：标记 stale（章节条目走下次定稿 DAG；共享事实下次压缩自动重提取）
 */
import { useVolumeStore } from '../stores/volume-store'
import { useMemoryStore } from '../stores/memory-store'
import { ipc } from '../services/ipc-client'
import { ensureVolumeSummary } from '../services/memory/chapter-memory'
import { rebuildBookState } from '../services/memory/book-memory'
import { toast } from '../components/ui/Toast'
import { useTranslation } from './useTranslation'
import type { MemoryFileMeta } from '../services/memory/memory-codec'

export function useMemoryRebuild() {
  const { t } = useTranslation()

  /** 手动重建入口 */
  const handleRebuild = async (f: MemoryFileMeta) => {
    if (f.kind === 'volume') {
      const m = f.file.match(/^volume-(\d+)\.md$/)
      if (!m) { toast.error(t('error.unknown')); return }
      const applied = await useVolumeStore.getState().load() // 重建前保证卷数据最新（loadSeq 竞态守卫）
      const volumes = applied ? useVolumeStore.getState().volumes : []
      const vol = volumes.find(v => v.volumeNumber === Number(m[1]))
      if (!vol) { toast.error(t('error.unknown')); return }
      if (vol.chapterEnd === 0) {
        // 进行中卷：卷聚合无入口（ensureVolumeSummary 跳过）——提示走定稿/检查点生成
        toast.success(t('memory.rebuildHint'))
        return
      }
      const res = await ensureVolumeSummary(vol)
      if (res.success) await useMemoryStore.getState().refresh() // 覆盖写（无 status:stale）→ stale 徽标消失
      // F6：重建失败 = 卷内章节条目不完整（未定稿）——明确指引而非笼统未知错误
      else toast.error(t('memory.rebuildIncomplete'))
      return
    }
    if (f.kind === 'book') {
      const res = await rebuildBookState()
      if (res.success) {
        toast.success(t('memory.rebuildBookDone'))
        await useMemoryStore.getState().refresh() // 覆盖写（无 status:stale）→ stale 徽标消失
      } else {
        // M6：失败带出 rebuildBookState 的 reason（如 'all volume files stale'）而非吞掉——reason 为内部诊断串，直接拼接展示
        toast.error(res.reason ? `${t('error.unknown')}：${res.reason}` : t('error.unknown'))
      }
      return
    }
    const res = await ipc.invoke('memory:mark-stale', f.file)
    if (res.success) {
      toast.success(t('memory.rebuildHint'))
      await useMemoryStore.getState().refresh() // stale 徽标出现
    } else {
      toast.error(t('error.unknown'))
    }
  }

  return { handleRebuild }
}
