const IGNORED_TEXT = 'script, style, template, svg, [contenteditable], .cm-editor, .sr-only'
const TOLERANCE = 2
const MAX_WARNINGS = 12

function scanTextOverflow(root: HTMLElement) {
  const document = root.ownerDocument
  const boxes = new Map<HTMLElement, { style: CSSStyleDeclaration; bounds: DOMRect }>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  const issues = new Map<HTMLElement, { text: string; horizontal: boolean; vertical: boolean }>()

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    const parent = node.parentElement
    if (!text || !parent || parent.closest(IGNORED_TEXT)) continue
    range.selectNodeContents(node)
    const rectangles = [...range.getClientRects()]
    if (!rectangles.length) continue

    let checkX = true
    let checkY = true
    for (let box: HTMLElement | null = parent; box && (checkX || checkY); box = box.parentElement) {
      let geometry = boxes.get(box)
      if (!geometry) {
        geometry = { style: getComputedStyle(box), bounds: box.getBoundingClientRect() }
        boxes.set(box, geometry)
      }
      const { style, bounds } = geometry
      if (style.visibility !== 'visible') break
      if (style.display === 'inline' || style.display === 'contents' || !bounds.width || !bounds.height) continue
      if (Number.parseInt(style.webkitLineClamp, 10) > 0) break
      checkX &&= !['auto', 'scroll'].includes(style.overflowX) && style.textOverflow !== 'ellipsis'
      checkY &&= !['auto', 'scroll'].includes(style.overflowY)

      const horizontal = checkX && rectangles.some(rect => rect.left < bounds.left - TOLERANCE || rect.right > bounds.right + TOLERANCE)
      const vertical = checkY && ['hidden', 'clip'].includes(style.overflowY) && rectangles.some(rect =>
        rect.top < bounds.top - TOLERANCE || rect.bottom > bounds.bottom + TOLERANCE)
      if (horizontal || vertical) {
        if (!issues.has(box)) issues.set(box, { text: text.replace(/\s+/g, ' ').slice(0, 100), horizontal, vertical })
        break
      }
      if (style.position === 'fixed') break
    }
  }
  return issues
}

/** 渲染后检查文字越界，跳过刻意滚动或截断的内容以及正文编辑器。 */
export function startTextOverflowCheck(root: HTMLElement): () => void {
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let reported = new Set<HTMLElement>()
  const scan = () => {
    timer = undefined
    const issues = scanTextOverflow(root)
    const newlyDetected = [...issues].filter(([box]) => !reported.has(box))
    reported = new Set(issues.keys())
    for (const [box, { text, horizontal, vertical }] of newlyDetected.slice(0, MAX_WARNINGS)) {
      const axis = horizontal && vertical ? 'both axes' : horizontal ? 'horizontal' : 'vertical'
      console.warn(`[UI text overflow] ${axis}: ${text}`, box)
    }
    if (newlyDetected.length > MAX_WARNINGS) {
      console.warn(`[UI text overflow] ${newlyDetected.length - MAX_WARNINGS} additional containers`)
    }
  }
  const schedule = () => {
    if (active && timer === undefined) timer = setTimeout(scan, 450)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(root, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'data-state', 'data-feature-view'],
  })
  window.addEventListener('resize', schedule)
  void root.ownerDocument.fonts.ready.then(schedule)
  schedule()
  return () => {
    active = false
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    clearTimeout(timer)
  }
}
