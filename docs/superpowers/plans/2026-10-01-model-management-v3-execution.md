# 模型管理 v3 实施计划（dsh 对齐：形态重构 + 完整凭据层）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 逐任务实施。Steps 用 checkbox（`- [ ]`）跟踪。
> **代码密度说明（沿用 v2 计划先例，有意偏离 writing-plans 全代码惯例）**：executor 与作者同仓同语；
> 本计划给**契约 + 完整测试代码 + 关键实现片段**；样板 JSX 由 executor 按 spec §一/§二 与既有
> NF 组件惯例写出。凡标「编译驱动」的步骤，以 tsc 报错为索引逐点修正，禁止用 `as any` 绕过。

**Goal:** 设置页模型管理改为 dsh 形态（紧凑行 + 单开行内编辑卡 + 卡内模型目录三态 + 保存前发现），
配套完整凭据层（独立存储 / 只写 / 引用名 / 环境变量优先 / 存量迁移），视觉一律 NF 家族。

**Architecture:** 新增 `electron/credentials/`（store/resolve/migrate）+ `credential:*` IPC；
数据模型加 `apiKeyRef`/`inputTypes`/`modelNames?`（三态）/providers.json v2（带 revision）；
主进程统一切到「请求时 resolve」；渲染层改只写；UI 由 `ProviderRowList` + `ProviderEditorCard` +
`ModelCatalogEditor` + `AddProviderCard` 承载（`ModelProviderCard` 退役）。

**Tech Stack:** Electron 41 + React 19 + zustand + Radix + Vitest；加密复用
`electron/utils/secure-config.ts`（`ENC:` 前缀 + safeStorage / `ENC:B64:` 降级）。

**Spec:** `docs/superpowers/specs/2026-10-01-model-management-v3-design.md`（§1 视觉硬约束、§2 形态、
§3 数据、§4 凭据层、§5 机制表、§9 测试验收）

## Global Constraints

- **视觉一律 NF 家族**（spec §1）：`--color-*` 令牌 / 行片 32px / ui 组件 / ui/Disclosure / ui/Dialog /
  aria-label / 相对叠加 hover——不搬 dsh 的 CSS Modules 与 primitives。
- **id 形状不动**：派生 id 仍为 `{accountId}::{modelName}`；路由 / 默认模型 / 会话引用零变化。
- **明文永不落盘、永不跨境**（T5 后由类型保证）：请求参数里的 `apiKey` 字段一律是
  **一次性草稿值**（`apiKeyDraft` 语义），落盘类型不含该字段。
- **三门禁每任务跑，退出码直查**：`pnpm run typecheck && pnpm run lint && pnpm run test`，
  管道场景用 `> /tmp/v3.log 2>&1; echo $?` 显式查码（`| tail` 会把退出码变成 0）。
- i18n 三语（zh-CN / en-US / ru-RU）随任务就近入 `src/shared/locale-data/` 对应分片（settings/error）。
- 提交信息 `<type>: <描述>`；每任务一提交；不推送（推送需用户显式指令）。
- 加密/存储复用既有件：`secure-config.ts`、`config-utils.ts` 的 `readJsonFile`/`writeJsonFile`（原子写）、
  `guardedHandle`（`electron/security/ipc-guard.ts`）。

## Review Focus

1. **半迁移崩溃 → 幂等续跑**：只在写 credentials.json 后崩溃、文件未清 → 重跑必须收敛到同一终态（T4 测试 4）。
2. **多账户环境变量影子只命中同名 ref**：`OPENAI_API_KEY` 被 shell 设置时，`OPENAI_API_KEY_2` 不受影响（T1 测试 5）。
3. **safeStorage 解密失败不崩**：密文损坏/换机器 → resolve 返回 undefined + 错误日志，请求报「无 key」而非崩溃（T1 测试 6）。
4. **删光目录行 = 恢复默认**：`modelNames: []` 与 undefined 同义（继承全集）——防止用户删行后目录空掉（T2 测试 3）。
5. **两窗并发保存 → conflict 拒绝**：编辑卡打开期间另一窗口保存 → 本窗提交被拒 + 草稿保留（T2 测试 6；UI 提示在 T6）。

---

### Task 1: 凭据层模块 + IPC

**Files:**
- Create: `src/shared/credential-rules.ts`（纯函数：ref 派生 + key 校验；主/渲染共用）
- Create: `electron/credentials/store.ts`（credentials.json 读写 + 进程内缓存）
- Create: `electron/credentials/resolve.ts`（resolve / describe）
- Create: `electron/controllers/credential-controller.ts`
- Modify: `electron/utils/config-utils.ts`（加 `CREDENTIALS_CONFIG_PATH`）
- Modify: `src/shared/ipc-channels.ts`（`CredentialInfo` 类型 + `CredentialChannels` 通道）
- Modify: `src/shared/ipc-policy.ts`（三条 `credential:` 通道，`authority: 'network-secret'`）
- Create: `src/shared/credential-rules.test.ts`
- Create: `electron/credentials/credentials.test.ts`

