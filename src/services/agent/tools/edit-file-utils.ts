/**
 * edit_file 纯函数引擎（CC FileEditTool/utils.ts 对齐，NF 中文排版裁决版）——Task C2（CC §三.3）
 *
 * 三层匹配降级链 + 文风归一化（preserveQuoteStyle）的纯函数层：
 * - 无 ipc / store / electron 依赖——可单测；工具接线（edit-file.tool.ts）只做 IO 与 i18n
 * - 所有"命中即回映文件真实子串"：替换区域永远取自文件原文 [start,end)，不采用模型回显文本
 *
 * 匹配降级链顺序（每层命中即返回）：
 *   L1 exact         —— old_string 是文件的字面子串
 *   L2 desanitized   —— old_string 含"LLM 可见的脱敏占位形态"，反脱敏回文件真实形态再匹配
 *                       （new_string 由工具层调用 desanitizeText 同步反脱敏后写入）
 *   L3 whitespace    —— 模型侧尾随水平空格松弛（仅裁剪模型输入侧；文件侧永不裁剪——
 *                       对 .md 的硬换行语义天然安全，见 trimModelTrailingWhitespace 注释）
 *   L4 quotes        —— 引号族归一化匹配，候选按"与文件的引号差异数最少"择优（回映文件真实子串）
 *
 * 附带语义（对齐 CC，落地裁决见各函数注释）：
 * - 删除/新增的尾换行处理（consumeTrailingNewline + 整行替换对称防护）
 * - diff/上下文截断纯函数（truncateContextAtLineBoundary）——v1 工具消息不含文件上下文
 *   （引擎 800-token 截断使大段上下文无意义，read_file 是验证通道），保留为未来 diff 输出的护栏
 * - 多编辑链碰撞防护：NF 工具一次调用只处理一个 old_string，CC 的"前序 new_string 不能是后序
 *   old_string 子串"属跨调用会话态（agent-engine 无多编辑请求类型），v1 不做——见报告裁决
 */

// ===== 引号族数据（中文排版裁决：映射表为纯数据，逐族可单测） =====

/** ASCII 直双引号 */
export const QUOTE_DOUBLE_STRAIGHT = '"'
/** 中文/西文弯双引号开与闭 */
export const QUOTE_DOUBLE_CURLY_OPEN = '\u201C' // “
export const QUOTE_DOUBLE_CURLY_CLOSE = '\u201D' // ”

/** ASCII 直单引号（兼撇号） */
export const QUOTE_SINGLE_STRAIGHT = "'"
/** 弯单引号开与闭（’ 兼缩写撇号） */
export const QUOTE_SINGLE_CURLY_OPEN = '\u2018' // ‘
export const QUOTE_SINGLE_CURLY_CLOSE = '\u2019' // ’

/** 直角引号（中文/日文）；无直引号变体——仅自身匹配，不参与任何风格转换 */
export const QUOTE_CORNER_OPEN = '\u300C' // 「
export const QUOTE_CORNER_CLOSE = '\u300D' // 」

/**
 * 引号族归一化 token（PUA 哨兵——正文不可见，保证与任何非引号字符不冲突）。
 * 匹配视角：同一族内的直/弯、开/闭互换视为等价（文件 'don’t' ↔ 模型 "don't"）。
 * ⚠️ 族间不互换：弯双引号族 {", “, ”} 与直角引号「」是不同排版体系——
 *    模型写直引号不能匹配文件中的「」/『』（跨族匹配会造成错误回映，NF 裁决不做）。
 */
const TOKEN_DOUBLE_FAMILY = '\uE000'
const TOKEN_SINGLE_FAMILY = '\uE001'

const QUOTE_NORMALIZE: Readonly<Record<string, string>> = {
  [QUOTE_DOUBLE_STRAIGHT]: TOKEN_DOUBLE_FAMILY,
  [QUOTE_DOUBLE_CURLY_OPEN]: TOKEN_DOUBLE_FAMILY,
  [QUOTE_DOUBLE_CURLY_CLOSE]: TOKEN_DOUBLE_FAMILY,
  [QUOTE_SINGLE_STRAIGHT]: TOKEN_SINGLE_FAMILY,
  [QUOTE_SINGLE_CURLY_OPEN]: TOKEN_SINGLE_FAMILY,
  [QUOTE_SINGLE_CURLY_CLOSE]: TOKEN_SINGLE_FAMILY,
}

/** 是否弯单引号（开/闭；’ 兼撇号——回填时区分，见 straightToCurlySingle） */
function isCurlySingle(ch: string): boolean {
  return ch === QUOTE_SINGLE_CURLY_OPEN || ch === QUOTE_SINGLE_CURLY_CLOSE
}

