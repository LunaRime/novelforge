/**
 * AutomationSection — 设置页「自动化」分区（D 档 T9）
 *
 * 表单按「执行目标类型」与「触发器类型」条件展开；产出物形状必须与
 * scheduler / executor 的契约一致：targetType + targetRef + triggers[] + defaultActionPolicy。
 */
import { useEffect, useState } from 'react'
import { Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Switch } from '../ui/Switch'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { useTranslation } from '../../hooks/useTranslation'
import { useAutomationStore } from '../../stores/automation-store'
import { randomUUID } from '../../utils/id'
import { AUTOMATION_WORKFLOW_TARGETS } from '../../services/automation/executor'
import type {
  ActionPolicy,
  AutomationTask,
  TriggerDefinition,
  TriggerType,
} from '../../services/automation/types'

const ACTION_POLICIES: ActionPolicy[] = ['auto_run', 'confirm', 'notify_only']
const TRIGGER_TYPES: TriggerType[] = ['chapter_batch', 'schedule', 'semantic', 'manual']

/** 空表单（新建） */
function emptyTask(): AutomationTask {
  return {
    id: randomUUID(),
    name: '',
    enabled: true,
    targetType: 'workflow',
    // 默认给一个**真正可重建**的目标（评审 Critical 1：原计划的占位符 {"type":"post_process"} 必然重建失败）
    targetRef: AUTOMATION_WORKFLOW_TARGETS[0].example,
    sessionStrategy: 'per_run',
    triggers: [{ id: randomUUID(), type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
    defaultActionPolicy: 'confirm',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** 触发器摘要（列表行展示） */
function describeTrigger(trigger: TriggerDefinition, t: (k: never) => string): string {
  const tr = t as unknown as (k: string) => string
  switch (trigger.type) {
    case 'chapter_batch':
      return tr('automation.settings.batchSummary').replace('{n}', String(trigger.chapterBatchSize ?? 3))
    case 'schedule':
      return tr('automation.settings.scheduleSummary')
    case 'semantic':
      return tr('automation.settings.semanticSummary')
    default:
      return tr('automation.settings.manualSummary')
  }
}

export default function AutomationSection() {
  const { t } = useTranslation()
  const tasks = useAutomationStore(s => s.tasks)
  const loadAll = useAutomationStore(s => s.loadAll)
  const saveTask = useAutomationStore(s => s.saveTask)
  const deleteTask = useAutomationStore(s => s.deleteTask)
  const setEnabled = useAutomationStore(s => s.setEnabled)
  const runNow = useAutomationStore(s => s.runNow)

  const [editing, setEditing] = useState<AutomationTask | null>(null)

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const patchEditing = (patch: Partial<AutomationTask>) =>
    setEditing(prev => (prev ? { ...prev, ...patch } : prev))

  const patchTrigger = (patch: Partial<TriggerDefinition>) =>
    setEditing(prev => prev
      ? { ...prev, triggers: prev.triggers.map((tr, i) => (i === 0 ? { ...tr, ...patch } : tr)) }
      : prev)

  const handleSave = async () => {
    if (!editing) return
    await saveTask({ ...editing, updatedAt: Date.now() })
    setEditing(null)
  }

  const trigger = editing?.triggers[0]

  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {t('automation.settings.title')}
        </p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('automation.settings.desc')}
        </p>
      </div>

      {/* 任务列表 */}
      {tasks.length === 0 && !editing && (
        <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>
          {t('automation.settings.empty')}
        </p>
      )}
      {tasks.map(task => (
        <div
          key={task.id}
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--color-hover)' }}
        >
          <Switch checked={task.enabled} onCheckedChange={(v) => void setEnabled(task.id, v)} />
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{task.name}</p>
            <p className="text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>
              {task.triggers.map(tr => describeTrigger(tr, t as never)).join(' · ')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void runNow(task.id)}>
            <Play size={11} /> {t('automation.settings.runNow')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing({ ...task })}>
            {t('automation.settings.edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void deleteTask(task.id)}>
            <Trash2 size={11} />
          </Button>
        </div>
      ))}

      {/* 表单 */}
      {editing && (
        <div className="space-y-3 rounded-lg p-3" style={{ border: '1px solid var(--color-border)' }}>
          <div className="space-y-1">
            <Label>{t('automation.settings.name')}</Label>
            <Input
              data-field="name"
              value={editing.name}
              onChange={e => patchEditing({ name: e.target.value })}
              placeholder={t('automation.settings.namePlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label>{t('automation.settings.targetType')}</Label>
            <Select
              value={editing.targetType}
              onValueChange={v => patchEditing({ targetType: v as AutomationTask['targetType'], targetRef: '' })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="workflow">{t('automation.settings.targetWorkflow')}</SelectItem>
                <SelectItem value="agent">{t('automation.settings.targetAgent')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 目标类型决定第二项的形态：workflow 填 JSON 目标 / agent 填提示词 */}
          <div className="space-y-1">
            <Label>
              {editing.targetType === 'workflow'
                ? t('automation.settings.workflowRef')
                : t('automation.settings.prompt')}
            </Label>
            <Input
              data-field="target-ref"
              value={editing.targetRef}
              onChange={e => patchEditing({ targetRef: e.target.value })}
              placeholder={editing.targetType === 'workflow'
                ? AUTOMATION_WORKFLOW_TARGETS[0].example
                : t('automation.settings.promptPlaceholder')}
            />
            {editing.targetType === 'workflow' && (
              <p className="text-micro leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('automation.settings.workflowHint')
                  .replace('{types}', AUTOMATION_WORKFLOW_TARGETS.map(x => x.type).join(' / '))}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t('automation.settings.triggerType')}</Label>
            <Select
              value={trigger?.type ?? 'chapter_batch'}
              onValueChange={v => {
                // 切换类型时补齐该类型的必填默认值（评审 Important 7：选「定时」后未动输入框
                // 直接保存 → 没有 schedule 对象 → 永久静默不触发）
                const patch: Partial<TriggerDefinition> = { type: v as TriggerType }
                if (v === 'schedule' && !trigger?.schedule) patch.schedule = { kind: 'daily', hour: 9, minute: 0 }
                if (v === 'chapter_batch' && !trigger?.chapterBatchSize) patch.chapterBatchSize = 3
                if (v === 'semantic' && trigger?.semanticCondition === undefined) patch.semanticCondition = ''
                patchTrigger(patch)
              }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map(type => (
                  <SelectItem key={type} value={type}>{t(`automation.settings.trigger_${type}` as never)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 触发器条件按类型展开 */}
          {trigger?.type === 'chapter_batch' && (
            <div className="space-y-1">
              <Label>{t('automation.settings.batchSize')}</Label>
              <Input
                data-field="batch-size"
                type="number"
                min={1}
                value={trigger.chapterBatchSize ?? 3}
                onChange={e => patchTrigger({ chapterBatchSize: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
          )}
          {trigger?.type === 'schedule' && (
            <div className="space-y-1">
              <Label>{t('automation.settings.scheduleHour')}</Label>
              <Input
                data-field="schedule-hour"
                type="number"
                min={0}
                max={23}
                value={trigger.schedule?.hour ?? 9}
                onChange={e => patchTrigger({
                  schedule: { kind: 'daily', hour: Number(e.target.value) || 0, minute: trigger.schedule?.minute ?? 0 },
                })}
              />
            </div>
          )}
          {trigger?.type === 'semantic' && (
            <div className="space-y-1">
              <Label>{t('automation.settings.semanticCondition')}</Label>
              <Input
                data-field="semantic-condition"
                value={trigger.semanticCondition ?? ''}
                onChange={e => patchTrigger({ semanticCondition: e.target.value })}
                placeholder={t('automation.settings.semanticPlaceholder')}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t('automation.settings.actionPolicy')}</Label>
            <Select
              value={editing.defaultActionPolicy}
              onValueChange={v => patchEditing({ defaultActionPolicy: v as ActionPolicy })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_POLICIES.map(p => (
                  <SelectItem key={p} value={p}>{t(`automation.settings.policy_${p}` as never)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="success" size="sm" onClick={() => void handleSave()}>
              {t('automation.settings.save')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              {t('automation.settings.cancel')}
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <Button variant="outline" size="sm" onClick={() => setEditing(emptyTask())}>
          <Plus size={11} /> {t('automation.settings.newTask')}
        </Button>
      )}
    </div>
  )
}
