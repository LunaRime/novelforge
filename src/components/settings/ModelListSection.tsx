/**
 * ModelListSection — 模型列表 + 卡片 + 编辑表单（自 SettingsModal 拆出，2026-09-28）
 *
 * 拆出目的：① 给「行内编辑」重构一个可独立测试的边界；② SettingsModal 已 1460 行。
 * 行为与拆分前完全一致，后续改动（按钮规范化/行内编辑/拉取面板）均在本文件内进行。
 */
import { useEffect, useState } from 'react'
import { Check, Plus, Settings2, Trash2, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { ModelForm, tokenSpec } from './ModelForm'

export function ModelListSection({
  purposes,
  purposeLabel,
}: {
  purposes: ModelProfile['purposes']
  purposeLabel: string
}) {
  const { t } = useTranslation()
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore(s => s.defaultEmbeddingModelId)
  const loaded = useLLMStore(s => s.loaded)
  const loadModels = useLLMStore(s => s.loadModels)
  const saveModel = useLLMStore(s => s.saveModel)
  const deleteModel = useLLMStore(s => s.deleteModel)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore(s => s.setDefaultEmbeddingModel)
  // 列表常驻，编辑器在对应位置原地展开（2026-09-28 替代旧的 editingModel「整列表替换」）；
  // baseline = 进入编辑时的 JSON 快照，用于「有实际改动才拦切换」的判定
  const [editing, setEditing] = useState<{ draft: ModelProfile; isNew: boolean; baseline: string } | null>(null)
  const [saving, setSaving] = useState(false)
  /** 正在删除的模型 id —— 删除可能较慢，必须给等待反馈并禁用按钮（否则用户连点） */
  const [deletingId, setDeletingId] = useState<string | null>(null)
  useEffect(() => {
    if (!loaded) loadModels()
  }, [loaded, loadModels])

  // 预设直接使用内置常量，无需 IPC 加载
  const presets = BUILTIN_PRESETS

  // 按用途过滤——遗留模型（无 purposes 字段的旧配置）按生成模型兜底显示，
  // 否则成孤儿无法编辑/删除/设默认（P3 修复）
  const filtered = models.filter((m) => {
    if (!m.purposes || m.purposes.length === 0) {
      return !purposes.includes('embedding')
    }
    return m.purposes.some((p) => purposes.includes(p as ModelProfile['purposes'][number]))
  })

  /**
   * 应用编辑态变更：无未保存改动时**同步**生效（点编辑立即展开，不等微任务）；
   * 有改动则先弹确认，确认后才应用——静默丢改动是 bug。
   */
  const withDirtyGuard = (apply: () => void) => {
    const dirty = editing !== null && JSON.stringify(editing.draft) !== editing.baseline
    if (!dirty) {
      apply()
      return
    }
    void confirm(t('model.discardEdit'), { danger: true, confirmText: t('action.discard') })
      .then((ok) => { if (ok) apply() })
  }

  /** 创建新模型：进入 isNew 编辑态（草稿卡在列表头部展开，不入 store，取消即消失） */
  const handleAdd = () => {
    withDirtyGuard(() => {
      const isEmbedding = purposes.includes('embedding')
      const openaiPreset = presets.find((p) => p.provider === 'openai') ?? presets[0]
      const draft: ModelProfile = {
        id: randomUUID(),
        name: '',
        provider: 'openai',
        protocol: (openaiPreset?.protocol ?? 'openai') as 'openai' | 'gemini',
        modelName: isEmbedding
          ? (openaiPreset?.embeddingModels[0] ?? 'text-embedding-3-small')
          : (openaiPreset?.models[0]?.name ?? 'gpt-4o'),
        apiKey: '',
        baseUrl: openaiPreset?.baseUrl ?? 'https://api.openai.com',
        temperature: 0.7,
        ...tokenSpec(openaiPreset?.models[0], 4096),
        purposes: [...purposes],
      }
      setEditing({ draft, isNew: true, baseline: JSON.stringify(draft) })
    })
  }

  /** 进入编辑：该卡在列表原位置展开（2026-09-28 行内编辑） */
  const startEdit = (m: ModelProfile) => {
    withDirtyGuard(() => setEditing({ draft: { ...m }, isNew: false, baseline: JSON.stringify(m) }))
  }

  const isEmbeddingSection = purposes.includes('embedding')

  /** 保存模型；若是该分类第一个则自动设为默认。
   *  ⚠️ 失败（saveModel 返回 false 或抛异常）时**保留草稿**——2026-09-28 整分支复核 I1：
   *  主进程对空 modelName/purposes 等返回 {success:false}（不抛），旧实现不检查返回值，
   *  会弹「保存成功」并收回表单，编辑静默丢失。失败必须可继续改。 */
  const handleSave = async () => {
    if (!editing) return
    const draft = editing.draft
    const t0 = Date.now()
    setSaving(true)
    try {
      const ok = await saveModel(draft)
      if (!ok) {
        renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
          .replace('{id}', () => draft.id)
          .replace('{error}', () => t('status.unknown')))
        toast.error(t('save.failed').replace('{error}', () => t('status.unknown')))
        return // 保留草稿（失败不丢编辑）
      }
      // 新增模型后，如果该分类还没有默认则自动设为默认
      if (filtered.length === 0) {
        if (isEmbeddingSection) {
          setDefaultEmbeddingModel(draft.id)
        } else {
          setDefaultModel(draft.id)
        }
      }
      // 保存行为日志流：成功 info + toast 视觉反馈
      renderLog('info', 'Save:Settings', t('log.render.modelSaveSuccess')
        .replace('{id}', () => draft.id)
        .replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
      setEditing(null) // 仅成功才收回
    } catch (e) {
      renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
        .replace('{id}', () => draft.id)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
      // 保留草稿
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('model.configured').replace('{n}', String(filtered.length)).replace('{label}', purposeLabel)}
        </span>
        <Button size="sm" onClick={() => void handleAdd()}>
          <Plus size={13} />
          {t('model.addLabel').replace('{label}', purposeLabel)}
        </Button>
      </div>

      {/* 空态：新增草稿卡存在时不显示（避免「空态 + 编辑卡」同屏） */}
      {filtered.length === 0 && !editing?.isNew ? (
        <div
          className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl"
          style={{ border: '1.5px dashed var(--color-border)' }}
        >
          <Zap size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('model.noLabelConfig').replace('{label}', purposeLabel)}
          </span>
          <Button size="sm" variant="outline" onClick={() => void handleAdd()}>
            <Plus size={13} />
            {t('model.addFirstLabel').replace('{label}', purposeLabel)}
          </Button>
        </div>
      ) : (
        /* 行内编辑（2026-09-28）：列表常驻；编辑中的卡在原位置展开为 ModelForm，
           新增草稿卡出现在列表头部 */
        <div className="space-y-2">
          {editing?.isNew && (
            <ModelForm
              model={editing.draft}
              onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              saving={saving}
              purposeOptions={purposes}
              presets={presets}
            />
          )}
          {filtered.map((model) => (
            editing && !editing.isNew && editing.draft.id === model.id ? (
              <ModelForm
                key={model.id}
                model={editing.draft}
                onChange={(m) => setEditing((e) => (e ? { ...e, draft: m } : e))}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                saving={saving}
                purposeOptions={purposes}
                presets={presets}
              />
            ) : (
              <ModelCard
                key={model.id}
                model={model}
                isDefault={isEmbeddingSection
                  ? defaultEmbeddingModelId === model.id
                  : defaultModelId === model.id}
                onSetDefault={() => isEmbeddingSection
                  ? setDefaultEmbeddingModel(model.id)
                  : setDefaultModel(model.id)}
                onEdit={() => void startEdit(model)}
                onDelete={async () => {
                  // 删除模型配置此前无二次确认（且入口是 hover 才显形的按钮，键盘用户极易误触）
                  const ok = await confirm(
                    t('settings.confirmDeleteModel').replace('{name}', model.name),
                    { danger: true, confirmText: t('action.delete') },
                  )
                  if (!ok) return
                  setDeletingId(model.id)
                  try {
                    await deleteModel(model.id)
                  } finally {
                    setDeletingId(null)
                  }
                }}
                deleting={deletingId === model.id}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

/** 模型卡片 */
function ModelCard({
  model, isDefault, onSetDefault, onEdit, onDelete, deleting = false,
}: {
  model: ModelProfile
  isDefault: boolean
  onSetDefault: () => void
  onEdit: () => void
  onDelete: () => void
  /** 删除进行中：显示旋转图标并禁用（防连点） */
  deleting?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl group transition-colors',
        isDefault
          ? 'border border-[var(--color-accent)]'
          : 'border border-[var(--color-border)] hover:border-[var(--color-accent)]',
      )}
      style={{ backgroundColor: isDefault ? 'color-mix(in srgb, var(--color-accent) 5%, var(--color-panel))' : 'var(--color-panel)' }}
    >
      {/* 图标 — 固定 32×32（`w-9` 在本仓 html{font-size:14px} 下 = 31.5px，半像素修正） */}
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
        style={{ width: 32, height: 32, backgroundColor: 'var(--color-hover)' }}
      >
        {providerEmoji(model.provider)}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {model.name || model.modelName}
          </span>
          {isDefault && (
            <Badge variant="solid" className="px-1.5 font-normal flex-shrink-0">
              {t('model.default')}
            </Badge>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {model.provider} · {model.modelName} · {model.baseUrl}
        </p>
      </div>

      {/* 操作按钮 —— 常驻 32×32（2026-09-28 走查：此前是 hover 才显形，违反
          「操作按钮常驻」不变量；热区也低于 32×32 标准） */}
      <div className="flex items-center gap-1">
        {!isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            title={t('model.setDefault')}
            aria-label={t('model.setDefault')}
            className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            style={{ width: 32, height: 32 }}
          >
            <Check size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          title={t('action.edit')}
          aria-label={t('action.edit')}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          style={{ width: 32, height: 32 }}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title={t('action.delete')}
          aria-label={t('action.delete')}
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ width: 32, height: 32 }}
        >
          {deleting ? <Spinner size={14}  /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  )
}


// ==================== 工具函数（随 ModelCard 自 SettingsModal 迁入） ====================

function providerEmoji(provider: string) {
  const map: Record<string, string> = {
    openai: '🤖', deepseek: '🐬', gemini: '✨', ollama: '🦙', bigmodel: '🧠', custom: '⚙️',
  }
  return map[provider] ?? '🔧'
}