// ===== 反脱敏映射表（匹配降级链 L2，扩展点） =====

/**
 * 反脱敏映射：条目 = [LLM 在 observation 中看到的形态, 文件中的真实形态]。
 * new_string 同步反脱敏后写入（desanitizeText 在工具层对 new_string 调用）。
 *
 * ⚠️ 调研结论（Task C2，勿臆造条目）：
 * 1. agent-engine.sanitizeObservation 是 lossy 剥离（<tool_call / <tool_result 标签整体删除，
 *    无占位符残留）——被剥内容不可逆，无法用查表恢复，故不产生可登记条目；
 * 2. sanitizeErrorText 的 [path] 掩码只作用于错误文本（文件正文读入不经它），不构成编辑回环；
 * 3. HTML 实体转义（&lt;…&gt;）仅存在于 share-card / yearly-report（HTML 渲染），与 agent 管道无关。
 * → 当前管道不存在可逆的"脱敏占位符"；本表以空集起步，保持表驱动架构。
 *   未来引擎若引入实体转义 / 占位符替换（如 CC 的 &lt;fnr&gt; ↔ <function_results>），在此登记。
 */
export const DESANITIZE_MAP: ReadonlyArray<readonly [string, string]> = []

/**
 * 反脱敏：按序把 text 中所有 [脱敏形态] 替换为 [文件真实形态]（全量替换，映射表数据驱动）。
 * 空表 = 恒等函数（当前生产态）。
 */
export function desanitizeText(
  text: string,
  map: ReadonlyArray<readonly [string, string]> = DESANITIZE_MAP,
): string {
  let out = text
  for (const [view, real] of map) {
    if (out.includes(view)) out = out.split(view).join(real)
  }
  return out
}

// ===== L3：模型侧尾随水平空格松弛 =====

/**
 * 剥掉模型输入侧的尾随水平空格（每行行尾 + 整串末尾）。
 * 只作用于"模型回显文本"一侧：文件侧一个字符都不裁剪——因此对 .md 的硬换行（行尾 2 空格）
 * 语义天然安全：文件行尾空格不在命中区外时绝不参与匹配裁剪，命中区永远是文件真实子串。
 * （对比 CC：CC 对代码文件剥 old_string 尾随空格，对 .md 跳过以防破坏硬换行——
 *   NF 统一"只剥模型侧"，.md 与非 .md 同一条规则，测试锁定两种语义。）
 */
export function trimModelTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]+$/, '')
}

// ===== L4：引号归一化匹配（回映文件真实子串） =====

/** 引号族归一化键：族内直/弯、开/闭 → 同一哨兵 token；其余字符原样（1:1，长度不变 → 偏移可直接映射回文件） */
export function normalizeQuoteKey(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    out += QUOTE_NORMALIZE[ch] ?? ch
  }
  return out
}

/** 候选与 old_string 的逐字符差异数（键相等 ⇒ 差异只可能是族内引号风格翻转） */
function countQuoteStyleDiff(oldText: string, candidate: string): number {
  let diff = 0
  for (let i = 0; i < oldText.length; i++) {
    if (oldText[i] !== candidate[i]) diff++
  }
  return diff
}

// ===== 主入口：匹配降级链 =====

/** 匹配命中的降级层级 */
export type EditMatchLayer = 'exact' | 'desanitized' | 'whitespace' | 'quotes'

export interface EditMatch {
  /** 命中层级（供工具组提示） */
  layer: EditMatchLayer
  /** 命中区 [start, end)（字符偏移，fileText 下标）——永远指向文件真实文本 */
  start: number
  end: number
  /** 文件真实命中子串（回映：layer ≠ 'exact' 时与 old_string 不同，供诊断/测试） */
  matchedText: string
  /** 该匹配 needle 在文件中的出现次数（同层计数，≥1；引号层 = 归一化候选数） */
  occurrenceTotal: number
}

export interface EditMatchOptions {
  /**
   * 反脱敏映射表（默认 DESANITIZE_MAP=空=恒等）。测试注入用；生产条目登记在 DESANITIZE_MAP。
   */
  desanitizeMap?: ReadonlyArray<readonly [string, string]>
  /** 允许 L3 模型侧尾随空格松弛（默认 true） */
  allowModelTrailingWhitespace?: boolean
}

/** needle 在 haystack 中的首次出现 + 出现总数（needle 为空 → 无匹配） */
function scanOccurrences(haystack: string, needle: string): { first: number; total: number } {
  if (needle === '') return { first: -1, total: 0 }
  let first = -1
  let total = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    if (first === -1) first = idx
    total++
    idx = haystack.indexOf(needle, idx + 1)
  }
  return { first, total }
}

