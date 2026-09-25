import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind 类名（shadcn/ui 标准工具函数）。
 *
 * ⚠️ 必须用配置过的 twMerge：项目在 `index.css` 的 `@theme` 里自定义了字号档
 * `--text-2xs` / `--text-micro`，而 twMerge 不认识它们——它按 `text-<任意值>`
 * 的兜底规则把 `text-micro` 归进**文字颜色**组，于是 `cn('text-micro', 'text-white')`
 * 里两者被判为同类冲突，**后者胜、字号被静默丢弃**（不报错、不警告，只是字大一号）。
 * 把这两档登记进 font-size 组，字号与颜色才能共存、字号之间才正确互斥。
 *
 * 新增自定义字号档时，必须同步加进下面的列表。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['2xs', 'micro'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
