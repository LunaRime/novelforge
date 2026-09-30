/* eslint-disable react-refresh/only-export-components -- 有意混合导出：目录草稿的四个纯函数
   与组件同属一处语义（草稿形状 = 提交形状），拆文件只会让「改了 ModelDraft 字段却没改解析」这类
   漂移变成两个文件之间的事；ModelForm.tsx 同款先例。 */
import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { formatCapacity, parseCapacity } from '../../shared/capacity'
import { builtinCatalogFor, presetModelDefaults } from '../../shared/provider-presets'
import type { ModelOverrides } from '../../shared/provider-accounts'
import type { ModelProfile, ProviderModelQuery } from '../../shared/ipc-channels'
import type { TextKey } from '../../shared/locale'
import type { InputType } from './ModelInputTypes'
import { ModelCatalogRow } from './ModelCatalogRow'
import { ModelPickerDialog, type AdoptedModel } from './ModelPickerDialog'

/**
 * 目录行草稿（模型管理 v3 §3.3/§5）。
 *
 * ⚠️ **字段都是「显式值」**：`undefined` = 这一项**没被本次编辑碰过**（继承既有条目/内置规格），
 * 提交时不出现在 overrides 里 —— 于是「没改的字段」永远不会覆盖条目上的真值。
 * 容量两个字段存的是**输入原文**（不是解析后的数）：键盘缓冲必须原样留着，否则
 * 敲到一半的 `1000` 会被格式化回 `1K`，非法值也会被一句「规范化」抹掉、用户再也看不到自己敲了什么。
 */
export interface ModelDraft {
  /** 模型 ID（= `modelName`；派生条目 id 的后半。改它 = 换一个模型） */
  modelName: string
  /** 显示名草稿（空 = 回落 `modelName`） */
  name?: string
  /** 上下文窗口的输入原文（`undefined`/空 = 继承） */
  contextWindowText?: string
  /** 最大输出 token 的输入原文（`undefined`/空 = 继承） */
  maxTokensText?: string
  /** 输入类型的**显式**值（`undefined` = 继承 → `['text']`） */
  inputTypes?: InputType[]
}

/**
 * 「获取可用模型」要用的凭据快照（v3 §4.7）：草稿密钥优先，否则主进程按 ref 解析。
 * provider 不在其中 —— 它就是本区的 `provider` prop（同一次挂载里两者不可能不一致）。
 */
export type CatalogFetchCredentials = Omit<ProviderModelQuery, 'provider'>

export interface ModelCatalogEditorProps {
  /** 供应商 id —— 决定继承源（内置目录）与规格兜底 */
  provider: string
  /**
   * 该账户**现有**的派生条目（初值/placeholder/用途标签的来源）。
   * 空数组 = 新账户还没同步过 → 一切按内置规格。
   */
  existing: ModelProfile[]
  /** 目录草稿：`undefined` = **继承**内置目录（三态之一，不是「空目录」） */
  value: ModelDraft[] | undefined
  onChange: (next: ModelDraft[] | undefined) => void
  /** 校验结果（id 空/重复、容量非法）—— 父级据此禁「应用」 */
  onValidityChange?: (valid: boolean) => void
  /**
   * 「获取可用模型」用的凭据。**`undefined` = 入口禁用** —— 门控（无 API 地址 / 密钥草稿不合法）
   * 由父级判定：只有它同时握着地址与密钥草稿这两个草稿值。
   */
  fetchCredentials?: CatalogFetchCredentials
  /** 候选 Modal 开关上报（= 探测/采纳流程进行中）——添加卡据此锁住模式切换 */
  onBusyChange?: (busy: boolean) => void
  disabled?: boolean
}

/**
 * 模型名清单 → 目录行。
 *
 * **显示名从既有条目预填**（不是 placeholder）：显示名有「清空 = 回落模型 ID」这条语义，
 * 只有把当前值放进可编辑的框里，用户才清得掉它 —— 塞进 placeholder 的话，
 * 一个已改过名的模型永远回不到模型 ID（框本来就是空的，再清一次什么也没变）。
 *
 * 容量相反：它们是**显式值**（`undefined` = 没改过），当前生效值走 placeholder ——
 * 见 `ModelDraft` 的说明。
 */
