/**
 * NovelForge Icon Generator — 纯数学像素生成，零外部依赖
 *
 * 设计元素：
 *   深蓝圆角方形背景 + 打开书本(蓝紫渐变) + 锻造锤铁砧(橙红粉火焰渐变)
 *   + 击打火花 + AI 神经节点 + 金色 N 字母
 *
 * 运行: node build/generate-icon.cjs
 * 输出: build/icon.png (512x512)
 */
'use strict'

const zlib = require('zlib')
const fs = require('fs')

const W = 512
const H = 512
const R = 96 // corner radius

// ===== 颜色工具 =====

function rgb(r, g, b) { return [r, g, b, 255] }
function rgba(r, g, b, a) { return [r, g, b, a] }

function lerp(a, b, t) { return a + (b - a) * t }
function lerpColor(c1, c2, t) {
  return c1.map((v, i) => Math.round(lerp(v, c2[i], t)))
}

/** 渐变色：在 (x, y) 处按角度采样 */
function gradient(x, y, stops) {
  const angle = Math.atan2(y - W / 2, x - W / 2) + Math.PI
  const t = angle / (Math.PI * 2)
  for (let i = 0; i < stops.length - 1; i++) {
    const [t1, c1] = stops[i]
    const [t2, c2] = stops[i + 1]
    if (t >= t1 && t <= t2) {
      return lerpColor(c1, c2, (t - t1) / (t2 - t1))
    }
  }
  return stops[stops.length - 1][1]
}

function blend(bg, fg) {
  const a = fg[3] / 255
  return [
    Math.round(bg[0] * (1 - a) + fg[0] * a),
    Math.round(bg[1] * (1 - a) + fg[1] * a),
    Math.round(bg[2] * (1 - a) + fg[2] * a),
    255,
  ]
}

// ===== 调色板 =====

const BG_COLOR = rgb(22, 22, 46)
const FORGE_STOPS = [
  [0.0, rgb(249, 115, 22)],
  [0.33, rgb(239, 68, 68)],
  [0.66, rgb(236, 72, 153)],
  [1.0, rgb(249, 115, 22)],
]
const BOOK_COLOR = rgb(99, 102, 241)
const BOOK_COLOR_LIGHT = rgb(129, 140, 248)
const SPINE_COLOR = rgb(199, 210, 254)
const SPARK_COLOR = rgb(251, 191, 36)
const NODE_COLOR_LEFT = rgb(56, 189, 248)
const NODE_COLOR_RIGHT = rgb(129, 140, 248)
const N_COLOR = rgb(251, 146, 60)

// ===== 像素缓冲区 =====

const pixels = new Uint8Array(W * H * 4)

function setPixel(x, y, color) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return
  const i = (iy * W + ix) * 4
  const existing = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
  const blended = blend(existing, color)
  pixels[i] = blended[0]
  pixels[i + 1] = blended[1]
  pixels[i + 2] = blended[2]
  pixels[i + 3] = 255
}

// ===== 绘制函数 =====

/** 填充圆角方形 */
function fillRoundedRect(cx, cy, w, h, r, color) {
  for (let y = Math.max(0, Math.round(cy - h / 2)); y < Math.min(H, Math.round(cy + h / 2)); y++) {
    for (let x = Math.max(0, Math.round(cx - w / 2)); x < Math.min(W, Math.round(cx + w / 2)); x++) {
      // 圆角裁剪
      let inside = true
      const rx = x - (cx - w / 2)
      const ry = y - (cy - h / 2)
      if (rx < r && ry < r) {
        const dx = rx - r, dy = ry - r
        if (dx * dx + dy * dy > r * r) inside = false
      }
      if (rx > w - r && ry < r) {
        const dx = rx - (w - r), dy = ry - r
        if (dx * dx + dy * dy > r * r) inside = false
      }
      if (rx < r && ry > h - r) {
        const dx = rx - r, dy = ry - (h - r)
        if (dx * dx + dy * dy > r * r) inside = false
      }
      if (rx > w - r && ry > h - r) {
        const dx = rx - (w - r), dy = ry - (h - r)
        if (dx * dx + dy * dy > r * r) inside = false
      }
      if (inside) setPixel(x, y, color)
    }
  }
}

/** 填充圆 */
function fillCircle(cx, cy, r, color) {
  const rr = r * r
  for (let y = Math.round(cy - r); y <= Math.round(cy + r); y++) {
    for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= rr) setPixel(x, y, color)
    }
  }
}

