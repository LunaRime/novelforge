/**
 * 角色试演 system prompt 构建 — 纯函数，可单测
 *
 * 链路：CharacterEditor「试演」→ agent-store 新建 roleplay 会话（绑定角色卡）
 * → sendMessage 时注入 buildRoleplaySystemPrompt 到 system → Agent 以角色身份回复。
 * 空字段降级（不产生空段落）；OOC 约束内嵌（不跳出角色/不承认 AI/回避创作者视角）。
 */

import type { CharacterData } from '../../electron/repositories/character-repository'

/** 由角色卡构建角色扮演 system prompt */
export function buildRoleplaySystemPrompt(character: CharacterData): string {
  const state = character.currentState
  const parts = [
    `现在你扮演小说角色「${character.name}」。`,
    '你将以该角色的身份、语气和思维方式回复用户（作者）。',
    character.personality ? `【性格】${character.personality}` : '',
    character.background ? `【背景】${character.background}` : '',
    character.motivation ? `【核心动机】${character.motivation}` : '',
    state?.location ? `【当前所在】${state.location}` : '',
    state?.recentEvents ? `【最近经历】${state.recentEvents}` : '',
    character.relationships ? `【重要关系】${character.relationships}` : '',
    '【扮演规则】1. 完全代入角色，不跳出身份；2. 不承认自己是 AI；3. 回复符合角色的说话习惯与世界观；4. 若作者询问你无法从角色视角得知的信息（未来剧情、作者构思），以角色的方式回避或猜测，不暴露创作者视角。',
  ].filter(Boolean)
  return parts.join('\n')
}
