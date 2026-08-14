import { describe, it, expect } from 'vitest'
import {
  mergeVoiceProfiles,
  upsertVoiceProfile,
  loadCharacterVoiceProfiles,
  analyzeCharacterVoice,
  extractVoiceProfileFromNotes,
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

describe('analyzeCharacterVoice 对话提取（P2-2 增强）', () => {
  it('模式1：角色名+说+冒号+引号', () => {
    const p = analyzeCharacterVoice('苏晚说：“退下，全部退下。”', '苏晚')
    expect(p.sampleLines.some(l => l.includes('退下，全部退下'))).toBe(true)
  })

  it('模式2：引号在前、说话人在后（无中间标点）', () => {
    const p = analyzeCharacterVoice('“我们走吧，师兄。”苏晚道', '苏晚')
    expect(p.sampleLines.some(l => l.includes('我们走吧，师兄'))).toBe(true)
  })

  it('P2-2 模式3：引号段与说话人之间有标点/空格（“走吧。” 苏晚说着）', () => {
    const p = analyzeCharacterVoice('“我们走吧。” 苏晚说着，推开门。', '苏晚')
    expect(p.sampleLines.some(l => l.includes('我们走吧'))).toBe(true)
  })

  it('P2-2 模式3：半角引号 + 逗号分隔', () => {
    const p = analyzeCharacterVoice('"别怕，有我在。"，苏晚道。', '苏晚')
    expect(p.sampleLines.some(l => l.includes('别怕，有我在'))).toBe(true)
  })

  it('其他角色说的话不提取（空档案 tone=未分析）', () => {
    const p = analyzeCharacterVoice('李雷说：“我是李雷。”', '苏晚')
    expect(p.sampleLines.length).toBe(0)
    expect(p.tone).toEqual(['未分析'])
  })

  it('P2-2: 英文对话语气检测（冷酷/悲伤），中文标签输出', () => {
    const p = analyzeCharacterVoice('"You are cold and cruel." 苏晚 said. "I am crying with grief." 苏晚 said.', '苏晚')
    expect(p.tone).toContain('冷酷')
    expect(p.tone).toContain('悲伤')
  })

  it('P2-2: 重复对话行去重（模式1/3 可能同时命中）', () => {
    const p = analyzeCharacterVoice('苏晚说：“退下，都退下。”\n“退下，都退下。” 苏晚道。', '苏晚')
    const dup = p.sampleLines.filter(l => l.includes('退下，都退下'))
    // 去重后同一句只出现一次
    expect(new Set(dup).size).toBe(dup.length)
  })
})

describe('extractVoiceProfileFromNotes（P1-2 单角色同步解析）', () => {
  const validBlock = '[VOICE:苏晚]\n{"name":"苏晚","tone":["冷酷"],"topWords":["退下"],"avgSentenceLength":8,"sampleLines":["退下。"],"formalityLevel":0.8,"interjections":["哼"],"analyzedChapters":"1-3","updatedAt":"2026-01-01"}\n'

  it('解析角色自己的声音档案', () => {
    const p = extractVoiceProfileFromNotes(`角色笔记。\n${validBlock}`, '苏晚')
    expect(p).not.toBeNull()
    expect(p?.tone).toEqual(['冷酷'])
    expect(p?.topWords).toContain('退下')
  })

  it('无块/空 notes → null', () => {
    expect(extractVoiceProfileFromNotes('普通笔记', '苏晚')).toBeNull()
    expect(extractVoiceProfileFromNotes('', '苏晚')).toBeNull()
  })

  it('污染块（块内 name 是其他角色）→ null', () => {
    expect(extractVoiceProfileFromNotes(validBlock, '李雷')).toBeNull()
  })

  it('多块时只取自己角色的块', () => {
    const other = '[VOICE:李雷]\n{"name":"李雷","topWords":["哈"]}\n'
    const p = extractVoiceProfileFromNotes(other + validBlock, '苏晚')
    expect(p?.name).toBe('苏晚')
  })

  it('非法 JSON → null', () => {
    expect(extractVoiceProfileFromNotes('[VOICE:苏晚]\n{broken\n', '苏晚')).toBeNull()
  })
})
