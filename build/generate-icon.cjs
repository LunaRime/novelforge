/**
 * NovelForge Icon Generator v2 — 4x 超采样抗锯齿 + 精确几何形状
 *
 * 运行: node build/generate-icon.cjs
 * 输出: build/icon.png (512x512), build/icon.ico (5 尺寸)
 */
'use strict'

const zlib = require('zlib')
const fs = require('fs')

const SCALE = 4         // 超采样倍率
const W = 512 * SCALE   // 2048
const H = 512 * SCALE   // 2048
const OUT = 512
const R = 96 * SCALE    // 圆角半径

// ===== 颜色 =====
const rgb = (r, g, b) => [r, g, b]
const rgba = (r, g, b, a) => [r, g, b, a]

function lc(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t)
}

// ===== 像素缓冲区 (float 精度) =====
const pixels = new Float64Array(W * H * 4)

function plot(x, y, color) {
  const ix = x | 0, iy = y | 0
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return
  const i = (iy * W + ix) * 4
  const a = color[3] !== undefined ? color[3] : 1
  // alpha blend
  pixels[i]     = pixels[i]     + color[0] * a * (1 - pixels[i + 3] / 255)
  pixels[i + 1] = pixels[i + 1] + color[1] * a * (1 - pixels[i + 3] / 255)
  pixels[i + 2] = pixels[i + 2] + color[2] * a * (1 - pixels[i + 3] / 255)
  pixels[i + 3] = pixels[i + 3] + a * 255 * (1 - pixels[i + 3] / 255)
}

// ===== 亚像素精确图形 =====

/** 抗锯齿填充圆角矩形 */
function fillRoundedRect(cx, cy, w, h, r, color) {
  const x0 = cx - w / 2, y0 = cy - h / 2
  const x1 = cx + w / 2, y1 = cy + h / 2

  for (let py = y0; py < y1; py += 0.5) {
    for (let px = x0; px < x1; px += 0.5) {
      let inside = true

      if (px < x0 + r && py < y0 + r) {
        const dx = px - (x0 + r), dy = py - (y0 + r)
        inside = dx * dx + dy * dy <= r * r
      } else if (px > x1 - r && py < y0 + r) {
        const dx = px - (x1 - r), dy = py - (y0 + r)
        inside = dx * dx + dy * dy <= r * r
      } else if (px < x0 + r && py > y1 - r) {
        const dx = px - (x0 + r), dy = py - (y1 - r)
        inside = dx * dx + dy * dy <= r * r
      } else if (px > x1 - r && py > y1 - r) {
        const dx = px - (x1 - r), dy = py - (y1 - r)
        inside = dx * dx + dy * dy <= r * r
      }

      if (inside) plot(px, py, color)
    }
  }
}

/** AA 填充圆 */
function fillCircle(cx, cy, r, color) {
  const rr = r * r
  for (let py = cy - r; py <= cy + r; py += 0.5) {
    const dy = py - cy
    const halfW = Math.sqrt(Math.max(0, rr - dy * dy))
    for (let px = cx - halfW; px <= cx + halfW; px += 0.5) {
      plot(px, py, color)
    }
  }
}

/** AA 发光圆 */
function glowCircle(cx, cy, cr, color, glowR) {
  const gr2 = glowR * glowR
  for (let py = cy - glowR; py <= cy + glowR; py += 1) {
    for (let px = cx - glowR; px <= cx + glowR; px += 1) {
      const d2 = (px - cx) ** 2 + (py - cy) ** 2
      if (d2 > gr2) continue
      let a
      if (d2 <= cr * cr) {
        a = 1
      } else {
        a = Math.exp(-(d2 - cr * cr) / (cr * cr * 4))
      }
      plot(px, py, [color[0], color[1], color[2], a])
    }
  }
}

/** AA 直线 */
function drawLine(x1, y1, x2, y2, color, w) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  const nx = -dy / len, ny = dx / len
  for (let t = 0; t <= 1; t += 0.5 / len) {
    const cx = x1 + dx * t
    const cy = y1 + dy * t
    for (let s = -w / 2; s <= w / 2; s += 0.5) {
      plot(cx + nx * s, cy + ny * s, color)
    }
  }
}

/** AA 填充多边形 */
function fillPoly(points, color) {
  if (points.length < 3) return
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  for (let py = minY; py <= maxY; py += 0.5) {
    for (let px = minX; px <= maxX; px += 0.5) {
      let inside = false
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j]
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
          inside = !inside
      }
      if (inside) plot(px, py, color)
    }
  }
}

