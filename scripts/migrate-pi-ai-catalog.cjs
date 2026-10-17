#!/usr/bin/env node
/**
 * 目录移植（2026-09-28，一次性）：从 @earendil-works/pi-ai（MIT）的 providers/data/*.json
 * 提取 `openai-completions` 系条目，生成 `src/shared/model-specs.generated.ts`：
 *   ① PI_AI_MODEL_SPECS —— 现有家的模型规格（presetModelDefaults 的补全源，NF 字面量优先）
 *   ② PI_AI_PROVIDER_PRESETS —— 并入 BUILTIN_PRESETS 的新供应商（9 家，OpenAI 兼容 + key 鉴权）
 *
 * 用法：node scripts/migrate-pi-ai-catalog.cjs [--source D:/Code/deepseek-harness]
 * 仅在需要刷新数据时复跑；产物入库，运行时不依赖 pi-ai 或其源目录。
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const srcIdx = args.indexOf('--source')
const SOURCE = srcIdx >= 0 ? args[srcIdx + 1] : 'D:/Code/deepseek-harness'
const OUT = path.join(__dirname, '..', 'src', 'shared', 'model-specs.generated.ts')

const pnpm = path.join(SOURCE, 'node_modules', '.pnpm')
const pkgDir = fs.existsSync(pnpm)
  ? fs.readdirSync(pnpm).find((d) => d.startsWith('@earendil-works+pi-ai@'))
  : undefined
if (!pkgDir) {
  console.error(`[migrate] 未在 ${pnpm} 找到 @earendil-works/pi-ai（用 --source 指定 dsh 仓库根）`)
  process.exit(1)
}
const DATA = path.join(pnpm, pkgDir, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')

/** NF 现有家 id → pi-ai 目录 id（名字不齐的在此对齐） */
const EXISTING_MAP = {
  openai: 'openai', deepseek: 'deepseek', anthropic: 'anthropic',
  gemini: 'google', moonshot: 'moonshotai', bigmodel: 'zai', xiaomi: 'xiaomi',
  mistral: 'mistral', groq: 'groq', xai: 'xai', openrouter: 'openrouter',
}

/** 新增供应商（pi-ai id → NF 显示名）；协议一律 openai 兼容 + key 鉴权 */
const NEW_PROVIDERS = {
  'minimax-cn': 'MiniMax',
  'zai-coding-cn': '智谱（编程套餐）',
  'kimi-coding': 'Kimi（编程套餐）',
  'qwen-token-plan-cn': '通义千问（Token 套餐）',
  'xiaomi-token-plan-cn': '小米 MiMo（订阅套餐）',
  cerebras: 'Cerebras',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  nvidia: 'NVIDIA NIM',
}

const readData = (id) => JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf-8'))
const posInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/**
 * 从数据文件里挑 NF 可服务的协议键（2026-09-28：NF 已有 openai/gemini/anthropic 三协议；
 * 数据侧这里只用到 openai-completions 与 anthropic-messages 两个键——minimax/kimi 等
 * 走 anthropic-messages，正因 NF 新增了 anthropic 原生协议才可服务）。
 */
const pickApi = (raw) => {
  if (raw['openai-completions']) return { key: 'openai-completions', protocol: 'openai' }
  if (raw['anthropic-messages']) return { key: 'anthropic-messages', protocol: 'anthropic' }
  return null
}

// ① 规格表：pi-ai 1.1.0 起单个 provider 文件按**协议键**分组
//    （openai-completions / openai-responses / anthropic-messages / google-* …），
//    条目键可能带 `chat:` 前缀，**真实模型 id 在 entry.id**；classifier/image 等非聊天条目要排除。
//    规格与协议无关：合并全部 chat 条目、按 id 去重（先到者保留；缺字段用后到条目补齐）。
const isChatEntry = (m) => !!m && (m.type === undefined || m.type === 'chat')
const entryModelId = (key, m) => {
  const id = typeof m.id === 'string' ? m.id.trim() : ''
  // 旧 schema（<= 1.0.x）没有 entry.id，键就是 id；新 schema 键是 `chat:<id>`
  return id.length > 0 ? id : key.replace(/^chat:/, '')
}
const specs = {}
for (const [nfId, piId] of Object.entries(EXISTING_MAP)) {
  let raw
  try {
    raw = readData(piId)
  } catch {
    console.warn(`[migrate] 跳过 ${nfId}：pi-ai 无 ${piId}.json`)
    continue
  }
  const merged = {}
  for (const apiEntries of Object.values(raw)) {
    if (!apiEntries || typeof apiEntries !== 'object' || Array.isArray(apiEntries)) continue
    for (const [key, m] of Object.entries(apiEntries)) {
      if (!isChatEntry(m)) continue
      const id = entryModelId(key, m)
      const spec = (merged[id] ??= {})
      const cw = posInt(m.contextWindow)
      const mt = posInt(m.maxTokens)
      if (cw !== undefined && spec.contextWindow === undefined) spec.contextWindow = cw
      if (mt !== undefined && spec.maxTokens === undefined) spec.maxTokens = mt
    }
  }
  const entry = {}
  for (const [id, spec] of Object.entries(merged)) {
    if (Object.keys(spec).length > 0) entry[id] = spec
  }
  if (Object.keys(entry).length > 0) specs[nfId] = entry
}

