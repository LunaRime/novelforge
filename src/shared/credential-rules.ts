/**
 * 凭据规则纯函数（模型管理 v3 §4.3/§4.4）—— **主/渲染共用，零依赖**。
 *
 * 为什么放 `src/shared/`：`apiKeyFailure` 两边都要用 ——
 * 渲染层（T6 密钥框行内红字）用它在提交前给即时反馈，主进程（`credential:set`）用它做
 * **权威校验**（渲染层可被绕过，主进程这一道不可省）。两处判据必须逐字一致，故单源在这里。
 * `deriveCredentialRef` 目前只有主进程用（T2 创建账户时分配 ref），放同一文件避免规则分裂。
 *
 * 依赖面：只 import `locale` 的 **`TextKey` 类型**（编译期擦除）——运行期仍然零依赖，
 * 主进程可以照常引用本文件（同 `llm-protocols.ts` 的 `labelKey` 先例）。
 */
import type { TextKey } from './locale'

/**
 * 合法密钥字符集：可打印 ASCII（`!`~`~`，**不含空格**）。
 *
 * ⚠️ 判定基准是 **`draft.trim()` 之后的值**（dsh 语义）：首尾空白/换行是从网页或 `.env`
 *   复制粘贴时的**噪声**，不是密钥内容 —— `'sk-abc\t'`、`' sk-abc '` 都应通过，
 *   但值**内部**的空格/控制符/非 ASCII（`'sk-密钥'`、`'sk ab'`）仍一律拒绝。
 *   写入时同样落 trim 后的值（见 `credential:set`），保证「校验通过」与「实际存下」是同一个串。
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
/** `NAME=value` 形（用户误把 `.env` 整行粘进来）：要求 `=` 后有内容且该内容不以 `=` 开头 */
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/
/** 包裹字符：引号（含反引号）成对包裹 = 从配置文件里复制粘贴的形态 */
const QUOTES = ['"', '\'', '`'] as const

/** 拒因码（渲染层据此取 i18n 文案，见 settings 分片 `credential.failure.*`） */
export type ApiKeyFailure = 'keyBlank' | 'keyIllegalCharacters'

/**
 * 凭据通道可能回来的**全部**拒因码：`apiKeyFailure` 的两个 ∪ 主进程侧的 `envShadowed`。
 *
 * 单源在这里的理由：主进程 `credential:set` / `save-provider` 会回 `envShadowed`，
 * 而渲染层若不认识它就会把「环境变量影子」显示成一句技术串 —— 两边各写一份映射必然漂移
 * （T1 评审 minor：T6 手写映射的预警）。
 */
export type CredentialFailure = ApiKeyFailure | 'envShadowed'

/**
 * 拒因码 → i18n key（**只认码**；返回 `undefined` = 不是拒因码）。
 *
 * 调用方拿到 `undefined` 时应把原文（技术错误串：磁盘满/权限…）**原样展示** ——
 * 排障要看得到原文，硬套一句「未知错误」会让界面与日志同时失去线索。
 *
 * ⚠️ 键名与拒因码**同名**（`credential.failure.<code>`），加码时两处一起加
 * （`switch` 的穷尽性由 `CredentialFailure` 联合类型保证）。
 */
export function credentialFailureKey(code: string): TextKey | undefined {
  switch (code as CredentialFailure) {
    case 'keyBlank': return 'credential.failure.keyBlank'
    case 'keyIllegalCharacters': return 'credential.failure.keyIllegalCharacters'
    case 'envShadowed': return 'credential.failure.envShadowed'
    default: return undefined
  }
}

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
 * - trim 后为空（纯空白）→ `keyBlank`（用户想填但没填出内容）
 * - `NAME=value` 行 / 引号包裹 / 含可打印 ASCII 之外的字符 → `keyIllegalCharacters`
 *
 * ⚠️ 后三类判据都作用在 **`draft.trim()`** 上（dsh 语义）——粘贴带来的首尾空白先清掉再判，
 *    详见 `LEGAL_API_KEY` 的说明；调用方**存值也要存 trim 后的串**（否则校验与落库不是同一个值）。
 */
export function apiKeyFailure(draft: string): ApiKeyFailure | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value)) return 'keyIllegalCharacters'
  const first = value[0]
  if (QUOTES.includes(first as (typeof QUOTES)[number]) && value.length > 1 && value.endsWith(first)) {
    return 'keyIllegalCharacters'
  }
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}
