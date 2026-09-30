/**
 * 凭据库存储层（模型管理 v3 §4.2）—— `~/.novelforge/credentials.json` 读写 + 进程内明文缓存。
 *
 * 形状：`{ version: 1, refs: { [ref]: '<ENC:…>' } }` —— 值一律是 `ENC:` 密文串，
 * 加解密**复用** `electron/utils/secure-config.ts`（safeStorage / DPAPI；不可用时 `ENC:B64:` 降级）。
 *
 * 缓存语义（§4.2「本进程为唯一写者」）：
 *   - 首次读时从盘上加载一次并**解密进内存**；此后读走缓存（避免每次请求都做一次 DPAPI 调用）；
 *   - set/unset 写盘后同步更新缓存 —— 于是「改动在下一次请求生效」（热轮换）无需重读盘；
 *   - **不追求外部手改文件的热感知**（已知限制，写入方只有本进程）。
 *
 * 为什么值出栈要经 `readCredentialValue` 而不是暴露文件内容：调用方拿到的应是明文，
 * 密文串一旦被当明文用（例如发进 HTTP 头）会变成 401 难排查类故障 —— 见 `decryptPlain`。
 */
import { CREDENTIALS_CONFIG_PATH, readJsonFile, writeJsonFile } from '../utils/config-utils'
import { decryptApiKey, encryptApiKey, isPlaintextKey } from '../utils/secure-config'

/** 盘上形状（版本号预留迁移位；当前恒为 1） */
export interface CredentialFile {
  version: 1
  /** ref（环境变量名）→ `ENC:` 密文串 */
  refs: Record<string, string>
}

/** ref → **明文**（进程内缓存；null = 尚未从盘上加载过） */
let cache: Record<string, string> | null = null

/** 测试注入的文件层；`fileInjected` 与 `fileOverride` 分开 —— 注入 `null` 也必须能表达
 *  「文件层就长这样」，否则会退回读真实 `~/.novelforge/credentials.json`（用例污染真实 home） */
let fileInjected = false
let fileOverride: unknown = null

/** 只接受 `{ refs: Record<string,string> }` 里的字符串值；其余（坏 JSON / 手改坏形状）一律丢弃 */
function normalize(raw: unknown): CredentialFile {
  if (!raw || typeof raw !== 'object') return { version: 1, refs: {} }
  const refs = (raw as { refs?: unknown }).refs
  if (!refs || typeof refs !== 'object') return { version: 1, refs: {} }
  const out: Record<string, string> = {}
  for (const [ref, value] of Object.entries(refs as Record<string, unknown>)) {
    if (typeof value === 'string') out[ref] = value
  }
  return { version: 1, refs: out }
}

/**
 * 读凭据文件（**已归一化**；坏 JSON / 形状不符 → 空结构，不抛）。
 *
 * `readJsonFile` 自身对 JSON 解析失败已兜底（返回 fallback + console.warn），
 * 这里再加一层形状归一：`{"refs": "oops"}` 这类「合法 JSON、非法形状」也能安全降级。
 */
export function readCredentialFile(): CredentialFile {
  if (fileInjected) return normalize(fileOverride)
  return normalize(readJsonFile<unknown>(CREDENTIALS_CONFIG_PATH, { version: 1, refs: {} }))
}

/**
 * 写凭据文件（原子写：`writeJsonFile` 的 tmp + rename）。
 *
 * 注入态下**原地更新注入对象**：用例以 `JSON.stringify(注入对象)` 断言落盘形状，
 * 若这里另存副本，断言就看不到写入结果（且会真的落盘到用户 home）。
 */
export function writeCredentialFile(file: CredentialFile): void {
  if (fileInjected) {
    if (fileOverride && typeof fileOverride === 'object') {
      const target = fileOverride as { version?: unknown; refs?: unknown }
      target.version = file.version
      target.refs = file.refs
    }
    return
  }
  writeJsonFile(CREDENTIALS_CONFIG_PATH, file)
}

/**
 * 解密单个密文串；解不开 → `undefined`。
 *
 * ⚠️ `decryptApiKey` 的失败契约是「原样返回入参」（secure-config.ts）——不识别这一点的话，
 * 换机器/密文损坏时会把 `ENC:…` 串当密钥发出去，故障表现从「没有 key」退化成「401 且看不懂」
 * （Review Focus 3：宁可判未配置，也不能把密文当值用）。
 */
function decryptPlain(cipher: string): string | undefined {
  const plain = decryptApiKey(cipher)
  if (plain === cipher && !isPlaintextKey(cipher)) return undefined
  return plain
}

/** 取（必要时加载）明文缓存 */
function ensureCache(): Record<string, string> {
  if (cache) return cache
  const loaded: Record<string, string> = {}
  for (const [ref, cipher] of Object.entries(readCredentialFile().refs)) {
    const plain = decryptPlain(cipher)
    if (plain !== undefined) loaded[ref] = plain
  }
  cache = loaded
  return cache
}

/** 读一个 ref 的明文值（未配置 / 解不开 → undefined） */
export function readCredentialValue(ref: string): string | undefined {
  return ensureCache()[ref]
}

/** 写入一个 ref 的明文值（落盘为密文；同 ref 覆盖） */
export function setStoredValue(ref: string, value: string): void {
  const current = ensureCache()
  const file = readCredentialFile()
  writeCredentialFile({ version: 1, refs: { ...file.refs, [ref]: encryptApiKey(value) } })
  current[ref] = value
}

/** 删除一个 ref（幂等：不存在 → 不写盘、不抛） */
export function unsetStoredValue(ref: string): void {
  const file = readCredentialFile()
  if (!(ref in file.refs)) return
  const refs = { ...file.refs }
  delete refs[ref]
  writeCredentialFile({ version: 1, refs })
  delete ensureCache()[ref]
}

// ===== 测试辅助（brief 锁定的导出面；供本任务用例与 T3 用例共用）=====

/** 注入文件层（同时**清空内存缓存**——换了一份盘上数据，缓存必须失效） */
export function __setCredentialFileForTest(file: CredentialFile): void {
  fileInjected = true
  fileOverride = file
  cache = null
}

/** 注入内存缓存（**明文** map；T3 `resolveModelKey` 用例用） */
export function __setStoredForTest(map: Record<string, string>): void {
  cache = { ...map }
}