**Interfaces:**
- Produces（后续任务全部依赖这些名字）：
  - `deriveCredentialRef(provider: string, taken: ReadonlySet<string>): string` —— `<PROVIDER>_API_KEY`，
    非字母数字 → `_`，`custom` → `CUSTOM`；占用则 `_2`、`_3`…
  - `apiKeyFailure(draft: string): 'keyBlank' | 'keyIllegalCharacters' | undefined`
    （对 **trim 后**值判：trim 后空 → keyBlank；`^[A-Z][A-Z0-9_]*=[^=]` 行 / 引号包裹 / 非 `^[\x21-\x7E]+$` → keyIllegalCharacters）
  - `CredentialInfo = { configured: boolean; source?: 'env' | 'store'; writable: boolean }`
  - `describeCredentials(refs: string[]): Record<string, CredentialInfo>`（**永不回传值**）
  - `resolveCredential(ref: string | undefined): string | undefined`（env 非空优先 → store；**每次调用即读**）
  - `readCredentialFile()/writeCredentialFile()`（`{version:1, refs: Record<string,string>}`，值为 `ENC:` 密文）
  - 测试辅助：`__setCredentialFileForTest(file)`（文件层注入）、`__setStoredForTest(map)`（内存缓存注入）
- 通道：`credential:describe`（`refs: string[]`）、`credential:set`（`ref, value`）、
  `credential:unset`（`ref`）；set/unset 返回 `{success, error?}`；set 校验失败/环境变量影子 → `success:false`。

- [ ] **Step 1: 写失败测试（credential-rules）**

```ts
// src/shared/credential-rules.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCredentialRef, apiKeyFailure } from './credential-rules'

describe('deriveCredentialRef', () => {
  it('词干大写 + 非字母数字转下划线', () => {
    expect(deriveCredentialRef('openai', new Set())).toBe('OPENAI_API_KEY')
    expect(deriveCredentialRef('zai-coding-cn', new Set())).toBe('ZAI_CODING_CN_API_KEY')
    expect(deriveCredentialRef('custom', new Set())).toBe('CUSTOM_API_KEY')
  })
  it('占用时递增去重（同一 provider 多账户）', () => {
    const taken = new Set(['OPENAI_API_KEY'])
    expect(deriveCredentialRef('openai', taken)).toBe('OPENAI_API_KEY_2')
    taken.add('OPENAI_API_KEY_2')
    expect(deriveCredentialRef('openai', taken)).toBe('OPENAI_API_KEY_3')
  })
})

describe('apiKeyFailure', () => {
  it('空串通过（= 不提供）；纯空白拒绝', () => {
    expect(apiKeyFailure('')).toBeUndefined()
    expect(apiKeyFailure('   ')).toBe('keyBlank')
  })
  it('拒绝 NAME=value 行与引号包裹', () => {
    expect(apiKeyFailure('OPENAI_API_KEY=sk-abc')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('"sk-abc"')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure("'sk-abc'")).toBe('keyIllegalCharacters')
  })
  it('拒绝非可打印 ASCII（含中文）；边缘空白是粘贴噪声（trim 后判定）', () => {
    expect(apiKeyFailure('sk-密钥')).toBe('keyIllegalCharacters')
    // 2026-10-01 裁定（trim-first，照 dsh；spec §4.4 修订版）：\t 属边缘空白，trim 后有效
    expect(apiKeyFailure('sk-abc\t')).toBeUndefined()
    expect(apiKeyFailure(' sk-abc ')).toBeUndefined()
  })
  it('正常 key 通过（含 sk- 前缀与 base64 形）', () => {
    expect(apiKeyFailure('sk-proj-abcDEF123')).toBeUndefined()
    expect(apiKeyFailure('ABCD==efgh')).toBeUndefined() // 全大写 + == 结尾不误判 env 行
  })
})
```

- [ ] **Step 2: 跑测试确认失败**：`npx vitest run src/shared/credential-rules.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 `credential-rules.ts`**

```ts
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

export type ApiKeyFailure = 'keyBlank' | 'keyIllegalCharacters'

export function deriveCredentialRef(provider: string, taken: ReadonlySet<string>): string {
  const stem = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  if (!taken.has(stem)) return stem
  for (let n = 2; ; n++) {
    const candidate = `${stem}_${String(n)}`
    if (!taken.has(candidate)) return candidate
  }
}

export function apiKeyFailure(draft: string): ApiKeyFailure | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value)) return 'keyIllegalCharacters'
  const first = value[0]
  if ((first === '"' || first === '\'' || first === '`') && value.length > 1 && value.endsWith(first)) {
    return 'keyIllegalCharacters'
  }
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}
```

- [ ] **Step 4: 写失败测试（credentials store/resolve）**

```ts
// electron/credentials/credentials.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFrom, describeFrom } from './resolve'
import { readCredentialFile, __setCredentialFileForTest } from './store'

