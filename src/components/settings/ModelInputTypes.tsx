import { useTranslation } from '../../hooks/useTranslation'

/** 目录行声明的输入类型（与 `ModelProfile.inputTypes` 同一个封闭联合） */
export type InputType = 'text' | 'image'

export interface ModelInputTypesProps {
  /** **生效**的输入类型（草稿显式值；未设 → 回退 `['text']`） */
  value: InputType[]
  onChange: (next: InputType[]) => void
  /** 行号（1 起，显示序）—— 多行同名控件靠它区分（读屏时「文本 2」才说得清是第几行） */
  position: number
  disabled?: boolean
}

const INPUT_TYPES: readonly InputType[] = ['text', 'image']

/**
 * 输入类型（文本 / 图片）—— 目录行内展开的第三格（模型管理 v3 §5）。
 *
 * **至少留一种**：只剩一种时那一格自己禁用（不是拦提交、不是报错）——
 * 空数组在类型上合法但语义上等于「这个模型什么都收不了」，用户按下它只会得到一个
 * 永远用不了的模型。禁用把「做不到」摆在点之前，比事后红字好。
 *
 * 复选框用 NF 原生 `accent-[var(--color-accent)]` 惯例（spec §1：`ui/` 无 Checkbox，**勿新建**）。
 */
export function ModelInputTypes({ value, onChange, position, disabled }: ModelInputTypesProps) {
  const { t } = useTranslation()
  const labelOf = (type: InputType) => (type === 'text' ? t('catalog.inputText') : t('catalog.inputImage'))

  return (
    <fieldset aria-label={`${t('catalog.inputTypes')} ${String(position)}`}>
      <legend className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>
        {t('catalog.inputTypes')}
      </legend>
      <div className="flex items-center gap-3 mt-0.5">
        {INPUT_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input
              type="checkbox"
              className="accent-[var(--color-accent)] cursor-pointer"
              style={{ width: 13, height: 13 }}
              aria-label={`${labelOf(type)} ${String(position)}`}
              checked={value.includes(type)}
              // 只剩一种时把那一格钉住（取消它 = 一种都不剩）
              disabled={disabled || (value.length === 1 && value.includes(type))}
              onChange={(e) => {
                const next = INPUT_TYPES.filter((v) => (v === type ? e.target.checked : value.includes(v)))
                onChange([...next])
              }}
            />
            {labelOf(type)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
