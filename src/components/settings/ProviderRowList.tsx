import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Server, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'
import { getCurrentLocale } from '../../shared/locale'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import { CreateIcon, SortDirectionIcon } from '../ui/ActionIcons'
import CountBadge from '../ui/CountBadge'
import MenuRow from '../ui/MenuRow'
import { Spinner } from '../ui/Spinner'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { CredentialDot } from './CredentialDot'
import { ProviderEditorCard } from './ProviderEditorCard'
import { AddProviderCard } from './AddProviderCard'
import { OrphanRows } from './OrphanRows'
import { blockingReferences } from './model-references'

type ModelSort = 'configured' | 'name' | 'modelCount'

/** 行的显示名：自定义显示名 → 预设名 → provider id 兜底 */
function displayNameOf(account: ProviderAccount): string {
  const custom = account.displayName?.trim()
  if (custom) return custom
  return BUILTIN_PRESETS.find((p) => p.provider === account.provider)?.displayName ?? account.provider
}

/**
 * ProviderRowList —— 供应商**行列表**（模型管理 v3 §2.1/§2.2，2026-10-01）。
 *
 * 行 = 名称 +（`自定义` 标签）+ 模型数 + 凭据灯 + [编辑][删除]。
 * 点「编辑」（或行片主按钮）→ 该行**下方行内展开**编辑卡，一次只开一张（`editingId`）。
 * 切换行时若当前卡有未保存改动 → 先确认（`model.discardEdit`，v2 同款语义）。
 *
 * 凭据灯的数据源是 `credential:describe`（**批量**，设置段打开时一次拉全）——行上没有密钥值，
 * 只有状态（`CredentialDot` 三态）。删除顺序见 spec §4.7：**先凭据后配置**（见 `handleDelete`）。
 *
 * 本列表还承载三个区块（T9 + 2026-10-01 版位/形态调整）：**无归属条目行组**（`orphans` prop，
 * `OrphanRows` —— 与供应商行同款行卡、**并入主列表**，渲染在行列表之后、添加块之前）、**添加卡**
 * （`AddProviderCard`，与行列表并存）与**首次运行的空态**（无账户且无条目时）。
 *
 * store 驱动：行的一切自持；唯一 prop 是容器算好的 `orphans`（数据在容器、版位在本列表）。
 */