/** 描边多边形 */
function strokePoly(points, color, w) {
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    drawLine(points[i][0], points[i][1], points[j][0], points[j][1], color, w)
  }
}

/** 立体书本：带厚度感的页面 */
function drawOpenBook(cx, cy, w, h) {
  const spread = w * 0.7
  const pageH = h * 0.85

  // 书脊（中脊高光）
  const spineL = rgb(180, 190, 240)
  const spineR = rgb(140, 150, 220)
  for (let ys = cy - pageH / 2 - 10; ys <= cy + pageH / 2; ys += 0.5) {
    const da = 1 - Math.abs(ys - cy) / (pageH / 2)
    const t = Math.pow(Math.max(0, da), 0.5)
    const sc = lc(spineL, spineR, 0.5 + t * 0.5)
    plot(cx, ys, sc)
    plot(cx + 1, ys, sc)
    plot(cx - 1, ys, sc)
  }

  // 左页 — 带弧度的页面
  const leftPts = []
  for (let dy = -pageH / 2; dy <= pageH / 2; dy += pageH / 40) {
    const t = (dy + pageH / 2) / pageH
    const curve = Math.sin(t * Math.PI) * spread * 0.15
    const x = cx - spread * 0.5 + curve * 0.3 - 10
    leftPts.push([x, cy + dy - 5])
  }
  // 左页底部
  for (let dy = pageH / 2; dy >= -pageH / 2; dy -= pageH / 40) {
    const t = (dy + pageH / 2) / pageH
    const x = cx - spread + 10
    leftPts.push([x, cy + dy - 5])
  }

  // 左页渐变填充（从外到内变亮）
  fillPoly(leftPts, rgb(80, 85, 220))

  // 左页高光
  for (let dy = -pageH / 2; dy <= pageH / 2; dy += 2) {
    const t = (dy + pageH / 2) / pageH
    const curve = Math.sin(t * Math.PI) * spread * 0.15
    const x = cx - spread * 0.5 + curve * 0.3
    for (let dx = 0; dx < spread * 0.3; dx += 1) {
      const a = 0.15 * (1 - dx / (spread * 0.3))
      plot(x + dx, cy + dy - 5, [120, 125, 255, a])
    }
  }

  // 右页
  const rightPts = []
  for (let dy = -pageH / 2; dy <= pageH / 2; dy += pageH / 40) {
    const t = (dy + pageH / 2) / pageH
    const curve = Math.sin(t * Math.PI) * spread * 0.15
    const x = cx + spread * 0.5 - curve * 0.3 + 10
    rightPts.push([x, cy + dy - 5])
  }
  for (let dy = pageH / 2; dy >= -pageH / 2; dy -= pageH / 40) {
    const x = cx + spread - 10
    rightPts.push([x, cy + dy - 5])
  }
  fillPoly(rightPts, rgb(65, 70, 200))
  for (let dy = -pageH / 2; dy <= pageH / 2; dy += 2) {
    const t = (dy + pageH / 2) / pageH
    const curve = Math.sin(t * Math.PI) * spread * 0.15
    const x = cx + spread * 0.5 - curve * 0.3
    for (let dx = 0; dx < spread * 0.3; dx += 1) {
      const a = 0.12 * (1 - dx / (spread * 0.3))
      plot(x - dx, cy + dy - 5, [180, 185, 255, a])
    }
  }

  // 页面线（装订线纹理）
  for (let dy = -pageH / 2 + 20; dy <= pageH / 2 - 20; dy += 40) {
    drawLine(cx - 5, cy + dy, cx + 5, cy + dy, rgba(180, 190, 240, 60), 1.5)
  }
}

// ===== 锻造锤 + 铁砧 + 火焰 =====

