/**
 * 路径授权判定单测（L4 S8）
 *
 * 覆盖测试评审要求的「5 形态 × 3 意图」交叉矩阵 + 越界/凭据/意图粒度/大小写。
 * 全部路径用 `os.tmpdir()` 拼装，**不含硬编码盘符或反斜杠**（否则 POSIX 上会形同虚设）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import {
  isPathAllowed,
  assertPathAllowed,
  grantPath,
  revokeGrant,
  currentGrants,
  clearGrantsForTest,
  type PathIntent,
  type PathPolicy,
} from './grants'

const BASE = path.join(os.tmpdir(), 'l4-grants-test')
const VELA = path.join(BASE, 'home', '.novelforge')
const PROJ = path.join(BASE, 'projects', 'p1')
const GRANTED = path.join(BASE, 'exports')
const LEGACY_HOME = path.join(BASE, 'userhome')
const OUTSIDE = path.join(BASE, '..', 'l4-outside')

const policy = (over: Partial<PathPolicy> = {}): PathPolicy => ({
  velaHome: VELA,
  projectRoot: PROJ,
  granted: new Map(),
  legacyHomeDir: null,
  ...over,
})

const INTENTS: PathIntent[] = ['read', 'write', 'delete']

describe('isPathAllowed —— 5 形态 × 3 意图交叉矩阵', () => {
  const matrix: Array<{ name: string; file: string; base: Partial<PathPolicy>; expect: [boolean, boolean, boolean] }> = [
    { name: '① VELA_HOME 内', file: path.join(VELA, 'vela.db'), base: {}, expect: [true, true, true] },
    { name: '② 当前项目根内', file: path.join(PROJ, 'ch1.md'), base: {}, expect: [true, true, true] },
    {
      name: '③ 授权目录内（仅授 write）',
      file: path.join(GRANTED, 'out.md'),
      base: { granted: new Map([[GRANTED, new Set<PathIntent>(['write'])]]) },
      expect: [false, true, false], // 意图分级：写授权 ≠ 读授权 ≠ 删授权
    },
    { name: '④ 过渡期主目录根内', file: path.join(LEGACY_HOME, 'doc.md'), base: { legacyHomeDir: LEGACY_HOME }, expect: [true, true, true] },
    { name: '⑤ 白名单之外', file: path.join(OUTSIDE, 'x.md'), base: {}, expect: [false, false, false] },
  ]

  for (const c of matrix) {
    for (let i = 0; i < INTENTS.length; i++) {
      const intent = INTENTS[i]
      const want = c.expect[i]
      it(`${c.name} · ${intent} → ${want ? '放行' : '拒绝'}`, () => {
        expect(isPathAllowed(c.file, intent, policy(c.base))).toBe(want)
      })
    }
  }

  it('边界：恰好等于根目录本身 → 放行（相等不算越界）', () => {
    expect(isPathAllowed(PROJ, 'read', policy())).toBe(true)
    expect(isPathAllowed(GRANTED, 'write', policy({ granted: new Map([[GRANTED, new Set<PathIntent>(['write'])]]) }))).toBe(true)
  })

  it('同前缀不同目录不得误放行（/p1 vs /p1-evil）', () => {
    expect(isPathAllowed(`${PROJ}-evil/x.md`, 'read', policy())).toBe(false)
  })

  it('空 / 非字符串 / 纯空白 → 拒绝（不抛错）', () => {
    expect(isPathAllowed('', 'read', policy())).toBe(false)
    expect(isPathAllowed('   ', 'read', policy())).toBe(false)
    expect(isPathAllowed(undefined as unknown as string, 'read', policy())).toBe(false)
  })

  it('未打开项目时（projectRoot=null）项目路径不再放行', () => {
    expect(isPathAllowed(path.join(PROJ, 'ch1.md'), 'read', policy({ projectRoot: null }))).toBe(false)
  })
})

describe('越界与凭据保护', () => {
  it('用 .. 逃出项目根 → 拒绝（解析后不在任何根内）', () => {
    const escaped = path.join(PROJ, '..', '..', 'userhome', 'secret.md')
    expect(isPathAllowed(escaped, 'read', policy())).toBe(false)
  })

  it('用 .. 从项目根逃到 VELA_HOME → 放行（确实落在 velaHome 内，属合法数据）', () => {
    const intoVela = path.join(PROJ, '..', '..', 'home', '.novelforge', 'x.txt')
    expect(isPathAllowed(intoVela, 'write', policy())).toBe(true)
  })

  it('凭据文件：VELA_HOME 根级 config.json / mcp_config.json 三种意图一律拒绝', () => {
    for (const name of ['config.json', 'mcp_config.json']) {
      for (const intent of INTENTS) {
        expect(isPathAllowed(path.join(VELA, name), intent, policy()), `${name}/${intent}`).toBe(false)
      }
    }
  })

  it('凭据拒绝只管 VELA_HOME 根级：子目录同名文件不受影响（项目内 config.json 合法）', () => {
    expect(isPathAllowed(path.join(VELA, 'sub', 'config.json'), 'read', policy())).toBe(true)
    expect(isPathAllowed(path.join(PROJ, 'config.json'), 'read', policy())).toBe(true)
  })

  it.skipIf(process.platform !== 'win32')('Windows 大小写不敏感：CONFIG.JSON 同样被拒', () => {
    expect(isPathAllowed(path.join(VELA, 'CONFIG.JSON'), 'read', policy())).toBe(false)
    expect(isPathAllowed(path.join(VELA.toUpperCase(), 'vela.db'), 'read', policy())).toBe(true)
  })
})

describe('assertPathAllowed（抛错版）', () => {
  it('放行时返回绝对路径', () => {
    expect(assertPathAllowed(path.join(PROJ, 'a.md'), 'read', policy())).toBe(path.resolve(path.join(PROJ, 'a.md')))
  })

  it('越界抛错，消息含被拒路径', () => {
    expect(() => assertPathAllowed(path.join(OUTSIDE, 'x'), 'read', policy())).toThrow(/x/)
  })

  it('凭据文件抛错（与越界区分，便于排查）', () => {
    expect(() => assertPathAllowed(path.join(VELA, 'config.json'), 'read', policy())).toThrow()
  })
})

describe('会话级授权登记（只能由主进程签发）', () => {
  beforeEach(() => clearGrantsForTest())

  it('grantPath 后按意图放行；未授予的意图仍拒绝', () => {
    grantPath(GRANTED, ['write'])
    const p = policy({ granted: currentGrants() })
    expect(isPathAllowed(path.join(GRANTED, 'a.md'), 'write', p)).toBe(true)
    expect(isPathAllowed(path.join(GRANTED, 'a.md'), 'read', p)).toBe(false)
  })

  it('多次授权取并集', () => {
    grantPath(GRANTED, ['write'])
    grantPath(GRANTED, ['read'])
    const p = policy({ granted: currentGrants() })
    expect(isPathAllowed(path.join(GRANTED, 'a.md'), 'read', p)).toBe(true)
    expect(isPathAllowed(path.join(GRANTED, 'a.md'), 'write', p)).toBe(true)
  })

  it('revoke 后立即失效', () => {
    grantPath(GRANTED, ['read'])
    revokeGrant(GRANTED)
    expect(isPathAllowed(path.join(GRANTED, 'a.md'), 'read', policy({ granted: currentGrants() }))).toBe(false)
  })

  it('空路径登记是 no-op（不抛错、不放行任何东西）', () => {
    grantPath('', ['read'])
    grantPath('   ', ['read'])
    expect(currentGrants().size).toBe(0)
  })
})
