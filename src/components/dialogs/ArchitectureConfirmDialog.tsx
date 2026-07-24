import { useState } from 'react'
import { Wand2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { guardArchitectureGeneration, guardCharacterRegeneration } from '../../services/workflow-guards'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'

type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

function getArchFiles(t: (key: TextKey) => string): Array<{
  key: ArchStepKey
  fileName: string
  label: string
  iconName: string
  desc: string
}> {
  return [
    { key: 'premise',       fileName: 'premise.md',       label: t('arch.storyPremise'), iconName: 'target', desc: t('archConfirm.premiseDesc') },
    { key: 'characters',    fileName: 'characters.md',    label: t('arch.characterMap'),  iconName: 'users',  desc: t('archConfirm.charactersDesc') },
    { key: 'worldbuilding', fileName: 'worldbuilding.md', label: t('arch.worldBuilding'), iconName: 'globe',  desc: t('archConfirm.worldbuildingDesc') },
    { key: 'synopsis',      fileName: 'synopsis.md',      label: t('arch.plotOutline'),  iconName: 'map',    desc: t('archConfirm.synopsisDesc') },
  ]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 各架构文件的生成状态 */
  archStatus: Record<string, boolean>
  /** 预先选中的步骤（单文件生成时传入） */
  initialSelectedSteps?: ArchStepKey[]
  onConfirm: (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => void
}

/** 生成架构确认弹框（含步骤勾选） */
export default function ArchitectureConfirmDialog({
  isOpen, onClose, archStatus, initialSelectedSteps, onConfirm,
}: Props) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const archFiles = getArchFiles(t)

  // 默认：未生成的全部勾选；或使用 initialSelectedSteps 覆盖
  const [checked, setChecked] = useState<Record<ArchStepKey, boolean>>(() => {
    if (initialSelectedSteps) {
      return {
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      }
    }
    return {
      premise:      !archStatus.premise,
      characters:   !archStatus.characters,
      worldbuilding: !archStatus.worldbuilding,
      synopsis:     !archStatus.synopsis,
    }
  })

  // 每步的补充指导
  const [stepGuidance, setStepGuidance] = useState<Record<string, string>>({})
  // 是否展开指导输入区
  const [showGuidance, setShowGuidance] = useState(false)

  // 每次弹窗打开时重置选中状态
  const resetChecked = () => {
    if (initialSelectedSteps) {
      setChecked({
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      })
    } else {
      setChecked({
        premise:      !archStatus.premise,
        characters:   !archStatus.characters,
        worldbuilding: !archStatus.worldbuilding,
        synopsis:     !archStatus.synopsis,
      })
    }
  }

  const isArchRunning = useWorkflowStore(s => s.isTypeRunning('architecture_generation'))
  const [isConfirming, setIsConfirming] = useState(false)
  const [guardError, setGuardError] = useState<string | null>(null)

  if (!currentProject) return null
  const config = currentProject.novelConfig

  const toggleStep = (key: ArchStepKey) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const selectedSteps = (Object.keys(checked) as ArchStepKey[]).filter(k => checked[k])
  const noneSelected = selectedSteps.length === 0

  const handleConfirm = async () => {
    if (noneSelected) return
    // 防重复：同类型工作流正在运行
    if (isArchRunning) {
      toast.warning(t('error.archInProgress'))
      return
    }

    setIsConfirming(true)
    try {
      // 前置校验 1：小说配置是否填写
      const configGuard = guardArchitectureGeneration()
      if (!configGuard.ok) {
        setGuardError(configGuard.message || t('error.configCheckFailed'))
        return
      }

      // 前置校验 2：如果勾选了角色图谱（意味着将重新生成角色卡），则必须确保蓝图为空
      if (selectedSteps.includes('characters') && archStatus.characters) {
        const charGuard = await guardCharacterRegeneration()
        if (!charGuard.ok) {
          setGuardError(charGuard.message || t('error.charNoRegen'))
          return
        }
      }

      setGuardError(null)
      onConfirm(selectedSteps, stepGuidance)
      onClose()
      const stepNames = selectedSteps.map(k => archFiles.find(f => f.key === k)?.label).filter(Boolean).join('、')
      toast.info(t('archConfirm.submittedToast').replace('{steps}', stepNames))
    } finally {
      setIsConfirming(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    } else {
      resetChecked()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={16} className="text-[var(--color-accent)]" />
            {t('dialog.aiGenArch')}
          </DialogTitle>
          <DialogDescription>
            {t('archConfirm.dialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-4">
          {/* 配置预览 */}
          <div
            className="rounded-lg p-3 space-y-1.5 text-xs"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-medium text-[0.7rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('archConfirm.preview')}
            </p>
            <div className="grid grid-cols-2 gap-1">
              <ConfigRow label={t('archConfirm.type')} value={[config.genre, config.subGenre].filter(Boolean).join(' · ')} placeholder={t('status.notConfigured')} />
              <ConfigRow label={t('archConfirm.audience')} value={config.targetAudience} placeholder={t('status.notConfigured')} />
              <ConfigRow label={t('novelConfig.totalChapters')} value={`${config.totalChapters} ${t('unit.chaptersCount')}`} placeholder={t('status.notConfigured')} />
              <ConfigRow label={t('novelConfig.wordsPerChapter')} value={`${config.wordsPerChapter} ${t('unit.chars')}`} placeholder={t('status.notConfigured')} />
            </div>
            {config.coreOutline && (
              <p
                className="mt-1.5 pt-1.5 text-xs"
                style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                {config.coreOutline.slice(0, 80)}{config.coreOutline.length > 80 ? '...' : ''}
              </p>
            )}
          </div>

          {/* 步骤勾选列表 */}
          <div
            className="rounded-lg p-3 space-y-2.5"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {t('archConfirm.selectSteps')}
              </p>
              <button
                onClick={() => setChecked({ premise: true, characters: true, worldbuilding: true, synopsis: true })}
                className="text-xs underline"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('archConfirm.selectAll')}
              </button>
            </div>

            {archFiles.map(f => {
              const exists = archStatus[f.key]
              const isChecked = checked[f.key]
              return (
                <label
                  key={f.key}
                  className="flex items-center gap-2.5 cursor-pointer select-none"
                  onClick={() => toggleStep(f.key)}
                >
                  {/* 复选框 */}
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: isChecked ? 'var(--color-accent)' : 'transparent',
                      border: `1.5px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    }}
                  >
                    {isChecked && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* 步骤名 */}
                  <span className="text-xs flex-1" style={{ color: isChecked ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {f.label}
                    <span className="ml-1 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                      — {f.desc}
                    </span>
                  </span>

                  {/* 状态标签 */}
                  <span
                    className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
                    style={exists
                      ? isChecked
                        ? { backgroundColor: 'rgba(var(--color-warning-rgb), 0.15)', color: 'var(--color-warning)' }
                        : { backgroundColor: 'rgba(var(--color-success-rgb), 0.1)', color: 'var(--color-success)' }
                      : { backgroundColor: 'rgba(var(--color-accent-rgb), 0.1)', color: 'var(--color-accent)' }
                    }
                  >
                    {exists ? (isChecked ? t('archConfirm.willOverwrite') : t('archConfirm.willKeep')) : t('status.pendingGen')}
                  </span>
                </label>
              )
            })}
          </div>

          {/* 逐步指导区域（可折叠） */}
          {selectedSteps.length > 0 && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-panel)' }}
                onClick={() => setShowGuidance(!showGuidance)}
              >
                {showGuidance ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('archConfirm.extraGuidance')}
              </button>
              {showGuidance && (
                <div className="px-3 pb-3 space-y-3" style={{ backgroundColor: 'var(--color-panel)' }}>
                  {archFiles.filter(f => checked[f.key]).map(f => (
                    <div key={f.key}>
                      <label className="text-[0.7rem] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                        {f.label}
                      </label>
                      <Textarea
                        value={stepGuidance[f.key] || ''}
                        onChange={e => setStepGuidance(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={t('archConfirm.guidancePlaceholderFull').replace('{label}', f.label)}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {noneSelected && (
            <p className="text-xs px-3 py-2 rounded-[var(--radius-md)]" style={{ backgroundColor: 'rgba(var(--color-error-rgb), 0.1)', borderColor: 'rgba(var(--color-error-rgb), 0.2)', borderWidth: 1, color: 'var(--color-error)' }}>
              ⚠️ {t('error.selectStep')}
            </p>
          )}
          {/* 前置校验失败提示 */}
          {guardError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] text-xs" style={{ backgroundColor: 'rgba(var(--color-warning-rgb), 0.1)', borderColor: 'rgba(var(--color-warning-rgb), 0.3)', borderWidth: 1, color: 'var(--color-warning)' }}>
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
              <span className="whitespace-pre-line">{guardError}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isConfirming}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={handleConfirm} disabled={noneSelected || isConfirming}>
            <Wand2 size={13} />
            {isConfirming ? t('status.verifying') : t('archConfirm.btn').replace('{n}', String(selectedSteps.length))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfigRow({ label, value, placeholder }: { label: string; value: string; placeholder: string }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}：</span>
      <span style={{ color: 'var(--color-text)' }}>{value || placeholder}</span>
    </div>
  )
}