function catalogRowsOf(names: string[], existing: ModelProfile[]): ModelDraft[] {
  const byName = new Map(existing.map((m) => [m.modelName, m]))
  return names.map((modelName) => {
    const name = byName.get(modelName)?.name
    return name === undefined ? { modelName } : { modelName, name }
  })
}

/**
 * 三态 → 草稿的初值：`undefined` / **空数组** = 继承（回 `undefined`）。
 *
 * ⚠️ 空数组是「继承」的存储表达（v3 §3.1），不是「一个模型都没有」——
 * 这正是「删光行 → 提交 `[]` → 重开又见全集」那条语义的来源。
 */
export function initialCatalogDraft(
  modelNames: string[] | undefined,
  existing: ModelProfile[] = [],
): ModelDraft[] | undefined {
  if (!modelNames || modelNames.length === 0) return undefined
  return catalogRowsOf(modelNames, existing)
}

/** 草稿 → 提交用的 `modelNames`（trim；继承态原样 `undefined`） */
export function catalogModelNames(rows: ModelDraft[] | undefined): string[] | undefined {
  if (rows === undefined) return undefined
  return rows.map((row) => row.modelName.trim())
}

/**
 * 两份目录草稿是否等价（编辑卡的「脏草稿」判定用）。
 *
 * 逐字段比而不是比引用：初值每渲染重算（见 ProviderEditorCard），引用比较会永远为 false
 * → 卡片一挂载就「有未保存改动」，切换行时白弹一次确认。
 */