// 纯核心以注入源测试，避免触盘；store 的文件层另有 1 条 IO 往返用例
describe('resolve（env 优先）', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name]
  const stored = (vars: Record<string, string>) => (ref: string) => vars[ref]

  it('env 非空 → 命中且 source=env', () => {
    expect(resolveFrom('OPENAI_API_KEY', env({ OPENAI_API_KEY: 'sk-env' }), stored({ OPENAI_API_KEY: 'sk-store' })))
      .toEqual({ value: 'sk-env', source: 'env' })
  })
  it('env 影子只命中同名 ref（多账户）：_2 不受影响', () => {
    expect(resolveFrom('OPENAI_API_KEY_2', env({ OPENAI_API_KEY: 'sk-env' }), stored({ OPENAI_API_KEY_2: 'sk-2' })))
      .toEqual({ value: 'sk-2', source: 'store' })
  })
  it('env 为空串/未设 → 回落 store；两者皆无 → undefined', () => {
    expect(resolveFrom('X', env({ X: '  ' }), stored({ X: 'sk' }))).toEqual({ value: 'sk', source: 'store' })
    expect(resolveFrom('Y', env({}), stored({}))).toBeUndefined()
  })
  it('密文损坏（解密抛错）→ undefined 不崩', () => {
    const broken = () => { throw new Error('decrypt failed') }
    expect(() => resolveFrom('Z', env({}), broken)).not.toThrow()
    expect(resolveFrom('Z', env({}), broken)).toBeUndefined()
  })
  it('describe：configured/source/writable（env 影子 writable=false）', () => {
    const d = describeFrom(['A', 'B'], env({ A: 'sk-a' }), stored({ B: 'sk-b' }))
    expect(d.A).toEqual({ configured: true, source: 'env', writable: false })
    expect(d.B).toEqual({ configured: true, source: 'store', writable: true })
  })
})

describe('store 文件层', () => {
  it('写→读往返（值以 ENC: 前缀落盘）', async () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    const { setStoredValue, readCredentialValue } = await import('./store')
    setStoredValue('K', 'sk-123')
    expect(readCredentialValue('K')).toBe('sk-123')
    expect(JSON.stringify(file)).toContain('ENC:')
    expect(JSON.stringify(file)).not.toContain('sk-123')
  })
})
```

- [ ] **Step 5: 实现 `store.ts` / `resolve.ts` / controller / 通道 / 策略**

```ts
// electron/credentials/resolve.ts —— 纯核心 + 薄包装
export interface SourceResult { value: string; source: 'env' | 'store' }
export type EnvSource = (name: string) => string | undefined
export type StoredSource = (ref: string) => string | undefined

export function resolveFrom(ref: string, env: EnvSource, stored: StoredSource): SourceResult | undefined {
  const envValue = env(ref)
  if (envValue !== undefined && envValue.trim().length > 0) return { value: envValue, source: 'env' }
  try {
    const value = stored(ref)
    if (value !== undefined && value.trim().length > 0) return { value, source: 'store' }
  } catch { /* 解密失败：按未配置处理（Review Focus 3） */ }
  return undefined
}
export function describeFrom(refs: readonly string[], env: EnvSource, stored: StoredSource): Record<string, CredentialInfo> { /* 逐 ref：env 命中 → {configured:true,source:'env',writable:false}；store 命中 → source:'store',writable:true；无 → {configured:false,writable:env 未影子} */ }
export function resolveCredential(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  return resolveFrom(ref, (n) => process.env[n], readCredentialValue)?.value
}
// store.ts：CREDENTIALS_CONFIG_PATH 走 config-utils；内存缓存 + writeCredentialFile 原子写；值进出一律 encryptApiKey/decryptApiKey（secure-config）
// credential-controller.ts：guardedHandle 三枚；set 先 apiKeyFailure 校验 → env 影子（resolveFrom source==='env'）→ 拒绝
```

- [ ] **Step 6: 跑全部相关测试**：`npx vitest run src/shared/credential-rules.test.ts electron/credentials/credentials.test.ts` → PASS。
- [ ] **Step 7: 三门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/shared/credential-rules.ts src/shared/credential-rules.test.ts \
  electron/credentials/ electron/controllers/credential-controller.ts \
  electron/utils/config-utils.ts src/shared/ipc-channels.ts src/shared/ipc-policy.ts
git commit -m "feat(credentials): 凭据层模块——ref 派生/校验/resolve/describe + credential: IPC"
```

---

### Task 2: 数据模型与写入层（apiKeyRef / inputTypes / modelNames 三态 / providers.json v2 / 写队列）

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`ProviderAccount` 加 `apiKeyRef?` `displayName?`、`modelNames?`；
  `ModelProfile` 加 `apiKeyRef?` `inputTypes?`）
- Modify: `src/shared/provider-presets.ts`（加 `builtinCatalogFor(provider): string[]`）
- Modify: `src/shared/provider-accounts.ts`（`syncAccountModels` 三态 + `apiKeyRef` 传递）
- Create: `electron/utils/config-write-queue.ts`（`serialize(key, task)`）
- Modify: `electron/utils/config-utils.ts`（`readProvidersFile()`/`writeProvidersFile()` v2 + 兼容旧数组）
- Modify: `electron/controllers/llm-controller.ts`（save-provider 分配 ref + revision 门控 + 队列；delete-provider 走队列）
- Test: `src/shared/provider-accounts.test.ts`（补三态用例）、`electron/utils/config-write-queue.test.ts`（新）
- Test: `electron/controllers/llm-controller.providers.test.ts`（新：ref 分配/冲突）

**Interfaces:**
- `builtinCatalogFor(provider: string): string[]` —— `preset.models` 名 ∪ `preset.embeddingModels` ∪
  `PI_AI_MODEL_SPECS[provider]` 的键（顺序：手写 models → embeddingModels → 生成表键；全程去重，先到者保留原位）。
- `syncAccountModels(account, existing, defaults)`：`account.modelNames === undefined || length === 0` →
  wanted = `builtinCatalogFor(account.provider)`；否则现语义。派生条目凭据副本 = `{provider, protocol, apiKey, baseUrl, apiKeyRef: account.apiKeyRef}`
  （`apiKey` 过渡保留至 T5）。
