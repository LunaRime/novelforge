/**
 * CharactersView — 角色管理列表视图 (v7 戏份分级)
 */
import { useState, useMemo, useId } from 'react'
import { Users, RefreshCw, Sparkles, ChevronDown, ChevronRight, Radar, Network } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import {
  useCharacterStore, groupByTier,
} from '../../../stores/character-store'
import type { CharacterCard } from '../../../stores/character-store'
import { Button } from '../../ui/Button'
import { CreateIcon } from '../../ui/ActionIcons'
import { Input } from '../../ui/Input'
import { EmptyState } from '../../ui/EmptyState'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../hooks/useTranslation'
import { useWorkflowCompletion } from '../../../hooks/useWorkflowCompletion'
import { openBuiltinEditor } from './SidebarShared'
import { runCharacterArchive } from '../../../services/workflows/character-archive-workflow'
import { parseAliases } from '../../../services/character-normalize'
import { renderLog } from '../../../services/render-logger'
import { captureCharacterSource, isCharacterSourceCurrent, readCharacterEdits } from '../../../services/characters/character-edits-adapter'

import { FilterButtons } from '../../ui/ChoiceControls'
import CountBadge from '../../ui/CountBadge'
import { SemanticLabel } from '../../ui/SemanticLabel'
import { characterRole, characterRoles, characterTier } from '../../editor/character-labels'
import { readAppearanceChapters } from '../../editor/character-links'
import MenuRow from '../../ui/MenuRow'