export function catalogsEqual(a: ModelDraft[] | undefined, b: ModelDraft[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return a.every((row, i) => {
    const other = b[i]
    return row.modelName === other.modelName
      && row.name === other.name
      && row.contextWindowText === other.contextWindowText
      && row.maxTokensText === other.maxTokensText
      && (row.inputTypes ?? []).join() === (other.inputTypes ?? []).join()
  })
}

/** 该行显式填的容量：`undefined` = 没填（继承）；`NaN` = 填了但读不出来 */
function draftCapacity(text: string | undefined): number | undefined {
  return text === undefined ? undefined : parseCapacity(text)
}

/** 能落盘的容量（正整数，与行级校验同一判据） */
function isLegalCapacity(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0
}

/**
 * 一个容量框的原文 → 该字段的覆盖值（三态）。
 *
 *   - `undefined`（根本没填过）→ 本次不动这个字段
 *   - 空串 / 纯空白 → `null` = **移除覆盖**（spec §5「留空=继承」：清空即回落内置规格）
 *   - 数字 → 覆盖；非法文本 → 不上报（行级校验已拦住提交，这里是第二道防线）
 */
function capacityOverride(text: string | undefined): number | null | undefined {
  if (text === undefined) return undefined
  const value = parseCapacity(text)
  if (value === undefined) return null
  return isLegalCapacity(value) ? value : undefined
}

/**
 * 草稿 → `modelOverrides`（**只含本次动过的字段**）。
 *
 * 三条判据，缺一条都会静默毁掉用户的数据：
 *  - `name`：与「该行当前的显示名」比（既有条目 → 它的 name；新行 → 模型名）。
 *    显示名清空 = 回落模型名，所以**空也要发**（那是「把改过的名字改回去」的意思，不发就改不回来）。
 *  - 容量（见 `capacityOverride`）：`undefined` = 没填过（不发）/ **空串 = `null`（移除覆盖，
 *    spec §5「留空=继承」）** / 有值 = 覆盖。
 *  - 输入类型：只在草稿里**显式改过**时才发（至少留一种，没有「清空」态）。
 *  - 非法容量（NaN/0/负数/非整数）**不上报**：主进程侧没有类型约束，坏值一旦出这个函数
 *    就会原样写进 models.json。UI 的禁应用是门控，这行是防线。
 */
export function catalogOverrides(
  rows: ModelDraft[] | undefined,
  existing: ModelProfile[],
): ModelOverrides | undefined {
  if (rows === undefined) return undefined
  const byName = new Map(existing.map((m) => [m.modelName, m]))
  const out: ModelOverrides = {}

  for (const row of rows) {
    const id = row.modelName.trim()
    if (!id) continue // 空 id 的行由校验拦下，这里不产生无主覆盖

    const base = byName.get(id)
    const override: ModelOverrides[string] = {}
    // 显示名三态与容量同构：`undefined` = 本次没碰（条目上的名字是权威值，别拿它去覆盖）；
    // `''` = **清空**（显式意图：回落模型 ID）；有值 = 改成它。
    if (row.name !== undefined) {
      const desiredName = row.name.trim() || id
      if (desiredName !== (base?.name ?? id)) override.name = desiredName
    }

    const contextWindow = capacityOverride(row.contextWindowText)
    if (contextWindow !== undefined) override.contextWindow = contextWindow
    const maxTokens = capacityOverride(row.maxTokensText)
    if (maxTokens !== undefined) override.maxTokens = maxTokens

    if (row.inputTypes !== undefined && row.inputTypes.length > 0) override.inputTypes = [...row.inputTypes]

    if (Object.keys(override).length > 0) out[id] = override
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** 采纳项 → 新行（只带**有值**的字段：`undefined` = 没这个信息，别写成空串把继承态抹平） */
function adoptedRowOf(id: string, model: AdoptedModel): ModelDraft {
  const displayName = model.displayName?.trim()
  return {
    modelName: id,
    ...(displayName ? { name: displayName } : {}),
    ...(model.contextWindow !== undefined ? { contextWindowText: formatCapacity(model.contextWindow) } : {}),
    ...(model.maxTokens !== undefined ? { maxTokensText: formatCapacity(model.maxTokens) } : {}),
    ...(model.inputTypes !== undefined && model.inputTypes.length > 0 ? { inputTypes: [...model.inputTypes] } : {}),
  }
}

/**
 * 采纳结果 → 目录草稿（v3 §5「采纳时已存在行保留用户值、只补齐缺失字段」）。
 *
 * 两条分支：
 *  - **目录里没有** → 追加在**末尾**（存储序；显示层倒序会让它自然置顶），规格照填；
 *  - **目录里已有** → 一个字都不覆盖：只在该字段**两边都缺**（行草稿没填过 + 既有条目也没有）时
 *    才用采纳值补上。用户改过的容量、显示名、输入类型都是权威值 —— 端点说的不算。
 *
 * ⚠️ 传入的是**生效行**（继承态下 = 内置目录那一组），不是 `value`：采纳 = 一次编辑，
 * 必须先把继承态物化，否则目录会被这次采纳「换掉」（只剩被采纳的那一个）。
 */
export function mergeAdopted(
  rows: readonly ModelDraft[],
  adopted: readonly AdoptedModel[],
  existing: readonly ModelProfile[],
): ModelDraft[] {
  const byName = new Map(existing.map((m) => [m.modelName, m]))
  const next = [...rows]
  for (const model of adopted) {
    const id = model.name.trim()
    if (id.length === 0) continue
    const at = next.findIndex((row) => row.modelName.trim() === id)
    if (at < 0) {
      next.push(adoptedRowOf(id, model))
      continue
    }
    const row = next[at]
    const entry = byName.get(id)
    const filled: ModelDraft = { ...row }
    if (filled.name === undefined && entry?.name === undefined && model.displayName?.trim()) {
      filled.name = model.displayName
    }
    if (filled.contextWindowText === undefined && entry?.contextWindow === undefined && model.contextWindow !== undefined) {
      filled.contextWindowText = formatCapacity(model.contextWindow)
    }
    if (filled.maxTokensText === undefined && entry?.maxTokens === undefined && model.maxTokens !== undefined) {
      filled.maxTokensText = formatCapacity(model.maxTokens)
    }
    const adoptedTypes = model.inputTypes
    const entryHasTypes = (entry?.inputTypes?.length ?? 0) > 0
    if (filled.inputTypes === undefined && !entryHasTypes && adoptedTypes !== undefined && adoptedTypes.length > 0) {
      filled.inputTypes = [...adoptedTypes]
    }
    next[at] = filled
  }
  return next
}

/** 一行的错误（按字段带 key，不预先翻译 —— 行组件要按字段决定 `aria-invalid` 与红字位置） */
export interface ModelRowErrors {
  id?: TextKey
  contextWindow?: TextKey
  maxTokens?: TextKey
}

/**
 * 行级校验 → 每行的错误（与行同序）。
 *
 * 去重按 **trim 后**比较（`model ` 与 `model` 是同一个模型，不 trim 就漏判），
 * 且**只判后出现的那一行**：第一个是保留者，把它也标红只会让用户不知道改哪一个。
 */
function rowErrorsOf(rows: ModelDraft[]): ModelRowErrors[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const errors: ModelRowErrors = {}
    const id = row.modelName.trim()
    if (id.length === 0) errors.id = 'catalog.idRequired'
    else if (seen.has(id)) errors.id = 'catalog.idDuplicate'
    else seen.add(id)

    const contextWindow = draftCapacity(row.contextWindowText)
    if (contextWindow !== undefined && !isLegalCapacity(contextWindow)) errors.contextWindow = 'catalog.contextInvalid'
    const maxTokens = draftCapacity(row.maxTokensText)
    if (maxTokens !== undefined && !isLegalCapacity(maxTokens)) errors.maxTokens = 'catalog.maxTokensInvalid'

    return errors
  })
}

/**
 * 目录区操作行里的文字型按钮（恢复默认 / 获取可用模型）。
 *
 * py-1 + 11px 行高 ≈ 21px 高 —— 文字型目标下限 20px（card-affordance-standard）：
 * `py-0.5` 只有 17px，低于下限。两个按钮共用同一串类名，免得分头演化出两种长相。
 */
const HEADER_ACTION = 'text-micro px-1.5 py-1 rounded transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-50 disabled:cursor-not-allowed'

/** 删掉某行后把它后面展开着的行号往前挪一格 */
function shiftAfterRemove(expanded: ReadonlySet<number>, removed: number): Set<number> {
  const next = new Set<number>()
  for (const at of expanded) {
    if (at < removed) next.add(at)
    else if (at > removed) next.add(at - 1)
  }
  return next
}

/**
 * ModelCatalogEditor —— 模型目录区（模型管理 v3 §2 的第三个区，dsh `ModelListEditor` 的 NF 版）。
 *
 * ```
 * 模型目录   默认模型目录 / 已自定义模型目录            [恢复默认模型]
 *   gpt-5.6-sol     主力              [生成]  ⌄  🗑
 *     ⌄ 上下文窗口 [256K]  最大输出 token [64K]  输入类型 ☑文本 ☐图片
 *   [+ 添加模型]
 * ```
 *
 * 三条语义（spec，别在重构里丢）：
 * 1. **三态**：`undefined` = 继承内置目录（行区显示全集、只读地体现「目录现在长什么样」）；
 *    任何增删改 → **先物化**（把当前有效目录整组落成草稿）再施加改动；「恢复默认模型」= 清回 `undefined`。
 * 2. **删光 = 恢复默认**：空数组在存储层就是「继承」（v3 §3.1），所以删光全部行 = 下次保存后
 *    回到全集 —— 这是**设计语义**，不是漏判，界面上用 meta 文案说清即可（不加「至少留一行」的守卫）。
 * 3. **显示层倒序**（用户既定）：新加/新采纳的行显示在最上；**存储序不动**，行操作的定位一律走
 *    条目下标（不是显示下标）—— 倒排显示 + 按下标删除是最容易错位的一处。
 *
 * 「获取可用模型」（T8，v3 §5）：入口在本区操作行，候选 Modal 打开时**才挂载**（key 即重置），
 * 采纳结果走 `mergeAdopted` 合并 —— 新行追加在存储序末尾（倒序显示 → 看起来置顶），
 * 已存在行只补缺、不覆盖用户值。
 */
export function ModelCatalogEditor({
  provider, existing, value, onChange, onValidityChange, fetchCredentials, onBusyChange, disabled,
}: ModelCatalogEditorProps) {
  const { t } = useTranslation()
  const inheriting = value === undefined
  /**
   * 继承态下直接拿内置目录当行（**不落 state**）：物化只发生在用户真的改了东西那一刻，
   * 「只是点开看了一眼」不该让账户从继承态变成自定义态。
   */
  const rows: ModelDraft[] = value ?? catalogRowsOf(builtinCatalogFor(provider), existing)
  const errors = rowErrorsOf(rows)
  const valid = errors.every((e) => e.id === undefined && e.contextWindow === undefined && e.maxTokens === undefined)

  /** 展开的行（**存储序**下标）：显示倒排，但状态按条目存，删行后靠 `shiftAfterRemove` 对齐 */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  /** 候选 Modal：`true` 时**才挂载**（挂载即重置 —— 见 ModelPickerDialog 的生命周期约定） */
  const [pickerOpen, setPickerOpen] = useState(false)

  const byName = useMemo(() => new Map(existing.map((m) => [m.modelName, m])), [existing])

  useEffect(() => { onValidityChange?.(valid) }, [valid, onValidityChange])
  // 探测/采纳流程 = 候选 Modal 开着（打开即拉取）。它是模态，背后点不到 —— 锁是第二道防线
  useEffect(() => { onBusyChange?.(pickerOpen) }, [pickerOpen, onBusyChange])

  const patch = (index: number, next: Partial<ModelDraft>) => {
    onChange(rows.map((row, at) => (at === index ? { ...row, ...next } : row)))
  }

  const remove = (index: number) => {
    onChange(rows.filter((_row, at) => at !== index))
    setExpanded((current) => shiftAfterRemove(current, index))
  }

  const toggleExpanded = (index: number) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  return (
    <section aria-label={t('catalog.title')}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('catalog.title')}</span>
        <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>
          {inheriting ? t('catalog.inherited') : t('catalog.customized')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!inheriting && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { onChange(undefined); setExpanded(new Set()) }}
              className={HEADER_ACTION}
            >
              {t('catalog.reset')}
            </button>
          )}
          <button
            type="button"
            disabled={disabled || fetchCredentials === undefined}
            // 禁用一个「看起来能点」的按钮必须说明为什么（ui-interaction-standard 的 disabled 边界）
            title={fetchCredentials === undefined ? t('catalog.fetchDisabled') : undefined}
            onClick={() => setPickerOpen(true)}
            className={HEADER_ACTION}
          >
            {t('provider.fetchModels')}
          </button>
        </div>
      </div>

      {/* 空目录只在**自定义态**才有意义（继承态为空 = 该家本来就没有内置目录，没什么可恢复的） */}
      {!inheriting && rows.length === 0 && (
        <p className="text-micro mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {t('catalog.emptyCustomized')}
        </p>
      )}

      <div className="space-y-0.5 mt-1">
        {rows
          .map((row, index) => ({ row, index }))
          .reverse() // 显示层倒序（新行在上）；操作仍按 index（存储序）定位
          .map(({ row, index }, at) => {
            const id = row.modelName.trim()
            const entry = byName.get(id)
            const spec = presetModelDefaults(provider, id)
            return (
              <ModelCatalogRow
                key={index}
                draft={row}
                position={at + 1}
                purposes={entry?.purposes ?? spec.purposes}
                inherited={{
                  contextWindow: entry?.contextWindow ?? spec.contextWindow,
                  maxTokens: entry?.maxTokens ?? spec.maxTokens,
                  // 回退链：行 → 规格（生成表暂无 inputTypes 来源）→ ['text']
                  inputTypes: entry?.inputTypes && entry.inputTypes.length > 0 ? entry.inputTypes : ['text'],
                }}
                errors={errors[index]}
                expanded={expanded.has(index)}
                disabled={disabled}
                onToggle={() => { toggleExpanded(index) }}
                onChange={(next) => { patch(index, next) }}
                onRemove={() => { remove(index) }}
              />
            )
          })}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => { onChange([...rows, { modelName: '' }]) }}
        className="mt-1 flex items-center gap-1 text-micro px-1.5 py-1 rounded-lg transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={12} />
        {t('catalog.add')}
      </button>

      {/* 候选 Modal：**打开时才挂载**（组件按挂载重置草稿状态，见其文件头约定） */}
      {pickerOpen && fetchCredentials && (
        <ModelPickerDialog
          open
          credentials={{ provider, ...fetchCredentials }}
          existing={existing.map((m) => m.modelName)}
          onAdopt={(models) => {
            // 采纳 = 一次编辑：继承态下 `rows` 是内置目录那一组，合并结果即物化后的草稿
            onChange(mergeAdopted(rows, models, existing))
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  )
}