function drawForge(cx, cy, size) {
  const hammerLen = size * 0.7
  const hammerW = size * 0.45
  const handleW = size * 0.08
  const anvilW = size * 0.6
  const anvilH = size * 0.12
  const angle = -18 * Math.PI / 180

  function rot(x, y) {
    return [
      cx + x * Math.cos(angle) - y * Math.sin(angle),
      cy + y * Math.cos(angle) + x * Math.sin(angle),
    ]
  }

  // 铁砧基座
  const anvilCY = cy + hammerLen * 0.25
  fillRoundedRect(cx, anvilCY + 5, anvilW * 1.1, anvilH * 1.2, size * 0.05, rgb(249, 115, 22))
  fillRoundedRect(cx, anvilCY - 5, anvilW, anvilH, size * 0.03, rgb(251, 146, 60))

  // 铁砧顶部高光
  fillRoundedRect(cx, anvilCY - 5, anvilW * 0.7, anvilH * 0.4, size * 0.02, rgba(255, 200, 140, 180))

  // 锤头
  const headPts = [
    rot(-hammerW / 2, -size * 0.1),
    rot(hammerW / 2, -size * 0.12),
    rot(hammerW / 2, size * 0.12),
    rot(-hammerW / 2, size * 0.1),
  ]
  fillPoly(headPts, rgb(239, 68, 68))
  strokePoly(headPts, rgb(200, 40, 40), 2)

  // 锤头高光
  fillPoly([
    rot(-hammerW * 0.3, -size * 0.08),
    rot(hammerW * 0.3, -size * 0.1),
    rot(hammerW * 0.3, -size * 0.02),
    rot(-hammerW * 0.3, -size * 0.01),
  ], rgba(255, 150, 150, 100))

  // 锤柄
  const handlePts = [
    rot(-handleW / 2, -hammerLen / 2 + 20),
    rot(handleW / 2, -hammerLen / 2 + 20),
    rot(handleW / 2, 0),
    rot(-handleW / 2, 0),
  ]
  fillPoly(handlePts, rgb(180, 60, 40))
  strokePoly(handlePts, rgb(140, 30, 20), 1.5)

  // 锤柄末端
  fillCircle(rot(0, -hammerLen / 2 + 15)[0], rot(0, -hammerLen / 2 + 15)[1], size * 0.06, rgb(236, 72, 153))

  // 火焰效果 — 从锤击点向上辐射
  const strikeX = cx + hammerW * 0.25 * Math.cos(angle) - (-size * 0.1) * Math.sin(angle)
  const strikeY = cy + hammerW * 0.25 * Math.sin(angle) + (-size * 0.1) * Math.cos(angle)

  // 多层火焰光晕
  for (const [r, a, c] of [
    [size * 0.55, 0.4, rgb(251, 191, 36)],
    [size * 0.8, 0.25, rgb(249, 115, 22)],
    [size * 1.1, 0.12, rgb(239, 68, 68)],
  ]) {
    glowCircle(strikeX, strikeY - size * 0.15, size * 0.15, c, r)
  }

  // 火花粒子
  const sparks = [
    [strikeX + size * 0.2, strikeY - size * 0.6, size * 0.04],
    [strikeX + size * 0.45, strikeY - size * 0.45, size * 0.025],
    [strikeX + size * 0.15, strikeY - size * 0.75, size * 0.02],
    [strikeX + size * 0.55, strikeY - size * 0.25, size * 0.018],
    [strikeX - size * 0.05, strikeY - size * 0.65, size * 0.02],
    [strikeX + size * 0.35, strikeY - size * 0.65, size * 0.015],
    [strikeX + size * 0.5, strikeY - size * 0.55, size * 0.012],
  ]
  for (const [sx, sy, sr] of sparks) {
    glowCircle(sx, sy, sr, rgb(255, 235, 160), sr * 4)
  }
}

// ===== AI 神经节点 =====

function drawNeuralNodes(cx, cy, bookTop) {
  const nodes = [
    [cx - 340, bookTop - 180, rgb(56, 189, 248), 6, 'left1'],
    [cx + 340, bookTop - 180, rgb(129, 140, 248), 6, 'right1'],
    [cx - 340, bookTop - 260, rgb(56, 189, 248), 4, 'left2'],
    [cx + 340, bookTop - 260, rgb(129, 140, 248), 4, 'right2'],
  ]

  // 连线到书本中心区
  const bookMidX = cx
  const bookMidY = bookTop + 60

  for (const [nx, ny, nc, r, id] of nodes) {
    // 节点发光
    glowCircle(nx, ny, r, nc, r * 3.5)
    // 实心点
    fillCircle(nx, ny, r, [nc[0], nc[1], nc[2], 255])
    // 连线
    const ta = id.startsWith('left') ? 0.25 : 0.2
    drawLine(nx, ny, bookMidX + (id.startsWith('left') ? -80 : 80), bookMidY, [nc[0], nc[1], nc[2], ta], 1.8)
  }
}

// ===== N 字母（精确几何） =====

