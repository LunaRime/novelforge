/**
 * theme-init.js — 渲染前同步初始化（主题 + 启动页 i18n）
 *
 * 原为 index.html 内联脚本；为启用生产 CSP（script-src 'self'，禁 unsafe-inline）
 * 外移至 public/。同步阻塞执行（render-blocking），行为与内联完全一致。
 */
(function () {
  // 同步读取主题（仅为提前注入 html class，确保全局 CSS 变量立即生效）
  var theme = 'light'; // 默认主题（与 theme-store 初始值保持一致）
  try {
    var raw = localStorage.getItem('vela-theme');
    if (raw) {
      var state = JSON.parse(raw).state;
      theme = state.resolvedTheme || state.theme || 'light';
      if (theme === 'night') theme = 'dark'; // 兼容旧版
    }
  } catch (e) {}

  // 提前给 html 注入主题 class，确保所有全局 CSS 变量立即生效
  document.documentElement.classList.remove('light', 'dark', 'galaxy', 'paper');
  document.documentElement.classList.add(theme);

  // 启动页固定品牌色（2026-10-02 用户拍板：取 build/icon.png 的渐变——青→绿，不再随主题）
  // ⚠️ 本脚本在 <head> 同步执行，`document.body` 此时为 null——不得对 body 赋值
  //（原实现在此处抛错中断，导致 --loader-bg 从未被设置、启动页长年吃 CSS 回退值；body 背景改由
  // 启动页容器自身及后续主题 CSS 负责）
  document.documentElement.style.setProperty('--loader-bg', 'linear-gradient(90deg, #0E9EA8, #70D261)');
})();

// 启动加载页国际化（React 挂载前无法使用 t()，按持久化语言偏好做最小三语映射；
// React 挂载后由 App 的 effect 接管 document.title —— 唯一写入口 src/lib/window-title.ts，
// 它会在应用标题之外补上**当前项目名**，那是这一刻还读不到的信息）
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