export function ProviderRowList({ orphans }: { orphans?: ModelProfile[] }) {
  const { t } = useTranslation()
  const providers = useLLMStore((s) => s.providers)
  const models = useLLMStore((s) => s.models)
  const credentialInfo = useLLMStore((s) => s.credentialInfo)
  const providersRevision = useLLMStore((s) => s.providersRevision)
  const describeCredentials = useLLMStore((s) => s.describeCredentials)
  const deleteProvider = useLLMStore((s) => s.deleteProvider)
  const unsetCredential = useLLMStore((s) => s.unsetCredential)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sort, setSort] = useState<ModelSort>('configured')
  /** 保存成功的播报文案（spec §2.7 的 aria-live；名字取 reload 后的那一行） */
  const [savedName, setSavedName] = useState<string | null>(null)
  const returnToAddButton = useRef(false)
  /**
   * 打开中的卡是否有未保存改动 —— 由卡片上报（`ProviderEditorCard.onDirtyChange`）。
   * 用 ref 而不是 state：它只在「切换行」这一瞬间被读一次，进 state 只会白白多一轮渲染。
   */
  const dirtyRef = useRef(false)

  const closeAdd = useCallback(() => {
    returnToAddButton.current = true
    setAdding(false)
  }, [])

  const focusAddButton = useCallback((button: HTMLButtonElement | null) => {
    if (!button || !returnToAddButton.current) return
    returnToAddButton.current = false
    button.focus()
  }, [])

  const focusAddCard = useCallback((card: HTMLDivElement | null) => {
    card?.querySelector('button')?.focus()
  }, [])

  // 设置段打开时批量拉一次凭据状态（三态灯的数据源）；失败只降级成无灯，不打扰用户
  useEffect(() => { void describeCredentials() }, [describeCredentials])

  /** 打开某行的编辑卡（单开 + 脏草稿保护） */
  const openEditor = async (id: string) => {
    if (editingId === id) return
    if (editingId !== null && dirtyRef.current) {
      const ok = await confirm(t('model.discardEdit'), { danger: true, confirmText: t('action.discard') })
      if (!ok) return
    }
    dirtyRef.current = false
    // 开卡即清掉上一条播报：aria-live 只在**内容变化**时发声，不清的话
    // 「同一个名字连存两次」第二次是静默的（T6 评审 Minor ⑤）
    setSavedName(null)
    setEditingId(id)
  }

  const closeEditor = useCallback((account: ProviderAccount) => (changed: boolean) => {
    setEditingId(null)
    dirtyRef.current = false
    if (!changed) return
    // 「已保存 {name}」（spec §2.7）：取**重载后**的那一行（改名后要播报新名字）。
    // 写在容器而不是卡里：成功即关卡，卡上的 live region 会在播报前被卸载。
    const fresh = useLLMStore.getState().providers.find((p) => p.id === account.id)
    setSavedName(displayNameOf(fresh ?? account))
  }, [])

  /**
   * 删除账户（spec §4.7 顺序）：引用检查 → 确认 → **凭据**（describe → unset）→ 配置（deleteProvider）。
   *
   * 凭据在前、配置在后：反过来的话 `apiKeyRef` 随账户一起没了，凭据库里那条值就成了
   * **再也无人引用、也无人知道该删**的孤儿密钥。两步分别幂等。
   */
  const handleDelete = async (account: ProviderAccount) => {
    const derived = models.filter((m) => isModelOfAccount(m.id, account.id)).map((m) => m.id)
    // 引用检查在确认**之前**（v1 同口径）：被引用时根本不该走到删除确认
    const blocking = blockingReferences(derived)
    if (blocking) {
      toast.error(t('provider.referenced').replace('{list}', () => blocking))
      return
    }
    const ok = await confirm(
      t('provider.deleteConfirm')
        .replace('{name}', () => displayNameOf(account))
        .replace('{n}', String(derived.length)),
      { danger: true, confirmText: t('action.delete') },
    )
    if (!ok) return

    setDeletingId(account.id)
    try {
      const ref = account.apiKeyRef
      if (ref) {
        // 现查一次状态（spec §4.7「先 credential:describe([ref])」）：env 影子（writable === false）
        // 的值由环境提供、不归本页管理 → **跳过**凭据步骤（set/unset 在影子下都会被拒）
        await describeCredentials([ref])
        const writable = useLLMStore.getState().credentialInfo[ref]?.writable
        if (writable !== false) {
          const res = await unsetCredential(ref)
          // 影子是在 describe 与实际 unset 之间才出现的窄窗口（用户刚在别处设了同名环境变量）：
          // 这不是失败 —— 我们本来就没有该删的东西，照常删配置
          if (!res.success && res.error !== 'envShadowed') {
            renderLog('error', 'Save:Settings', `credential unset failed ref=${ref} (${res.error ?? 'unknown'})`)
            toast.error(t('credential.unsetFailed').replace('{error}', () => res.error ?? t('status.unknown')))
            return
          }
        }
      }
      const res = await deleteProvider(account.id)
      if (!res.success) {
        renderLog('error', 'Save:Settings', `provider delete failed: ${account.id} (${res.error ?? 'unknown'})`)
        toast.error(t('provider.deleteFailed').replace('{error}', () => res.error ?? t('status.unknown')))
        return
      }
      if (editingId === account.id) setEditingId(null)
    } catch (e) {
      // IPC 本身 reject（超时/主进程异常）：同样要有反馈（否则只有「点了没反应」）
      renderLog('error', 'Save:Settings', `provider delete failed: ${account.id} (${String(e)})`)
      toast.error(t('provider.deleteFailed').replace('{error}', () => String(e)))
    } finally {
      setDeletingId(null)
    }
  }

  /** 添加成功后：收起添加卡 + 播报「已保存 {name}」（名字取**重载后**的那一行，同编辑卡口径） */
  const announceAdded = useCallback((accountId: string) => {
    closeAdd()
    const fresh = useLLMStore.getState().providers.find((p) => p.id === accountId)
    if (fresh) setSavedName(displayNameOf(fresh))
  }, [closeAdd])

  /**
   * 打开添加卡 —— 与 `openEditor` 同口径先清上一条播报。
   * 不清的话「连续添加两个显示名相同的供应商」（两家 openai，或两个都回落预设名）第二次是静默的：
   * aria-live 只在**内容变化**时发声，而文本一模一样（T6 评审 Minor ⑤ 的另一半）。
   */
  const openAdd = useCallback(() => {
    setSavedName(null)
    setAdding(true)
  }, [])

  // 空态和列表页头共用添加状态。排序只重排显示行，账号与草稿仍按 id 对应。
  const isEmpty = providers.length === 0 && models.length === 0
  const rows = providers.map((account) => ({
    account,
    name: displayNameOf(account),
    modelCount: models.filter((model) => isModelOfAccount(model.id, account.id)).length,
  }))
  if (sort !== 'configured') {
    const byName = new Intl.Collator(getCurrentLocale(), { numeric: true })
    rows.sort((a, b) => (sort === 'modelCount' ? b.modelCount - a.modelCount : 0)
      || byName.compare(a.name, b.name))
  }

  return (
    <div className="space-y-3">
      {/* 保存成功播报（spec §2.7）：视觉上不打扰，读屏可闻 */}
      <span role="status" aria-live="polite" className="sr-only">
        {savedName ? t('model.savedNotice').replace('{name}', () => savedName) : ''}
      </span>
      <header className="nf-settings-resource-bar">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <Server size={16} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
            {t('model.accountsTitle')}
          </h4>
          <p className="mt-0.5 text-micro text-[var(--color-text-secondary)]">
            {t('model.configuredCount').replace('{n}', String(models.length))}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {rows.length + (orphans?.length ?? 0) > 1 && (
            <div className="nf-settings-sort">
              <SortDirectionIcon direction="desc" size={14} />
              <select aria-label={t('model.sortLabel')} value={sort} onChange={event => setSort(event.target.value as ModelSort)}>
                <option value="configured">{t('model.sortConfigured')}</option>
                <option value="name">{t('model.sortName')}</option>
                <option value="modelCount">{t('model.sortModelCount')}</option>
              </select>
              <ChevronDown size={12} aria-hidden="true" />
            </div>
          )}
          {!isEmpty && !adding && (
            <Button ref={focusAddButton} type="button" size="lg" onClick={openAdd}>
              <CreateIcon size={14} />
              {t('provider.addVendor')}
            </Button>
          )}
        </div>
      </header>

      {/* 添加卡和行列表同时挂载，保留已打开的编辑草稿。 */}
      {adding && (
        <div ref={focusAddCard}>
          <AddProviderCard onCancel={closeAdd} onDone={announceAdded} />
        </div>
      )}

      <div className="space-y-2">
        {rows.map(({ account, name, modelCount }) => {
          const ref = account.apiKeyRef
          const isCustom = account.provider === 'custom'
          return (
            <div key={account.id} className="space-y-2">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-editor-bg)] p-1">
                <MenuRow
                  icon={<Server size={14} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />}
                  title={name}
                  titleSuffix={isCustom ? (
                    <span className="shrink-0 rounded bg-[var(--color-hover)] px-1 py-0.5 text-2xs text-[var(--color-text-secondary)]">
                      {t('model.providerCustom')}
                    </span>
                  ) : undefined}
                  count={(
                    <span className="flex items-center gap-2">
                      <CountBadge value={t('model.accountModelCount').replace('{n}', String(modelCount))} />
                      {ref && <CredentialDot info={credentialInfo[ref]} refName={ref} />}
                    </span>
                  )}
                  active={editingId === account.id}
                  onPrimary={() => void openEditor(account.id)}
                  titleHint={t('model.editConfig').replace('{name}', () => name)}
                  actions={
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        onClick={() => void openEditor(account.id)}
                        title={t('action.edit')}
                        aria-label={t('action.edit')}
                        className="flex items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
                        style={{ width: 32, height: 32 }}
                      >
                        <Settings2 size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(account)}
                        disabled={deletingId === account.id}
                        title={t('provider.delete')}
                        aria-label={t('provider.delete')}
                        className="flex items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] hover:text-[var(--color-error)] disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ width: 32, height: 32 }}
                      >
                        {deletingId === account.id ? <Spinner size={14} /> : <Trash2 size={14} aria-hidden="true" />}
                      </button>
                    </div>
                  }
                />
              </div>
              {editingId === account.id && (
                <ProviderEditorCard
                  account={account}
                  revision={providersRevision}
                  keyInfo={ref ? credentialInfo[ref] : undefined}
                  onClose={closeEditor(account)}
                  onDirtyChange={(dirty) => { dirtyRef.current = dirty }}
                />
              )}
            </div>
          )
        })}
        {orphans && orphans.length > 0 && <OrphanRows models={orphans} sortByName={sort === 'name'} />}
      </div>

      {isEmpty && !adding && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-editor-bg)] px-4 py-8 text-center">
          <span className="grid size-10 place-items-center rounded-lg bg-[var(--color-panel)] text-[var(--color-accent)]">
            <Server size={18} aria-hidden="true" />
          </span>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('model.noConfig')}
          </span>
          <Button ref={focusAddButton} type="button" className="min-h-8" onClick={openAdd}>
            <CreateIcon size={14} />
            {t('provider.addVendor')}
          </Button>
        </div>
      )}
    </div>
  )
}
