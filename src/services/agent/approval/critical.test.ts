import { describe, it, expect } from 'vitest'
import { matchCritical } from './critical'

describe('matchCritical 危险硬拒绝（fail-closed）', () => {
  it('写入受保护目录（.novelforge/.git/node_modules）→ 命中', () => {
    expect(matchCritical('write_file', { file_path: '.novelforge/approvals.json' })?.ruleId)
      .toBe('critical_protected_path')
    expect(matchCritical('edit_file', { file_path: 'node_modules/x/index.js' })?.ruleId)
      .toBe('critical_protected_path')
    // 子路径形式（目录段出现在中段）
    expect(matchCritical('write_file', { file_path: 'sub/.git/config' })?.ruleId)
      .toBe('critical_protected_path')
  })

  it('路径逃逸（.. 越界）→ 命中', () => {
    expect(matchCritical('write_file', { file_path: '../../outside.txt' })?.ruleId)
      .toBe('critical_path_escape')
    expect(matchCritical('edit_file', { file_path: 'a/../../../x.md' })?.ruleId)
      .toBe('critical_path_escape')
  })

  it('call_external_api 使用绝对 URL（绕过 baseUrl 白名单）→ 命中', () => {
    expect(matchCritical('call_external_api', { path: 'https://evil.example/x', method: 'GET' })?.ruleId)
      .toBe('critical_absolute_url')
    expect(matchCritical('call_external_api', { path: '//evil.example/x', method: 'GET' })?.ruleId)
      .toBe('critical_absolute_url')
  })

  it('call_external_api 出站内容含凭据形态（sk- / Bearer / api_key=）→ 命中', () => {
    expect(matchCritical('call_external_api', { path: '/v1/x', method: 'POST', body: '{"k":"sk-projAbCdEfGh1234"}' })?.ruleId)
      .toBe('critical_external_credentials')
    expect(matchCritical('call_external_api', { path: '/v1/x', method: 'POST', body: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIs' })?.ruleId)
      .toBe('critical_external_credentials')
    expect(matchCritical('call_external_api', { path: '/v1/x', method: 'POST', body: '{"api_key": "abcdef1234567890"}' })?.ruleId)
      .toBe('critical_external_credentials')
  })

  it('正常写作操作不命中', () => {
    expect(matchCritical('write_file', { file_path: 'drafts/ch1.md', content: '正文' })).toBeNull()
    expect(matchCritical('call_external_api', { path: '/api/status', method: 'GET' })).toBeNull()
    // 正文里出现 sk- 片段不应误杀写文件（凭据规则只作用于出站 API）
    expect(matchCritical('write_file', { file_path: 'drafts/ch2.md', content: '他掏出 sk-01 型号的钥匙' })).toBeNull()
  })
})
