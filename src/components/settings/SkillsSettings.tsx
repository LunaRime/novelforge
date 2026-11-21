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
import { Button } from '../ui/Button'
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
    <section className="nf-settings-panel space-y-3">
      <header className="nf-settings-resource-bar">
        <span className="rounded-md bg-[var(--color-editor-bg)] px-2 py-1 text-xs tabular-nums text-[var(--color-text-secondary)]" aria-label={t('settings.skills')}>
          {skills.length}
        </span>
        <Button type="button" className="min-h-8" onClick={handleImport}>
          <Upload size={14} aria-hidden="true" />
          {t('skill.import')}
        </Button>
      </header>

      {/* 技能列表由设置窗口的内容区统一滚动。 */}
      <div aria-busy={loading}>
        {loading ? (
          <div className="text-center py-8 text-xs opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('status.loading')}
          </div>
        ) : loadFailed ? (
          /* 错误态与空态必须分开：失败渲染成「暂无技能」会让用户以为本来就没有 */
          <div className="text-center py-10 text-xs space-y-2">
            <div style={{ color: 'var(--color-error)' }}>{t('common.loadFailed')}</div>
            <Button type="button" variant="outline" onClick={() => void loadSkills()}>
              {t('action.retry')}
            </Button>
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
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-editor-bg)] px-3 py-2"
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
                <Button type="button" variant="ghost" size="icon" className="size-[32px] shrink-0"
                  onClick={() => handleDelete(skill.name)} title={t('action.delete')} aria-label={`${t('action.delete')} ${skill.name}`}>
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
