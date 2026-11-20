// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const themeScript = readFileSync('public/theme-init.js', 'utf8')
const startupScript = readFileSync('public/startup-timer.js', 'utf8')

function setup(locale = 'en-US', theme = 'paper') {
  localStorage.setItem('novelforge-locale', locale)
  localStorage.setItem('vela-theme', JSON.stringify({ state: { theme } }))
  const invoke = vi.fn().mockResolvedValue(undefined)
  const reload = vi.fn()
  const browser = {
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    matchMedia: () => ({ matches: false }),
    location: { reload },
    novelforgeAPI: { invoke },
    __VELA_HTML_READY: undefined as number | undefined,
  }
  const bindings = { window: browser, document, localStorage, MutationObserver, HTMLScriptElement, ErrorEvent,
    getComputedStyle, setTimeout, clearTimeout, performance }
  runInNewContext(themeScript, bindings)
  runInNewContext(startupScript, bindings)
  return { browser, invoke, reload }
}

async function parseShell() {
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>'))
  await Promise.resolve()
  return {
    shell: document.querySelector<HTMLElement>('[data-startup]')!,
    retry: document.querySelector<HTMLButtonElement>('#startup-retry')!,
    state: document.getElementById('startup-state')!,
  }
}

describe('pre-React startup', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    document.documentElement.className = ''
  })

  afterEach(async () => {
    document.body.replaceChildren()
    await Promise.resolve()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('uses saved locale and theme, reports slow startup, then stops at the first rendered view', async () => {
    const { browser, invoke } = setup()
    expect(document.documentElement.classList.contains('paper')).toBe(true)
    expect(document.documentElement.lang).toBe('en-US')
    const { shell, state, retry } = await parseShell()
    expect(browser.__VELA_HTML_READY).toEqual(expect.any(Number))
    expect(state.textContent).toBe('Opening the workbench…')
    expect(shell.dataset.startup).toBe('loading')
    expect(retry.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(shell.dataset.startup).toBe('slow')
    expect(retry.hidden).toBe(true)
    document.getElementById('root')!.replaceChildren(document.createElement('main'))
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('log:write', 'debug', 'Startup', expect.stringContaining('Workbench ready'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a missing image and shows a localized retry after an entry script load failure', async () => {
    const { invoke, reload } = setup('ru-RU', 'dark')
    const { shell, state, retry } = await parseShell()
    shell.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(shell.dataset.startup).toBe('loading')
    const entry = document.createElement('script')
    entry.type = 'module'
    entry.src = './assets/main.js'
    document.body.appendChild(entry)
    entry.dispatchEvent(new Event('error'))
    expect(shell.dataset.startup).toBe('failed')
    expect(state.textContent).toBe('Не удалось открыть рабочую область')
    expect(retry.hidden).toBe(false)
    expect(document.activeElement).toBe(retry)
    retry.click()
    expect(reload).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5000)
    expect(shell.dataset.startup).toBe('failed')
    expect(invoke).not.toHaveBeenCalledWith('log:write', 'warn', 'Startup', expect.any(String))
  })

  it('retains an entry failure raised before the static shell is parsed', async () => {
    setup('zh-CN', 'unrecognized')
    const entry = document.createElement('script')
    entry.type = 'module'
    entry.src = './assets/main.js'
    document.head.appendChild(entry)
    try {
      entry.dispatchEvent(new Event('error'))
      const { shell, state, retry } = await parseShell()
      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(shell.dataset.startup).toBe('failed')
      expect(state.textContent).toBe('无法打开工作台')
      expect(document.activeElement).toBe(retry)
    } finally {
      entry.remove()
    }
  })
})
