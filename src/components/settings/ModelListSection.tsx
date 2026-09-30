/**
 * ModelListSection — 「模型」一体卡区（v2，2026-09-28）。
 *
 * 卡 = 供应商（凭据 + 名下模型，生成/向量混排）+ 「其他」卡（无归属历史模型，仅存在时渲染）。
 * 本文件是**薄容器**：账户级的新建（两模式表单）/编辑/删除（含引用检查）与整页空态；
 * 卡内的一切行为（行倒序/类型标签/行内编辑/拉取采纳）都在 `ModelProviderCard`。
 *
 * 与 v1 的差异：不再按 purposes 分段（生成/嵌入同账户天然混排）；空态只在"一无所有"时出现。
 */
import { useState } from 'react'
import { Plus, Zap } from 'lucide-react'
import { useLLMStore } from '../../stores/llm-store'
import { isModelOfAccount } from '../../shared/provider-accounts'
import type { ProviderAccount } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { ModelProviderCard } from './ModelProviderCard'
import { ProviderAccountForm, blockingReferences } from './ProviderAccountsSection'

export function ModelListSection() {
  const { t } = useTranslation()
  const models = useLLMStore(s => s.models)
  const providers = useLLMStore(s => s.providers)
  const [editingAccount, setEditingAccount] = useState<ProviderAccount | null>(null)

  /** 「其他」卡：不属于任何供应商账户的历史条目（P3 兼容——可见可编辑可删，不自动迁移） */
  const orphans = models.filter(m => !providers.some(p => isModelOfAccount(m.id, p.id)))

  /** 删除账户：引用检查放在确认**之前**（被引用时根本不该走到删除确认）——逻辑迁自 v1 账户区 */
  const handleDeleteAccount = async (account: ProviderAccount) => {
    const derived = models.filter(m => isModelOfAccount(m.id, account.id)).map(m => m.id)
    const blocking = blockingReferences(derived)
    if (blocking) {
      toast.error(t('provider.referenced').replace('{list}', () => blocking))
      return
    }
    const ok = await confirm(
      t('provider.deleteConfirm')
        .replace('{name}', () => account.provider)
        .replace('{n}', String(derived.length)),
      { danger: true, confirmText: t('action.delete') },
    )
    if (ok) await useLLMStore.getState().deleteProvider(account.id)
  }

  /** 新建账户的初值：目录模式第一家（有模型的家）；两模式在表单里切换 */
  const newAccount = (): ProviderAccount => {
    const preset =
      BUILTIN_PRESETS.find(p => p.provider !== 'custom' && (p.models.length > 0 || p.embeddingModels.length > 0)) ??
      BUILTIN_PRESETS[0]
    return {
      id: randomUUID(),
      provider: preset.provider as ProviderAccount['provider'],
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      modelNames: [],
    }
  }

  if (editingAccount) {
    return (
      <ProviderAccountForm
        account={editingAccount}
        onCancel={() => setEditingAccount(null)}
        onDone={() => setEditingAccount(null)}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('model.configured').replace('{n}', String(models.length)).replace('{label}', '')}
        </span>
        <Button size="sm" onClick={() => setEditingAccount(newAccount())}>
          <Plus size={13} />
          {t('provider.addVendor')}
        </Button>
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
          <Button size="sm" variant="outline" onClick={() => setEditingAccount(newAccount())}>
            <Plus size={13} />
            {t('provider.addVendor')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map(account => (
            <ModelProviderCard
              key={account.id}
              account={account}
              models={models.filter(m => isModelOfAccount(m.id, account.id))}
              onEditAccount={() => setEditingAccount(account)}
              onDeleteAccount={() => void handleDeleteAccount(account)}
            />
          ))}
          {orphans.length > 0 && <ModelProviderCard account={null} models={orphans} />}
        </div>
      )}
    </div>
  )
}
