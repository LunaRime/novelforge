# A 档实施计划：工具审批语义 + 批准记忆 + 危险硬拒绝 + 路由动态化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「工具级静态确认」升级为「参数语义级的审批策略」（可固化规则 + workspace 持久批准 + 危险硬拒绝），并把模型路由从「完全静态的 purpose→tier」升级为「可选的动态策略 + 每层多模型」。

**Architecture:** 新增一个**纯函数审批决策层**（`src/services/agent/approval/`），输入 = 工具名 + 参数 + 工具描述 + 已固化规则 + 项目边界，输出 = allow/prompt/deny + risk + 可固化规则提案；持久化落在项目内 `.novelforge/approvals.json`（该目录被 `isProtectedRelativePath` 保护，agent 自身写不进去）；接线点在 `agent-store` 的 `onToolCallConfirmRequired`（唯一能拿到项目路径的地方）。路由侧在既有 `ModelRouter` 上加 tier 覆盖参数，动态策略以 Agent 对话的现有 `mode` 档位为判据（零 LLM 成本），静态映射保持默认。

**Tech Stack:** TypeScript（strict）/ React 19 / Zustand / vitest / 既有 fs IPC（`fs:*`）+ 项目内 JSON 文件

**Spec:** `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md`（§3.1 A 档修订、§7.1-A 条目 A1/A2/A3、§8 第 1 条）；参照实现 = Denova `internal/agents/toolapproval/`（`policy.go` 决策模型 / `rule_proposal.go` 固化边界 / `critical.go` 硬拒绝）

## Global Constraints

- TypeScript strict：`noUnusedLocals` / `noUnusedParameters` 开启，`tsc --noEmit` 必须零错误
- ESLint `--max-warnings 0`，不允许任何 warning
- **所有用户可见文本必须 i18n**（zh-CN / en-US / ru-RU 三语，扁平 key 内联在 `src/shared/locale-data/*.ts`）
- 颜色一律用 CSS 变量（`var(--color-*)`），禁止硬编码色值
- 新增 IPC 通道必须三处同步：`electron/preload.ts` 白名单前缀、`src/shared/ipc-channels.ts` 类型、`src/shared/ipc-policy.ts` 权限项
- 测试命令：`npx vitest run <file>`；全量 `npx vitest run`
- 本计划**不引入** Denova 的 approval mode（ask/write/full-access）三模式——保持"需确认的工具每次都问，除非命中已固化规则"这一既有语义，把模式选择留给后续档位

## Review Focus

- **拒绝后的重试循环**：既有语义是"拒绝 = 以 error observation 回注，模型可换参数重试"。新增规则层后，同一工具同一参数被拒后模型可能反复请求 → 明确"本轮拒绝不产生规则、也不抑制重试"是有意为之；但若模型对**同一 identity** 连续请求 ≥3 次，应视为异常
- **规则失效语义**：规则绑定项目路径。项目被移动/复制/改名后，`.novelforge/approvals.json` 会跟着走 → 规则里的 `projectPath` 与当前路径不符时必须**不匹配**（fail-closed 回到 prompt）
- **危险规则误杀**：`critical_external_credentials` 会把"正文里恰好含 `sk-` 开头片段"的写文件操作拦掉 → 该规则**只作用于 `call_external_api` 的出站内容**，不作用于写文件
- **空层与降级链**：多模型 UI 允许把某层清空；清空后必须走既有 fallback 链（`model-router.ts:118-135`），不得回到已删除的 autoDetectTiers 行为
- **确认等待期内的取消**：`agent-engine.ts:453` 的 `await` 无超时；`cancelGeneration` 会 resolve(false) 清空 pending（`agent-store.ts:1049-1053`）——新增的规则写入必须发生在 resolve 之前还是之后，要有明确顺序（见 Task 4）

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/agent/approval/types.ts` | 决策层全部类型（Decision / Rule / Proposal / Request） | 新建 |
| `src/services/agent/approval/critical.ts` | 危险规则表 + `matchCritical`（fail-closed） | 新建 |
| `src/services/agent/approval/proposal.ts` | 可固化规则提案（哪些工具+参数可固化）+ 规则匹配 | 新建 |
| `src/services/agent/approval/policy.ts` | `evaluateApproval(request): ApprovalDecision` 编排 | 新建 |
| `src/services/agent/approval/store.ts` | workspace 规则持久化（读/写 `.novelforge/approvals.json`） | 新建 |
| `src/services/agent/approval/index.ts` | 对外出口 | 新建 |
| `src/stores/agent-store.ts` | 确认门接线：先查规则 → 命中放行；未命中 → 弹卡（带提案） | 修改 `:832-845` |
| `src/components/panels/agent/ConfirmCard.tsx` | 展示 risk + 规则描述 + 第三按钮「本项目内始终允许」 | 修改 |
| `src/services/llm/model-router.ts` | `route(purpose, tierOverride?)` + `routeStrategy` | 修改 `:44-68/:103-115` |
| `src/components/settings/SettingsModal.tsx` | 每层多模型有序列表 + 动态策略开关 | 修改 `:408-480` |

---

### Task 1: 审批决策类型 + 危险规则（纯函数）

**Files:**
- Create: `src/services/agent/approval/types.ts`
- Create: `src/services/agent/approval/critical.ts`
- Test: `src/services/agent/approval/critical.test.ts`

**Interfaces:**
- Consumes: 无（纯新增）
- Produces: `ApprovalAction` / `ApprovalRisk` / `ApprovalRequest` / `ApprovalDecision` / `CriticalHit`（types.ts）；`matchCritical(toolName: string, args: Record<string, unknown>): CriticalHit | null`（critical.ts）

- [ ] **Step 1: 写失败测试**

```ts
// src/services/agent/approval/critical.test.ts
import { describe, it, expect } from 'vitest'
import { matchCritical } from './critical'