function drawLetterN(cx, cy, size) {
  const sw = size * 0.22  // stem width
  const hw = size * 0.55  // half width
  const h = size * 0.9

  // 左竖
  fillPoly([
    [cx - hw, cy - h / 2],
    [cx - hw + sw, cy - h / 2],
    [cx - hw + sw, cy + h / 2],
    [cx - hw, cy + h / 2],
  ], rgb(251, 146, 60))

  // 右竖
  fillPoly([
    [cx + hw - sw, cy - h / 2],
    [cx + hw, cy - h / 2],
    [cx + hw, cy + h / 2],
    [cx + hw - sw, cy + h / 2],
  ], rgb(251, 146, 60))

  // 斜线
  fillPoly([
    [cx - hw + sw, cy - h / 2],
    [cx - hw + sw + 2, cy - h / 2],
    [cx + hw, cy + h / 2],
    [cx + hw - sw, cy + h / 2],
  ], rgb(249, 115, 22))

  // 发光描边
  strokePoly([
    [cx - hw, cy - h / 2],
    [cx - hw + sw, cy - h / 2],
    [cx + hw - sw, cy + h / 2],
    [cx + hw, cy + h / 2],
    [cx + hw - sw, cy + h / 2],
    [cx + hw - sw, cy - h / 2],
    [cx + hw, cy - h / 2],
    [cx + hw, cy + h / 2],
  ], rgb(200, 90, 20), 2)

  // N 发光
  glowCircle(cx - hw + sw / 2, cy, sw / 2, rgb(251, 191, 36), sw * 3)
  glowCircle(cx + hw - sw / 2, cy, sw / 2, rgb(251, 191, 36), sw * 3)
}

// ===== 背景装饰环 =====

function drawDecorativeRing(cx, cy) {
  for (let r = 380 * SCALE; r <= 400 * SCALE; r += 10 * SCALE) {
    const a = r === 380 * SCALE ? 0.05 : 0.03
    for (let a2 = 0; a2 < Math.PI * 2; a2 += 0.005) {
      const x = cx + r * Math.cos(a2)
      const y = cy + r * Math.sin(a2)
      const t = (a2 + Math.PI) / (Math.PI * 2) // 0-1 around circle
      let col
      if (t < 0.25) col = lc(rgb(249, 115, 22), rgb(239, 68, 68), t / 0.25)
      else if (t < 0.5) col = lc(rgb(239, 68, 68), rgb(236, 72, 153), (t - 0.25) / 0.25)
      else if (t < 0.75) col = lc(rgb(236, 72, 153), rgb(249, 115, 22), (t - 0.5) / 0.25)
      else col = lc(rgb(249, 115, 22), rgb(249, 115, 22), (t - 0.75) / 0.25)
      plot(x, y, [col[0], col[1], col[2], a])
    }
  }
}

// ===== 主构建 =====

function build() {
  const cx = W / 2, cy = H / 2
  console.log('Generating NovelForge icon at', W, 'x', H, '(4x supersampling)...')

  // 1. 深蓝圆角背景
  fillRoundedRect(cx, cy, 448 * SCALE, 448 * SCALE, R, rgb(22, 22, 46))

  // 2. 装饰环
  drawDecorativeRing(cx, cy)

  // 3. 书本 (y 偏移到下方)
  const bookCY = cy + 50 * SCALE
  drawOpenBook(cx, bookCY, 360 * SCALE, 180 * SCALE)

  // 4. 锻造锤铁砧 + 火焰 (书本上方)
  drawForge(cx, cy - 60 * SCALE, 220 * SCALE)

  // 5. AI 神经节点
  const bookTop = bookCY - 90 * SCALE
  drawNeuralNodes(cx, cy, bookTop)

  // 6. N 字母
  drawLetterN(cx, cy + 170 * SCALE, 100 * SCALE)

  console.log('Pixels rendered, downsampling...')
}

// ===== 4x → 1x 降采样 =====

function downsample() {
  const out = Buffer.alloc(OUT * OUT * 4)
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const si = ((y * SCALE + dy) * W + (x * SCALE + dx)) * 4
          r += pixels[si]
          g += pixels[si + 1]
          b += pixels[si + 2]
          a += pixels[si + 3]
        }
      }
      const n = SCALE * SCALE
      const di = (y * OUT + x) * 4
      out[di] = Math.round(r / n)
      out[di + 1] = Math.round(g / n)
      out[di + 2] = Math.round(b / n)
      out[di + 3] = Math.round(a / n)
    }
  }
  return out
}