function toMatch(layer: EditMatchLayer, text: string, first: number, needleLen: number, total: number): EditMatch {
  return { layer, start: first, end: first + needleLen, matchedText: text.slice(first, first + needleLen), occurrenceTotal: total }
}

/**
 * 匹配降级链主入口：L1 精确 → L2 反脱敏 → L3 模型侧空格松弛 → L4 引号归一化。
 * 命中返回的 [start,end) 一律指向文件真实文本；任何层都不改写文件内容。
 */
export function findEditMatch(fileText: string, oldString: string, options: EditMatchOptions = {}): EditMatch | null {
  if (!oldString) return null

  // L1：精确 includes
  const exact = scanOccurrences(fileText, oldString)
  if (exact.first !== -1) return toMatch('exact', fileText, exact.first, oldString.length, exact.total)

  // L2：反脱敏表（当前空表 → dsOld === oldString，跳过；条目登记见 DESANITIZE_MAP 注释）
  const dsOld = desanitizeText(oldString, options.desanitizeMap ?? DESANITIZE_MAP)
  if (dsOld !== oldString) {
    const m = scanOccurrences(fileText, dsOld)
    if (m.first !== -1) return toMatch('desanitized', fileText, m.first, dsOld.length, m.total)
  }

  // L3：模型侧尾随空格松弛（不触碰文件侧）
  if (options.allowModelTrailingWhitespace !== false) {
    const wsOld = trimModelTrailingWhitespace(oldString)
    if (wsOld !== oldString) {
      const m = scanOccurrences(fileText, wsOld)
      if (m.first !== -1) return toMatch('whitespace', fileText, m.first, wsOld.length, m.total)
    }
  }

  // L4：引号归一化（回映文件真实子串）——差异最少者优先，同差取最早
  const oldKey = normalizeQuoteKey(oldString)
  const fileKey = normalizeQuoteKey(fileText)
  let best: EditMatch | null = null
  let bestDiff = Infinity
  let candidates = 0
  let idx = fileKey.indexOf(oldKey)
  while (idx !== -1) {
    candidates++
    const diff = countQuoteStyleDiff(oldString, fileText.slice(idx, idx + oldString.length))
    if (diff < bestDiff) {
      bestDiff = diff
      best = toMatch('quotes', fileText, idx, oldString.length, 0)
    }
    idx = fileKey.indexOf(oldKey, idx + 1)
  }
  if (best) best.occurrenceTotal = candidates
  return best
}

// ===== preserveQuoteStyle：文件引号风格检测 + new_string 回填 =====

/** 文件引号风格判定结果：dominant='curly'/'straight'，无证据或持平 = 'none'（不转换） */
export type QuoteVariant = 'curly' | 'straight' | 'none'

export interface FileQuoteStyle {
  /** 双引号族（" ↔ “”） */
  double: QuoteVariant
  /** 单引号族（' ↔ ‘’） */
  single: QuoteVariant
}

/**
 * 全文件扫描统计引号风格：各族 弯 > 直 → 'curly'；直 > 弯 → 'straight'；否则 'none'。
 * 裁决：NF 小说正文单文件通常单一引号体系（弯「」/“” 或 ASCII），全文件多数决足够；
 *       代码/正文混合文件若两种风格并存 → 'none'（不改写模型文本，宁缺毋滥）。
 * ⚠️ 「」/『』 直角引号族不参与风格回填：其无直引号对应族，把模型直引号自动转「」属跨族猜测
 *   （风险：文件可能 " 用于引述词而「」用于对话），v1 裁决不做——见 task-C2-report。
 */
export function detectFileQuoteStyle(fileText: string): FileQuoteStyle {
  let doubleStraight = 0
  let doubleCurly = 0
  let singleStraight = 0
  let singleCurly = 0
  for (let i = 0; i < fileText.length; i++) {
    const ch = fileText[i]
    if (ch === QUOTE_DOUBLE_STRAIGHT) doubleStraight++
    else if (ch === QUOTE_DOUBLE_CURLY_OPEN || ch === QUOTE_DOUBLE_CURLY_CLOSE) doubleCurly++
    else if (ch === QUOTE_SINGLE_STRAIGHT) singleStraight++
    else if (isCurlySingle(ch)) singleCurly++
  }
  const pick = (straight: number, curly: number): QuoteVariant =>
    straight === curly ? 'none' : straight > curly ? 'straight' : 'curly'
  return { double: pick(doubleStraight, doubleCurly), single: pick(singleStraight, singleCurly) }
}

