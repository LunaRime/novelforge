/**
 * SkillsSettings — 技能库设置（导入/列表/删除 .md 技能文件）
 *
 * 技能存储于 ~/.novelforge/skills/*.md（与 Claude Code skills 目录同模式），
 * 供 AI Agent 对话时按需加载。
 */
import { useState, useEffect, useCallback } from 'react'
import { Upload, Trash2, FileText } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { EmptyState } from '../ui/EmptyState'
import { useTranslation } from '../../hooks/useTranslation'

interface SkillItem {
  name: string
  description: string
}

export default function SkillsSettings() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  // 加载技能列表（初始挂载；导入/删除后手动调用 loadSkills 刷新）
  const loadSkills = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ipc.invoke('skill:list')
      setSkills(list)
      setLoadFailed(false)
    } catch (e) {
      console.warn('[SkillsSettings] 加载技能失败:', e)
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ipc.invoke('skill:list').then(list => {
      if (!cancelled) { setSkills(list); setLoadFailed(false) }
    }).catch(e => {
      console.warn('[SkillsSettings] 加载技能失败:', e)
      if (!cancelled) setLoadFailed(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  /** 选择 .md 文件并导入 */
  const handleImport = useCallback(async () => {
    const file = await ipc.invoke('dialog:select-skill-file')
    if (!file) return
    const result = await ipc.invoke('skill:import', { name: file.name, content: file.content })
    if (result.success) {
      toast.success(t('skill.imported'))
      loadSkills()
    } else {
      toast.error(result.error ?? t('status.unknown'))
    }
  }, [t, loadSkills])

  /** 删除技能 */
  const handleDelete = useCallback(async (name: string) => {
    const ok = await confirm(
      t('skill.deleteConfirm').replace('{name}', name),
      { title: t('settings.skills'), danger: true },
    )
    if (!ok) return
    const result = await ipc.invoke('skill:delete', name)
    if (result.success) loadSkills()
  }, [t, loadSkills])

  return (
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] flex-shrink-0">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {t('settings.skills')}
          <span className="ml-2 text-xs opacity-50" style={{ color: 'var(--color-text-muted)' }}>
            {skills.length}
          </span>
        </span>
        <button
          type="button"
          onClick={handleImport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{ color: '#fff', backgroundColor: 'var(--color-accent)' }}
        >
          <Upload size={12} />
          {t('skill.import')}
        </button>
      </div>

      {/* 技能列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center py-8 text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('status.loading')}
          </div>
        ) : loadFailed ? (
          /* 错误态与空态必须分开：失败渲染成「暂无技能」会让用户以为本来就没有 */
          <div className="text-center py-10 text-xs space-y-2">
            <div style={{ color: 'var(--color-error)' }}>{t('common.loadFailed')}</div>
            <button
              type="button"
              className="px-3 py-1 rounded-lg text-xs transition-colors cursor-pointer"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              onClick={() => void loadSkills()}
            >
              {t('action.retry')}
            </button>
          </div>
        ) : skills.length === 0 ? (
          <EmptyState
            message={t('skill.empty')}
            size="xs"
            className="text-center text-[var(--color-text-muted)]"
          />
        ) : (
          <div className="space-y-2">
            {skills.map(skill => (
              <div
                key={skill.name}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
              >
                <FileText size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {skill.name}
                  </p>
                  {skill.description && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {skill.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(skill.name)}
                  className="flex-shrink-0 p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={t('action.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
