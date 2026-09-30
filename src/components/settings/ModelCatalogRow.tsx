import { ChevronDown, Trash2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { formatCapacity } from '../../shared/capacity'
import type { ModelProfile } from '../../shared/ipc-channels'
import { Input } from '../ui/Input'
import { ModelInputTypes, type InputType } from './ModelInputTypes'
import type { ModelDraft, ModelRowErrors } from './ModelCatalogEditor'

/** 单图标按钮骨架（32×32 命中区 + aria-label；card-affordance-standard） */
const ICON_BUTTON = 'flex items-center justify-center flex-shrink-0 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

export interface ModelCatalogRowProps {
  /** 行草稿（显式值；`undefined` 字段 = 继承） */
  draft: ModelDraft
  /** 行号（1 起，**显示序**）—— 只用于可访问名，操作定位靠调用方按条目下标闭包 */
  position: number
  /** 用途标签（只读）：既有条目 → 其 purposes；否则内置规格 */
  purposes: ModelProfile['purposes']
  /**
   * 该行 id 的**生效值**（既有条目 → 它的值；否则内置规格/`['text']`）。
   * 容量用它做 placeholder，输入类型直接当勾选态 —— 三者都不是硬编码的默认值。
   */
  inherited: { contextWindow: number; maxTokens: number; inputTypes: InputType[] }
  /** 行级错误（按字段带 key）。非空 → 红字 + `aria-invalid` + 禁提交 */
  errors: ModelRowErrors
  expanded: boolean
  disabled?: boolean
  onToggle: () => void
  onChange: (patch: Partial<ModelDraft>) => void
  onRemove: () => void
}

/**
 * ModelCatalogRow —— 目录的一行（模型管理 v3 §2.3/§5）。
 *
 * 常显：模型 ID / 显示名 / 用途标签 / [⌄][🗑]；行内展开：上下文窗口 / 最大输出 token / 输入类型。
 *
 * 两条已经踩过坑的纪律：
 * 1. **容量是文本缓冲**（`contextWindowText`）：值不参与输入框内容的重写 ——
 *    否则敲到一半的 `1000` 会被格式化回 `1K`，光标与输入节奏全乱。解析值只在提交/校验时算。
 * 2. **`id` 与显示名是两个框**：id 是模型的真实名字（派生条目 id 的后半，改它 = 换一个模型），
 *    显示名只是给人看的。留空 = 回落 id（不报错）。
 */
export function ModelCatalogRow({
  draft, position, purposes, inherited, errors, expanded, disabled, onToggle, onChange, onRemove,
}: ModelCatalogRowProps) {
  const { t } = useTranslation()
  const inputTypes: InputType[] = draft.inputTypes ?? inherited.inputTypes
  const messages = [errors.id, errors.contextWindow, errors.maxTokens]
    .filter((key): key is NonNullable<typeof key> => key !== undefined)
    .map((key) => t(key))
  const hasError = messages.length > 0

  return (
    <div
      className="rounded-lg px-1 py-0.5 transition-colors"
      style={{ border: `1px solid ${hasError ? 'var(--color-error)' : 'transparent'}` }}
    >
      <div className="flex items-center gap-1.5">
        <Input
          value={draft.modelName}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${t('catalog.modelId')} ${String(position)}`}
          aria-invalid={errors.id !== undefined || undefined}
          placeholder={t('catalog.modelIdPlaceholder')}
          onChange={(e) => { onChange({ modelName: e.target.value }) }}
          className="flex-1 min-w-0"
        />
        <Input
          value={draft.name ?? ''}
          disabled={disabled}
          aria-label={`${t('catalog.modelName')} ${String(position)}`}
          placeholder={t('catalog.modelNamePlaceholder')}
          onChange={(e) => { onChange({ name: e.target.value }) }}
          className="flex-1 min-w-0"
        />

        {/* 用途标签（只读）—— 生成 / 向量；用途由规格与内置目录决定，目录区改不了 */}
        <span
          className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
          style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
        >
          {purposes.includes('embedding') ? t('catalog.purposeEmbedding') : t('catalog.purposeGen')}
        </span>

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={expanded}
          aria-label={`${t('catalog.rowOptions')} ${String(position)}`}
          title={t('catalog.rowOptions')}
          className={`${ICON_BUTTON} text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]`}
          style={{ width: 32, height: 32 }}
        >
          <ChevronDown size={13} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`${t('catalog.removeRow')} ${String(position)}`}
          title={t('catalog.removeRow')}
          className={`${ICON_BUTTON} text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[rgba(var(--color-error-rgb),0.1)]`}
          style={{ width: 32, height: 32 }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {hasError && (
        <p className="text-2xs mt-0.5" style={{ color: 'var(--color-error)' }} role="alert">
          {messages.join(' ')}
        </p>
      )}

      {expanded && (
        <div className="grid grid-cols-2 gap-2 px-1 pt-1.5 pb-1">
          <label className="block">
            <span className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>{t('catalog.contextWindow')}</span>
            <Input
              inputMode="numeric"
              value={draft.contextWindowText ?? ''}
              disabled={disabled}
              spellCheck={false}
              aria-label={`${t('catalog.contextWindow')} ${String(position)}`}
              aria-invalid={errors.contextWindow !== undefined || undefined}
              placeholder={formatCapacity(inherited.contextWindow)}
              onChange={(e) => { onChange({ contextWindowText: e.target.value }) }}
              className="mt-0.5"
            />
          </label>
          <label className="block">
            <span className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>{t('catalog.maxTokens')}</span>
            <Input
              inputMode="numeric"
              value={draft.maxTokensText ?? ''}
              disabled={disabled}
              spellCheck={false}
              aria-label={`${t('catalog.maxTokens')} ${String(position)}`}
              aria-invalid={errors.maxTokens !== undefined || undefined}
              placeholder={formatCapacity(inherited.maxTokens)}
              onChange={(e) => { onChange({ maxTokensText: e.target.value }) }}
              className="mt-0.5"
            />
          </label>
          <div className="col-span-2">
            <ModelInputTypes
              value={inputTypes}
              position={position}
              disabled={disabled}
              onChange={(next) => { onChange({ inputTypes: next }) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
