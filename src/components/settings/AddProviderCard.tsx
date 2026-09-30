import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLLMStore } from '../../stores/llm-store'
import { BUILTIN_PRESETS, builtinCatalogFor } from '../../shared/provider-presets'
import type { ProviderAccount } from '../../shared/ipc-channels'
import { randomUUID } from '../../utils/id'
import { Label } from '../ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { SegmentedControl } from '../ui/SegmentedControl'
import { ProviderEditorCard } from './ProviderEditorCard'

type AddProviderMode = 'catalog' | 'custom'

/**
 * 目录模式可选的家：**有内置目录**者（目录命中可以免网络直答）且不是 `custom`
 * —— `custom` 由「自定义 API」模式承担，混进下拉是双重入口。
 */
function catalogProviders() {
  return BUILTIN_PRESETS.filter((p) => p.provider !== 'custom' && builtinCatalogFor(p.provider).length > 0)
}

/**
 * 新建账户的初值（**唯一来源**；T6 遗留的两份逐字重复在此收敛）。
 *
 * `modelNames` 刻意缺省（v3 §3.1）：新建账户的本意就是「用这一家的默认目录」。
 */
function draftAccountFor(provider: string): ProviderAccount {
  const preset = BUILTIN_PRESETS.find((p) => p.provider === provider)
  return {
    id: randomUUID(),
    provider: provider as ProviderAccount['provider'],
    protocol: preset?.protocol ?? 'openai',
    baseUrl: preset?.baseUrl ?? '',
  }
}

/**
 * 模式面板：**首访后保持挂载**（切模式只是 `hidden`，不卸载）—— 这是「切模式不丢草稿」的机制
 * （v3 §2.3）。顺带承担首次运行的两个细节：密钥框自动聚焦（挂载即聚焦一次）、
 * `role="group"` + 模式名给面板一个可达的名字。
 */
function ModePanel({ label, hidden, children }: { label: string; hidden: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // 首次运行：点开添加卡就能直接粘贴密钥（dsh setup 卡的 NF 适配点之一）
    ref.current?.querySelector<HTMLInputElement>('input[type="password"]')?.focus()
  }, [])
  return (
    <div ref={ref} role="group" aria-label={label} hidden={hidden} className="space-y-2">
      {children}
    </div>
  )
}

export interface AddProviderCardProps {
  /** 取消（一个字节都没写）—— 面板收起、草稿丢弃 */
  onCancel: () => void
  /**
   * 保存成功（账户已落盘并同步派生条目）—— 容器收起面板、行列表自然多出一行。
   * `accountId` = 新建账户的 id：容器据此从**重载后的**行里取名字播报「已保存 {name}」
   * （spec §2.7 的播报口径与行内编辑卡一致，添加路径同样要出声）。
   */
  onDone: (accountId: string) => void
}

/**
 * AddProviderCard —— 底部「添加模型提供商」卡（模型管理 v3 §2.3/§2.4，2026-10-01）。
 *
 * ```
 * 添加模型提供商
 * （ 第三方模型提供商 | 自定义模型 API ）   ← 分段两模式
 *   说明行（当前模式的一句话）
 *   ┌ 目录模式：服务商下拉 + 编辑卡（hideTitle：无卡头/无边框，外壳由本卡给）
 *   └ 自定义模式：编辑卡（advancedOpen：显示名/端点/协议是路由字段，直接摊开）
 * ```
 *
 * 三条语义（v3 §2.3，别在重构里丢）：
 * 1. **切换两模式不丢草稿**：访问过的模式面板一直挂着（`hidden` 而非卸载），各自持有草稿
 *    ——目录与自定义本来就是两份不同的草稿（家 vs 手填端点）。
 * 2. **写入 / 探测中锁定切换**：保存中或候选面板开着时，分段控件禁用（半途换模式会让
 *   进行中的那次提交对着一个已经不可见的表单回话）。
 * 3. **只剩一种模式时**不出分段控件，以该模式名为标题直接显示表单（可用集变了也不会露出个
 *    点了没反应的档位）。
 *
 * provider 由本卡持有（目录模式的下拉）而**不是**编辑卡：换家要连 protocol/baseUrl 一起重播种，
 * 卡片侧靠 `account.provider` 变化识别（见 ProviderEditorCard 的换家 effect）。
 */
