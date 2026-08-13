/**
 * CharactersView — 角色管理列表视图 (v7 戏份分级)
 */
import { useState, useMemo, useRef } from 'react'
import { Users, RefreshCw, Plus, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import {
  useCharacterStore, groupByTier,
} from '../../../stores/character-store'
import type { CharacterCard } from '../../../stores/character-store'
import type { TextKey } from '../../../shared/locale'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../hooks/useTranslation'
import { openBuiltinEditor } from './SidebarShared'
import { runCharacterArchive } from '../../../services/workflows/character-archive-workflow'

// 角色定位 / 戏份等级 i18n 映射（不使用 store 硬编码常量，语言切换即时更新）
const ROLE_LABEL_KEYS: Record<CharacterCard['role'], TextKey> = {
  protagonist: 'character.roleLabel.protagonist',
  antagonist: 'character.roleLabel.antagonist',
  supporting: 'character.roleLabel.supporting',
  minor: 'character.roleLabel.minor',
}
const TIER_LABEL_KEYS: Record<number, TextKey> = {
  1: 'character.tierLabel.core',
  2: 'character.tierLabel.important',
  3: 'character.tierLabel.minor',
}

export default function CharactersView() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const load = useCharacterStore(s => s.load)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const addCharacter = useCharacterStore(s => s.addCharacter)
  const dirty = useCharacterStore(s => s.dirty)

  /** 刷新：有未保存编辑时先确认（P3 修复——此前一键 load 直接丢弃全部未保存修改） */
  const handleRefresh = async () => {
    if (dirty) {
      const ok = await confirm(t('character.refreshConfirm'), {
        title: t('charList.refresh'),
        confirmText: t('charList.refresh'),
        danger: true,
      })
      if (!ok) return
    }
    load(true) // 手动刷新（已确认）→ force 跳过 dirty 检查
  }
  // 「从定稿生成档案」执行中状态：由 WORKFLOW_COMPLETE 事件驱动结束（60s 兜底释放监听）
  // 竞态防护：stop 统一 unsub + 清 timer，任何触发路径（完成/兜底）都彻底释放——
  // 残留 timer 不再可能在前一轮结束后误伤下一轮的 setArchiving（此前 run1 到期残留
  // timer 会在 run2 进行中提前解锁按钮 → 并发工作流 → 重复 LLM 计费）
  const [archiving, setArchiving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleArchive = async () => {
    const ok = await confirm(t('character.archiveConfirm'), { title: t('character.archiveBtn'), confirmText: t('action.confirm') })
    if (!ok) return
    const project = currentProject
    if (!project) return
    const { globalEventBus } = await import('../../../shared/event-bus')
    setArchiving(true)
    let unsub: () => void = () => {}
    const stop = () => {
      unsub()
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      setArchiving(false)
    }
    unsub = globalEventBus.on('WORKFLOW_COMPLETE', stop)
    // 兜底：60s 后释放监听（失败路径 executor throw 不发 WORKFLOW_COMPLETE，悬挂至此）
    timerRef.current = setTimeout(stop, 60000)
    runCharacterArchive(project.path)
  }
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [collapsedTiers, setCollapsedTiers] = useState<Record<number, boolean>>({ 2: false, 3: true })

  const grouped = useMemo(() => groupByTier(characters), [characters])
  const display = useMemo(() => {
    if (tierFilter === null) return grouped
    return { [tierFilter]: grouped[tierFilter] || [] }
  }, [grouped, tierFilter])

  if (!currentProject) {
    return <EmptyState icon={<Users size={36} />} message={t('blueprint.openProjectFirst')} className="pb-[15vh]" opacity={0.4} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1">
          <Users size={13} />
          {t('charList.title')} ({characters.length})
        </span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh} title={t('charList.refresh')}>
            <RefreshCw size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleArchive} disabled={archiving} title={t('character.archiveBtnTitle')}>
            <Sparkles size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addCharacter} title={t('charList.newChar')}>
            <Plus size={14} strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* 分级筛选标签 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)] flex-shrink-0">
        {[null, 1, 2, 3].map(tier => (
          <button
            key={String(tier)}
            className={cn(
              'text-[0.65rem] px-2 py-0.5 rounded-full transition-colors cursor-pointer border',
              tierFilter === tier
                ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]'
            )}
            onClick={() => setTierFilter(tier)}
            type="button"
          >
            {tier === null ? t('charList.filterAll') : t(TIER_LABEL_KEYS[tier] ?? 'character.tierLabel.core')}
            <span className="ml-0.5 opacity-60">{tier === null ? characters.length : (grouped[tier] || []).length}</span>
          </button>
        ))}
      </div>

      {/* 角色列表 — 按 tier 分组 */}
      <div className="flex-1 overflow-y-auto p-1">
        {characters.length === 0 ? (
          <div className="text-center py-6 opacity-30 text-xs">{t('character.empty')}</div>
        ) : (
          [1, 2, 3].map(tier => {
            const chars = display[tier] || []
            if (chars.length === 0) return null
            const collapsed = collapsedTiers[tier] ?? false
            return (
              <div key={tier}>
                {/* tier 分组头 */}
                <button
                  className="flex items-center gap-1 px-2 py-1 w-full text-[0.65rem] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] rounded cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setCollapsedTiers(prev => ({ ...prev, [tier]: !collapsed })) }}
                  type="button"
                >
                  {collapsed
                    ? <ChevronRight size={10} />
                    : <ChevronDown size={10} />
                  }
                  {t(TIER_LABEL_KEYS[tier] ?? 'character.tierLabel.core')}
                  <span className="opacity-50 ml-auto">{chars.length}</span>
                </button>
                {!collapsed && chars.map(c => (
                  <CharItem
                    key={c.name}
                    char={c}
                    selected={selectedName === c.name}
                    onClick={() => {
                      // 角色 Tab 可能被手动关闭——点击角色时确保重新打开并激活
                      // （openFile 已存在则仅激活；不存在则新开 'character-editor' Tab）
                      openBuiltinEditor('character-editor', t('charList.title'), 'character')
                      setSelectedName(c.name)
                    }}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function CharItem({ char: c, selected, onClick }: {
  char: CharacterCard; selected: boolean; onClick: () => void
}) {
  const { t } = useTranslation()

  // 解析标签
  let tags: string[] = []
  try { tags = JSON.parse(c.tags || '[]') } catch { tags = [] }

  // 解析出场章节（Array.isArray 守卫：裸 JSON 文本框可存 "1,5" 字符串——此前 join 抛 TypeError 崩溃）
  let chaps: number[] = []
  try {
    const parsed = JSON.parse(c.appearChapters || '[]')
    if (Array.isArray(parsed)) chaps = parsed as number[]
  } catch { chaps = [] }

  const chapsDisplay = chaps.length <= 3
    ? chaps.join(',')
    : t('character.chapterRange')
        .replace('{start}', String(chaps[0]))
        .replace('{end}', String(chaps[chaps.length - 1]))
        .replace('{n}', String(chaps.length))

  const tier = c.tier ?? (c.role === 'protagonist' || c.role === 'antagonist' ? 1 : 2)

  return (
    <div
      className={cn(
        'px-2.5 py-1.5 rounded-md text-xs cursor-pointer mb-0.5 transition-colors',
        selected
          ? 'bg-[var(--color-active)] text-[var(--color-text)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium truncate">{c.name || t('character.unnamed')}</span>
        {/* P1-6：生命周期状态徽标（退场/死亡角色列表可见，编辑器中可切换） */}
        {c.status && c.status !== 'active' && (
          <span
            className="text-[0.55rem] px-1 rounded flex-shrink-0"
            style={{
              backgroundColor: c.status === 'dead' ? 'rgba(239,68,68,0.15)' : 'var(--color-hover)',
              color: c.status === 'dead' ? 'var(--color-error)' : 'var(--color-text-muted)',
            }}
          >
            {c.status === 'dead' ? t('character.statusDead') : t('character.statusDeparted')}
          </span>
        )}
        {c.currentState?.updatedAtChapter ? (
          <span className="text-[0.6rem] opacity-40 ml-auto flex-shrink-0">
            {t('chapter.nLabel').replace('{n}', String(c.currentState.updatedAtChapter))}
          </span>
        ) : null}
      </div>
      <div className="text-[0.7rem] mt-0.5 opacity-60 flex items-center gap-1.5">
        <span>{t(ROLE_LABEL_KEYS[c.role] ?? 'character.roleLabel.supporting')}</span>
        {tier === 1 && chaps.length > 0 && (
          <span className="opacity-50">· {chapsDisplay}</span>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="text-[0.6rem] px-1 rounded"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
            >
              #{tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[0.6rem] opacity-40">+{tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  )
}
