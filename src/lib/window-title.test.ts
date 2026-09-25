// @vitest-environment jsdom
/**
 * window-title — 窗口标题的**唯一写入口**。
 *
 * 标题 = 「项目名 — NovelForge」；没开项目时回落本地化的应用标题。
 * 这条字符串不只是装饰：Windows 那条 32px 顶栏是我们自己画的，**系统看不到它**，
 * 任务栏 / Alt-Tab / Mission Control 读的是 `document.title`。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { setWindowTitle } from './window-title'
import { setCurrentLocale, t } from '../shared/locale'

afterEach(() => {
  setCurrentLocale('zh-CN')
  setWindowTitle(null)
})

describe('setWindowTitle', () => {
  it('开项目时 = 项目名 — NovelForge', () => {
    setWindowTitle('我的小说')
    expect(document.title).toBe('我的小说 — NovelForge')
  })

  it('无项目时回落本地化的应用标题', () => {
    setWindowTitle(null)
    const zhTitle = document.title
    expect(zhTitle).toBe(t('window.title'))

    // 回落值必须**跟着语言走**（不是硬编码一份）
    setCurrentLocale('en-US')
    setWindowTitle(null)
    expect(document.title).toBe(t('window.title'))
    expect(document.title).not.toBe(zhTitle)
  })

  it('项目名为空或全空白时不产生半截标题', () => {
    setWindowTitle('   ')
    expect(document.title).toBe(t('window.title'))
  })
})
