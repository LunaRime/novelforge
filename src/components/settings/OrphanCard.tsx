import { useEffect, useMemo, useState } from 'react'
import { Check, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { renderLog } from '../../services/render-logger'
import MenuRow from '../ui/MenuRow'
import { Spinner } from '../ui/Spinner'
import { Badge } from '../ui/Badge'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { ModelForm } from './ModelForm'

/**
 * 「其他」卡 —— 无归属手工条目（v3 §2.8 兼容层，T9 自 `ModelListSection` 独立成文件）。
 *
 * 行 = 名称 + 类型标签 + [设为默认][编辑][删除]，编辑走「其他」卡专用的 `ModelForm`。
 * **不自动迁移**到账户 —— 手工条目的 baseUrl/provider 是用户手填的，猜错了会静默改掉他的端点。
 *
 * 凭据灯/placeholder 的数据源与行列表同一条（`credential:describe`）：本卡挂载与**条目 ref 变化**时
 * 定点刷新一次。手工条目不在账户表里，全量刷新（不传 refs）只覆盖账户 ref —— 保存后新分配的 ref
 * 要靠这里补上，否则 placeholder 会一直停在「输入 API 密钥」。
 */
export function OrphanCard({ models }: { models: ModelProfile[] }) {
  const { t } = useTranslation()
  const defaultModelId = useLLMStore((s) => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore((s) => s.defaultEmbeddingModelId)
  const credentialInfo = useLLMStore((s) => s.credentialInfo)
  const describeCredentials = useLLMStore((s) => s.describeCredentials)
  const saveModel = useLLMStore((s) => s.saveModel)
  const deleteModel = useLLMStore((s) => s.deleteModel)
  const setDefaultModel = useLLMStore((s) => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore((s) => s.setDefaultEmbeddingModel)

  const [editing, setEditing] = useState<{ draft: ModelProfile; baseline: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  /** 本卡条目的凭据状态（定点问，别指望账户那次全量刷新带上它们） */
  const refs = useMemo(
    () => [...new Set(models.map((m) => m.apiKeyRef).filter((r): r is string => Boolean(r)))],
    [models],
  )
  const refsKey = refs.join(',')
  useEffect(() => {
    if (refs.length > 0) void describeCredentials(refs)
    // refsKey 是 refs 的内容指纹：每次 models 重载都会给出新数组引用，直接依赖会多问几轮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, describeCredentials])

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
                presets={BUILTIN_PRESETS}
                keyInfo={m.apiKeyRef ? credentialInfo[m.apiKeyRef] : undefined}
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