/** 词字符（撇号判定用：缩写撇号两侧是字母/数字） */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

/** 弯双引号目标：直 " → 按"开/闭交替"回填（换行处重置——中文对话常每行一对） */
function straightToCurlyDouble(text: string): string {
  if (!text.includes(QUOTE_DOUBLE_STRAIGHT)) return text
  let out = ''
  let expectOpen = true
  for (const ch of text) {
    if (ch === QUOTE_DOUBLE_STRAIGHT) {
      out += expectOpen ? QUOTE_DOUBLE_CURLY_OPEN : QUOTE_DOUBLE_CURLY_CLOSE
      expectOpen = !expectOpen
    } else {
      out += ch
      if (ch === '\n') expectOpen = true
    }
  }
  return out
}

/** 直双引号目标：弯 “”→ 直 " */
function curlyToStraightDouble(text: string): string {
  if (!text.includes(QUOTE_DOUBLE_CURLY_OPEN) && !text.includes(QUOTE_DOUBLE_CURLY_CLOSE)) return text
  let out = ''
  for (const ch of text) {
    out += ch === QUOTE_DOUBLE_CURLY_OPEN || ch === QUOTE_DOUBLE_CURLY_CLOSE ? QUOTE_DOUBLE_STRAIGHT : ch
  }
  return out
}

/**
 * 弯单引号目标：直 ' → 上下文启发式（对齐 CC）：两侧均为词字符 → 缩写撇号（回填右弯撇号 ’，
 * 不参与开/闭交替）；否则按开/闭交替回填（换行处重置）。
 */
function straightToCurlySingle(text: string): string {
  if (!text.includes(QUOTE_SINGLE_STRAIGHT)) return text
  let out = ''
  let expectOpen = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === QUOTE_SINGLE_STRAIGHT) {
      const prev = i > 0 ? text[i - 1] : ''
      const next = i < text.length - 1 ? text[i + 1] : ''
      if (isWordChar(prev) && isWordChar(next)) {
        // 缩写撇号（don't / O'Brien）→ 右弯单引号（撇号形态）
        out += QUOTE_SINGLE_CURLY_CLOSE
      } else {
        out += expectOpen ? QUOTE_SINGLE_CURLY_OPEN : QUOTE_SINGLE_CURLY_CLOSE
        expectOpen = !expectOpen
      }
    } else {
      out += ch
      if (ch === '\n') expectOpen = true
    }
  }
  return out
}

/** 直单引号目标：弯 ‘/’ → 直 '（撇号不区分） */
function curlyToStraightSingle(text: string): string {
  if (!text.includes(QUOTE_SINGLE_CURLY_OPEN) && !text.includes(QUOTE_SINGLE_CURLY_CLOSE)) return text
  let out = ''
  for (const ch of text) {
    out += isCurlySingle(ch) ? QUOTE_SINGLE_STRAIGHT : ch
  }
  return out
}

/**
 * preserveQuoteStyle：按文件引号风格回填 new_string 中的引号。
 * - 文件弯引号为主 → 模型直引号自动转弯（双引号族开/闭交替；单引号族撇号上下文区分）
 * - 文件直引号为主 → 模型弯引号转直（风格统一）
 * - 该族无证据/持平 → 原文不动
 * - 直角引号「」族：不转换（见 detectFileQuoteStyle 注释）
 */
export function adaptTextToQuoteStyle(text: string, styles: FileQuoteStyle): string {
  let out = text
  if (styles.double === 'curly') out = straightToCurlyDouble(out)
  else if (styles.double === 'straight') out = curlyToStraightDouble(out)
  if (styles.single === 'curly') out = straightToCurlySingle(out)
  else if (styles.single === 'straight') out = curlyToStraightSingle(out)
  return out
}

/**
 * preserveQuoteStyle 区域感知判定（评审 Finding 2 修复）：
 * 回填基准 = **命中区真实文本**（fileText 的 [start,end)）逐族的引号风格，而非全文件多数决——
 * 弯引号主文件内嵌的直引号区（md JSON/代码块/外文串）本身是合法的少数风格区：
 * L1 精确命中该区（old/new 逐字复制自 read_file）时若按全文件转弯，会改写 old==new 的无意义请求
 * （破坏 no-op 承诺、mtime 抖动）甚至损坏直引号 JSON。
 * 规则：某族在命中区有证据 → 按命中区风格回填（弯→转弯、直→转直）；命中区该族无证据
 * （new_string 引入了命中区没有的引号族）→ 才回退全文件多数决（detectFileQuoteStyle）；仍无证据 → none 不动。
 */