- `readProvidersFile(): { revision: number; accounts: ProviderAccount[] }`（旧数组形 → `{revision: 0, accounts}`）；
  `writeProvidersFile(state)` 写 v2。
- `mutateProviders(expectedRevision: number | undefined, fn)` → `{kind:'written', revision} | {kind:'conflict'} | {kind:'failed', error}`；
  内部 = `serialize('providers', ...)` 读→校 revision→写 revision+1。
- `llm:save-provider` args 加第 3 参 `expectedRevision?: number`；返回加 `{ revision?: number; conflict?: boolean }`。

- [ ] **Step 1: syncAccountModels 三态测试（RED）**

```ts
// src/shared/provider-accounts.test.ts 追加
it('modelNames 缺省/空数组 = 继承内置目录全集', () => {
  const account: ProviderAccount = { id: 'a1', provider: 'openai', protocol: 'openai', apiKey: '', baseUrl: '', modelNames: [] }
  const out = syncAccountModels(account, [], (n) => presetModelDefaults(account.provider, n))
  expect(out.map(m => m.modelName)).toEqual(builtinCatalogFor('openai')) // 名序一致
  expect(out.every(m => m.apiKeyRef !== undefined)).toBe(true)
})
it('恢复默认（undefined）与空数组同义', () => {
  const account = { ...base, modelNames: undefined }
  expect(syncAccountModels(account, [], defaults).length).toBe(builtinCatalogFor('openai').length)
})
it('自定义清单只含所列模型（现语义零变化）', () => { /* 现有用例保持通过 */ })
```

- [ ] **Step 2: 实现三态 + `builtinCatalogFor`**；跑 `npx vitest run src/shared/provider-accounts.test.ts` → PASS。
- [ ] **Step 3: 写队列 + providers v2 测试（RED）**

```ts
// electron/utils/config-write-queue.test.ts
it('同 key 串行：慢任务未完成前第二个不开始', async () => {
  const order: string[] = []
  const p1 = serialize('k', async () => { await new Promise(r => setTimeout(r, 20)); order.push('a') })
  const p2 = serialize('k', () => { order.push('b') })
  await Promise.all([p1, p2])
  expect(order).toEqual(['a', 'b'])
})
it('任务抛错不断链', async () => {
  await expect(serialize('k', () => { throw new Error('x') })).rejects.toThrow('x')
  await expect(serialize('k', () => 1)).resolves.toBe(1)
})
```

```ts
// llm-controller.providers.test.ts（用 vi.mock 打桩 config-utils 的文件层）
it('save-provider 为新账户分配 apiKeyRef（去重）', async () => { /* 两次保存同 provider 不同账户 → OPENAI_API_KEY / OPENAI_API_KEY_2 */ })
it('expectedRevision 不符 → conflict，文件不被写', async () => { /* 先保存一次使 revision=1；再带 expectedRevision=0 提交 → conflict */ })
```

- [ ] **Step 4: 实现队列 + `readProvidersFile/writeProvidersFile` + save-provider 改造**；跑测试 → PASS。
- [ ] **Step 5: 三门禁 + 提交** `feat(llm): 数据模型 v3——apiKeyRef/inputTypes/目录三态 + providers.json v2（revision）+ 写队列`。

---

### Task 3: 主进程解析接线（ref 优先、明文回落；零行为变化）

**Files:**
- Modify: `electron/credentials/resolve.ts`（加 `resolveModelKey(profile)`）
- Modify: `electron/controllers/llm-controller.ts`（生成/test/list 三处接到 resolveModelKey）
- Modify: `electron/controllers/embedding-controller.ts`、`electron/controllers/kb-controller.ts`（embedding 取 key 改 resolve）
- Test: `electron/credentials/credentials.test.ts`（补 resolveModelKey 用例）

**Interfaces:**
- `resolveModelKey(profile: { apiKeyRef?: string; apiKey?: string }): string` ——
  `resolveCredential(profile.apiKeyRef) ?? profile.apiKey ?? ''`（**过渡回落**：T4 迁移前 refs 尚未存在，行为零变化；
  T5 后 `apiKey` 字段消失，仅剩 ref 通路）。

- [ ] **Step 1: RED 测试**

```ts
// 测试辅助 __setStoredForTest(map)：注入 store 内存缓存（T1 store.ts 提供，供本用例与 T1 测试共用）
it('resolveModelKey：ref 命中优先于明文', () => {
  __setStoredForTest({ R: 'sk-ref' })
  expect(resolveModelKey({ apiKeyRef: 'R', apiKey: 'sk-plain' })).toBe('sk-ref')
})
it('resolveModelKey：无 ref / ref 未配置 → 回落明文；两者皆无 → 空串', () => {
  expect(resolveModelKey({ apiKey: 'sk-plain' })).toBe('sk-plain')
  expect(resolveModelKey({ apiKeyRef: 'MISSING', apiKey: 'sk-plain' })).toBe('sk-plain')
  expect(resolveModelKey({})).toBe('')
})
```