export default function CharactersView({ headerAction }: { headerAction?: React.ReactNode }) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const view = useCharacterStore(s => s.view)
  const setView = useCharacterStore(s => s.setView)
  const load = useCharacterStore(s => s.load)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const addCharacter = useCharacterStore(s => s.addCharacter)
  const dirty = useCharacterStore(s => s.dirty)

  /** 刷新：有未保存编辑时先确认（P3 修复——此前一键 load 直接丢弃全部未保存修改） */
  const handleRefresh = async () => {
    const source = captureCharacterSource()
    if (!source) return
    if (dirty) {
      const ok = await confirm(t('character.refreshConfirm'), {
        title: t('charList.refresh'),
        confirmText: t('charList.refresh'),
        danger: true,
      })
      if (!ok) return
    }
    if (isCharacterSourceCurrent(source)) void load(true)
  }
  // 「从定稿生成档案」执行中状态：线③ 第 3 条——状态机抽 useWorkflowCompletion（60s 超时显式失败）
  const { running: archiving, start: startArchive } = useWorkflowCompletion()
  const handleArchive = async () => {
    const source = captureCharacterSource()
    if (!source) return
    const ok = await confirm(t('character.archiveConfirm'), { title: t('character.archiveBtn'), confirmText: t('action.confirm') })
    if (!ok || !isCharacterSourceCurrent(source)) return
    startArchive(
      () => runCharacterArchive(source.path),
      {
        workflowType: 'post_process',
        onDone: (status) => {
          if (status === 'timeout') toast.error(t('character.archiveTimeout'))
          else if (status === 'failed') toast.error(t('character.archiveFailed'))
        },
      },
    )
  }
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [collapsedTiers, setCollapsedTiers] = useState<Record<number, boolean>>({ 2: false, 3: true })
  const groupsId = useId()
  // P1-1：名字/别名即时过滤（大小写不敏感；空查询 = 全部）
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  // P2-1：出场统计扫描（存量项目生命周期字段回填 + 疑似退场提示）
  const [scanning, setScanning] = useState(false)
  const handleScan = async () => {
    const source = captureCharacterSource()
    if (!source) return
    if (dirty) {
      const ok = await confirm(t('character.refreshConfirm'), {
        title: t('charList.refresh'),
        confirmText: t('charList.refresh'),
        danger: true,
      })
      if (!ok || !isCharacterSourceCurrent(source)) return
    }
    const ok2 = await confirm(t('charList.scanConfirm'), { title: t('charList.scanAppearances'), confirmText: t('action.confirm') })
    if (!ok2 || !isCharacterSourceCurrent(source)) return
    const confirmedCards = useCharacterStore.getState().characters
    setScanning(true)
    try {
      const { loadFinalizedChapters, scanCharacterAppearances, saveAppearanceStats, DEPARTED_GAP } =
        await import('../../../services/character-appearance-scan')
      const snapshot = await readCharacterEdits(source)
      const chapters = await loadFinalizedChapters(source)
      if (chapters.length === 0) {
        toast.warning(t('charList.scanNoFinalized'))
        return
      }
      const result = scanCharacterAppearances(chapters, snapshot.cards)
      const updated = await saveAppearanceStats(result.stats, source, snapshot)
      if (!isCharacterSourceCurrent(source)) return
      renderLog('info', 'Scan:Appearances', t('charList.scanDone').replace('{n}', String(updated)))
      toast.success(t('charList.scanDone').replace('{n}', String(updated)))
      if (result.departed.length > 0) {
        toast.warning(t('charList.scanDeparted')
          .replace('{gap}', String(DEPARTED_GAP))
          .replace('{names}', result.departed.join('、')))
      }
      await load(useCharacterStore.getState().characters === confirmedCards)
    } catch (e) {
      if (!isCharacterSourceCurrent(source)) return
      renderLog('error', 'Scan:Appearances', t('charList.scanFailed').replace('{error}', () => String(e)))
      toast.error(t('charList.scanFailed').replace('{error}', () => String(e)))
    } finally {
      setScanning(false)
    }
  }

  const grouped = useMemo(() => groupByTier(characters), [characters])
  const display = useMemo(() => {
    const filtered = q
      ? characters.filter(c => {
          const hay = [c.name, ...parseAliases(c.aliases)].join(' ').toLowerCase()
          return hay.includes(q)
        })
      : characters
    const byTier = groupByTier(filtered)
    if (tierFilter === null) return byTier
    return { [tierFilter]: byTier[tierFilter] || [] }
  }, [characters, tierFilter, q])

  if (!currentProject) {
    return <EmptyState icon={<Users size={36} />} message={t('empty.pleaseOpenProject')} className="pb-[15vh]" opacity={0.4} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between gap-1 px-2 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] min-w-0 truncate" title={t('charList.title')}>
          {t('charList.title')} ({characters.length})
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-[32px]" onClick={handleRefresh} title={t('charList.refresh')} aria-label={t('charList.refresh')}>
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          </Button>
          {/* P2-1：出场统计扫描（存量项目生命周期字段回填） */}
          <Button variant="ghost" size="icon" className="size-[32px]" onClick={() => void handleScan()} disabled={scanning} title={t('charList.scanAppearances')} aria-label={t('charList.scanAppearances')}>
            <Radar size={14} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" className="size-[32px]" onClick={handleArchive} disabled={archiving} title={t('character.archiveBtnTitle')} aria-label={t('character.archiveBtnTitle')}>
            <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" className="size-[32px]" onClick={() => {
            addCharacter()
            openBuiltinEditor('character-editor', t('character.viewProfile'), 'character')
          }} title={t('charList.newChar')} aria-label={t('charList.newChar')}>
            <CreateIcon size={14} />
          </Button>
          {headerAction}
        </div>
      </div>

      {/* 筛选选项和分组标题共用角色等级语义。 */}
      <FilterButtons
        className="shrink-0 border-b border-[var(--color-border)] px-2 py-1.5"
        size="sm"
        value={tierFilter ?? 0}
        onChange={tier => setTierFilter(tier || null)}
        items={[0, 1, 2, 3].map(tier => ({
          value: tier,
          label: <>
            {tier === 0 ? t('charList.filterAll') : t(characterTier(tier).label)}
            <CountBadge value={tier === 0 ? characters.length : (grouped[tier] || []).length} />
          </>,
        }))}
      />

      <div className="shrink-0 border-b border-[var(--color-border)] px-1 pb-1.5 pt-1">
        <MenuRow
          icon={<Network size={14} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />}
          title={t('character.viewGraph')}
          titleHint={t('character.viewRelations')}
          swap="nav"
          active={view === 'graph'}
          onPrimary={() => {
            setView('graph')
            openBuiltinEditor('character-editor', t('character.viewProfile'), 'character')
          }}
        />
        <div className="px-1 pt-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('charList.searchPlaceholder')}
            aria-label={t('charList.searchPlaceholder')}
            className="h-8 px-2"
          />
        </div>
      </div>

      {/* 角色列表 — 按 tier 分组 */}
      <div className="flex-1 overflow-y-auto p-1">
        {characters.length === 0 ? (
          <EmptyState message={t('character.empty')} size="xs" className="text-center" />
        ) : !Object.values(display).some(cards => cards.length > 0) ? (
          <EmptyState message={t('charList.noMatches')} size="xs" className="text-center" />
        ) : (
          [1, 2, 3].map(tier => {
            const chars = display[tier] || []
            if (chars.length === 0) return null
            const collapsed = collapsedTiers[tier] ?? false
            const groupId = `${groupsId}-${tier}`
            return (
              <div key={tier}>
                {/* 网格伸展将原生按钮铺满行宽，行片两侧各 4px 外边距与搜索框边缘对齐。 */}
                <div className="grid">
                  <button
                    className="menu-chip gap-1.5 border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer"
                    onClick={() => setCollapsedTiers(prev => ({ ...prev, [tier]: !collapsed }))}
                    aria-expanded={!collapsed}
                    aria-controls={groupId}
                    type="button"
                  >
                    {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    <SemanticLabel name={characterTier(tier).icon}>{t(characterTier(tier).label)}</SemanticLabel>
                    <CountBadge value={chars.length} className="ml-auto" />
                  </button>
                </div>
                <div id={groupId} hidden={collapsed}>
                  {!collapsed && chars.map(c => (
                    <CharItem
                      key={c.name}
                      char={c}
                      selected={view !== 'graph' && selectedName === c.name}
                      onClick={() => {
                        setSelectedName(c.name)
                        setView('edit')
                        openBuiltinEditor('character-editor', t('character.viewProfile'), 'character')
                      }}
                    />
                  ))}
                </div>
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

  const chaps = readAppearanceChapters(c.appearChapters)

  const chapsDisplay = chaps.length <= 3
    ? chaps.join(',')
    : t('character.chapterRange')
        .replace('{start}', String(chaps[0]))
        .replace('{end}', String(chaps[chaps.length - 1]))
        .replace('{n}', String(chaps.length))

  const tier = c.tier ?? (c.role === 'protagonist' || c.role === 'antagonist' ? 1 : 2)
  const role = characterRole(c.role)

  /* 2026-09-28 批 0：行容器改「行片」（`.menu-chip`）——圆角/左右外边距/悬停底色/2px 片间距
     全部由片承担，原 `rounded-md`/`hover:bg-*`/`mb-0.5`/`transition-colors` 随之删除。
     高度改由内容决定（`height:auto` + `minHeight:32`）：片的基础几何 `height:32px` 是为
     **单行**菜单行定的，而本行是多行条目（姓名行 + 角色行 + 可选标签行，估算 ~40–58px），
     照搬固定高会把内容压出片外。`minHeight:32` 保证内容再短也不低于片的基准高；
     `items-stretch` 让主按钮铺满片高（片底色由 `:has(button)` 点亮，按钮短一截就会留下
     「亮着点不动」的死带）。
     ⚠️ 片内**唯一**元素子节点就是主按钮（flex 项按 CSS 规则被块化 ⇒ 块级载体），姓名/角色/标签
     三行全是它的块级子块、在原位纵向堆叠 ⇒ **不存在**「并列子块被 flex 横排」的形态，故未再加
     一层 wrapper、也未覆盖 `flex-col`（片只有这一个子项，两种写法都只是多一层空壳）。 */
  return (
    <div
      className={cn(
        'menu-chip items-stretch text-xs',
        selected
          ? 'bg-[var(--color-active)] text-[var(--color-text)]'
          : 'text-[var(--color-text-secondary)]'
      )}
      style={{ height: 'auto', minHeight: 32 }}
    >
      {/* 2026-09-25 重构：选中此前在 `<div onClick>` 上 —— 键盘完全够不到。
          本行是多行块（姓名行 / 角色行 / 标签行纵向排列），故主按钮不用参考实现的单行 flex 布局，
          保持原有纵向堆叠与整宽热区；行内无其他按钮，纯转向。
          2026-09-28 批 0：内边距（`px-2.5 py-1.5`）由行容器移到**可点的主按钮**上 —— 挂在片上
          会在片底色里造出「亮起但点不动」的死带（2026-09-27 修过的同类缺陷）；
          并去 `block w-full`（主按钮已是 `flex-1` 铺满片宽，`w-full` 只会与片的 4px 外边距打架）。 */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 px-2.5 py-1.5 text-left enabled:cursor-pointer"
      >
        <div className="flex items-center gap-1">
          <span className="font-medium truncate">{c.name || t('character.unnamed')}</span>
          {/* P1-6：生命周期状态徽标（退场/死亡角色列表可见，编辑器中可切换） */}
          {c.status && c.status !== 'active' && (
            <span
              className="text-2xs px-1 rounded flex-shrink-0"
              style={{
                backgroundColor: c.status === 'dead' ? 'rgba(var(--color-error-rgb),0.15)' : 'var(--color-hover)',
                color: c.status === 'dead' ? 'var(--color-error)' : 'var(--color-text-muted)',
              }}
            >
              {c.status === 'dead' ? t('character.statusDead') : t('character.statusDeparted')}
            </span>
          )}
          {c.currentState?.updatedAtChapter ? (
            <span className="text-2xs opacity-40 ml-auto flex-shrink-0">
              {t('chapter.nLabel').replace('{n}', String(c.currentState.updatedAtChapter))}
            </span>
          ) : null}
        </div>
        <div className="text-micro mt-0.5 flex items-center gap-2 text-[var(--color-text-secondary)]">
          <SemanticLabel name={role}>{t(characterRoles[role])}</SemanticLabel>
          {tier === 1 && chaps.length > 0 && (
            <span className="text-[var(--color-text-muted)]">{chapsDisplay}</span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="text-2xs px-1 rounded"
                style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
              >
                #{tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-2xs opacity-40">+{tags.length - 3}</span>
            )}
          </div>
        )}
      </button>
    </div>
  )
}
