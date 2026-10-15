/**
 * 主题元数据 —— 主题的**唯一一份**图标映射 / 展示顺序 / 名称取值。
 *
 * 2026-10 抽出（docs/ui-6items-plan.md §2.5）：主题有两个入口 —— 右侧图标栏底部的菜单
 * （`components/layout/RightToolWindowBar.tsx`）与设置 → 编辑器的主题卡片
 * （`components/settings/ThemeSection.tsx`）。图标与顺序原先各写一份，改一处两处漂移。
 *
 * ⚠️ 圆形扩散过渡**不在这里**：它在 `lib/theme-transition.ts`；
 * 名称仍取 `ui.ts` 的既有 key（`theme.starry` 等），本模块不新增文案 key。
 */
import { Moon, ScrollText, Sparkles, Sun, type LucideIcon } from 'lucide-react'
import type { TextKey } from '../shared/locale'
import type { Theme } from '../stores/theme-store'

/** 主题图标（两个入口共用同一套图标语义） */
export const THEME_ICONS: Record<Theme, LucideIcon> = {
  light: Sun,
  galaxy: Sparkles,
  paper: ScrollText,
  dark: Moon,
}

/** 展示顺序（图标栏菜单与设置卡片同序 —— 改这里即两处同变） */
export const THEME_ORDER: Theme[] = ['galaxy', 'dark', 'light', 'paper']

/**
 * 主题显示名 —— 复用既有 key：galaxy 在用户可见文案里叫「星空」= `theme.starry`。
 * `t` 由调用方传入（响应式：语言切换触发重渲染后重新取值）。
 */
export function themeLabel(id: Theme, t: (key: TextKey) => string): string {
  return id === 'galaxy' ? t('theme.starry')
    : id === 'paper' ? t('theme.paper')
      : id === 'dark' ? t('theme.dark')
        : t('theme.light')
}