- [ ] **Step 2: 实现 + 接线**：llm-controller 的生成路径/tест/list 取 key 处、embedding-controller:
  `getEmbeddingConfig`（现 `decryptApiKey(model.apiKey)`）、kb-controller `getEmbeddingConfig`/`getQueryEmbeddingArgs`
  统一改 `resolveModelKey(model)`；`llm:list-provider-models` 的渲染入参（`Pick<...,'apiKey'>`）处
  `apiKey: resolveModelKey(credentials)`。**零行为变化**：此阶段无 refs，全走明文回落。
- [ ] **Step 3: 跑测试 + 全量回归**：`npx vitest run electron/credentials` + `pnpm run test` → 全绿（无行为变化）。
- [ ] **Step 4: 三门禁 + 提交** `refactor(llm): 主进程密钥解析统一走 resolveModelKey（ref 优先/明文回落）`。

---

### Task 4: 迁移（备份 / 幂等 / 懒迁移）

**Files:**
- Create: `electron/credentials/migrate.ts`（纯核心 `planMigration` + IO 壳 `runCredentialMigration`）
- Modify: `electron/main.ts`（`await migrateLegacyDirs()` 之后调用）
- Modify: `electron/controllers/llm-controller.ts`（`loadModelConfigs`/`readProvidersFile` 发现非空 apiKey → 懒迁移同函数）
- Modify: `electron/controllers/credential-controller.ts`（no-op 占位不必要；由 main 触发）
- Modify: `src/components/settings/ModelForm.tsx`（测试按钮 gating 过渡微调：`(!model.apiKey && !model.apiKeyRef && ...)`）
- Modify: `src/components/settings/ProviderAccountsSection.tsx`（`listProviderModels` 入参带 `apiKeyRef: draft.apiKeyRef`）
- Test: `electron/credentials/migrate.test.ts`（新）

**Interfaces:**
- `planMigration(accounts, models, storedRefs): { refs: Record<string,string>; accounts; models; changed: boolean }`
  —— 纯函数；`accounts/models` 里非空 `apiKey`（`ENC:` 或明文）→ 分配 ref（沿用已有 `apiKeyRef` 或
  `deriveCredentialRef`）→ `refs[ref] = encryptApiKey(值)`、条目 `apiKey: ''` + `apiKeyRef: ref`。
  **`changed = 是否存在非空 apiKey`**（幂等判据）。
- `runCredentialMigration()`：读两文件（原始 IO）→ plan → 无变化直接 return →
  首次备份 `providers.json`/`models.json` → `*.pre-credentials.bak`（仅当 .bak 不存在）→
  合并写 credentials.json → 写两文件。全程 try/catch（失败 log + 保留原状，下次再试）。

- [ ] **Step 1: RED 测试（含 Review Focus 1）**

```ts
// electron/credentials/migrate.test.ts
it('账户与手工条目明文/密文 key 全量搬入 refs，文件字段清空', () => {
  const accounts = [{ id: 'a1', provider: 'openai', protocol: 'openai', apiKey: 'ENC:xxx', baseUrl: '', modelNames: ['gpt-4o'] }]
  const models = [{ id: 'm1', provider: 'deepseek', apiKey: 'sk-plain', /* 其余字段省略 */ } as ModelProfile]
  const plan = planMigration(accounts, models, {})
  expect(plan.accounts[0].apiKey).toBe('')
  expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY')
  expect(plan.models[0].apiKeyRef).toBe('DEEPSEEK_API_KEY')
  expect(plan.refs['OPENAI_API_KEY']).toBe('ENC:xxx')
  expect(plan.refs['DEEPSEEK_API_KEY']).toMatch(/^ENC:/) // 明文被加密
})
it('幂等：终态再跑 changed=false，refs 不新增', () => {
  const plan = planMigration([{ ...done, apiKey: '', apiKeyRef: 'OPENAI_API_KEY' }], [], { OPENAI_API_KEY: 'ENC:xxx' })
  expect(plan.changed).toBe(false)
})
it('半迁移崩溃续跑：refs 已写、文件未清 → 重跑只清文件（不重复分配）', () => {
  const plan = planMigration([{ ...account, apiKey: 'ENC:xxx', apiKeyRef: 'OPENAI_API_KEY' }], [], { OPENAI_API_KEY: 'ENC:xxx' })
  expect(plan.changed).toBe(true)
  expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY') // 沿用，不新开 _2
})
it('备份只做一次（.bak 已存在则跳过）与 IO 壳失败静默', async () => { /* 文件层用 tmp 目录实测 */ })
```

- [ ] **Step 2: 实现 migrate.ts + main.ts 接线 + 懒迁移钩子 + 两处过渡微调**（`pnpm run typecheck` 定位全部编译点）。
- [ ] **Step 3: 迁移实测（本机真实数据）**：`pnpm run dev` 起一次 → 检查
  `~/.novelforge/credentials.json` 生成、两文件无 `apiKey` 值、`.bak` 存在、应用内设置页可用（旧 key 生效）。
- [ ] **Step 4: 全量测试 + 三门禁 + 提交** `feat(credentials): 存量明文迁移——分配 refs/加密入库/备份/幂等 + 懒迁移`。

---

### Task 5: 渲染层剥离 + 类型删 apiKey（大扫除）

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`ModelProfile`/`ProviderAccount` **删 `apiKey`**；
  `llm:save-model` args → `[model, apiKeyDraft?: string]`；`llm:test-connection` → `[model, apiKeyDraft?: string]`；
  `llm:save-provider` → `[account, modelSpecs?, expectedRevision?, apiKeyDraft?]`；
  `llm:list-provider-models` 入参 → `{ provider, protocol, baseUrl, apiKeyRef?, apiKeyDraft? }`）