// ② 新供应商（模型清单 + 规格；protocol 按数据键判定——minimax/kimi 系走 anthropic-messages；
//    contextWindow 仅在与 maxTokens 不同时显式写——NF 既有约定）
const newPresets = []
for (const [piId, displayName] of Object.entries(NEW_PROVIDERS)) {
  let raw
  try {
    raw = readData(piId)
  } catch {
    console.warn(`[migrate] 跳过新供应商 ${piId}：数据文件不存在`)
    continue
  }
  const picked = pickApi(raw)
  if (!picked) {
    console.warn(`[migrate] 跳过新供应商 ${piId}：无可服务协议键（需 openai-completions 或 anthropic-messages）`)
    continue
  }
  const entries = Object.entries(raw[picked.key])
    .filter(([, m]) => isChatEntry(m))
    .map(([key, m]) => ({ id: entryModelId(key, m), m }))
  const seen = new Set()
  const models = []
  for (const { id, m } of entries) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const mt = posInt(m.maxTokens) ?? 8192
    const cw = posInt(m.contextWindow)
    const out = { name: id, maxTokens: mt }
    if (cw !== undefined && cw !== mt) out.contextWindow = cw
    models.push(out)
  }
  if (models.length === 0) {
    console.warn(`[migrate] 跳过新供应商 ${piId}：${picked.key} 下没有 chat 模型`)
    continue
  }
  const baseUrl = entries.find(({ m }) => typeof m.baseUrl === 'string' && m.baseUrl.length > 0)?.m.baseUrl ?? ''
  newPresets.push({ provider: piId, displayName, baseUrl, protocol: picked.protocol, models, embeddingModels: [] })
}

const header = `/**
 * ⚠️ 自动生成（scripts/migrate-pi-ai-catalog.cjs）；请勿手改。
 *
 * 数据来源：@earendil-works/pi-ai（MIT，Copyright Mario Zechner）dist/providers/data/*.json。
 *   版本基准：DSH（deepseek-harness）0.2.1-rc.1 的 pnpm-lock 锁定 pi-ai 1.1.0；
 *   取包方式（无需安装依赖）：npm pack @earendil-works/pi-ai@1.1.0 解包到临时目录后
 *   按 <源根>/node_modules/.pnpm/@earendil-works+pi-ai@<ver>/node_modules/@earendil-works/pi-ai 摆放。
 *
 * 1.1.0 schema：单文件按协议键分组（openai-completions / openai-responses / anthropic-messages /
 * google-* …），条目键可能带 \`chat:\` 前缀，真实模型 id 取 entry.id；仅收 type=chat
 * （classifier / image 条目排除）。规格与协议无关，因此跨协议键合并、按 id 去重。
 *
 * 用途：
 *   ① PI_AI_MODEL_SPECS —— presetModelDefaults 在 NF 手写字面量**缺省时**补全规格（字面量优先）；
 *   ② PI_AI_PROVIDER_PRESETS —— 并入 BUILTIN_PRESETS 的新供应商（OpenAI 兼容 / anthropic 原生 + key 鉴权）。
 * 刷新：node scripts/migrate-pi-ai-catalog.cjs --source <含 node_modules 的源根>
 */
import type { ProviderPreset } from './provider-presets'

/** provider → modelId → 规格（contextWindow/maxTokens） */
export const PI_AI_MODEL_SPECS: Record<string, Record<string, { contextWindow?: number; maxTokens?: number }>> = `
const body = JSON.stringify(specs, null, 2)
const presetsBlock = `

/** 新增供应商（并入 BUILTIN_PRESETS） */
export const PI_AI_PROVIDER_PRESETS: ProviderPreset[] = ${JSON.stringify(newPresets, null, 2)}
`

fs.writeFileSync(OUT, header + body + presetsBlock, 'utf-8')
const totalModels = Object.values(specs).reduce((n, m) => n + Object.keys(m).length, 0)
console.log(
  `[migrate] 已生成 ${path.relative(process.cwd(), OUT)}：` +
    `规格 ${Object.keys(specs).length} 家 / ${totalModels} 个模型；新供应商 ${newPresets.length} 家`,
)
