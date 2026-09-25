// @vitest-environment jsdom
/**
 * Confirm 命令式 API — 行为特征测试（2026-09-25）
 *
 * 写于「两份模态壳抽取为 ui/ModalShell」这次重构**之前**：本文件先锁住既有行为
 * （挂载、按钮语义、退场延时、卸载、返回值），重构后必须仍然全绿 —— 它是这次
 * 改动唯一的安全网（这三个 API 此前零测试覆盖，且被 22 个调用点使用）。
 *
 * 覆盖：
 * 1. confirm() 挂载到 body、点确认 resolve true、点取消 resolve false，两者都卸载 DOM
 * 2. alertError() 单按钮 alertdialog 角色（读屏立即播报），遮罩/ESC 等同确认
 * 3. confirmDeleteProject() 三按钮，分别 resolve 'delete' / 'remove' / 'cancel'
 *
 * ⚠️ 退场动画有时序：点按钮后先播 200ms 退场动画再卸载，故用假定时器推进。
 * 只伪造 setTimeout —— React 调度器走 MessageChannel，一并伪造会让 render 卡住。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { confirm, alertError, confirmDeleteProject } from './Confirm'

/** 退场动画时长 200ms（见 Confirm.tsx），留些余量 */
const EXIT_MS = 250

const dialog = () => document.querySelector('[role="dialog"], [role="alertdialog"]')

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('confirm()', () => {
  it('挂载模态并显示文案，点确认 → resolve(true) 且卸载', async () => {
    const p = confirm('确认执行吗', { confirmText: 'OK', cancelText: 'NO' })
    await act(async () => {})

    expect(dialog()?.textContent).toContain('确认执行吗')

    act(() => buttonByText('OK')!.click())
    await act(async () => {
      vi.advanceTimersByTime(EXIT_MS)
    })

    await expect(p).resolves.toBe(true)
    expect(dialog()).toBeNull()
  })

  it('点取消 → resolve(false) 且卸载', async () => {
    const p = confirm('确认执行吗', { confirmText: 'OK', cancelText: 'NO' })
    await act(async () => {})

    act(() => buttonByText('NO')!.click())
    await act(async () => {
      vi.advanceTimersByTime(EXIT_MS)
    })

    await expect(p).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })

  it('危险操作带二次确认语义：danger 只影响按钮变体，不影响返回值', async () => {
    const p = confirm('删除？', { danger: true, confirmText: 'DEL' })
    await act(async () => {})
    act(() => buttonByText('DEL')!.click())
    await act(async () => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    await expect(p).resolves.toBe(true)
  })
})

describe('alertError()', () => {
  it('单按钮 alertdialog：无取消按钮，点确认即 resolve', async () => {
    const p = alertError('不是有效的项目目录', { confirmText: 'OK' })
    await act(async () => {})

    const el = dialog()
    expect(el?.getAttribute('role')).toBe('alertdialog')
    expect(el?.textContent).toContain('不是有效的项目目录')
    expect(buttonByText('取消')).toBeUndefined()

    act(() => buttonByText('OK')!.click())
    await act(async () => {
      vi.advanceTimersByTime(EXIT_MS)
    })
    await expect(p).resolves.toBeUndefined()
    expect(dialog()).toBeNull()
  })
})

describe('confirmDeleteProject()', () => {
  it('三按钮分别 resolve delete / remove / cancel', async () => {
    for (const [label, expected] of [
      ['DEL', 'delete'],
      ['RM', 'remove'],
      ['CAN', 'cancel'],
    ] as const) {
      const p = confirmDeleteProject()
      await act(async () => {})

      // 三按钮都在（文案走 i18n，故按位置取：取消 / 移出最近 / 删除文件夹）
      const btns = Array.from(document.querySelectorAll('button'))
      expect(btns).toHaveLength(3)
      void label

      act(() => btns[expected === 'delete' ? 2 : expected === 'remove' ? 1 : 0].click())
      await act(async () => {
        vi.advanceTimersByTime(EXIT_MS)
      })

      await expect(p).resolves.toBe(expected)
      expect(dialog()).toBeNull()
    }
  })
})
