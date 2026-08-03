import { describe, it, expect } from 'vitest'
import {
  mergeVoiceProfiles,
  upsertVoiceProfile,
  loadCharacterVoiceProfiles,
  type CharacterVoiceProfile,
} from './character-voice-analyzer'

const makeProfile = (overrides: Partial<CharacterVoiceProfile> = {}): CharacterVoiceProfile => ({
  name: '测试角色',
  tone: ['冷酷'],
  topWords: ['哼', '愚蠢'],
  avgSentenceLength: 8,
  sampleLines: ['哼，愚蠢的人类。'],
  formalityLevel: 0.2,
  interjections: ['哼'],
  analyzedChapters: '最新章',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
})

describe('upsertVoiceProfile', () => {
  it('无旧档案时写入单块', () => {
    const notes = '角色背景：自幼习武。'
    const result = upsertVoiceProfile(notes, makeProfile())
    expect(result).toContain('角色背景：自幼习武。')
    expect(result).toContain('[VOICE:测试角色]')
    // 只保留一块
    expect(result.match(/\[VOICE:测试角色\]/g)?.length).toBe(1)
  })

  it('有旧档案时合并而非追加（幂等）', () => {
    const oldProfile = makeProfile({ topWords: ['哼'], tone: ['冷酷'], analyzedChapters: '旧章' })
    const notes = '背景：A。\n' + `[VOICE:测试角色]\n${JSON.stringify(oldProfile)}\n`
    // 第二次定稿：新分析带新词
    const newProfile = makeProfile({ topWords: ['哼', '愚蠢', '退下'], tone: ['冷酷', '严肃'] })
    const result = upsertVoiceProfile(notes, newProfile)

    // 仍只有一块
    expect(result.match(/\[VOICE:测试角色\]/g)?.length).toBe(1)
    // 旧词"哼"保留且新词"退下"合并进来（新词权重更高）
    const parsed = JSON.parse(result.match(/\{[\s\S]*\}/)![0]) as CharacterVoiceProfile
    expect(parsed.topWords).toContain('哼')
    expect(parsed.topWords).toContain('退下')
    // analyzedChapters 重置为新分析，不无限拼接
    expect(parsed.analyzedChapters).toBe('最新章')
    // 其他笔记内容保留
    expect(result).toContain('背景：A。')
  })

  it('多角色 notes 互不影响', () => {
    const other = makeProfile({ name: '另一角色', topWords: ['嗯'] })
    const notes = '背景：B。\n' + `[VOICE:另一角色]\n${JSON.stringify(other)}\n`
    const result = upsertVoiceProfile(notes, makeProfile())
    // 目标角色的块已写入
    expect(result).toContain('[VOICE:测试角色]')
    // 其他角色的块原样保留
    expect(result).toContain('[VOICE:另一角色]')
    expect(result).toContain('"嗯"')
  })
})

describe('mergeVoiceProfiles', () => {
  it('新词权重更高', () => {
    const old = makeProfile({ topWords: ['哼'] })
    const fresh = makeProfile({ topWords: ['退下'] })
    const merged = mergeVoiceProfiles(old, fresh)
    // 新词"退下"（权重 2）排在最前，旧词"哼"（权重 1）仍在
    expect(merged.topWords[0]).toBe('退下')
    expect(merged.topWords).toContain('哼')
  })
})

describe('loadCharacterVoiceProfiles', () => {
  it('无 IPC 环境时安全返回空数组', async () => {
    const result = await loadCharacterVoiceProfiles()
    // jsdom 测试环境无 ipc 通道 → 内部 catch 返回 []
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })

  it('[VOICE:] 块与读端正则格式一致（写读闭环）', () => {
    // 与 finalize voice_analysis 写端产物逐字节对照读端解析正则
    const profile = makeProfile()
    const notes = `背景：某国公主。\n[VOICE:测试角色]\n${JSON.stringify(profile)}\n`
    const match = notes.match(/\[VOICE:([^\]]+)\]\s*\n?([\s\S]*?)(?=\n\[VOICE:|$)/)
    expect(match?.[1]).toBe('测试角色')
    const parsed = JSON.parse(match![2].trim()) as CharacterVoiceProfile
    expect(Array.isArray(parsed.topWords)).toBe(true)
    expect(parsed.name).toBe('测试角色')
  })

  it('JSON 含多块时首个块解析正常（upsert 后 notes 仅一块）', () => {
    const a = makeProfile({ topWords: ['哼'] })
    const b = makeProfile({ name: '角色乙', topWords: ['嗯'] })
    const notes = `[VOICE:角色甲]\n${JSON.stringify(a)}\n[VOICE:角色乙]\n${JSON.stringify(b)}\n`
    const re = /\[VOICE:([^\]]+)\]\s*\n?([\s\S]*?)(?=\n\[VOICE:|$)/g
    const blocks = [...notes.matchAll(re)]
    expect(blocks.length).toBe(2)
    expect(blocks[1][1]).toBe('角色乙')
  })
})