export function AddProviderCard({ onCancel, onDone }: AddProviderCardProps) {
  const { t } = useTranslation()
  const providersRevision = useLLMStore((s) => s.providersRevision)

  /** 可用模式（只剩一种时以该模式为标题直接显示表单） */
  const modes = useMemo<AddProviderMode[]>(
    () => (catalogProviders().length > 0 ? ['catalog', 'custom'] : ['custom']),
    [],
  )
  const [mode, setMode] = useState<AddProviderMode>(modes[0])
  /** 已访问过的模式：**只增不减** —— 首访后保持挂载（切模式不丢对侧草稿） */
  const [visited, setVisited] = useState<AddProviderMode[]>(() => [modes[0]])
  /** 各模式的「写入 / 探测中」 */
  const [busy, setBusy] = useState<Record<AddProviderMode, boolean>>({ catalog: false, custom: false })
  const busyNow = busy.catalog || busy.custom

  /** 目录模式的草稿（下拉换家时整组重播种）。默认家 = 第一家**有内置目录**的预设（v3 §2.4） */
  const [catalogAccount, setCatalogAccount] = useState<ProviderAccount>(() =>
    draftAccountFor(modes[0] === 'catalog' ? (catalogProviders()[0]?.provider ?? 'openai') : 'custom'))
  /** 自定义模式：`provider` 固定 `custom`，协议/地址在卡里选填 */
  const [customAccount] = useState<ProviderAccount>(() => draftAccountFor('custom'))

  const switchMode = (next: AddProviderMode) => {
    if (busyNow) return // 分段控件已禁用，这里是第二道防线
    setMode(next)
    setVisited((seen) => (seen.includes(next) ? seen : [...seen, next]))
  }

  /** 换家：provider + 它的预设协议/地址一起换（卡片据此重播种，见 ProviderEditorCard） */
  const changeProvider = (next: string) => {
    const preset = BUILTIN_PRESETS.find((p) => p.provider === next)
    setCatalogAccount((cur) => ({
      ...cur,
      provider: next as ProviderAccount['provider'],
      protocol: preset?.protocol ?? 'openai',
      baseUrl: preset?.baseUrl ?? '',
    }))
  }

  // 两个模式各一个稳定的上报函数（身份稳定 → 子组件的 effect 不会每次渲染都重跑）
  const onCatalogBusy = useCallback(
    (b: boolean) => setBusy((cur) => (cur.catalog === b ? cur : { ...cur, catalog: b })),
    [],
  )
  const onCustomBusy = useCallback(
    (b: boolean) => setBusy((cur) => (cur.custom === b ? cur : { ...cur, custom: b })),
    [],
  )

  const modeLabel = (m: AddProviderMode) =>
    m === 'catalog' ? t('addProvider.modeCatalog') : t('addProvider.modeCustom')

  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{ border: '1.5px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
        {t('addProvider.title')}
      </span>

      {modes.length > 1 ? (
        <SegmentedControl
          items={modes.map((m) => ({ value: m, label: modeLabel(m) }))}
          value={mode}
          onChange={switchMode}
          disabled={busyNow}
          fill
        />
      ) : (
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{modeLabel(modes[0])}</span>
      )}

      <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>
        {t(mode === 'catalog' ? 'addProvider.catalogDesc' : 'addProvider.customDesc')}
      </p>

      {visited.includes('catalog') && (
        <ModePanel label={modeLabel('catalog')} hidden={mode !== 'catalog'}>
          <div>
            <Label>{t('form.provider')}</Label>
            <Select value={catalogAccount.provider} onValueChange={changeProvider}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {catalogProviders().map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>{p.displayName ?? p.provider}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ProviderEditorCard
            account={catalogAccount}
            revision={providersRevision}
            // 新账户**还没有** ref（主进程保存时才分配）→ 三态回落「输入 API 密钥」/Ollama 特例
            keyInfo={undefined}
            hideTitle
            onBusyChange={onCatalogBusy}
            onClose={(changed) => (changed ? onDone(catalogAccount.id) : onCancel())}
          />
        </ModePanel>
      )}

      {visited.includes('custom') && (
        <ModePanel label={modeLabel('custom')} hidden={mode !== 'custom'}>
          <ProviderEditorCard
            account={customAccount}
            revision={providersRevision}
            keyInfo={undefined}
            hideTitle
            advancedOpen
            onBusyChange={onCustomBusy}
            onClose={(changed) => (changed ? onDone(customAccount.id) : onCancel())}
          />
        </ModePanel>
      )}
    </div>
  )
}
