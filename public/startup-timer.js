/* 在入口模块求值前监听真实加载错误。React 提交会替换 root 内的静态稿纸。 */
(() => {
  const copy = {
    'zh-CN': {
      loading: '正在打开工作台…',
      slow: '本次启动比平时久一些。',
      failed: '无法打开工作台',
      detail: '请重试加载工作台。',
      retry: '重试',
      ready: '工作台已就绪',
    },
    'en-US': {
      loading: 'Opening the workbench…',
      slow: 'Startup is taking longer than usual.',
      failed: 'Could not open the workbench',
      detail: 'Try loading the workbench again.',
      retry: 'Retry',
      ready: 'Workbench ready',
    },
    'ru-RU': {
      loading: 'Открываем рабочую область…',
      slow: 'Запуск занимает больше времени, чем обычно.',
      failed: 'Не удалось открыть рабочую область',
      detail: 'Попробуйте загрузить рабочую область снова.',
      retry: 'Повторить',
      ready: 'Рабочая область готова',
    },
  }
  const locale = document.documentElement.lang
  const labels = Object.hasOwn(copy, locale) ? copy[locale] : copy['zh-CN']
  const SLOW_START_MS = 4000

  let timedOut
  let showFailure
  let entryError

  function invoke(channel, ...args) {
    try {
      window.novelforgeAPI?.invoke(channel, ...args).catch(() => {})
    } catch {
      // 早期 preload 不可用时，仍允许显示首屏并重试。
    }
  }

  function onLoadError(event) {
    const entryFailed = event.target instanceof HTMLScriptElement && event.target.type === 'module' &&
      event.target.src && !event.target.src.includes('/@vite/client')
    const evaluationFailed = event instanceof ErrorEvent && Boolean(event.filename)
    if (!entryFailed && !evaluationFailed) return
    entryError = entryFailed ? event.target.src : event.message
    showFailure?.()
  }

  function onPreloadError(event) {
    entryError = String(event.payload ?? 'Module preload failed')
    showFailure?.()
  }

  function stopWaiting() {
    clearTimeout(timedOut)
    window.removeEventListener('error', onLoadError, true)
    window.removeEventListener('vite:preloadError', onPreloadError)
  }

  const observer = new MutationObserver(connect)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('error', onLoadError, true)
  window.addEventListener('vite:preloadError', onPreloadError)
  connect()

  function connect() {
    const root = document.getElementById('root')
    const shell = root?.querySelector('[data-startup]')
    const status = document.getElementById('startup-state')
    const detail = document.getElementById('startup-detail')
    const progress = document.getElementById('startup-progress')
    const retry = document.getElementById('startup-retry')
    if (!root || !shell || !status || !detail || !progress || !retry) return

    observer.disconnect()
    window.__VELA_HTML_READY = performance.now()
    status.textContent = labels.loading
    retry.textContent = labels.retry
    retry.addEventListener('click', () => window.location.reload())

    const colors = getComputedStyle(shell)
    const color = colors.getPropertyValue('--startup-canvas').trim()
    const symbolColor = colors.getPropertyValue('--startup-ink').trim()
    if (color && symbolColor) invoke('window:set-titlebar-overlay', { color, symbolColor })

    const ready = new MutationObserver(() => {
      if (shell.isConnected || !root.firstChild) return
      stopWaiting()
      ready.disconnect()
      const elapsed = Math.round(performance.now() - window.__VELA_HTML_READY)
      invoke('log:write', 'debug', 'Startup', `${labels.ready} (${elapsed} ms)`)
    })
    ready.observe(root, { childList: true })

    showFailure = () => {
      stopWaiting()
      shell.dataset.startup = 'failed'
      status.textContent = labels.failed
      detail.textContent = labels.detail
      detail.hidden = false
      progress.hidden = true
      retry.hidden = false
      retry.focus()
      invoke('log:write', 'error', 'Startup', `${labels.failed}: ${entryError}`)
    }
    if (entryError) {
      showFailure()
      return
    }
    timedOut = setTimeout(() => {
      if (!shell.isConnected) return
      shell.dataset.startup = 'slow'
      detail.textContent = labels.slow
      detail.hidden = false
      invoke('log:write', 'warn', 'Startup', labels.slow)
    }, SLOW_START_MS)
  }
})()
