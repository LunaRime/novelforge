/**
 * ModelListSection — 「模型」段（模型管理 v3 §2，2026-10-01）。
 *
 * 本文件是**薄容器**：标题（计数）+ `ProviderRowList`（供应商行 + 行内编辑卡）+ 「其他」卡 + 空态。
 * 行的行为（单开/三态灯/删除顺序/添加卡）全在 `ProviderRowList` 里，这里不重复。
 *
 * 与 v2 的差异：一体卡（`ModelProviderCard`）退役 —— 卡头变行、卡内模型行搬进编辑卡的目录区
 * （T7 挂载）；本段不再常驻显示任何模型条目。
 */
import { useState } from 'react'
import { Check, Plus, Settings2, Trash2, Zap } from 'lucide-react'
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { useTranslation } from '../../hooks/useTranslation'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import MenuRow from '../ui/MenuRow'
import { Spinner } from '../ui/Spinner'
import { Badge } from '../ui/Badge'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { ProviderRowList } from './ProviderRowList'
import { ProviderAccountForm } from './ProviderAccountsSection'
import { ModelForm } from './ModelForm'

export function ModelListSection() {
  const { t } = useTranslation()
  const models = useLLMStore((s) => s.models)
  const providers = useLLMStore((s) => s.providers)
  const [adding, setAdding] = useState<ProviderAccount | null>(null)

  /** 「其他」卡：不属于任何供应商账户的历史条目（P3 兼容——可见可编辑可删，不自动迁移） */
  const orphans = models.filter((m) => !providers.some((p) => isModelOfAccount(m.id, p.id)))

  /** 新建账户的初值：目录模式第一家（有模型的家）；两模式在表单里切换 */
  const newAccount = (): ProviderAccount => {
    const preset =
      BUILTIN_PRESETS.find((p) => p.provider !== 'custom' && (p.models.length > 0 || p.embeddingModels.length > 0)) ??
      BUILTIN_PRESETS[0]
    return {
      id: randomUUID(),
      provider: preset.provider as ProviderAccount['provider'],
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      // 空数组 = 继承内置目录（v3 §3.1），新账户要的正是「默认目录」，故**不写**该字段
    }
  }

  if (adding) {
    return (
      <ProviderAccountForm
        account={adding}
        onCancel={() => setAdding(null)}
        onDone={() => setAdding(null)}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('model.configured').replace('{n}', String(models.length)).replace('{label}', '')}
        </span>
      </div>

      {providers.length === 0 && orphans.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl"
          style={{ border: '1.5px dashed var(--color-border)' }}
        >
          <Zap size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('model.noLabelConfig').replace('{label}', '')}
          </span>
          <Button size="sm" variant="outline" onClick={() => setAdding(newAccount())}>
            <Plus size={13} />
            {t('provider.addVendor')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ProviderRowList />
          {orphans.length > 0 && <OrphanCard models={orphans} />}
        </div>
      )}
    </div>
  )
}

/**
 * 「其他」卡 —— 无归属手工条目（v3 §2.8 兼容层，**T9 重写 ModelForm 时一并收编**）。
 *
 * 一体卡退役后它暂住这里：行 = 名称 + 类型标签 + [设为默认][编辑][删除]，编辑沿用 `ModelForm`
 * （凭据只写化已在 T5 落进 ModelForm）。**不自动迁移**到账户 —— 手工条目的 baseUrl/provider
 * 是用户手填的，猜错了会静默改掉他的端点。
 */
