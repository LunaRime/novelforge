/* 首帧同步主题和窗口标题。React 加载后应用接管主题与标题。 */
(() => {
  let theme = 'light'
  let locale = 'zh-CN'
  try {
    const saved = JSON.parse(localStorage.getItem('vela-theme') ?? 'null')?.state
    theme = saved?.theme ?? saved?.resolvedTheme ?? theme
    if (theme === 'dark' && localStorage.getItem('vela-theme-migrated') !== '1') theme = 'galaxy'
    if (theme === 'night') theme = 'dark'
    if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    // 启动偏好不可用时保留默认主题。
  }
  try {
    locale = localStorage.getItem('novelforge-locale') ?? locale
  } catch {
    // 启动偏好不可用时保留默认语言。
  }

  const titles = {
    'zh-CN': 'NovelForge — AI 深度驱动的小说创作 IDE',
    'en-US': 'NovelForge — AI-Powered Novel Writing IDE',
    'ru-RU': 'NovelForge — IDE для написания романов с ИИ',
  }
  if (!Object.hasOwn(titles, locale)) locale = 'zh-CN'
  const themes = ['light', 'dark', 'galaxy', 'paper']
  const root = document.documentElement
  root.classList.remove(...themes)
  root.classList.add(themes.includes(theme) ? theme : 'light')
  root.lang = locale
  document.title = titles[locale]
})()