/** 发光圆（高斯衰减） */
function glowCircle(cx, cy, r, color, glowR) {
  const gr2 = (glowR || r * 2.5) ** 2
  for (let y = Math.round(cy - glowR); y <= Math.round(cy + glowR); y++) {
    for (let x = Math.round(cx - glowR); x <= Math.round(cx + glowR); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2
      if (d2 > gr2) continue
      let a = Math.exp(-d2 / (r * r * 2))
      if (d2 <= r * r) a = 1
      setPixel(x, y, rgba(color[0], color[1], color[2], Math.round(Math.min(255, a * 255))))
    }
  }
}

/** 描边线 */
function drawLine(x1, y1, x2, y2, color, width) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.ceil(len)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x1 + dx * t, y = y1 + dy * t
    fillCircle(x, y, width / 2, color)
  }
}

/** 填充多边形 */
function fillPoly(points, color) {
  const minX = Math.max(0, Math.min(...points.map(p => p[0])))
  const maxX = Math.min(W - 1, Math.max(...points.map(p => p[0])))
  const minY = Math.max(0, Math.min(...points.map(p => p[1])))
  const maxY = Math.min(H - 1, Math.max(...points.map(p => p[1])))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i]
        const [xj, yj] = points[j]
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
          inside = !inside
        }
      }
      if (inside) setPixel(x, y, color)
    }
  }
}

/** 贝塞尔曲线多边形 */
function fillBezierShape(pts, color) {
  // 简单三角形 + 曲线逼近
  fillPoly(pts, color)
}

// ===== 构建图标 =====

function build() {
  console.log('Generating NovelForge icon (512x512)...')

  // 1. 深蓝背景圆角方形
  const bgW = 448, bgH = 448
  fillRoundedRect(W / 2, H / 2, bgW, bgH, R, BG_COLOR)

  // 2. 外圈装饰环
  for (let r = 190; r <= 200; r += 10) {
    const a = r === 190 ? 0.06 : 0.04
    for (let a2 = 0; a2 < Math.PI * 2; a2 += 0.01) {
      const x = W / 2 + r * Math.cos(a2)
      const y = H / 2 + r * Math.sin(a2)
      const c = gradient(x, y, FORGE_STOPS)
      setPixel(x, y, rgba(c[0], c[1], c[2], Math.round(a * 255)))
    }
  }

  // 3. 打开的书籍 (y=300 中心)
  const bookCy = 310
  // 左页
  fillPoly([
    [W / 2, bookCy - 95],
    [W / 2 - 65, bookCy - 105],
    [W / 2 - 75, bookCy - 55],
    [W / 2 - 60, bookCy + 45],
    [W / 2 - 40, bookCy + 30],
    [W / 2 - 5, bookCy + 20],
  ], BOOK_COLOR_LIGHT)
  // 右页
  fillPoly([
    [W / 2, bookCy - 95],
    [W / 2 + 65, bookCy - 105],
    [W / 2 + 75, bookCy - 55],
    [W / 2 + 60, bookCy + 45],
    [W / 2 + 40, bookCy + 30],
    [W / 2 + 5, bookCy + 20],
  ], BOOK_COLOR)
  // 书脊
  drawLine(W / 2, bookCy - 100, W / 2, bookCy + 25, SPINE_COLOR, 3)

  // 4. 锻造锤 + 铁砧 (y=230)
  const anvilY = 255
  // 铁砧底部
  fillPoly([
    [W / 2 - 48, anvilY - 5],
    [W / 2 + 48, anvilY - 5],
    [W / 2 + 48, anvilY + 8],
    [W / 2 - 48, anvilY + 8],
  ], rgba(249, 115, 22, 70))
  // 铁砧上部
  fillPoly([
    [W / 2 - 33, anvilY - 16],
    [W / 2 + 33, anvilY - 16],
    [W / 2 + 33, anvilY - 5],
    [W / 2 - 33, anvilY - 5],
  ], rgba(239, 68, 68, 90))

  // 锤子 (旋转 -15 度)
  const hammerCX = W / 2
  const hammerCY = anvilY - 40
  const angle = -15 * Math.PI / 180
  function rot(x, y) {
    return [
      hammerCX + x * Math.cos(angle) - y * Math.sin(angle),
      hammerCY + x * Math.sin(angle) + y * Math.cos(angle),
    ]
  }
  // 锤头
  const hh = rot(-26, -8)
  fillPoly([
    rot(-26, -16), rot(26, -16), rot(26, 10), rot(-26, 10),
  ], rgb(249, 115, 22))
  // 锤柄
  fillPoly([
    rot(-4, -55), rot(3, -55), rot(3, 10), rot(-4, 10),
  ], rgba(239, 68, 68, 200))
  // 柄端
  fillPoly([
    rot(-5, -62), rot(5, -62), rot(5, -55), rot(-5, -55),
  ], rgba(236, 72, 153, 120))

  // 5. 火花
  const sparks = [
    [hammerCX + 30, hammerCY - 55, 4],
    [hammerCX + 45, hammerCY - 70, 3],
    [hammerCX + 15, hammerCY - 75, 2.5],
    [hammerCX + 55, hammerCY - 48, 2],
    [hammerCX + 35, hammerCY - 85, 2],
    [hammerCX - 5, hammerCY - 65, 1.5],
    [hammerCX + 50, hammerCY - 62, 1.5],
    [hammerCX + 22, hammerCY - 92, 1],
  ]
  for (const [sx, sy, sr] of sparks) {
    glowCircle(sx, sy, sr, SPARK_COLOR, sr * 3)
  }

  // 6. AI 神经节点
  const nodes = [
    [140, 175, NODE_COLOR_LEFT],
    [370, 175, NODE_COLOR_RIGHT],
    [140, 125, NODE_COLOR_LEFT],
    [370, 125, NODE_COLOR_RIGHT],
  ]
  for (const [nx, ny, nc] of nodes) {
    glowCircle(nx, ny, 2.5, nc, 5)
  }
  // 连线到书本
  drawLine(140, 175, W / 2, bookCy - 30, rgba(56, 189, 248, 50), 0.8)
  drawLine(370, 175, W / 2, bookCy - 30, rgba(129, 140, 248, 50), 0.8)
  drawLine(140, 125, 140, 175, rgba(56, 189, 248, 35), 0.8)
  drawLine(370, 125, 370, 175, rgba(129, 140, 248, 35), 0.8)

  // 7. 金色 N 字母
  drawN(W / 2, 430, 48, N_COLOR)

  console.log('Pixels generated, encoding PNG...')
}

