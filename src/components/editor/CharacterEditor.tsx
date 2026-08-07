import { useState } from 'react'
import { Save, Trash2, Users, Network, Link2, Plus, X, MessagesSquare, BookmarkPlus, FileInput, Sparkles } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'
import {
  useCharacterStore,
  EMPTY_STATE,
  type CharacterCurrentState,
} from '../../stores/character-store'
import RelationshipGraph from './RelationshipGraph'
import CharacterBacklinks from './CharacterBacklinks'
import { EmptyState as BaseEmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { useTranslation } from '../../hooks/useTranslation'
import { runCharacterArchive } from '../../services/workflows/character-archive-workflow'

/**
 * 角色卡编辑器 — 纯编辑区域（角色列表已移至侧栏）
 * 从 character-store 读取选中角色，仅渲染编辑表单。
 */
export default function CharacterEditor() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const saving = useCharacterStore(s => s.saving)
  const updateField = useCharacterStore(s => s.updateField)
  const deleteCharacter = useCharacterStore(s => s.deleteCharacter)
  const saveAll = useCharacterStore(s => s.saveAll)
  const [viewMode, setViewMode] = useState<'edit' | 'state' | 'graph' | 'backlinks'>('edit')

  // 数据由 ProjectService 统一加载，组件只消费 store 数据

  const selectedCard = characters.find((c) => c.name === selectedName) || null

  // tags 存储为 JSON 数组字符串（角色列表按 JSON.parse 消费，v7 语义）；
  // 编辑器显示逗号分隔文本，保存时转回 JSON 数组——两端格式统一
  const tagsDisplay = (() => {
    const raw = selectedCard?.tags || ''
    if (!raw) return ''
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.join('、') : raw
    } catch {
      return raw // 旧数据纯文本，原样显示
    }
  })()

  const onTagsChange = (value: string) => {
    if (!selectedCard) return
    const tags = value
      .split(/[，,、；;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    updateField(selectedCard.name, 'tags', tags.length > 0 ? JSON.stringify(tags.slice(0, 8)) : '')
  }

  const handleDelete = async () => {
    if (!selectedCard || !currentProject) return
    const ok = await confirm(
      t('character.deleteConfirm').replace('{name}', selectedCard.name || t('character.unnamed')),
      { title: t('character.deleteTitle'), confirmText: t('action.delete'), danger: true }
    )
    if (!ok) return
    await deleteCharacter(selectedCard.name, currentProject.path)
  }

  // 「从定稿生成档案」（单角色）：确认后仅针对当前选中角色执行
  const [archiving, setArchiving] = useState(false)
  const handleArchive = async () => {
    if (!selectedCard || !currentProject) return
    const ok = await confirm(t('character.archiveConfirm'), { title: t('character.archiveBtn'), confirmText: t('action.confirm') })
    if (!ok) return
    const { globalEventBus } = await import('../../shared/event-bus')
    const stop = () => setArchiving(false)
    const unsub = globalEventBus.on('WORKFLOW_COMPLETE', stop)
    setArchiving(true)
    runCharacterArchive(currentProject.path, selectedCard.name)
    // 兜底：60s 后释放监听（工作流事件已触发过则不重复执行）
    setTimeout(() => { unsub(); setArchiving(false) }, 60000)
  }

  // ===== 角色卡模板（~/.vela/templates/）：存为模板 / 应用模板 =====

  /** 模板列表（应用模板下拉用；空 = 未加载/无模板） */
  const [templates, setTemplates] = useState<Array<{ name: string; description: string }>>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)

  /** 加载模板元信息（下拉展开前拉取一次） */
  const loadTemplates = async () => {
    if (templatesLoaded) return
    try {
      const { ipc } = await import('../../services/ipc-client')
      setTemplates(await ipc.invoke('templates:list'))
      setTemplatesLoaded(true)
    } catch { /* 加载失败静默（下拉显示空） */ }
  }

  /** 存为模板：当前角色卡 → ~/.vela/templates/{角色名}.json（schema 校验在模板定义层） */
  const handleSaveTemplate = async () => {
    if (!selectedCard) return
    try {
      const { ipc } = await import('../../services/ipc-client')
      const res = await ipc.invoke('templates:save', {
        name: selectedCard.name,
        data: { ...selectedCard } as Record<string, unknown>,
      })
      if (!res.success) throw new Error(res.error || 'save failed')
      setTemplatesLoaded(false) // 下次下拉重新加载（含新模板）
      toast.success(t('template.saveSuccess').replace('{name}', selectedCard.name))
      renderLog('info', 'Save:Template', t('template.saveSuccess').replace('{name}', selectedCard.name))
    } catch (e) {
      toast.error(t('template.saveFailed').replace('{error}', String(e)))
    }
  }

  /** 应用模板：填充角色卡字段（跳过 name 主键，其余字段覆盖） */
  const handleApplyTemplate = async (tplName: string) => {
    if (!selectedCard || !tplName) return
    try {
      const { ipc } = await import('../../services/ipc-client')
      const data = await ipc.invoke('templates:get', tplName)
      if (!data) throw new Error('template data not found')
      for (const [key, value] of Object.entries(data)) {
        if (key === 'name' || key === 'relations' || key === 'appearChapters') continue // 主键/章节归属不覆盖
        if (typeof value === 'string') {
          // 动态 key 绕过泛型（运行时安全：模板字段均为角色卡文本字段）
          (updateField as (name: string, key: string, value: unknown) => void)(selectedCard.name, key, value)
        }
      }
      toast.success(t('template.applySuccess').replace('{name}', tplName))
    } catch (e) {
      toast.error(t('template.applyFailed').replace('{error}', String(e)))
    }
  }

  /** 角色试演：新建绑定角色的 Agent 会话（角色 prompt 在 sendMessage 时注入）并打开 AI 面板 */
  const handleRoleplay = () => {
    if (!selectedCard) return
    void (async () => {
      const { useAgentStore } = await import('../../stores/agent-store')
      const { useLayoutStore } = await import('../../stores/layout-store')
      const conv = useAgentStore.getState().createConversation({
        roleplayCharacter: selectedCard.name,
        title: t('roleplay.newConversation').replace('{name}', selectedCard.name),
      })
      useLayoutStore.getState().setAIPanelOpen(true)
      // 视觉反馈：会话已创建并打开 AI 面板（此前点击后无感知）
      toast.success(t('roleplay.created').replace('{name}', selectedCard.name).replace('{title}', conv.title))
    })()
  }

  const handleSave = async () => {
    if (!currentProject || !selectedCard) return
    // 出场章节 JSON 校验（裸文本框可输入 5 / "1,5" —— 非法值曾导致角色列表/反向链接渲染崩溃）
    try {
      const parsed = JSON.parse(selectedCard.appearChapters || '[]')
      if (!Array.isArray(parsed) || parsed.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
        toast.error(t('character.invalidAppearChapters'))
        return
      }
    } catch {
      toast.error(t('character.invalidAppearChapters'))
      return
    }
    const t0 = Date.now()
    try {
      await saveAll(currentProject.path)
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Character', t('log.render.characterSaveSuccess')
        .replace('{count}', String(characters.length))
        .replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
    } catch (e) {
      // 失败：toast + error 日志（含原因）
      renderLog('error', 'Save:Character', t('log.render.characterSaveFailed').replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
  }

  // ===== 渲染 =====

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* 统一顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
            {viewMode === 'graph'
              ? t('character.viewGraph')
              : selectedCard
                ? `${selectedCard.name || t('character.newCharacter')} ${viewMode === 'state' ? `— ${t('character.viewState')}` : `— ${t('character.viewEdit')}`}`
                : t('character.viewProfile')}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {viewMode === 'graph' ? (
            <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title={t('character.backToEdit')}>
              <Users size={12} /> {t('character.editMode')}
            </Button>
          ) : viewMode === 'backlinks' ? (
            <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title={t('character.backToEdit')}>
              <Users size={12} /> {t('character.editMode')}
            </Button>
          ) : selectedCard ? (
            <>
              {viewMode === 'state' ? (
                <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title={t('character.backToBasic')}>
                  <Users size={12} /> {t('character.basicSettings')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setViewMode('state')} title={t('character.viewCurrentState')}>
                  📋 {t('character.currentState')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={t('character.viewRelations')}>
                <Network size={12} /> {t('character.relationGraph')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setViewMode('backlinks')} title={t('character.viewBacklinks')}>
                <Link2 size={12} /> {t('character.backlinks')}
              </Button>
              {/* 从定稿生成档案：仅当前选中角色，确认后由工作流驱动（执行中禁用防重入） */}
              <Button variant="outline" size="sm" onClick={handleArchive} disabled={archiving} title={t('character.archiveBtnTitle')}>
                <Sparkles size={12} /> {archiving ? t('character.archiveRunning') : t('character.archiveBtn')}
              </Button>
              {/* 角色试演：新建绑定角色的 Agent 会话并打开 AI 面板（OOC 约束在 roleplay prompt 内） */}
              <Button variant="outline" size="sm" onClick={handleRoleplay} title={t('roleplay.enter')}>
                <MessagesSquare size={12} /> {t('roleplay.enter')}
              </Button>
              {/* 角色卡模板：存为模板（当前卡 → ~/.vela/templates/）/ 应用模板（下拉选择填充） */}
              <Button variant="outline" size="sm" onClick={handleSaveTemplate} title={t('template.saveAs')}>
                <BookmarkPlus size={12} />
              </Button>
              <Select value="" onValueChange={(v) => void handleApplyTemplate(v)} onOpenChange={(open) => { if (open) void loadTemplates() }}>
                <SelectTrigger className="h-6 w-6 rounded-[var(--radius-sm)] justify-center" title={t('template.apply')}>
                  <FileInput size={12} />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 ? (
                    <div className="px-2 py-1 text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>{t('template.empty')}</div>
                  ) : templates.map(tp => (
                    <SelectItem key={tp.name} value={tp.name}>{tp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 size={12} /> {t('action.delete')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                <Save size={12} /> {saving ? t('status.saving') : t('action.save')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={t('character.viewRelations')}>
              <Network size={12} /> {t('character.relationGraph')}
            </Button>
          )}
        </div>
      </div>

      {/* 主体区 */}
      <div className="flex-1 overflow-y-auto relative">
        {viewMode === 'graph' ? (
          <RelationshipGraph
            characters={characters}
            onSelect={(name) => { setViewMode('edit'); useCharacterStore.getState().setSelectedName(name) }}
          />
        ) : viewMode === 'backlinks' && selectedCard ? (
          <CharacterBacklinks character={selectedCard} allCharacters={characters} />
        ) : !selectedCard ? (
          <BaseEmptyState
            icon={<Users size={36} />}
            message={currentProject ? t('character.selectOrCreate') : t('blueprint.openProjectFirst')}
            opacity={currentProject ? 0.3 : 0.4}
          />
        ) : viewMode === 'state' ? (
          <div className="max-w-2xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--color-text)]">
                {t('character.stateProfile')}
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {t('character.lastUpdated').replace('{n}', String(selectedCard.currentState?.updatedAtChapter ?? 0))}
              </span>
            </div>
            <div className="space-y-3">
              {([
                ['location', 'character.state.location'],
                ['powerLevel', 'character.state.powerLevel'],
                ['physicalState', 'character.state.physicalState'],
                ['mentalState', 'character.state.mentalState'],
                ['keyItems', 'character.state.keyItems'],
                ['recentEvents', 'character.state.recentEvents'],
              ] as const).map(([field, labelKey]) => (
                <div key={field}>
                  <Label>{t(labelKey)}</Label>
                  <Textarea
                    value={selectedCard.currentState?.[field]?.toString() ?? ''}
                    onChange={(e) => {
                      const cs: CharacterCurrentState = {
                        ...(selectedCard.currentState ?? EMPTY_STATE),
                        [field]: e.target.value,
                      }
                      updateField(selectedCard.name, 'currentState', cs)
                    }}
                    rows={2}
                    placeholder={`${t(labelKey)}...`}
                  />
                </div>
              ))}
            </div>
            {!selectedCard.currentState && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--color-hover)] text-xs text-[var(--color-text-secondary)]">
                {t('character.stateHint')}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-4">
            <div className="space-y-3">
              {/* 戏份等级 + 角色定位 */}
              <div className="grid grid-cols-3 gap-3">
                <div><Label>{t('character.name')}</Label><Input value={selectedCard.name} onChange={(e) => updateField(selectedCard.name, 'name', e.target.value)} /></div>
                <div>
                  <Label>{t('character.tier')}</Label>
                  <Select
                    value={String(selectedCard.tier ?? 2)}
                    onValueChange={(v) => updateField(selectedCard.name, 'tier', parseInt(v))}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(getTierMap(t)).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('character.position')}</Label>
                  <Select value={selectedCard.role} onValueChange={(v) => updateField(selectedCard.name, 'role', v as typeof selectedCard.role)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(getRoleMap(t)).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 出场章节 + 标签 — 所有 tier 通用 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('character.appearChapters')}</Label>
                  <Input
                    value={selectedCard.appearChapters || '[]'}
                    onChange={(e) => updateField(selectedCard.name, 'appearChapters', e.target.value)}
                    placeholder="[1,5,10]"
                  />
                </div>
                <div>
                  <Label>{t('character.tags')}</Label>
                  <Input
                    value={tagsDisplay}
                    onChange={(e) => onTagsChange(e.target.value)}
                    placeholder={t('character.tagsPlaceholder')}
                  />
                </div>
              </div>

              {/* === Tier 1-2: 核心字段 === */}
              {(selectedCard.tier ?? 2) <= 2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>{t('character.gender')}</Label><Input value={selectedCard.gender} onChange={(e) => updateField(selectedCard.name, 'gender', e.target.value)} /></div>
                    <div><Label>{t('character.age')}</Label><Input value={selectedCard.age} onChange={(e) => updateField(selectedCard.name, 'age', e.target.value)} /></div>
                  </div>
                  <div><Label>{t('character.appearance')}</Label><Textarea value={selectedCard.appearance} onChange={(e) => updateField(selectedCard.name, 'appearance', e.target.value)} rows={3} /></div>
                  <div><Label>{t('character.personality')}</Label><Textarea value={selectedCard.personality} onChange={(e) => updateField(selectedCard.name, 'personality', e.target.value)} rows={3} /></div>
                </>
              )}

              {/* === Tier 1: 完整档案 === */}
              {(selectedCard.tier ?? 2) <= 1 && (
                <>
                  <div><Label>{t('character.background')}</Label><Textarea value={selectedCard.background} onChange={(e) => updateField(selectedCard.name, 'background', e.target.value)} rows={4} /></div>
                  <div><Label>{t('character.abilities')}</Label><Textarea value={selectedCard.abilities} onChange={(e) => updateField(selectedCard.name, 'abilities', e.target.value)} rows={3} /></div>
                  <div><Label>{t('character.motivation')}</Label><Textarea value={selectedCard.motivation} onChange={(e) => updateField(selectedCard.name, 'motivation', e.target.value)} rows={2} /></div>
                  {/* 结构化关系编辑器 */}
                  <StructuredRelations
                    relations={selectedCard.relations || '[]'}
                    allCharacters={characters.map(c => c.name)}
                    currentName={selectedCard.name}
                    onChange={(val) => updateField(selectedCard.name, 'relations', val)}
                    t={t}
                  />
                  {/* 旧版关系文本（保留兼容） */}
                  <details className="mt-2">
                    <summary className="text-[0.65rem] text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text)]">
                      {t('character.legacyRelations')}
                    </summary>
                    <div className="mt-1"><Textarea value={selectedCard.relationships} onChange={(e) => updateField(selectedCard.name, 'relationships', e.target.value)} rows={3} placeholder={t('character.legacyPlaceholder')} /></div>
                  </details>
                  <div><Label>{t('character.arc')}</Label><Textarea value={selectedCard.arc} onChange={(e) => updateField(selectedCard.name, 'arc', e.target.value)} rows={3} /></div>
                </>
              )}

              {/* 所有 tier 通用：备注 */}
              <div><Label>{t('character.notes')}</Label><Textarea value={selectedCard.notes} onChange={(e) => updateField(selectedCard.name, 'notes', e.target.value)} rows={2} /></div>

              {/* tier 3 提示 */}
              {(selectedCard.tier ?? 2) >= 3 && (
                <div className="p-2 rounded text-[0.65rem]" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}>
                  {t('character.tier3Hint')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 结构化关系编辑器 =====

function getRelTypeMap(t: ReturnType<typeof useTranslation>['t']): Record<string, string> {
  return {
    ally: t('character.relType.ally'), enemy: t('character.relType.enemy'), family: t('character.relType.family'),
    master_student: t('character.relType.masterStudent'), lover: t('character.relType.lover'), rival: t('character.relType.rival'),
    neutral: t('character.relType.neutral'), other: t('character.relType.other'),
  }
}

function getRoleMap(t: ReturnType<typeof useTranslation>['t']): Record<string, string> {
  return {
    protagonist: t('character.roleLabel.protagonist'),
    antagonist: t('character.roleLabel.antagonist'),
    supporting: t('character.roleLabel.supporting'),
    minor: t('character.roleLabel.minor'),
  }
}

function getTierMap(t: ReturnType<typeof useTranslation>['t']): Record<number, string> {
  return {
    1: t('character.tierLabel.core'),
    2: t('character.tierLabel.important'),
    3: t('character.tierLabel.minor'),
  }
}

function StructuredRelations({
  relations, allCharacters, currentName, onChange, t,
}: {
  relations: string
  allCharacters: string[]
  currentName: string
  onChange: (val: string) => void
  t: ReturnType<typeof useTranslation>['t']
}) {
  const [adding, setAdding] = useState(false)
  const [newTarget, setNewTarget] = useState('')
  const [newType, setNewType] = useState('ally')
  const [newLabel, setNewLabel] = useState('')

  const relTypes = getRelTypeMap(t)

  let rels: Array<{ target: string; type: string; label: string; sinceChapter: number }> = []
  try { rels = JSON.parse(relations || '[]') } catch { rels = [] }

  const available = allCharacters.filter(n => n && n !== currentName && !rels.some(r => r.target === n))

  const removeRelation = (target: string) => {
    onChange(JSON.stringify(rels.filter(r => r.target !== target)))
  }

  const addRelation = () => {
    if (!newTarget) return
    onChange(JSON.stringify([...rels, {
      target: newTarget,
      type: newType,
      label: newLabel || newType,
      sinceChapter: 0,
    }]))
    setNewTarget(''); setNewLabel(''); setAdding(false)
  }

  return (
    <div>
      <Label>
        <span className="flex items-center gap-1">
          <Link2 size={11} />
          {t('character.relations')}
        </span>
      </Label>

      {rels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {rels.map(r => (
            <span
              key={r.target}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border cursor-default group"
              style={{
                backgroundColor: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border)',
              }}
            >
              <span className="font-medium text-[var(--color-text)]">{r.target}</span>
              <span className="text-[0.65rem] opacity-60">{relTypes[r.type] || r.type}</span>
              {r.label && r.label !== r.type && <span className="text-[0.65rem] opacity-40">· {r.label}</span>}
              <button
                className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                onClick={() => removeRelation(r.target)}
                type="button"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {adding ? (
        <div className="flex items-center gap-1.5 mt-1">
          <Select value={newTarget} onValueChange={setNewTarget}>
            <SelectTrigger className="w-full"><SelectValue placeholder={`${t('action.select')}...`} /></SelectTrigger>
            <SelectContent>
              {available.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(relTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('character.relLabel')}
            className="w-24 text-xs"
          />
          <button onClick={addRelation} className="p-1 rounded bg-[var(--color-accent)] text-white cursor-pointer" type="button">
            <Plus size={10} />
          </button>
          <button onClick={() => setAdding(false)} className="p-1 text-[var(--color-text-muted)] cursor-pointer bg-transparent border-0" type="button">
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[0.65rem] flex items-center gap-1 mt-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] cursor-pointer bg-transparent border-0"
          type="button"
        >
          <Plus size={10} /> {available.length > 0 ? t('character.addRelation') : t('character.noTarget')}
        </button>
      )}
    </div>
  )
}
