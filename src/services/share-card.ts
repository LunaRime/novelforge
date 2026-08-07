/**
 * 章节分享卡 — 品牌卡片 HTML 生成（纯函数，可单测）
 *
 * 链路：编辑器选中正文 → LLM 摘要（summary + quote）→ buildShareCardHTML
 * → report:render-html 离屏截图 → fs:write-buffer 保存 PNG。
 * 与年度报告（yearly-report）共用截图链路；卡片风格独立于 UI 主题（品牌渐变固定色）。
 */

export interface ShareCardContent {
  /** 卡片主标题（书名/章节名） */
  title: string
  /** 副标题元信息（章节号 · 场景） */
  meta: string
  /** AI 摘要（150 字内） */
  summary: string
  /** 金句（可为空——为空时隐藏金句区） */
  quote: string
}

/** HTML 转义（用户内容/LLM 输出可能含特殊字符） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 生成 800px 宽章节分享卡 HTML（内联样式，零外部依赖——data URL 加载） */
export function buildShareCardHTML(content: ShareCardContent): string {
  const quoteBlock = content.quote
    ? `<div class="quote">${escapeHtml(content.quote)}</div>`
    : ''

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px;
    font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif;
    background: linear-gradient(150deg, #0A1628 0%, #152440 55%, #1E2C50 100%);
    color: #E8EEF7;
    padding: 56px 60px;
  }
  .brand { font-size: 16px; font-weight: 700; letter-spacing: 2px;
    background: linear-gradient(90deg, #7EC8E3, #9B8EC8, #C9A76C);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .title { font-size: 36px; font-weight: 800; margin-top: 18px; line-height: 1.3; }
  .meta { font-size: 14px; color: rgba(232,238,247,.55); margin-top: 10px; }
  .divider { width: 56px; height: 3px; border-radius: 2px; margin: 28px 0;
    background: linear-gradient(90deg, #7EC8E3, #9B8EC8); }
  .summary { font-size: 17px; line-height: 1.9; color: rgba(232,238,247,.9);
    border-left: 3px solid rgba(155,142,200,.5); padding-left: 18px; }
  .quote { margin-top: 32px; padding: 18px 22px; border-radius: 12px;
    background: rgba(201,167,108,.09); border: 1px solid rgba(201,167,108,.25);
    font-size: 19px; font-weight: 600; color: #C9A76C; line-height: 1.7; }
  .footer { margin-top: 40px; font-size: 12px; color: rgba(232,238,247,.35);
    display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="brand">NovelForge</div>
  <div class="title">${escapeHtml(content.title)}</div>
  ${content.meta ? `<div class="meta">${escapeHtml(content.meta)}</div>` : ''}
  <div class="divider"></div>
  <div class="summary">${escapeHtml(content.summary)}</div>
  ${quoteBlock}
  <div class="footer">
    <span>NovelForge</span>
    <span>${new Date().getFullYear()}</span>
  </div>
</body>
</html>`
}