// ===== 字母 N 绘制 =====
function drawN(cx, cy, size, color) {
  const hw = size * 0.55
  const h = size
  const stemW = size * 0.22

  // 左竖
  fillPoly([
    [cx - hw, cy - h / 2],
    [cx - hw + stemW, cy - h / 2],
    [cx - hw + stemW, cy + h / 2],
    [cx - hw, cy + h / 2],
  ], color)

  // 右竖
  fillPoly([
    [cx + hw - stemW, cy - h / 2],
    [cx + hw, cy - h / 2],
    [cx + hw, cy + h / 2],
    [cx + hw - stemW, cy + h / 2],
  ], color)

  // 斜线
  fillPoly([
    [cx - hw, cy - h / 2],
    [cx - hw + stemW, cy - h / 2],
    [cx + hw, cy + h / 2],
    [cx + hw - stemW, cy + h / 2],
  ], color)

  // 发光
  for (let dy = -h / 2; dy <= h / 2; dy += 2) {
    const x = cx - hw + (dy + h / 2) / h * (hw * 2)
    glowCircle(x, cy + dy, stemW * 0.6, color, stemW * 1.5)
  }
}

// ===== PNG 编码 =====

function createPNG() {
  // 创建原始像素数据（RGBA，逐行）
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0 // filter byte
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const off = y * (W * 4 + 1) + 1 + x * 4
      raw[off] = pixels[i]
      raw[off + 1] = pixels[i + 1]
      raw[off + 2] = pixels[i + 2]
      raw[off + 3] = pixels[i + 3]
    }
  }

  const deflated = zlib.deflateSync(raw)

  // PNG 文件格式
  function crc32(buf) {
    let c = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0)
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type, 'ascii')
    const crcData = Buffer.concat([typeB, data])
    const crcB = Buffer.alloc(4)
    crcB.writeUInt32BE(crc32(crcData))
    return Buffer.concat([len, typeB, data, crcB])
  }

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // IEND
  const iend = chunk('IEND', Buffer.alloc(0))

  // IDAT
  const idat = chunk('IDAT', deflated)

  // 组装
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const png = Buffer.concat([signature, chunk('IHDR', ihdr), idat, iend])

  return png
}

// ===== 主流程 =====

build()
const png = createPNG()
fs.writeFileSync('build/icon.png', png)

// 也生成 256x256 版本（缩小采样）
// 直接用 512 的，electron-builder 会自动缩放

console.log(`Done: build/icon.png (${(png.length / 1024).toFixed(1)} KB)`)
