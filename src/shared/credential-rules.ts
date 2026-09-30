/**
 * 凭据规则纯函数（模型管理 v3 §4.3/§4.4）—— **主/渲染共用，零依赖**。
 *
 * 为什么放 `src/shared/`：`apiKeyFailure` 两边都要用 ——
 * 渲染层（T6 密钥框行内红字）用它在提交前给即时反馈，主进程（`credential:set`）用它做
 * **权威校验**（渲染层可被绕过，主进程这一道不可省）。两处判据必须逐字一致，故单源在这里。
 * `deriveCredentialRef` 目前只有主进程用（T2 创建账户时分配 ref），放同一文件避免规则分裂。
 */

/**
 * 合法密钥字符集：可打印 ASCII（`!`~`~`，**不含空格**）。
 *
 * ⚠️ 为什么必须按**原始输入**判定（而非 `trim()` 后的值）：
 *   空格与制表符都在本集合之外 —— 用户从网页复制密钥常带首尾空白/换行，
 *   若先 trim 再判，`'sk-abc\t'` 会被判为合法并**把制表符当密钥内容**发出去（401 难排查）。
 *   渲染层提交前会 `.trim()`，但主进程拿到的可能是任意串 —— 校验一律以收到的原始串为准。
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
/** `NAME=value` 形（用户误把 `.env` 整行粘进来）：要求 `=` 后有内容且该内容不以 `=` 开头 */
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/
/** 包裹字符：引号（含反引号）成对包裹 = 从配置文件里复制粘贴的形态 */
const QUOTES = ['"', '\'', '`'] as const

/** 拒因码（渲染层据此取 i18n 文案，见 settings 分片 `credentialFailure.*`） */
export type ApiKeyFailure = 'keyBlank' | 'keyIllegalCharacters'

/**
 * 由 provider 派生环境变量名（= 凭据引用名）：`<PROVIDER>_API_KEY`。
 *
 * 规则（§4.3）：词干大写、非字母数字 → `_`（`zai-coding-cn` → `ZAI_CODING_CN`）；
 * 已占用则加后缀 `_2`、`_3`…（同一 provider 多账户 —— 第一个用标准名，
 * 于是 `OPENAI_API_KEY` 这个 shell 里常见的名字天然成为「环境变量影子」的目标）。
 *
 * @param taken 已分配的 ref 全集（调用方从既有账户收集；本函数不读盘）
 */
export function deriveCredentialRef(provider: string, taken: ReadonlySet<string>): string {
  const stem = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  if (!taken.has(stem)) return stem
  for (let n = 2; ; n++) {
    const candidate = `${stem}_${String(n)}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * 校验密钥草稿。返回 `undefined` = 通过；否则返回拒因码。
 *
 * - 空串 = **不提供**（保留已存值；新账户 = 无密钥/原生，如 Ollama）→ 通过
 * - 纯空白 → `keyBlank`（用户想填但没填出内容）
 * - `NAME=value` 行 / 引号包裹 / 含可打印 ASCII 之外的字符 → `keyIllegalCharacters`
 *
 * ⚠️ 后三类判据都作用在**原始草稿**上（不 trim）——见 `LEGAL_API_KEY` 的说明。
 */
export function apiKeyFailure(draft: string): ApiKeyFailure | undefined {
  if (draft.length === 0) return undefined
  if (draft.trim().length === 0) return 'keyBlank'
  if (ENV_LINE.test(draft)) return 'keyIllegalCharacters'
  const first = draft[0]
  if (QUOTES.includes(first as (typeof QUOTES)[number]) && draft.length > 1 && draft.endsWith(first)) {
    return 'keyIllegalCharacters'
  }
  if (!LEGAL_API_KEY.test(draft)) return 'keyIllegalCharacters'
  return undefined
}