- Modify: `electron/controllers/llm-controller.ts`（`llm:list-models`/`llm:list-providers` **返回值剥离**；
  save-model/save-provider 接 `apiKeyDraft` → `credential:set` 等价内部调用；test/list 用 `apiKeyDraft ?? resolveModelKey`）
- Modify: `electron/controllers/health-check.ts`（`health:check-llm` 加可选 `apiKeyRef`，无 draft 时 resolve）
- Modify: `src/stores/llm-store.ts`（action 签名同步；`listProviderModels`/`testConnection`/`saveModel`/`saveProvider`）
- Modify（过渡补丁，T6-T9 将删除/重写）：`ModelProviderCard.tsx`（凭据状态由 `describe` 传入）、
  `ProviderAccountsSection.tsx`、`ModelPickerDialog.tsx`、`ModelForm.tsx`（local `keyDraft` 取代 `model.apiKey` 绑定与 gating）
- Test: 全仓 `apiKey` 残留编译驱动修正（`src/**/*.test.ts(x)`、`electron/**/*.test.ts`，共 ~47 处）

- [ ] **Step 1: 类型删字段 → `pnpm run typecheck` 收集全部报错点（这就是清单）**
- [ ] **Step 2: 逐点修正（禁止 `as any`）**。要点：
  - `loadModelConfigs()` 返回**不含** key 的条目（类型即保证）；`saveModelConfigs` 不再加密（字段没了）
  - 生成路径密钥 = `apiKeyDraft ?? resolveModelKey(profile)`（草稿一次性，typed key wins）
  - `llm:list-models` 返回前 `delete (m as Record<string, unknown>).apiKey`（防御旧文件残留——迁移失败兜底**不把值交渲染层**）
  - 渲染层 gating：`!model.apiKey` → `!model.apiKeyRef`（表单本地另有 `keyDraft` 时再 `|| keyDraft`）
- [ ] **Step 3: 全量测试（含 47 处测试 mock/fixture 修正）**：`pnpm run test` 全绿。
- [ ] **Step 4: 三门禁 + 提交** `refactor(llm): 渲染层剥离密钥——类型删 apiKey、请求参数改一次性 apiKeyDraft`。

---

### Task 6: 行列表 + 编辑卡（紧凑行 / 单开 / 只写 / describe）

**Files:**
- Create: `src/components/settings/ProviderRowList.tsx`（行列表容器：行 + 添加按钮 + 删除确认 + describe 批量）
- Create: `src/components/settings/ProviderEditorCard.tsx`（行内编辑卡：只写密钥 + 自定义设置 + 应用/取消）
- Create: `src/components/settings/CredentialDot.tsx`（三态灯：`role="img"` + aria-label + tooltip）
- Delete: `src/components/settings/ModelProviderCard.tsx`
- Modify: `src/components/settings/ModelListSection.tsx`（薄容器改挂 `ProviderRowList`；保留「其他」卡占位）
- Modify: `src/stores/llm-store.ts`（加 `credentialInfo: Record<string, CredentialInfo>` + `describeCredentials()` 动作）
- Test: `ProviderEditorCard.test.tsx`（新）、`ProviderRowList.test.tsx`（新）

**Interfaces:**
- `ProviderRowList`（无 props，store 驱动）：行 = 名称 +（`自定义` 标签）+ `CredentialDot`（describe 结果）
  + [编辑][删除]；单开语义 = `editingId: string | null`；切换有脏草稿 → `confirm(t('model.discardEdit'))`。
- `ProviderEditorCard` props：`{ account: ProviderAccount; revision: number; keyInfo: CredentialInfo | undefined; onClose: (changed: boolean) => void }`。
  - 只写密钥框：`value={keyDraft}`（初值恒 `''`）+ placeholder 三态（env 锁定 / 已配置 / 输入密钥；
    ollama → 留空=不使用密钥）+ `apiKeyFailure(keyDraft)` 行内红字。
  - 应用顺序（spec §4.7）：`saveProvider(patch, undefined, revision, keyDraft.trim() || undefined)` →
    成功清 `keyDraft`；`conflict` → toast(`model.conflictReload`) + 保留草稿；失败 → toast + 保留草稿。
  - 删除（行级）顺序：`ipc credential:unset(ref)`（失败 → 中止 + toast）→ `deleteProvider`（含引用检查前置不变）。
  - 保存通知：成功后 `role="status" aria-live="polite"` 显示「已保存 {name}」（reload 后取名）。
- 视觉（NF）：行片 32px；按钮 `ui/Button`；卡片沿用 NF 卡片边框/`--color-panel`；切卡动画走 `ui/Disclosure` 惯例。

- [ ] **Step 1: RED 组件测试（契约）**

```tsx
it('单开：点第二行「编辑」→ 第一行卡收起（有脏草稿先 confirm）', ...)
it('只写：卡打开时密钥框为空，placeholder=「已配置（留空保持不变）」', ...)
it('应用：env 影子时（writable=false）密钥框禁用 + placeholder=「由环境变量 X 提供（只读）」', ...)
it('conflict：saveProvider 返回 conflict → 卡不关 + toast + 草稿保留', ...)
it('删除：credential:unset 失败 → deleteProvider 未被调用', ...)
```

