/**
 * 角色试演 system prompt 构建 — 纯函数，可单测
 *
 * 链路：CharacterEditor「试演」→ agent-store 新建 roleplay 会话（绑定角色卡）
 * → sendMessage 时注入 buildRoleplaySystemPrompt 到 system → Agent 以角色身份回复。
 *
 * P1-3：指令文本三语化（zh-CN/en-US/ru-RU，随当前 locale 输出）；
 * P1-2：注入角色声音档案（[VOICE:] 块——语气/高频词/句式），试演保持说话风格一致。
 * 空字段降级（不产生空段落）；OOC 约束内嵌（不跳出角色/不承认 AI/回避创作者视角）。
 */

import type { CharacterData } from '../../electron/repositories/character-repository'
import { getCurrentLocale, type SupportedLocale } from '../shared/locale'
import { extractVoiceProfileFromNotes } from './character-voice-analyzer'

/** 各语言指令文本（prompt 数据，与 prompts 的 locale 变体机制一致） */
interface RoleplayTexts {
  persona: string
  identity: string
  fieldPersonality: string
  fieldBackground: string
  fieldMotivation: string
  fieldLocation: string
  fieldRecent: string
  fieldRelations: string
  fieldVoice: string
  rules: string
}

const TEXTS: Record<SupportedLocale, RoleplayTexts> = {
  'zh-CN': {
    persona: '现在你扮演小说角色「{name}」。',
    identity: '你将以该角色的身份、语气和思维方式回复用户（作者）。',
    fieldPersonality: '【性格】',
    fieldBackground: '【背景】',
    fieldMotivation: '【核心动机】',
    fieldLocation: '【当前所在】',
    fieldRecent: '【最近经历】',
    fieldRelations: '【重要关系】',
    fieldVoice: '【声音档案】',
    rules: '【扮演规则】1. 完全代入角色，不跳出身份；2. 不承认自己是 AI；3. 回复符合角色的说话习惯与世界观；4. 若作者询问你无法从角色视角得知的信息（未来剧情、作者构思），以角色的方式回避或猜测，不暴露创作者视角。',
  },
  'en-US': {
    persona: 'You are now playing the novel character "{name}".',
    identity: 'You will reply to the user (the author) as this character — with their identity, tone and way of thinking.',
    fieldPersonality: '【Personality】',
    fieldBackground: '【Background】',
    fieldMotivation: '【Core motivation】',
    fieldLocation: '【Current location】',
    fieldRecent: '【Recent events】',
    fieldRelations: '【Important relationships】',
    fieldVoice: '【Voice profile】',
    rules: '【Roleplay rules】1. Fully embody the character, never break character; 2. Never admit you are an AI; 3. Reply in line with the character\'s speech habits and worldview; 4. If the author asks for information you cannot know from the character\'s perspective (future plot, author intent), dodge or guess in-character — never reveal the creator\'s perspective.',
  },
  'ru-RU': {
    persona: 'Теперь ты играешь персонажа романа «{name}».',
    identity: 'Ты будешь отвечать пользователю (автору) от лица этого персонажа — с его идентичностью, тоном и образом мыслей.',
    fieldPersonality: '【Характер】',
    fieldBackground: '【Происхождение】',
    fieldMotivation: '【Ключевая мотивация】',
    fieldLocation: '【Текущее место】',
    fieldRecent: '【Недавние события】',
    fieldRelations: '【Важные связи】',
    fieldVoice: '【Голосовой профиль】',
    rules: '【Правила отыгрыша】1. Полностью вживайся в роль, не выходи из образа; 2. Не признавай, что ты ИИ; 3. Отвечай в соответствии с речевыми привычками и мировоззрением персонажа; 4. Если автор спрашивает о том, чего персонаж не может знать (будущий сюжет, замысел автора), уклоняйся или предполагай в образе — не раскрывай взгляд автора.',
  },
}

/** 由角色卡构建角色扮演 system prompt（locale 可选传入，默认当前运行时语言） */
export function buildRoleplaySystemPrompt(character: CharacterData, locale?: SupportedLocale): string {
  const lang = locale ?? getCurrentLocale()
  const tx = TEXTS[lang] ?? TEXTS['zh-CN']
  const state = character.currentState
  // P1-2：注入该角色 [VOICE:] 声音档案（语气/高频词/典型句式），试演说话风格与正文一致
  const voice = extractVoiceProfileFromNotes(character.notes ?? '', character.name)
  const voiceText = voice ? formatVoiceProfileForRoleplay(voice) : ''

  const parts = [
    tx.persona.replace('{name}', character.name),
    tx.identity,
    character.personality ? `${tx.fieldPersonality}${character.personality}` : '',
    character.background ? `${tx.fieldBackground}${character.background}` : '',
    character.motivation ? `${tx.fieldMotivation}${character.motivation}` : '',
    state?.location ? `${tx.fieldLocation}${state.location}` : '',
    state?.recentEvents ? `${tx.fieldRecent}${state.recentEvents}` : '',
    character.relationships ? `${tx.fieldRelations}${character.relationships}` : '',
    voiceText ? `${tx.fieldVoice}\n${voiceText}` : '',
    tx.rules,
  ].filter(Boolean)
  return parts.join('\n')
}

/** 声音档案 → 试演注入文本（语气/高频词/典型对话；数据字段保持原文） */
function formatVoiceProfileForRoleplay(voice: {
  tone: string[]
  topWords: string[]
  avgSentenceLength: number
  sampleLines: string[]
}): string {
  const toneStr = voice.tone.join('、')
  const wordsStr = voice.topWords.slice(0, 10).join('、')
  const samplesStr = voice.sampleLines.map(l => `"${l}"`).join('；')
  return (
    `语气[${toneStr}] | 常用词[${wordsStr}] | 句长约${voice.avgSentenceLength}字` +
    (samplesStr ? `\n典型对话: ${samplesStr}` : '')
  )
}
