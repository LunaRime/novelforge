/**
 * 窗口标题 —— React 挂载后的**唯一写入口**。
 *
 * 标题里有两层信息：**哪个项目**（会变）+ 应用名（不变）。有项目时用短品牌名，
 * 没开项目时回落 `t('window.title')`（本地化的应用标题，兼作品牌标语）。
 *
 * ⚠️ 为什么必须收口成一个函数：这条字符串**不只是界面里的装饰**。Windows 那条 32px
 * 顶栏是我们自己画的，`-webkit-app-region: drag` 让系统完全看不到它 —— 任务栏 /
 * Alt-Tab / Mission Control 读的是 `document.title`。此前标题有三处写入口
 * （`main.tsx` 挂载、`useTranslation.switchLocale` 切语言、主进程 `win.setTitle`），
 * 每一处都只写应用名 → **切一次语言就把项目名冲掉**，且三处谁最后写谁赢。
 *
 * React 挂载前那一次兜底标题在 `public/theme-init.js`（那时读不到项目状态，
 * 只能按 localStorage 里的语言写应用标题），此后一律走本函数。
 */
import { t } from '../shared/locale'

/** 品牌短名：品牌标识不翻译，与顶栏/状态栏一致地写字面量 */
const BRAND = 'NovelForge'

/**
 * 写窗口标题。
 * @param projectName 当前项目名；无项目（或为空/空白）时回落到应用标题
 */
export function setWindowTitle(projectName?: string | null): void {
  const name = projectName?.trim()
  document.title = name ? `${name} — ${BRAND}` : t('window.title')
}
