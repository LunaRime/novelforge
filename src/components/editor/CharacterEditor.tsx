import { useState } from 'react'
import { Save, Trash2, Users, Network, Link2, Plus, X } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { confirm } from '../ui/Confirm'
import {
  useCharacterStore,
  EMPTY_STATE,
  ROLE_LABELS,
  TIER_LABELS,
  type CharacterCurrentState,
} from '../../stores/character-store'
import RelationshipGraph from './RelationshipGraph'
import CharacterBacklinks from './CharacterBacklinks'
import { EmptyState as BaseEmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { useTranslation } from '../../hooks/useTranslation'

/**
 * 角色卡编辑器 — 纯编辑区域（角色列表已移至侧栏）
 * 从 character-store 读取选中角色，仅渲染编辑表单。
 */
export default function CharacterEditor() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const addLog = useWorkflowStore(s => s.addLog)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const saving = useCharacterStore(s => s.saving)
  const updateField = useCharacterStore(s => s.updateField)
  const deleteCharacter = useCharacterStore(s => s.deleteCharacter)
  const saveAll = useCharacterStore(s => s.saveAll)
  const [viewMode, setViewMode] = useState<'edit' | 'state' | 'graph' | 'backlinks'>('edit')

  // 数据由 ProjectService 统一加载，组件只消费 store 数据

  const selectedCard = characters.find((c) => c.name === selectedName) || null

  const handleDelete = async () => {
    if (!selectedCard || !currentProject) return
    const ok = await confirm(
      `确定要删除角色「${selectedCard.name || '未命名'}」吗？此操作不可撤销。`,
      { title: '删除角色', confirmText: '删除', danger: true }
    )
    if (!ok) return
    await deleteCharacter(selectedCard.name, currentProject.path)
  }

  const handleSave = async () => {
    if (!currentProject) return
    await saveAll(currentProject.path)
    addLog('info', `Saved ${characters.length} character cards`)
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
              ? '角色图谱' 
              : selectedCard 
                ? `${selectedCard.name || '新角色'} ${viewMode === 'state' ? '— 当前状态' : '— 编辑档案'}`
                : '角色档案'}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {viewMode === 'graph' ? (
            <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title="返回编辑">
              <Users size={12} /> 编辑模式
            </Button>
          ) : viewMode === 'backlinks' ? (
            <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title="返回编辑">
              <Users size={12} /> 编辑模式
            </Button>
          ) : selectedCard ? (
            <>
              {viewMode === 'state' ? (
                <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title="返回基础设定">
                  <Users size={12} /> 基础设定
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setViewMode('state')} title="查看当前进展/状态">
                  📋 当前状态
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title="查看全员关系网">
                <Network size={12} /> 关系图谱
              </Button>
              <Button variant="outline" size="sm" onClick={() => setViewMode('backlinks')} title="查看反向链接">
                <Link2 size={12} /> 反向链接
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 size={12} /> 删除
              </Button>
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                <Save size={12} /> {saving ? '保存中...' : '保存'}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title="查看全员关系网">
              <Network size={12} /> 关系图谱
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
            message={currentProject ? "在左侧选择或创建角色卡" : "请先打开项目"} 
            opacity={currentProject ? 0.3 : 0.4}
          />
        ) : viewMode === 'state' ? (
          <div className="max-w-2xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--color-text)]">
                当前状态档案
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                最后更新：第 {selectedCard.currentState?.updatedAtChapter ?? 0} 章
              </span>
            </div>
            <div className="space-y-3">
              {([
                ['location', '当前位置/阵营'],
                ['powerLevel', '修为境界/能力等级'],
                ['physicalState', '身体状态（伤势/BUFF/外貌）'],
                ['mentalState', '心理状态（愿望/恐惧/心态）'],
                ['keyItems', '关键道具/资源'],
                ['recentEvents', '最近重要事件'],
              ] as const).map(([field, label]) => (
                <div key={field}>
                  <Label>{label}</Label>
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
                    placeholder={`${label}...`}
                  />
                </div>
              ))}
            </div>
            {!selectedCard.currentState && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--color-hover)] text-xs text-[var(--color-text-secondary)]">
                当前状态档案将在章节定稿后由 AI 自动更新，也可手动填写初始状态。
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
                  <NativeSelect
                    value={selectedCard.tier ?? 2}
                    onChange={(e) => updateField(selectedCard.name, 'tier', parseInt(e.target.value))}
                  >
                    {Object.entries(TIER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <Label>{t('character.position')}</Label>
                  <NativeSelect value={selectedCard.role} onChange={(e) => updateField(selectedCard.name, 'role', e.target.value as typeof selectedCard.role)}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </NativeSelect>
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
                    value={selectedCard.tags || ''}
                    onChange={(e) => updateField(selectedCard.name, 'tags', e.target.value)}
                    placeholder='["宗门","正道"]'
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
                    <div className="mt-1"><Textarea value={selectedCard.relationships} onChange={(e) => updateField(selectedCard.name, 'relationships', e.target.value)} rows={3} placeholder="旧版纯文本格式" /></div>
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

const REL_TYPE_LABELS: Record<string, string> = {
  ally: '盟友', enemy: '敌对', family: '家族',
  master_student: '师徒', lover: '恋人', rival: '劲敌',
  neutral: '中立', other: '其他',
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
              <span className="text-[0.65rem] opacity-60">{REL_TYPE_LABELS[r.type] || r.type}</span>
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
          <NativeSelect value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
            <option value="">{t('action.select')}...</option>
            {available.map(n => <option key={n} value={n}>{n}</option>)}
          </NativeSelect>
          <NativeSelect value={newType} onChange={(e) => setNewType(e.target.value)}>
            {Object.entries(REL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('character.relLabel') || '关系描述'}
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
