/* eslint-disable react-refresh/only-export-components -- providerEmoji 与卡内聚（迁移自 v1 ModelCard） */
import { useMemo, useState } from 'react'
import { Check, Plus, Settings2, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useLLMStore } from '../../stores/llm-store'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { useTranslation } from '../../hooks/useTranslation'
import { renderLog } from '../../services/render-logger'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { Badge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { ModelForm } from './ModelForm'
import { ModelPickerDialog } from './ModelPickerDialog'
import { blockingReferences } from './ProviderAccountsSection'

export interface ModelProviderCardProps {
  /** null = 「其他」卡（无归属历史模型；无添加入口，删除直删配置） */
  account: ProviderAccount | null
  /** 本卡的行（账户卡 = 派生条目；其他卡 = 无归属孤儿） */
  models: ModelProfile[]
  /** 账户卡操作（容器层处理：编辑打开建卡表单；删除做引用检查 + deleteProvider） */
  onEditAccount?: () => void
  onDeleteAccount?: () => void
}

/**
 * ModelProviderCard —— 供应商一体卡（v2，2026-09-28）。
 *
 * 卡 = 凭据（头：显示名/地址/凭据状态）+ 模型行（**倒序显示**——新添加在最上；行带类型标签；
 * 操作常驻 32×32）+ 「+ 添加模型」（账户卡）→ ModelPickerDialog（拉取多选批量采纳）。
 * 行内编辑沿用 ModelForm（切换保护与「失败保留草稿」同 v1）。
 * ⚠️ 行操作一律按 `model.id` 定位（倒序是显示层，Review Focus 3）。
 */
export function ModelProviderCard({ account, models, onEditAccount, onDeleteAccount }: ModelProviderCardProps) {
  const { t } = useTranslation()
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore(s => s.defaultEmbeddingModelId)
  const saveModel = useLLMStore(s => s.saveModel)
  const deleteModel = useLLMStore(s => s.deleteModel)
  const saveProvider = useLLMStore(s => s.saveProvider)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore(s => s.setDefaultEmbeddingModel)

  const [editing, setEditing] = useState<{ draft: ModelProfile; baseline: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const displayName = account
    ? (BUILTIN_PRESETS.find(p => p.provider === account.provider)?.displayName ?? account.provider)
    : t('modelCard.orphanTitle')

  /** 显示层倒序（新添加在最上）；行操作按 id 定位，与显示顺序无关 */
  const rows = useMemo(() => [...models].reverse(), [models])

  const isEmb = (m: ModelProfile) => m.purposes?.includes('embedding') ?? false
  const isDefault = (m: ModelProfile) =>
    isEmb(m) ? defaultEmbeddingModelId === m.id : defaultModelId === m.id

  /** 进入编辑：有未保存改动时先确认（同 v1 的切换保护） */
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

  /** 行保存（同 v1：saveModel 返回 false 或抛异常时**保留草稿**——复核 I1 语义） */
  const handleSave = async (apiKeyDraft?: string) => {
    if (!editing) return
    const draft = editing.draft
    const t0 = Date.now()
    setSaving(true)
    try {
      // apiKeyDraft：ModelForm 里刚输入的密钥（v3 §4.7 一次性草稿；空 = 不变更已存值）
      const ok = await saveModel(draft, apiKeyDraft)
      if (!ok) {
        renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
          .replace('{id}', () => draft.id)
          .replace('{error}', () => t('status.unknown')))
        toast.error(t('save.failed').replace('{error}', () => t('status.unknown')))
        return
      }
      // 本卡第一行保存后自动设为默认（该用途下）
      if (rows.length === 0) {
        if (isEmb(draft)) setDefaultEmbeddingModel(draft.id)
        else setDefaultModel(draft.id)
      }
      renderLog('info', 'Save:Settings', t('log.render.modelSaveSuccess')
        .replace('{id}', () => draft.id)
        .replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
      setEditing(null)
    } catch (e) {
      renderLog('error', 'Save:Settings', t('log.render.modelSaveFailed')
        .replace('{id}', () => draft.id)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', String(e)))
    } finally {
      setSaving(false)
    }
  }

  /** 删除行：账户卡 = 取消勾选（saveProvider 同步名册/派生条目）；其他卡 = 直删配置 */
  const handleDelete = async (m: ModelProfile) => {
    if (account) {
      // ⚠️ 引用检查在确认**之前**（v1 同口径，2026-09-29 复核 I1）：saveProvider 只 reload、
      // 不做路由/默认清理——删掉被引用的行会让 defaultModelId 悬空（状态栏消失/工作流报"未配置默认模型"）
      const blocking = blockingReferences([m.id])
      if (blocking) {
        toast.error(t('provider.referenced').replace('{list}', () => blocking))
        return
      }
    }
    const ok = await confirm(
      t('settings.confirmDeleteModel').replace('{name}', m.name || m.modelName),
      { danger: true, confirmText: t('action.delete') },
    )
    if (!ok) return
    // ⚠️ 过渡期守卫（v3 T2 fix round 1，T6/T7 目录区接管后退役）：删掉账户的**最后一行**会送
    //    `modelNames: []`，而 v3 起空数组 = **继承内置目录** → 主进程按目录把整组模型
    //    （含刚删的这个）重新物化出来，表现为「删了又回来」。放在确认**之后**：用户已表达删除意图，
    //    这里回答的是「为什么不能删」（与上面那条「被引用就别问」的引用检查分工不同）。
    if (account && models.length <= 1) {
      toast.error(t('provider.keepAtLeastOne'))
      return
    }
    setDeletingId(m.id)
    try {
      if (account) {
        const saved = await saveProvider(
          // `?? []`：v3 起 modelNames 可缺省（= 继承内置目录）；本任务仅保持既有行为（设置页重写见 v3 T6/T7）
          { ...account, modelNames: (account.modelNames ?? []).filter(n => n !== m.modelName) },
          undefined,
        )
        if (!saved.success) toast.error(t('save.failed').replace('{error}', () => saved.error ?? t('status.unknown')))
      } else {
        await deleteModel(m.id)
      }
    } finally {
      setDeletingId(null)
    }
  }

  /** Picker 采纳：合并名册 + 携带规格（主进程侧"本次规格优先、回落预设"） */
  const handleAdopt = async (names: string[], specs: Record<string, { contextWindow?: number; maxTokens?: number }>) => {
    if (!account) return
    setPickerOpen(false)
    const merged = [...(account.modelNames ?? [])]
    for (const n of names) if (!merged.includes(n)) merged.push(n)
    setSaving(true)
    try {
      const saved = await saveProvider({ ...account, modelNames: merged }, specs)
      if (saved.success) toast.success(t('save.success'))
      else toast.error(t('save.failed').replace('{error}', () => saved.error ?? t('status.unknown')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      {/* 卡头：显示名 / 地址 / 凭据状态 + 添加（仅账户卡） */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {displayName}
            </span>
            {account && (
              // ⚠️ 过渡判据（v3 T5）：只看 `apiKeyRef` 是否已分配 —— 值已不在账户上（密钥只进不出），
              // 真实状态得等 T6 的 credential:describe 三态灯。此处宁可粗也不回传值。
              <span
                className="text-2xs flex-shrink-0"
                style={{ color: account.apiKeyRef ? 'var(--color-success)' : 'var(--color-warning)' }}
              >
                {account.apiKeyRef ? t('modelCard.keyConfigured') : t('modelCard.keyMissing')}
              </span>
            )}
          </div>
          {account && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {account.baseUrl}
            </p>
          )}
        </div>
        {account && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setPickerOpen(true)}>
              <Plus size={13} />
              {t('modelCard.addModel')}
            </Button>
            {onEditAccount && (
              <Button variant="ghost" size="sm" onClick={onEditAccount}>
                {t('action.edit')}
              </Button>
            )}
            {onDeleteAccount && (
              <button
                type="button"
                onClick={onDeleteAccount}
                title={t('provider.delete')}
                aria-label={t('provider.delete')}
                className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                style={{ width: 32, height: 32 }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 行（倒序）；行内编辑时该位渲染 ModelForm */}
      {rows.length > 0 && (
        <div className="p-2 space-y-1.5">
          {rows.map((m) => (
            editing && editing.draft.id === m.id ? (
              <ModelForm
                key={m.id}
                model={editing.draft}
                onChange={(next) => setEditing((e) => (e ? { ...e, draft: next } : e))}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
                saving={saving}
                purposeOptions={m.purposes ?? []}
                presets={BUILTIN_PRESETS}
              />
            ) : (
              <ProviderModelRow
                key={m.id}
                model={m}
                isDefault={isDefault(m)}
                isEmbedding={isEmb(m)}
                onSetDefault={() => (isEmb(m) ? setDefaultEmbeddingModel(m.id) : setDefaultModel(m.id))}
                onEdit={() => startEdit(m)}
                onDelete={() => void handleDelete(m)}
                deleting={deletingId === m.id}
              />
            )
          ))}
        </div>
      )}

      {/* Picker：打开即挂载（Task 3 的生命周期约定——重置靠挂载，非 effect 内同步 setState） */}
      {account && pickerOpen && (
        <ModelPickerDialog
          open
          credentials={account}
          existing={account.modelNames ?? []}
          onAdopt={(names, specs) => void handleAdopt(names, specs)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  )
}

/** 单行（迁移自 v1 ModelCard：图标/信息/操作常驻 32×32；新增类型标签） */
function ProviderModelRow({
  model, isDefault, isEmbedding, onSetDefault, onEdit, onDelete, deleting = false,
}: {
  model: ModelProfile
  isDefault: boolean
  isEmbedding: boolean
  onSetDefault: () => void
  onEdit: () => void
  onDelete: () => void
  deleting?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
        isDefault
          ? 'border border-[var(--color-accent)]'
          : 'border border-[var(--color-border)] hover:border-[var(--color-accent)]',
      )}
      style={{ backgroundColor: isDefault ? 'color-mix(in srgb, var(--color-accent) 5%, var(--color-panel))' : 'var(--color-panel)' }}
    >
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
        style={{ width: 32, height: 32, backgroundColor: 'var(--color-hover)' }}
      >
        {providerEmoji(model.provider)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {model.name || model.modelName}
          </span>
          {isEmbedding && (
            <span
              className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
            >
              {t('modelCard.embeddingTag')}
            </span>
          )}
          {isDefault && (
            <Badge variant="solid" className="px-1.5 font-normal flex-shrink-0">
              {t('model.default')}
            </Badge>
          )}
        </div>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {model.provider} · {model.modelName}
        </p>
      </div>

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
          {deleting ? <Spinner size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  )
}

function providerEmoji(provider: string) {
  const map: Record<string, string> = {
    openai: '🤖', deepseek: '🐬', gemini: '✨', ollama: '🦙', bigmodel: '🧠', custom: '⚙️',
  }
  return map[provider] ?? '🔧'
}