export function detectRegionAwareQuoteStyle(regionText: string, fileText: string): FileQuoteStyle {
  const region = detectFileQuoteStyle(regionText)
  const file = detectFileQuoteStyle(fileText)
  return {
    double: region.double !== 'none' ? region.double : file.double,
    single: region.single !== 'none' ? region.single : file.single,
  }
}

// ===== 尾换行语义（附带，对齐 CC） =====

/**
 * 连带删除尾换行：命中区**覆盖整行**（spanStart===0 或前字符为 \n）、old_string 不以 \n 结尾、
 * 命中区后紧跟 \n，且替换文本为空或以 \n 结尾 → 命中区连带吞掉该 \n。
 * 避免残留空行（old 'b' new '' 于 'a\nb\nc\n' → 'a\nc\n' 而非 'a\n\nc\n'）。
 *
 * ⚠️ 整行校验（评审 Finding 1 修复）：行尾**片段**（如句末标点 '。'）删除不得吞行分隔——
 *   old '。' new '' 于 '第一段结尾。\n第二段' 若吞 \n 会把两段并成一行；md 的 \n\n 段落边界
 *   也会塌缩。消费尾换行只发生在「模型显然在删一整行」时（i18n 语义：删除独占一行的片段时
 *   连带删除行尾换行）。
 *
 * 替换文本不以 \n 结尾（且非空）时不消费——文件行分隔符保留（old 'b' new 'x' → 'a\nx\nc\n'，
 * 行替换语义下 new 与下行用文件原有 \n 分隔，不粘连）。
 */
export function consumeTrailingNewline(
  fileText: string,
  spanStart: number,
  spanEnd: number,
  oldString: string,
  newString: string,
): number {
  if (oldString.endsWith('\n')) return spanEnd
  const coversWholeLine = spanStart === 0 || fileText[spanStart - 1] === '\n'
  if (coversWholeLine && (newString === '' || newString.endsWith('\n'))) {
    if (fileText[spanEnd] === '\n') return spanEnd + 1
  }
  return spanEnd
}

/** 组装最终替换文本：new + （old 以 \n 结尾而 new 无 \n → 补 \n，防与下一行粘连的对称防护） */
export function finalizeReplacementText(oldString: string, newString: string): string {
  if (oldString.endsWith('\n') && newString !== '' && !newString.endsWith('\n')) return newString + '\n'
  return newString
}

export interface SpanEditResult {
  /** 替换后的完整文件文本 */
  content: string
  /** 实际被移除的字符数 = 最终命中区长度（含连带消费的尾换行） */
  removedChars: number
  /** 实际写入的替换文本字符数（含整行替换对称防护补的 \n） */
  addedChars: number
}

/**
 * 应用一次替换：span [start,end)（文件真实命中区，可由 findEditMatch 取得）
 * + 尾换行消费 + 整行替换对称防护。返回替换结果（内容 + 移除/新增字符数，供工具层反馈）。
 */
export function applySpanEdit(
  fileText: string,
  start: number,
  end: number,
  oldString: string,
  newString: string,
): SpanEditResult {
  const replacement = finalizeReplacementText(oldString, newString)
  const end2 = consumeTrailingNewline(fileText, start, end, oldString, replacement)
  return {
    content: fileText.slice(0, start) + replacement + fileText.slice(end2),
    removedChars: end2 - start,
    addedChars: replacement.length,
  }
}

// ===== diff/上下文截断（附带；v1 为未来 diff 输出的护栏，见文件头注释） =====

/** CC 对齐：diff/上下文单次注入上限 8KB（字符口径） */
export const EDIT_CONTEXT_MAX_CHARS = 8192

export interface ContextTruncation {
  text: string
  truncated: boolean
}

/**
 * 把待回显的上下文截断到 maxChars 以内，且只在换行处截断（不切半行）：
 * 前缀内最后一个 \n 处切（保留该行首至换行）；单行超长（前缀内无 \n）→ 硬切 maxChars。
 * 调用方负责在 truncated 时追加截断提示（i18n 在调用层）。
 */
export function truncateContextAtLineBoundary(text: string, maxChars: number = EDIT_CONTEXT_MAX_CHARS): ContextTruncation {
  if (text.length <= maxChars) return { text, truncated: false }
  const prefix = text.slice(0, maxChars)
  const lastBreak = prefix.lastIndexOf('\n')
  return {
    text: lastBreak === -1 ? prefix : prefix.slice(0, lastBreak + 1),
    truncated: true,
  }
}