describe('matchCritical 危险硬拒绝（fail-closed）', () => {
  it('写入受保护目录（.novelforge/.git/node_modules）→ 命中', () => {
    expect(matchCritical('write_file', { file_path: '.novelforge/approvals.json' })?.ruleId)
      .toBe('critical_protected_path')
    expect(matchCritical('edit_file', { file_path: 'node_modules/x/index.js' })?.ruleId)
      .toBe('critical_protected_path')
  })

  it('路径逃逸（.. 越界）→ 命中', () => {
    expect(matchCritical('write_file', { file_path: '../../outside.txt' })?.ruleId)
      .toBe('critical_path_escape')
  })

  it('call_external_api 使用绝对 URL（绕过 baseUrl 白名单）→ 命中', () => {
    expect(matchCritical('call_external_api', { path: 'https://evil.example/x', method: 'GET' })?.ruleId)
      .toBe('critical_absolute_url')
    expect(matchCritical('call_external_api', { path: '//evil.example/x', method: 'GET' })?.ruleId)
      .toBe('critical_absolute_url')
  })

  it('call_external_api 出站内容含凭据形态（Bearer / sk- / api_key=）→ 命中', () => {
    expect(matchCritical('call_external_api', { path: '/v1/x', method: 'POST', body: '{"k":"sk-abc123"}' })?.ruleId)
      .toBe('critical_external_credentials')
    expect(matchCritical('call_external_api', { path: '/v1/x', method: 'POST', body: 'Authorization: Bearer eyJhbGciOi' })?.ruleId)
      .toBe('critical_external_credentials')
  })

  it('正常写作操作不命中', () => {
    expect(matchCritical('write_file', { file_path: 'drafts/ch1.md', content: '正文' })).toBeNull()
    expect(matchCritical('call_external_api', { path: '/api/status', method: 'GET' })).toBeNull()
    // 正文里出现 sk- 片段不应误杀写文件（凭据规则只作用于出站 API）
    expect(matchCritical('write_file', { file_path: 'drafts/ch2.md', content: '他掏出 sk-01 型号的钥匙' })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/approval/critical.test.ts`
Expected: FAIL —— `Cannot find module './critical'`

- [ ] **Step 3: 实现 types.ts**

```ts
// src/services/agent/approval/types.ts
/** 审批决策三态：allow = 放行；prompt = 需要用户确认；deny = 硬拒绝（用户也无法放行） */
export type ApprovalAction = 'allow' | 'prompt' | 'deny'
export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical'

/** 危险规则命中结果（critical.ts 产出） */
export interface CriticalHit {
  ruleId: string
  risk: 'critical'
  /** i18n key（UI 本地化），参数见 reasonParams */
  reasonKey: string
  reasonParams?: Record<string, string>
}

/** 已固化的 workspace 批准规则（持久化于 {project}/.novelforge/approvals.json） */
export interface ApprovalRule {
  /** 稳定 id：approval-<sha16(projectPath + toolName + matchKey)> */
  id: string
  toolName: string
  matcher: string
  matcherVersion: number
  /** 参数身份 JSON（稳定序列化）；命中需与当次提案逐字节一致 */
  matchKey: string
  /** 人类可读描述（英文，UI 展示前经 i18n 包装） */
  displayPattern: string
  /** 审计：批准时的参数哈希 */
  approvedArgsHash: string
  createdAt: string
}

/** 当次调用可固化的规则提案（仅 prompt 决策时给出） */
export interface RuleProposal {
  toolName: string
  matcher: string
  matcherVersion: number
  matchKey: string
  displayPattern: string
}

/** 审批决策请求（全部为稳定事实，调用方不得自行推断 workspace） */
export interface ApprovalRequest {
  /** 项目根绝对路径；null = 无项目 → 不可固化、不可匹配规则 */
  projectPath: string | null
  toolName: string
  args: Record<string, unknown>
  /** 工具声明的静态属性 */
  descriptor: { requiresConfirmation: boolean; isReadOnly: boolean }
  /** 工具来源：builtin / mcp（MCP 参数不可固化）/ skill */
  source: 'builtin' | 'mcp' | 'skill'
  /** 该项目已固化的规则 */
  rules: ApprovalRule[]
}

export interface ApprovalDecision {
  action: ApprovalAction
  risk: ApprovalRisk
  ruleId: string
  reasonKey: string
  reasonParams?: Record<string, string>
  /** 仅 prompt 且可固化时存在 */
  remember?: RuleProposal
}
```

- [ ] **Step 4: 实现 critical.ts**

```ts
// src/services/agent/approval/critical.ts
import type { CriticalHit } from './types'

/** 受保护目录段（与 src/services/agent/tools/safe-path.ts 的 PROJECT_DATA_DIR_SEGMENTS 同源） */
const PROTECTED_SEGMENTS = ['.novelforge', '.vela', '.git', 'node_modules']

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/** 归一化路径分隔符后判断是否落在受保护目录内 */
function touchesProtectedDir(p: string): boolean {
  const normalized = p.replace(/\\/g, '/').toLowerCase()
  return PROTECTED_SEGMENTS.some(seg =>
    normalized === seg || normalized.startsWith(seg + '/') || normalized.includes('/' + seg + '/'),
  )
}

/** 相对路径是否向上越界（.. 段使深度 < 0） */
function escapesRoot(p: string): boolean {
  const parts = p.replace(/\\/g, '/').split('/')
  let depth = 0
  for (const seg of parts) {
    if (seg === '..') { depth--; if (depth < 0) return true }
    else if (seg !== '.' && seg !== '') depth++
  }
  return false
}

/** 出站内容里的凭据形态（保守模式：只作用于 call_external_api） */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\b(api[_-]?key|apikey|access[_-]?token|secret)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
]

/**
 * 危险操作硬拒绝（fail-closed）：命中即 deny，用户批准也不放行。
 * 与路径沙箱（safe-path.ts / fs-controller BLOCKED_PATHS）是**两道独立防线**——
 * 沙箱在工具实现内部，这里在审批层，防止未来新增工具忘记接沙箱。
 */
export function matchCritical(toolName: string, args: Record<string, unknown>): CriticalHit | null {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const p = firstString(args, ['file_path', 'path'])
    if (p && escapesRoot(p)) {
      return { ruleId: 'critical_path_escape', risk: 'critical', reasonKey: 'approval.critical.pathEscape', reasonParams: { path: p } }
    }
    if (p && touchesProtectedDir(p)) {
      return { ruleId: 'critical_protected_path', risk: 'critical', reasonKey: 'approval.critical.protectedPath', reasonParams: { path: p } }
    }
  }

  if (toolName === 'call_external_api') {
    const path = firstString(args, ['path'])
    if (/^[a-z]+:\/\//i.test(path) || path.startsWith('//')) {
      return { ruleId: 'critical_absolute_url', risk: 'critical', reasonKey: 'approval.critical.absoluteUrl', reasonParams: { path } }
    }
    const outbound = firstString(args, ['body'])
    if (outbound && CREDENTIAL_PATTERNS.some(re => re.test(outbound))) {
      return { ruleId: 'critical_external_credentials', risk: 'critical', reasonKey: 'approval.critical.credentials' }
    }
  }

  return null
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/services/agent/approval/critical.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 6: 提交**

```bash
git add src/services/agent/approval/types.ts src/services/agent/approval/critical.ts src/services/agent/approval/critical.test.ts
git commit -m "feat(approval): 审批决策类型 + 危险操作硬拒绝规则（A3）"
```

---

### Task 2: 可固化规则提案与匹配（参数语义边界）

**Files:**
- Create: `src/services/agent/approval/proposal.ts`
- Test: `src/services/agent/approval/proposal.test.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `ApprovalRequest` / `RuleProposal` / `ApprovalRule`
- Produces: `proposeRule(req: ApprovalRequest): RuleProposal | null`；`matchesRule(rule: ApprovalRule, proposal: RuleProposal): boolean`；`makeRule(proposal: RuleProposal, projectPath: string, args: Record<string, unknown>): ApprovalRule`

- [ ] **Step 1: 写失败测试**

```ts
// src/services/agent/approval/proposal.test.ts
import { describe, it, expect } from 'vitest'
import { proposeRule, matchesRule, makeRule } from './proposal'
import type { ApprovalRequest } from './types'

function req(toolName: string, args: Record<string, unknown>, source: 'builtin' | 'mcp' | 'skill' = 'builtin'): ApprovalRequest {
  return {
    projectPath: 'E:/novels/demo',
    toolName,
    args,
    descriptor: { requiresConfirmation: true, isReadOnly: false },
    source,
    rules: [],
  }
}

describe('proposeRule 可固化边界（对标 Denova「单一静态调用 + 已知命令族」）', () => {
  it('open_editor：按 tab_type + 目录固化', () => {
    const p = proposeRule(req('open_editor', { file_path: 'drafts/ch1.md', tab_type: 'draft' }))
    expect(p?.toolName).toBe('open_editor')
    expect(p?.displayPattern).toContain('draft')
    expect(p?.matchKey).toContain('drafts')
  })

  it('start_workflow：按工作流名固化', () => {
    const p = proposeRule(req('start_workflow', { workflow: 'generate_draft', chapter_number: 3 }))
    expect(p?.matchKey).toBe(JSON.stringify(['start_workflow', 'generate_draft']))
    expect(p?.displayPattern).toContain('generate_draft')
  })

  it('update_config：按字段固化', () => {
    const p = proposeRule(req('update_config', { field: 'totalChapters', value: '120' }))
    expect(p?.matchKey).toBe(JSON.stringify(['update_config', 'totalChapters']))
  })

  it('write_file：仅按目录固化，不按整份文件内容', () => {
    const a = proposeRule(req('write_file', { file_path: 'drafts/ch1.md', content: 'A' }))
    const b = proposeRule(req('write_file', { file_path: 'drafts/ch2.md', content: 'B' }))
    expect(a?.matchKey).toBe(b?.matchKey)          // 同目录 → 同一规则
    expect(a?.displayPattern).toContain('drafts')
  })

  it('call_external_api：只读方法可固化，写方法保持一次性', () => {
    expect(proposeRule(req('call_external_api', { path: '/api/status', method: 'GET' }))).not.toBeNull()
    expect(proposeRule(req('call_external_api', { path: '/api/status', method: 'POST', body: '{}' }))).toBeNull()
    expect(proposeRule(req('call_external_api', { path: '/api/x', method: 'DELETE' }))).toBeNull()
  })

  it('MCP 工具与 skill 来源不可固化（参数 schema 未知）', () => {
    expect(proposeRule(req('mcp__foo__bar', { x: 1 }, 'mcp'))).toBeNull()
    expect(proposeRule(req('skill__demo', {}, 'skill'))).toBeNull()
  })

  it('无项目时不可固化', () => {
    const r = req('open_editor', { file_path: 'a.md', tab_type: 'draft' })
    expect(proposeRule({ ...r, projectPath: null })).toBeNull()
  })
})

describe('matchesRule 匹配与失效', () => {
  const base = req('start_workflow', { workflow: 'generate_draft' })
  const proposal = proposeRule(base)!
  const rule = makeRule(proposal, 'E:/novels/demo', base.args)

  it('同工具同 identity 命中', () => {
    expect(matchesRule(rule, proposeRule(req('start_workflow', { workflow: 'generate_draft', chapter_number: 9 }))!)).toBe(true)
  })

  it('不同 identity 不命中', () => {
    expect(matchesRule(rule, proposeRule(req('start_workflow', { workflow: 'finalize' }))!)).toBe(false)
  })

  it('matcherVersion 不同 → 不命中（fail-closed）', () => {
    const p = proposeRule(req('start_workflow', { workflow: 'generate_draft' }))!
    expect(matchesRule(rule, { ...p, matcherVersion: p.matcherVersion + 1 })).toBe(false)
  })

  it('规则 id 稳定且含项目隔离', () => {
    const other = makeRule(proposal, 'E:/novels/other', base.args)
    expect(rule.id).not.toBe(other.id)
    expect(rule.id.startsWith('approval-')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/approval/proposal.test.ts`
Expected: FAIL —— `Cannot find module './proposal'`

- [ ] **Step 3: 实现 proposal.ts**

```ts
// src/services/agent/approval/proposal.ts
import type { ApprovalRequest, ApprovalRule, RuleProposal } from './types'

/** 匹配器版本：语义边界一旦调整必须 +1，旧规则自动失效（fail-closed 回到询问） */
export const MATCHER = 'args-identity'
export const MATCHER_VERSION = 1

/** 稳定序列化（键排序），保证同一语义的提案逐字节一致 */
function stableKey(parts: string[]): string {
  return JSON.stringify(parts)
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v : ''
}

/** 取文件所在目录（归一化分隔符；无目录 → '.'） */
function dirOf(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : '.'
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 规则提案：只有「单一静态调用 + 已知工具族」才产出提案（其余保持一次性授权）。
 * 语义边界的宽度 = 目录（文件类）/ 动作名（工作流类）/ 字段名（配置类），
 * 绝不按完整参数固化（内容任意，影响面不可界定）。
 * 见 test 文件逐条锁定的边界表。
 */
export function proposeRule(req: ApprovalRequest): RuleProposal | null {
  if (!req.projectPath || req.source !== 'builtin') return null

  const p = (identity: string[], pattern: string): RuleProposal => ({
    toolName: req.toolName,
    matcher: MATCHER,
    matcherVersion: MATCHER_VERSION,
    matchKey: stableKey(identity),
    displayPattern: pattern,
  })

  switch (req.toolName) {
    case 'open_editor': {
      const tabType = str(req.args, 'tab_type')
      if (!tabType) return null
      const dir = dirOf(str(req.args, 'file_path'))
      return p(['open_editor', tabType, dir], `open_editor → ${tabType} in ${dir}/`)
    }
    case 'start_workflow': {
      const workflow = str(req.args, 'workflow')
      if (!workflow) return null
      return p(['start_workflow', workflow], `start_workflow → ${workflow}`)
    }
    case 'update_config': {
      const field = str(req.args, 'field')
      if (!field) return null
      return p(['update_config', field], `update_config → ${field}`)
    }
    case 'write_file':
    case 'edit_file': {
      const dir = dirOf(str(req.args, 'file_path'))
      return p([req.toolName, dir], `${req.toolName} → ${dir}/`)
    }
    case 'index_content':
      return p(['index_content'], 'index_content')
    case 'call_external_api': {
      const method = (str(req.args, 'method') || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') return null
      const dir = dirOf(str(req.args, 'path'))
      return p(['call_external_api', method, dir], `${method} ${dir}/`)
    }
    default:
      return null
  }
}

/** 规则是否匹配当次提案（工具名 + matcher 版本 + matchKey 三者全等） */
export function matchesRule(rule: ApprovalRule, proposal: RuleProposal): boolean {
  return rule.toolName === proposal.toolName
    && rule.matcher === proposal.matcher
    && rule.matcherVersion === proposal.matcherVersion
    && rule.matchKey === proposal.matchKey
}

/** 由提案生成可持久化规则（id 绑定项目路径，防跨项目串用） */
export function makeRule(proposal: RuleProposal, projectPath: string, args: Record<string, unknown>): ApprovalRule {
  const hash = fnv1a(`${projectPath}::${proposal.toolName}::${proposal.matchKey}`)
  return {
    id: `approval-${hash}`,
    toolName: proposal.toolName,
    matcher: proposal.matcher,
    matcherVersion: proposal.matcherVersion,
    matchKey: proposal.matchKey,
    displayPattern: proposal.displayPattern,
    approvedArgsHash: fnv1a(JSON.stringify(args)),
    createdAt: new Date().toISOString(),
  }
}
```

**可固化边界（设计依据，与上面实现一一对应）**：

| 工具 | 可固化 identity | displayPattern |
|---|---|---|
| `open_editor` | `['open_editor', tab_type, dirOf(file_path)]` | `open_editor → {tab_type} in {dir}/` |
| `start_workflow` | `['start_workflow', workflow]` | `start_workflow → {workflow}` |
| `update_config` | `['update_config', field]` | `update_config → {field}` |
| `write_file` / `edit_file` | `[toolName, dirOf(file_path)]` | `{toolName} → {dir}/` |
| `index_content` | `['index_content']` | `index_content` |
| `call_external_api` | 仅 `method` ∈ {GET, HEAD} → `['call_external_api', method, dirOf(path)]` | `{method} {dir}/` |
| 其余（MCP / skill / 未知） | — → `null` | — |

前置条件：`req.projectPath === null`、`req.source !== 'builtin'`、或对应必填参数缺失 → 返回 `null`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/agent/approval/proposal.test.ts`
Expected: PASS（11 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/services/agent/approval/proposal.ts src/services/agent/approval/proposal.test.ts
git commit -m "feat(approval): 可固化规则提案与匹配（A1 参数语义边界）"
```

---

### Task 3: workspace 批准记忆持久化

**Files:**
- Create: `src/services/agent/approval/store.ts`
- Test: `src/services/agent/approval/store.test.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `ApprovalRule`
- Produces: `loadApprovalRules(projectPath: string): Promise<ApprovalRule[]>`；`appendApprovalRule(projectPath: string, rule: ApprovalRule): Promise<void>`；`clearApprovalRules(projectPath: string): Promise<void>`；`APPROVALS_RELATIVE_PATH = '.novelforge/approvals.json'`

**实现说明**：走渲染层既有 fs IPC（`fs:read-file` / `fs:write-file`，见 `src/services/audit/audit-context.ts:74-85` 的 `audit-whitelist.json` 同款范式）。读失败/解析失败一律返回 `[]`（fail-closed：宁可多问一次，不可静默放行）。

- [ ] **Step 1: 写失败测试**

```ts
// src/services/agent/approval/store.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadApprovalRules, appendApprovalRule } from './store'
import { ipc } from '../../ipc-client'
import type { ApprovalRule } from './types'

vi.mock('../../ipc-client', () => ({ ipc: { invoke: vi.fn() } }))
const mockInvoke = vi.mocked(ipc.invoke)

const rule: ApprovalRule = {
  id: 'approval-deadbeef', toolName: 'start_workflow', matcher: 'args-identity',
  matcherVersion: 1, matchKey: '["start_workflow","generate_draft"]',
  displayPattern: 'start_workflow → generate_draft',
  approvedArgsHash: 'cafebabe', createdAt: '2026-09-26T00:00:00.000Z',
}

beforeEach(() => mockInvoke.mockReset())

describe('workspace 批准记忆（.novelforge/approvals.json）', () => {
  it('读取：文件不存在 → 空数组（不抛错）', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false })
    expect(await loadApprovalRules('E:/novels/demo')).toEqual([])
  })

  it('读取：内容损坏 → 空数组（fail-closed）', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, content: '{not json' })
    expect(await loadApprovalRules('E:/novels/demo')).toEqual([])
  })

  it('读取：形状不对的条目不进入结果', async () => {
    mockInvoke.mockResolvedValueOnce({
      success: true,
      content: JSON.stringify({ version: 1, rules: [rule, { id: 'x' }, null] }),
    })
    const rules = await loadApprovalRules('E:/novels/demo')
    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe('approval-deadbeef')
  })

  it('追加：去重后写回完整结构（fs:write-file 双位置参数）', async () => {
    mockInvoke
      .mockResolvedValueOnce({ success: true, content: JSON.stringify({ version: 1, rules: [rule] }) })  // 读
      .mockResolvedValueOnce({ success: true })                                                          // 写
    await appendApprovalRule('E:/novels/demo', rule)
    const writeCall = mockInvoke.mock.calls[1]
    expect(writeCall[0]).toBe('fs:write-file')
    expect(String(writeCall[1])).toContain('.novelforge/approvals.json')
    const written = JSON.parse(String(writeCall[2]))
    expect(written.version).toBe(1)
    expect(written.rules).toHaveLength(1)   // 同 id 去重，不重复追加
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/approval/store.test.ts`
Expected: FAIL —— `Cannot find module './store'`

- [ ] **Step 3: 实现 store.ts**

```ts
// src/services/agent/approval/store.ts
import { ipc } from '../../ipc-client'
import { DIR_VELA_INTERNAL } from '../../../shared/project-paths'
import type { ApprovalRule } from './types'

export const APPROVALS_RELATIVE_PATH = `${DIR_VELA_INTERNAL}/approvals.json`

interface ApprovalsFile {
  version: 1
  rules: ApprovalRule[]
}

function fullPath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/${APPROVALS_RELATIVE_PATH}`
}

function isValidRule(v: unknown): v is ApprovalRule {
  const r = v as Partial<ApprovalRule> | null
  return !!r
    && typeof r.id === 'string' && r.id.length > 0
    && typeof r.toolName === 'string'
    && typeof r.matcher === 'string'
    && typeof r.matcherVersion === 'number'
    && typeof r.matchKey === 'string'
}

/**
 * 读取项目级批准规则。
 * 任何异常（文件不存在 / JSON 损坏 / 形状不符）→ 空数组：fail-closed，
 * 宁可多问一次用户，不可静默放行。
 * 通道沿用项目内既有范式（对照 src/services/audit/audit-context.ts:74-92）。
 */
export async function loadApprovalRules(projectPath: string): Promise<ApprovalRule[]> {
  try {
    const res = await ipc.invoke('fs:read-file', fullPath(projectPath)) as { success?: boolean; content?: string } | null
    if (!res?.success || !res.content) return []
    const parsed = JSON.parse(res.content) as Partial<ApprovalsFile>
    if (!Array.isArray(parsed?.rules)) return []
    return parsed.rules.filter(isValidRule)
  } catch {
    return []
  }
}

/** 追加规则（同 id 去重）：读-合并-写全量 */
export async function appendApprovalRule(projectPath: string, rule: ApprovalRule): Promise<void> {
  const existing = await loadApprovalRules(projectPath)
  const merged = existing.some(r => r.id === rule.id) ? existing : [...existing, rule]
  const payload: ApprovalsFile = { version: 1, rules: merged }
  await ipc.invoke('fs:write-file', fullPath(projectPath), JSON.stringify(payload, null, 2))
}

/** 清空项目全部规则（规则管理 UI 的预留接口） */
export async function clearApprovalRules(projectPath: string): Promise<void> {
  const payload: ApprovalsFile = { version: 1, rules: [] }
  await ipc.invoke('fs:write-file', fullPath(projectPath), JSON.stringify(payload, null, 2))
}
```

> 为什么放 `.novelforge/` 而不是全局配置：① A2 要求 scope = 仅 workspace；② 该目录被 `isProtectedRelativePath`（`src/services/agent/tools/safe-path.ts:68-80`）列为 agent 不可写——规则文件不会被 agent 自己篡改。

Run: `npx vitest run src/services/agent/approval/store.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 4: 提交**

```bash
git add src/services/agent/approval/store.ts src/services/agent/approval/store.test.ts
git commit -m "feat(approval): workspace 级批准记忆持久化（A2）"
```

---

### Task 4: evaluate 编排 + 接线到 agent 确认门

**Files:**
- Create: `src/services/agent/approval/policy.ts`
- Create: `src/services/agent/approval/index.ts`
- Test: `src/services/agent/approval/policy.test.ts`
- Modify: `src/stores/agent-store.ts:832-845`

**Interfaces:**
- Consumes: Task 1-3 全部导出
- Produces: `evaluateApproval(req: ApprovalRequest): ApprovalDecision`（纯函数）；agent-store 的 `onToolCallConfirmRequired` 在弹卡前先查规则

- [ ] **Step 1: 写失败测试（编排优先级）**

```ts
// src/services/agent/approval/policy.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateApproval } from './policy'
import { proposeRule, makeRule } from './proposal'
import type { ApprovalRequest } from './types'

function base(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    projectPath: 'E:/novels/demo', toolName: 'start_workflow',
    args: { workflow: 'generate_draft' },
    descriptor: { requiresConfirmation: true, isReadOnly: false },
    source: 'builtin', rules: [], ...over,
  }
}

describe('evaluateApproval 优先级：deny > 规则命中 > prompt', () => {
  it('危险命中 → deny（即使有匹配规则也拒绝）', () => {
    const req = base({ toolName: 'write_file', args: { file_path: '.novelforge/x.json' } })
    expect(evaluateApproval(req).action).toBe('deny')
  })

  it('命中已固化规则 → allow（ruleId 来自规则）', () => {
    const proposal = proposeRule(base())!
    const rule = makeRule(proposal, 'E:/novels/demo', { workflow: 'generate_draft' })
    const d = evaluateApproval(base({ rules: [rule] }))
    expect(d.action).toBe('allow')
    expect(d.ruleId).toBe(rule.id)
  })

  it('无规则命中 → prompt 且带提案', () => {
    const d = evaluateApproval(base())
    expect(d.action).toBe('prompt')
    expect(d.remember?.toolName).toBe('start_workflow')
  })

  it('只读工具 → allow（不产生提案）', () => {
    const d = evaluateApproval(base({ descriptor: { requiresConfirmation: false, isReadOnly: true } }))
    expect(d.action).toBe('allow')
    expect(d.remember).toBeUndefined()
  })

  it('不可固化工具 → prompt 无提案', () => {
    const d = evaluateApproval(base({ source: 'mcp', toolName: 'mcp__x__y' }))
    expect(d.action).toBe('prompt')
    expect(d.remember).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/approval/policy.test.ts`
Expected: FAIL —— `Cannot find module './policy'`

- [ ] **Step 3: 实现 policy.ts 与 index.ts**

`evaluateApproval` 顺序（**不可调换**）：① `matchCritical` → deny；② `descriptor.isReadOnly && !requiresConfirmation` → allow('read_only')；③ `proposeRule` → 有提案则找 `rules` 命中 → allow；④ 兜底 prompt（附提案或 undefined）。每个分支都要给出稳定的 `ruleId` 与 `reasonKey`。

`index.ts` 只做 re-export（types / critical / proposal / policy / store）。

Run: `npx vitest run src/services/agent/approval/policy.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 4: 接线 agent-store（弹卡前查规则）**

在 `src/stores/agent-store.ts:832-845` 的 `onToolCallConfirmRequired` 内，进入 pending Promise **之前**插入：

```ts
// A 档：先过审批策略层（危险硬拒绝 / workspace 规则命中）——命中则不再打扰用户
const projectPath = useProjectStore.getState().currentProject?.path ?? null
const rules = projectPath ? await loadApprovalRules(projectPath) : []
const tool = toolRegistry.get(toolCall.name)
const decision = evaluateApproval({
  projectPath, toolName: toolCall.name, args: (toolCall.args ?? {}) as Record<string, unknown>,
  descriptor: { requiresConfirmation: tool?.requiresConfirmation ?? true, isReadOnly: tool?.isReadOnly ?? false },
  source: toolCall.name.startsWith('mcp__') ? 'mcp' : toolCall.name.startsWith('skill__') ? 'skill' : 'builtin',
  rules,
})
if (decision.action === 'allow') return true          // 规则放行，等价用户已批准
if (decision.action === 'deny') return false          // 硬拒绝：以既有「拒绝」语义回注模型
```

并把 `decision`（含 `remember`）透传给 ConfirmCard（`ToolCallInfo` 增可选字段 `approval?: ApprovalDecision`——`agent-engine.ts:59` 类型同步）。

⚠️ 顺序约束：规则**写入**必须发生在用户点击「始终允许」之后、Promise resolve 之前（写入失败不阻断本次批准，只记录日志）。

- [ ] **Step 5: 补 agent-store 行为测试**

测试文件：`src/stores/agent-store.approval.test.ts`（沿用 `agent-store.test.ts` 的 mock 范式）。断言两条：① 命中规则的调用**不产生** pendingConfirmation；② 危险调用返回 false 且不产生 pending。

Run: `npx vitest run src/stores/agent-store.approval.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/services/agent/approval/ src/stores/agent-store.ts src/services/agent/agent-engine.ts src/stores/agent-store.approval.test.ts
git commit -m "feat(approval): 决策编排 + agent 确认门接线"
```

---

### Task 5: ConfirmCard 三态增强（risk + 规则描述 + 始终允许）

**Files:**
- Modify: `src/components/panels/agent/ConfirmCard.tsx`
- Modify: `src/shared/locale-data/agent.ts`（新增 key，三语）
- Test: `src/components/panels/agent/ConfirmCard.test.tsx`

**Interfaces:**
- Consumes: `ApprovalDecision`（`remember.displayPattern` / `risk` / `reasonKey`）
- Produces: 新增第三按钮「本项目内始终允许」（仅当 `decision.remember` 存在且 `action === 'prompt'` 时渲染）；回调 `onApproveAlways()` → agent-store 写规则

- [ ] **Step 1: 写失败测试**

```tsx
// 追加到 src/components/panels/agent/ConfirmCard.test.tsx
it('有可固化提案时渲染「始终允许」按钮，点击回调 approval 提案', () => {
  const onApproveAlways = vi.fn()
  render(<ConfirmCard toolCall={makeToolCall({ approval: { action: 'prompt', risk: 'medium', ruleId: 'r', reasonKey: 'k', remember: { toolName: 'start_workflow', matcher: 'args-identity', matcherVersion: 1, matchKey: '[]', displayPattern: 'start_workflow → generate_draft' } } })} onApprove={vi.fn()} onReject={vi.fn()} onApproveAlways={onApproveAlways} />)
  fireEvent.click(screen.getByText(/始终允许/))
  expect(onApproveAlways).toHaveBeenCalledTimes(1)
})

it('无可固化提案（MCP 工具）时不渲染「始终允许」', () => {
  render(<ConfirmCard toolCall={makeToolCall({ approval: { action: 'prompt', risk: 'high', ruleId: 'r', reasonKey: 'k' } })} onApprove={vi.fn()} onReject={vi.fn()} onApproveAlways={vi.fn()} />)
  expect(screen.queryByText(/始终允许/)).toBeNull()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/panels/agent/ConfirmCard.test.tsx`
Expected: FAIL —— 找不到「始终允许」按钮

- [ ] **Step 3: 实现 UI + i18n**

- 新增 i18n key（`src/shared/locale-data/agent.ts`，三语齐）：`agentConfirm.alwaysAllow`（本项目内始终允许 / Always allow in this project / Всегда разрешать в этом проекте）、`agentConfirm.rememberHint`（将记住：{pattern} / Will remember: {pattern} / …）、`agentConfirm.riskHigh` / `agentConfirm.riskMedium`
- 危险理由展示：`deny` 的直接以红字显示 `reasonKey` 对应文案（`approval.critical.*` 三语 key 一并在 `agent.ts` 补齐）
- 描述分支补齐：`generateDescription()` 目前只覆盖 4 个工具（`ConfirmCard.tsx:72-95`），补 `edit_file` / `index_content` / `call_external_api` 三个分支
- 第三按钮样式用 `variant="outline"` 与「拒绝」区分层级；沿用 `--color-*` 令牌

Run: `npx vitest run src/components/panels/agent/ConfirmCard.test.tsx`
Expected: PASS（含既有 2 个回调方向用例）

- [ ] **Step 4: 提交**

```bash
git add src/components/panels/agent/ConfirmCard.tsx src/components/panels/agent/ConfirmCard.test.tsx src/shared/locale-data/agent.ts
git commit -m "feat(approval): 确认卡支持始终允许 + 风险与规则展示"
```

---

### Task 6: 每层多模型 UI（有序列表）

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx:408-480`
- Modify: `src/shared/locale-data/settings.ts:165-174`
- Test: `src/components/settings/ModelRoutingSection.test.tsx`（新建）

**Interfaces:**
- Consumes: `useLLMStore` 的 `modelRoutes` / `updateModelRoutes`（`src/stores/llm-store.ts:361-370`）
- Produces: 每层为**有序列表**（数组顺序 = 优先级），支持追加/上移/移除/清空

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/settings/ModelRoutingSection.test.tsx
// 断言：① 已有两个模型的层渲染两行且顺序即数组顺序
//      ② 追加一个模型 → updateModelRoutes 收到 [原1, 原2, 新]
//      ③ 移除中间一个 → 收到 [原1, 原3]（顺序保留）
//      ④ 清空 → 收到 []（不是 [null]）
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/settings/ModelRoutingSection.test.tsx`
Expected: FAIL —— 当前实现是单个 Select，无法追加第二个模型

- [ ] **Step 3: 实现**

把 `patch[tier] = [modelId]`（`SettingsModal.tsx:425`）替换为有序列表模型：行内「上移/移除」+ 底部「添加模型」下拉（候选 = 未在该层的非 embedding 模型）。同时修正文案：`settings.routeClear`（`locale-data/settings.ts:174`）当前写「不指定（自动分配）」，但 `autoDetectTiers` 已删除 → 改为「不指定（回退默认模型）」，三语同步。

Run: `npx vitest run src/components/settings/ModelRoutingSection.test.tsx`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/SettingsModal.tsx src/components/settings/ModelRoutingSection.test.tsx src/shared/locale-data/settings.ts
git commit -m "feat(routing): 三层路由支持每层多模型（有序优先级列表）"
```

---

### Task 7: 路由动态策略（AgentMode → tier）

**Files:**
- Modify: `src/services/llm/model-router.ts:44-68,103-115`
- Modify: `src/stores/llm-store.ts:82,355-359`
- Modify: `src/stores/agent-store.ts:534`
- Modify: `src/shared/ipc-channels.ts:63`（`GlobalConfig.modelRoutes` 增 `strategy?`）
- Modify: `src/components/settings/SettingsModal.tsx`（策略开关）
- Test: `src/services/llm/model-router.test.ts`（新建）

**Interfaces:**
- Consumes: `AgentMode`（`agent-store.ts:27`，6 级）
- Produces: `ModelRouter.route(purpose: CallPurpose, tierOverride?: ModelTier): string | null`；`agentModeToTier(mode: AgentMode): ModelTier`；`ModelRouteConfig.strategy?: 'static' | 'dynamic'`

- [ ] **Step 1: 写失败测试**

```ts
// src/services/llm/model-router.test.ts
import { describe, it, expect } from 'vitest'
import { ModelRouter, agentModeToTier } from './model-router'

const models = [
  { id: 'e1', name: 'E', modelName: 'elite-model' },
  { id: 's1', name: 'S', modelName: 'std-model' },
  { id: 'b1', name: 'B', modelName: 'budget-model' },
] as never

describe('route 可选 tier 覆盖（动态策略）', () => {
  const router = new ModelRouter({ elite: ['e1'], standard: ['s1'], budget: ['b1'] }, models)

  it('不传 override 时行为与现状一致（静态 purpose→tier）', () => {
    expect(router.route('draft_chapter')).toBe('e1')
    expect(router.route('summarize')).toBe('b1')
  })

  it('override 生效：purpose 为 summarize 也可被拉到 elite', () => {
    expect(router.route('summarize', 'elite')).toBe('e1')
  })

  it('override 的层为空时走既有 fallback 链（不返回 null 以外的意外值）', () => {
    const empty = new ModelRouter({ elite: [], standard: ['s1'], budget: ['b1'] }, models)
    expect(empty.route('draft_chapter', 'elite')).toBe('s1')   // elite 空 → fallback standard
  })
})

describe('agentModeToTier 映射（零 LLM 成本）', () => {
  it('6 档映射到三层', () => {
    expect(agentModeToTier('quick')).toBe('budget')
    expect(agentModeToTier('swift')).toBe('budget')
    expect(agentModeToTier('balanced')).toBe('standard')
    expect(agentModeToTier('reflective')).toBe('standard')
    expect(agentModeToTier('deep')).toBe('elite')
    expect(agentModeToTier('max')).toBe('elite')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/llm/model-router.test.ts`
Expected: FAIL —— `agentModeToTier is not a function`

- [ ] **Step 3: 实现 route 覆盖 + 映射**

`route` 第二参数 `tierOverride?: ModelTier`：给定则跳过 `PURPOSE_TIER_MAP` 直接用作 tier（后续逻辑不变，含 fallback 与 `null` 兜底）。`agentModeToTier` 按上表实现（写在 `model-router.ts`，导出）。

Run: `npx vitest run src/services/llm/model-router.test.ts`
Expected: PASS

- [ ] **Step 4: 接入 agent 主对话（唯一绕过路由的路径）**

`src/stores/agent-store.ts:534` 改为：

```ts
// A 档动态策略：strategy==='dynamic' 时按对话模式（用户可见的投入档位）决定 tier；
// 静态策略保持现状（默认模型直取，不走路由）
const routeStrategy = llmStore.modelRoutes?.strategy ?? 'static'
const modelId = currentConv.modelId
  ?? (routeStrategy === 'dynamic'
        ? (llmStore.getModelForTier(agentModeToTier(currentConv.mode)) ?? llmStore.defaultModelId)
        : llmStore.defaultModelId)
  ?? undefined
```

`llm-store` 增 `getModelForTier(tier)`（内部 `router.route('default', tier)`），并让 `getModelForPurpose(purpose, tierOverride?)` 透传第二参。

Run: `npx vitest run src/services/llm/model-router.test.ts src/stores/agent-store.test.ts`
Expected: PASS（含既有 agent-store 用例不回归）

- [ ] **Step 5: 设置 UI 开关 + 持久化字段**

`ModelRoutingSection` 增「动态路由（按对话档位自动选层）」开关，写入 `modelRoutes.strategy`；`electron/controllers/llm-controller.ts:477-490` 的 `llm:set-routes` 白名单加 `strategy`（值域校验 `'static' | 'dynamic'`），`GlobalConfig.modelRoutes` 类型同步（`ipc-channels.ts:63`）。三语 i18n key 一并补。

Run: `npx vitest run src/components/settings/ModelRoutingSection.test.tsx`
Expected: PASS

- [ ] **Step 6: 全量门禁 + 提交**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: tsc 0 错误 / eslint 0 warning / 全量测试绿

```bash
git add src/services/llm/model-router.ts src/services/llm/model-router.test.ts src/stores/llm-store.ts src/stores/agent-store.ts src/components/settings/SettingsModal.tsx src/shared/ipc-channels.ts src/shared/locale-data/settings.ts electron/controllers/llm-controller.ts
git commit -m "feat(routing): 动态路由策略（AgentMode→tier）+ 持久化"
```

---

## 明确不做（本计划范围外）

- Approval mode（ask / write / full-access）三模式——Denova 有，NF 本次不引入；规则层已预留扩展点
- 规则管理 UI（设置页列出/删除已固化规则）——ACP 后续档位；本计划只提供 `clearApprovalRules()` 程序接口
- 外部执行引擎（Codex CLI / Claude Code CLI）——计划 §8 第 4 条的定位级决策，需你拍板