- [ ] **Step 2: 实现三组件 + ModelListSection 挂载 + describe 接线 + 删 `ModelProviderCard`**（编译驱动清 import）。
- [ ] **Step 3: 三门禁 + 提交** `feat(settings): 供应商行 + 行内编辑卡（只写密钥/三态灯/单开/冲突提示）`。

---

### Task 7: 目录区（三态 / 行内展开 / K-M / 输入类型 / 恢复默认）

**Files:**
- Create: `src/shared/capacity.ts`（`parseCapacity` / `formatCapacity` 纯函数）
- Create: `src/components/settings/ModelCatalogEditor.tsx`
- Create: `src/components/settings/ModelCatalogRow.tsx`（行 + 行内展开）
- Create: `src/components/settings/ModelInputTypes.tsx`（文本/图片 checkbox，NF 原生 accent 惯例）
- Modify: `src/components/settings/ProviderEditorCard.tsx`（自定义设置内挂目录区）
- Modify: `electron/controllers/llm-controller.ts` + `src/shared/provider-accounts.ts`
  （`llm:save-provider` 加 `modelOverrides?: Record<string, {name?, contextWindow?, maxTokens?, inputTypes?}>`；
  `syncAccountModels` 合并 overrides 到派生条目，保留其它用户字段）
- Test: `src/shared/capacity.test.ts`、`ModelCatalogEditor.test.tsx`

**Interfaces:**
- `parseCapacity(text): number | undefined`（空 → undefined=继承；`/^(\d+(?:\.\d+)?)([km])?$/i`；`k`=1000、`m`=1e6；
  非法 → `NaN`）与 `formatCapacity(value)`（整千 → `256K`、整百万 → `1M`，否则原样）。
- 目录区 state：`models: ModelDraft[] | undefined`（**undefined = 继承**）；meta 文案 `modelsInherited/modelsCustomized`；
  「恢复默认模型」= 置 undefined（仅自定义态可见）；任何增删改 → 先物化（继承态先展开为全集行）。
- 行：`id`/显示名 两输入常显 + [⌄][🗑]；展开 = 上下文窗口 / 最大输出 token（K-M 文本 + placeholder=继承值格式化）
  + 输入类型（至少留一种：仅剩一种时该框禁用）+ 用途标签（生成/向量，只读）；**显示层倒序**（操作按行 id/名字定位）。
- 校验：id 非空（trim 后）/去重（trim 比较）→ 行号红字 + 禁应用；容量 `NaN` → 行号红字 + 禁应用。
- overrides 管线：应用时把行上改过的字段（相对内置规格/既有条目的差异）随 `modelOverrides` 一并提交。

- [ ] **Step 1: RED 测试**

```ts
// capacity.test.ts
it('256K=256000 / 1m=1000000 / 131072 原样 / 空=undefined / 乱串=NaN', ...)
it('formatCapacity 往返：1000000→"1M"、256000→"256K"、131072→"131072"', ...)
```
```tsx
// ModelCatalogEditor.test.tsx
it('继承态：显示全部内置模型 + meta「默认模型目录」，无「恢复默认模型」', ...)
it('删光行（自定义态）→ 提交 modelNames 为 []；重开显示继承（Review Focus 4 的 UI 面）', ...)
it('容量非法：256KK → 行号红字 + 应用禁用', ...)
it('id 重复（trim 后同名）→ 第二行红字 + 应用禁用', ...)
```

- [ ] **Step 2: 实现 + overrides 管线 + 测试**；跑 `npx vitest run src/shared/capacity.test.ts src/components/settings/ModelCatalogEditor.test.tsx` → PASS。
- [ ] **Step 3: 三门禁 + 提交** `feat(settings): 模型目录区——三态/行内展开/K-M 容量/输入类型/恢复默认`。

---

### Task 8: 获取模型（内置直答 + 候选规则 + Modal 改造）

**Files:**
- Modify: `electron/controllers/llm-controller.ts`（`llm:list-provider-models`：`builtinCatalogFor(provider)` 非空 →
  **免网络直答**（名字 × `presetModelDefaults` 容量；输入类型暂缺 → undefined）；否则走既有端点探测）
- Modify: `src/components/settings/ModelPickerDialog.tsx`（候选规则 + NF 化）
- Modify: `ModelCatalogEditor.tsx`（「获取可用模型」入口 + 采纳合并）
- Test: `ModelPickerDialog.test.tsx`（改）、llm-controller 测试（直答免网络用例）

**Interfaces:**
- 候选：`LLMModelCandidate` 加 `name?: string; inputTypes?: ('text'|'image')[]`。
- 规则（spec §5）：新候选**默认勾选**；已存在**默认不勾、可勾**；采纳时**已存在行保留用户值**、
  只补齐缺失字段；等宽 id + `title=name`；全选只作用可见、取消全选清**全部**；手工输入行常驻。
- 采纳输出：`AdoptedModel[] = { name; displayName?; contextWindow?; maxTokens?; inputTypes? }[]` →
  目录编辑器物化合并（追加在末尾，显示层倒序自然置顶）。

- [ ] **Step 1: RED 测试**