function OrphanCard({ models }: { models: ModelProfile[] }) {
  const { t } = useTranslation()
  const defaultModelId = useLLMStore((s) => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore((s) => s.defaultEmbeddingModelId)
  const saveModel = useLLMStore((s) => s.saveModel)
  const deleteModel = useLLMStore((s) => s.deleteModel)
  const setDefaultModel = useLLMStore((s) => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore((s) => s.setDefaultEmbeddingModel)

  const [editing, setEditing] = useState<{ draft: ModelProfile; baseline: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /** 显示层倒序（新添加在最上）；操作按 id 定位，与显示顺序无关 */
  const rows = [...models].reverse()
  const isEmb = (m: ModelProfile) => m.purposes?.includes('embedding') ?? false
  const isDefault = (m: ModelProfile) =>
    isEmb(m) ? defaultEmbeddingModelId === m.id : defaultModelId === m.id

  /** 进入编辑：有未保存改动时先确认（同 v2 的切换保护） */
  const startEdit = (m: ModelProfile) => {
    const dirty = editing !== null && JSON.stringify(editing.draft) !== editing.baseline
    const apply = () => setEditing({ draft: { ...m }, baseline: JSON.stringify(m) })
    if (!dirty) {
      apply()
      return
    }
    void confirm(t('model.discardEdit'), { danger: true, confirmText: t('action.discard') })
      .then((ok) => { if (ok) apply() })
  }

  /** 保存失败**保留草稿**（同 v2 语义）；失败原因取主进程的 error（含拒因码） */
  const handleSave = async (apiKeyDraft?: string) => {
    if (!editing) return
    const draft = editing.draft
    const t0 = Date.now()
    setSaving(true)
    try {
      const result = await saveModel(draft, apiKeyDraft)
      if (!result.success) {
        renderLog('error', 'Save:Settings', `model save failed: ${draft.id} (${result.error ?? 'unknown'})`)
        toast.error(t('save.failed').replace('{error}', () => result.error ?? t('status.unknown')))
        return
      }
      // v2 的「本卡第一行保存后自动设为默认」在此**不适用**：本卡只在有孤儿条目时渲染，
      // 编辑的必是既有条目 —— 自动设默认会把用户当前的选择顶掉
      renderLog('info', 'Save:Settings', `model saved: ${draft.id} (${Date.now() - t0}ms)`)
      toast.success(t('save.success'))
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (m: ModelProfile) => {
    const ok = await confirm(
      t('settings.confirmDeleteModel').replace('{name}', m.name || m.modelName),
      { danger: true, confirmText: t('action.delete') },
    )
    if (!ok) return
    setDeletingId(m.id)
    try {
      await deleteModel(m.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div
        className="flex items-center gap-2 px-3 h-8"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('modelCard.orphanTitle')}
        </span>
      </div>

      <div className="py-1">
        {rows.map((m) => (
          editing && editing.draft.id === m.id ? (
            <div key={m.id} className="p-2">
              <ModelForm
                model={editing.draft}
                onChange={(next) => setEditing((e) => (e ? { ...e, draft: next } : e))}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                saving={saving}
                purposeOptions={m.purposes ?? []}
                presets={BUILTIN_PRESETS}
              />
            </div>
          ) : (
            <MenuRow
              key={m.id}
              title={m.name || m.modelName}
              titleSuffix={
                <>
                  {isEmb(m) && (
                    <span
                      className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                    >
                      {t('modelCard.embeddingTag')}
                    </span>
                  )}
                  {isDefault(m) && (
                    <Badge variant="solid" className="px-1.5 font-normal flex-shrink-0">
                      {t('model.default')}
                    </Badge>
                  )}
                </>
              }
              count={m.modelName}
              actions={
                <div className="flex items-center gap-1 pr-1">
                  {!isDefault(m) && (
                    <button
                      type="button"
                      onClick={() => (isEmb(m) ? setDefaultEmbeddingModel(m.id) : setDefaultModel(m.id))}
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
                    onClick={() => startEdit(m)}
                    title={t('action.edit')}
                    aria-label={t('action.edit')}
                    className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    style={{ width: 32, height: 32 }}
                  >
                    <Settings2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m)}
                    disabled={deletingId === m.id}
                    title={t('action.delete')}
                    aria-label={t('action.delete')}
                    className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ width: 32, height: 32 }}
                  >
                    {deletingId === m.id ? <Spinner size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              }
            />
          )
        ))}
      </div>
    </section>
  )
}
