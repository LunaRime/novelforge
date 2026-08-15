/**
 * startup-timer.js — 启动计时显示（原 index.html 内联脚本，为 CSP 外移）
 *
 * 记录 HTML 解析完成时间，并在加载页实时显示耗时。
 */
window.__VELA_HTML_READY = performance.now();
var timerEl = document.getElementById('vela-startup-timer');
if (timerEl) {
  setInterval(function () {
    var elapsed = ((performance.now() - window.__VELA_HTML_READY) / 1000).toFixed(1);
    timerEl.textContent = (window.__VELA_SPLASH_ELAPSED_PREFIX || '已耗时 ') + elapsed + 's';
  }, 200);
}