```ts
it('内置目录 provider（openai）免网络：不调 fetch，直答含容量', ...) // llm-controller 测试
```
```tsx
it('新候选默认勾选、已存在默认不勾（可勾）', ...)
it('采纳已存在的模型 → 不覆盖其已改容量（保留用户值）', ...)
it('全选只加可见；「取消全选」清全部勾选', ...)
```

- [ ] **Step 2: 实现 + 测试**；核对端点探测的 4MB 上限与 401/403 文案（缺则补，`provider.fetch*` key 就近扩展）。
- [ ] **Step 3: 三门禁 + 提交** `feat(settings): 获取可用模型——内置目录直答 + 候选规则（默认勾选/保留用户值）`。

---

### Task 9: 添加卡 + 首次运行 +「其他」卡

**Files:**
- Create: `src/components/settings/AddProviderCard.tsx`（底部两模式卡：第三方目录 / 自定义 API）
- Modify: `src/components/settings/ProviderRowList.tsx`（挂添加卡 + 首次运行默认选中）
- Modify: `src/components/settings/ModelForm.tsx`（「其他」卡专用：凭据只写化 + 测试按钮走 `apiKeyDraft`）
- Modify: `ModelListSection.tsx`（「其他」卡改由新行组件承载行编辑）
- Delete: `ProviderAccountsSection.tsx`（`blockingReferences`/`collectReferenceSources` 迁至
  `src/components/settings/model-references.ts`，引用方同步）
- Test: `AddProviderCard.test.tsx`（新）

**Interfaces:**
- 两模式分段（`ui/SegmentedControl`）+ 说明行；**面板首访后保持挂载**（切模式不丢草稿）；
  写入/探测中锁定切换；只剩一种模式 → 以该模式为标题直接显示表单。
- 目录模式 = provider 下拉 + `ProviderEditorCard`（hideTitle）；自定义模式 = 路由字段
  （显示名/端点/协议产品名/密钥/目录区，含获取）。`displayName` 仅自定义账户可编。
- 首次运行：无任何账户 → 空态（保留）+ 点开默认选中第一家有内置目录的预设 + 密钥框聚焦。

- [ ] **Step 1: RED 组件测试**：`it('切换两模式不丢对侧草稿（面板保持挂载）')`、
  `it('探测进行中（busy）时分段切换禁用')`、`it('首次运行默认选中第一家（有目录）且密钥框聚焦')`。
- [ ] **Step 2: 实现 + 拆除 ProviderAccountsSection + 移动 blockingReferences**（编译驱动）。
- [ ] **Step 3: 三门禁 + 提交** `feat(settings): 添加提供商卡（两模式/草稿保持）+ 其他卡收尾`。

---

### Task 10: i18n 收尾 + 走查 + 真机清单

**Files:**
- Modify: `src/shared/locale-data/settings.ts` / `error.ts`（清点本轮全部新 key：
  `credential.*`（placeholder 三态/校验/灯 tooltip）、`modelCatalog.*`（meta/恢复默认/行展开/输入类型/校验行号）、
  `modelPicker.*`（emoji/规则文案）、`model.conflictReload`、`addProvider.*`）
- Modify: `docs/superpowers/specs/2026-10-01-model-management-v3-design.md`（实施记录节：真机结果回填）

- [ ] **Step 1: 三语 key 清点**：`pnpm run gen:tokens` 或 grep 未翻译 key（既有惯用手法）；三语补齐。
- [ ] **Step 2: 全量门禁**：tsc / eslint / `pnpm run test` 全绿（记录最终测试数）。
- [ ] **Step 3: 真机清单落文档**（用户执行）：① 设置页全流程（行/单开卡/只写/灯）② 环境变量优先与只读
  ③ 轮换（改 key → 下次请求生效）④ 恢复默认目录 ⑤ 获取可用模型（内置直答/端点两路）⑥ 迁移后旧账户可用
  ⑦ 删除账户顺序（凭据失败中止可重试）⑧ conflict（两窗并发保存）。
- [ ] **Step 4: 提交** `docs+chore: 模型管理 v3 收尾——i18n 三语 + 走查/真机清单`。

---

## 自审记录（writing-plans 自检）

- **Spec 覆盖**：§2 形态 → T6/T9；§3 数据 → T2；§4 凭据层 → T1/T3/T4；§5 机制表 → T2/T7/T8/T6（revision）；
  §1 视觉约束 → Global Constraints + 各 UI 任务；§7 superseded → T6/T9 的删除清单；§9 验收 → T10。
- **占位符扫描**：无 TBD/TODO；UI 任务为「契约 + 测试 + 要点」，按本仓 v2 计划先例（顶部已声明）。
- **类型一致性**：`deriveCredentialRef`/`apiKeyFailure`/`resolveCredential`/`resolveModelKey`/`apiKeyDraft`/
  `builtinCatalogFor`/`mutateProviders`/`modelOverrides` 全计划同名同构；
  ⚠️ `apiKey` 字段在 T5 前是「存储字段」、T5 后在**请求参数**里是「一次性草稿」（`apiKeyDraft`）——两义已在 Global Constraints 锁死。
- **Review Focus 对号**：1→T4 测试 3；2→T1 测试（resolve env 影子 `_2`）；3→T1 测试（解密抛错）；
  4→T2 测试 1/2 + T7 组件测试；5→T2 测试（conflict）+ T6 组件测试（提示与草稿保留）。
