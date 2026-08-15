/**
 * theme-init.js — 渲染前同步初始化（主题 + 启动页 i18n）
 *
 * 原为 index.html 内联脚本；为启用生产 CSP（script-src 'self'，禁 unsafe-inline）
 * 外移至 public/。同步阻塞执行（render-blocking），行为与内联完全一致。
 */
(function () {
  // 同步读取主题，避免加载页与主界面背景色闪跳
  var bgMap = { light: '#F7F9FC', galaxy: '#0A1628', paper: '#F5F0E8', dark: '#1E1E1E' };
  var theme = 'dark';
  try {
    var raw = localStorage.getItem('vela-theme');
    if (raw) {
      var state = JSON.parse(raw).state;
      theme = state.resolvedTheme || state.theme || 'dark';
      if (theme === 'night') theme = 'dark'; // 兼容旧版
    }
  } catch (e) {}

  var bg = bgMap[theme] || bgMap.galaxy;

  // 提前给 html 注入主题 class，确保所有全局 CSS 变量立即生效
  document.documentElement.classList.remove('light', 'dark', 'galaxy', 'paper');
  document.documentElement.classList.add(theme);

  document.body.style.backgroundColor = bg;
  /* 将背景色注入 CSS 变量供 .vela-initial-loader 引用 */
  document.documentElement.style.setProperty('--loader-bg', bg);
})();

// 启动加载页国际化（React 挂载前无法使用 t()，按持久化语言偏好做最小三语映射；
// React 挂载后由 main.tsx / switchLocale 接管 document.title 与界面文案）
(function () {
  var locale = 'zh-CN';
  try { locale = localStorage.getItem('novelforge-locale') || 'zh-CN'; } catch (e) {}
  var TITLES = {
    'zh-CN': 'NovelForge — AI 深度驱动的小说创作 IDE',
    'en-US': 'NovelForge — AI-Powered Novel Writing IDE',
    'ru-RU': 'NovelForge — IDE для написания романов с ИИ'
  };
  var INIT = {
    'zh-CN': 'NovelForge 初始化中',
    'en-US': 'NovelForge Initializing',
    'ru-RU': 'NovelForge: инициализация'
  };
  var ELAPSED = {
    'zh-CN': '已耗时 ',
    'en-US': 'Elapsed ',
    'ru-RU': 'Прошло '
  };
  document.title = TITLES[locale] || TITLES['zh-CN'];
  window.__VELA_SPLASH_ELAPSED_PREFIX = ELAPSED[locale] || ELAPSED['zh-CN'];
  var splashText = document.getElementById('vela-splash-text');
  if (splashText) splashText.textContent = INIT[locale] || INIT['zh-CN'];
})();
