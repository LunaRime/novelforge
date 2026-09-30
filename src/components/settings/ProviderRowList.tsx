import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import type { ProviderAccount } from '../../shared/ipc-channels'
import { randomUUID } from '../../utils/id'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import MenuRow from '../ui/MenuRow'
import { Spinner } from '../ui/Spinner'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { CredentialDot } from './CredentialDot'
import { ProviderEditorCard } from './ProviderEditorCard'
import { ProviderAccountForm, blockingReferences } from './ProviderAccountsSection'

/** 行的显示名：自定义显示名 → 预设名 → provider id 兜底 */
function displayNameOf(account: ProviderAccount): string {
  const custom = account.displayName?.trim()
  if (custom) return custom
  return BUILTIN_PRESETS.find((p) => p.provider === account.provider)?.displayName ?? account.provider
}

/** 新建账户的初值：目录模式第一家（有模型的家）；两模式在表单里切换 */
function newAccount(): ProviderAccount {
  const preset =
    BUILTIN_PRESETS.find((p) => p.provider !== 'custom' && (p.models.length > 0 || p.embeddingModels.length > 0)) ??
    BUILTIN_PRESETS[0]
  return {
    id: randomUUID(),
    provider: preset.provider as ProviderAccount['provider'],
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    // ⚠️ 不写 `modelNames: []`（v3 §3.1：空数组 = **继承内置目录**，与「一个模型都没有」表达相反）——
    //    缺省才是「新账户 = 用该家默认目录」的本意
  }
}

/**
 * ProviderRowList —— 供应商**行列表**（模型管理 v3 §2.1/§2.2，2026-10-01）。
 *
 * 行 = 名称 +（`自定义` 标签）+ 凭据灯 + [编辑][删除]（行片 32px 几何，`ui/MenuRow` 唯一实现）。
 * 点「编辑」（或行片主按钮）→ 该行**下方行内展开**编辑卡，一次只开一张（`editingId`）。
 * 切换行时若当前卡有未保存改动 → 先确认（`model.discardEdit`，v2 同款语义）。
 *
 * 凭据灯的数据源是 `credential:describe`（**批量**，设置段打开时一次拉全）——行上没有密钥值，
 * 只有状态（`CredentialDot` 三态）。删除顺序见 spec §4.7：**先凭据后配置**（见 `handleDelete`）。
 *
 * store 驱动、无 props：容器（`ModelListSection`）只负责标题与「其他」卡，行的一切自持。
 */
export function ProviderRowList() {
  const { t } = useTranslation()
  const providers = useLLMStore((s) => s.providers)
  const models = useLLMStore((s) => s.models)
  const credentialInfo = useLLMStore((s) => s.credentialInfo)
  const providersRevision = useLLMStore((s) => s.providersRevision)
  const describeCredentials = useLLMStore((s) => s.describeCredentials)
  const deleteProvider = useLLMStore((s) => s.deleteProvider)
  const unsetCredential = useLLMStore((s) => s.unsetCredential)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState<ProviderAccount | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  /** 保存成功的播报文案（spec §2.7 的 aria-live；名字取 reload 后的那一行） */
  const [savedName, setSavedName] = useState<string | null>(null)
  /**
   * 打开中的卡是否有未保存改动 —— 由卡片上报（`ProviderEditorCard.onDirtyChange`）。
   * 用 ref 而不是 state：它只在「切换行」这一瞬间被读一次，进 state 只会白白多一轮渲染。
   */
  const dirtyRef = useRef(false)

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

  // 添加卡（复用 v2 的两模式表单；T9 换成 dsh 式「添加模型提供商」卡）
  if (adding) {
    return <ProviderAccountForm account={adding} onCancel={() => setAdding(null)} onDone={() => setAdding(null)} />
  }

  return (
    <div>
      {/* 保存成功播报（spec §2.7）：视觉上不打扰，读屏可闻 */}
      <span role="status" aria-live="polite" className="sr-only">
        {savedName ? t('model.savedNotice').replace('{name}', () => savedName) : ''}
      </span>

      {providers.map((account) => {
        const ref = account.apiKeyRef
        const name = displayNameOf(account)
        const isCustom = account.provider === 'custom'
        return (
          <div key={account.id}>
            <MenuRow
              title={name}
              titleSuffix={isCustom ? (
                <span
                  className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                >
                  {t('model.providerCustom')}
                </span>
              ) : undefined}
              count={ref ? <CredentialDot info={credentialInfo[ref]} refName={ref} /> : undefined}
              onPrimary={() => void openEditor(account.id)}
              titleHint={t('action.edit')}
              actions={
                <div className="flex items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={() => void openEditor(account.id)}
                    title={t('action.edit')}
                    aria-label={t('action.edit')}
                    className="flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    style={{ width: 32, height: 32 }}
                  >
                    <Settings2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(account)}
                    disabled={deletingId === account.id}
                    title={t('provider.delete')}
                    aria-label={t('provider.delete')}
                    className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgba(var(--color-error-rgb),0.1)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ width: 32, height: 32 }}
                  >
                    {deletingId === account.id ? <Spinner size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              }
            />
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

      <div className="flex items-center px-1 pt-1">
        <Button size="sm" variant="outline" onClick={() => setAdding(newAccount())}>
          <Plus size={13} />
          {t('provider.addVendor')}
        </Button>
      </div>
    </div>
  )
}
