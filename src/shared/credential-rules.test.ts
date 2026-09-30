/**
 * 凭据规则纯函数单测（模型管理 v3 §4.3/§4.4）
 *
 * 这两条规则是**主/渲染共用**的：
 *  - `deriveCredentialRef` 只在主进程分配 ref 时用（T2 save-provider）；
 *  - `apiKeyFailure` 渲染层（T6 密钥框行内红字）与主进程（credential:set 拒绝）**都**用，
 *    所以两边的判据必须完全一致 —— 单源在这里。
 */
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

  it('已占用集合为空集也不受影响（返回词干本身）', () => {
    expect(deriveCredentialRef('deepseek', new Set(['OTHER_KEY']))).toBe('DEEPSEEK_API_KEY')
  })
})

describe('apiKeyFailure', () => {
  it('空串通过（= 不提供）；纯空白拒绝', () => {
    expect(apiKeyFailure('')).toBeUndefined()
    expect(apiKeyFailure('   ')).toBe('keyBlank')
    expect(apiKeyFailure('\t\n')).toBe('keyBlank')
  })

  it('拒绝 NAME=value 行与引号包裹', () => {
    expect(apiKeyFailure('OPENAI_API_KEY=sk-abc')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('"sk-abc"')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure("'sk-abc'")).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('`sk-abc`')).toBe('keyIllegalCharacters')
  })

  it('拒绝非可打印 ASCII（含中文/控制符）', () => {
    expect(apiKeyFailure('sk-密钥')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('sk-abc\t')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure(' sk-abc')).toBe('keyIllegalCharacters')
    expect(apiKeyFailure('sk-abc ')).toBe('keyIllegalCharacters')
  })

  it('正常 key 通过（含 sk- 前缀与 base64 形）', () => {
    expect(apiKeyFailure('sk-proj-abcDEF123')).toBeUndefined()
    expect(apiKeyFailure('ABCD==efgh')).toBeUndefined() // 全大写 + == 结尾不误判 env 行
  })
})