// ===== PNG 编码 =====

function encodePNG(pixels) {
  const raw = Buffer.alloc((OUT * 4 + 1) * OUT)
  for (let y = 0; y < OUT; y++) {
    raw[y * (OUT * 4 + 1)] = 0
    for (let x = 0; x < OUT; x++) {
      const i = (y * OUT + x) * 4
      const off = y * (OUT * 4 + 1) + 1 + x * 4
      raw[off] = pixels[i]
      raw[off + 1] = pixels[i + 1]
      raw[off + 2] = pixels[i + 2]
      raw[off + 3] = pixels[i + 3]
    }
  }

  function crc32(buf) {
    let c = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0) }
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type, 'ascii')
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])))
    return Buffer.concat([len, typeB, data, crcB])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function encodeICO(png) {
  const raw = png // use png-compressed data
  const zlib = require('zlib')

  // Parse PNG to get raw pixels
  let pos = 8
  const idatChunks = []
  while (pos < png.length) {
    const len = png.readUInt32BE(pos)
    const type = png.slice(pos + 4, pos + 8).toString()
    if (type === 'IDAT') idatChunks.push(png.slice(pos + 8, pos + 8 + len))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const rawPixels = zlib.inflateSync(Buffer.concat(idatChunks))

  const sizes = [256, 64, 48, 32, 16]
  const images = []

  for (const size of sizes) {
    const scale = OUT / size
    const img = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sy = Math.floor(y * scale)
        const sx = Math.floor(x * scale)
        const si = (sy * (OUT * 4 + 1) + 1 + sx * 4)
        const di = (y * size + x) * 4
        img[di] = rawPixels[si]; img[di + 1] = rawPixels[si + 1]
        img[di + 2] = rawPixels[si + 2]; img[di + 3] = rawPixels[si + 3]
      }
    }

    const rowBytes = Math.ceil(size / 8)
    const bmpSize = 40 + size * size * 4 + size * rowBytes
    const bmp = Buffer.alloc(bmpSize)
    let off = 0
    bmp.writeUInt32LE(40, off); off += 4; bmp.writeInt32LE(size, off); off += 4
    bmp.writeInt32LE(size * 2, off); off += 4; bmp.writeUInt16LE(1, off); off += 2
    bmp.writeUInt16LE(32, off); off += 2; off += 20
    for (let y = size - 1; y >= 0; y--) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4
        bmp[off++] = img[si + 2]; bmp[off++] = img[si + 1]
        bmp[off++] = img[si]; bmp[off++] = img[si + 3]
      }
    }
    for (let y = 0; y < size; y++) {
      let byte = 0, bit = 0
      for (let x = 0; x < size; x++) {
        if (img[((size - 1 - y) * size + x) * 4 + 3] < 128) byte |= (1 << (7 - bit))
        if (++bit === 8 || x === size - 1) { bmp[off++] = byte; byte = 0; bit = 0 }
      }
    }
    images.push({ size, data: bmp })
  }

  let icoSize = 6 + 16 * sizes.length
  for (const img of images) icoSize += img.data.length
  const ico = Buffer.alloc(icoSize)
  let off = 0
  ico.writeUInt16LE(0, off); off += 2; ico.writeUInt16LE(1, off); off += 2
  ico.writeUInt16LE(sizes.length, off); off += 2
  let dataOff = 6 + 16 * sizes.length
  for (const img of images) {
    ico.writeUInt8(img.size >= 256 ? 0 : img.size, off); off++
    ico.writeUInt8(img.size >= 256 ? 0 : img.size, off); off++
    ico.writeUInt8(0, off); off++; ico.writeUInt8(0, off); off++
    ico.writeUInt16LE(1, off); off += 2; ico.writeUInt16LE(32, off); off += 2
    ico.writeUInt32LE(img.data.length, off); off += 4; ico.writeUInt32LE(dataOff, off); off += 4
    img.data.copy(ico, dataOff); dataOff += img.data.length
  }
  return ico
}

// ===== 主流程 =====

console.time('icon')
build()
const outPixels = downsample()
const png = encodePNG(outPixels)
fs.writeFileSync('build/icon.png', png)
console.log(`icon.png: ${(png.length / 1024).toFixed(1)} KB`)

const ico = encodeICO(png)
fs.writeFileSync('build/icon.ico', ico)
console.log(`icon.ico: ${(ico.length / 1024).toFixed(1)} KB`)
console.timeEnd('icon')
