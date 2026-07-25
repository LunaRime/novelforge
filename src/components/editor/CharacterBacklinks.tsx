/**
 * CharacterBacklinks — 角色反向链接面板 (Obsidian 风格)
 *
 * 展示：出场章节 / 被提及于 / 关联角色 / 关系网络
 */
import { useMemo } from 'react'
import { Hash, MessageCircle, Users } from 'lucide-react'
import type { CharacterCard } from '../../stores/character-store'

interface Props {
  character: CharacterCard
  allCharacters: CharacterCard[]
}

export default function CharacterBacklinks({ character, allCharacters }: Props) {
  // 出场章节
  const appearChapters = useMemo(() => {
    try { return JSON.parse(character.appearChapters || '[]') as number[] }
    catch { return [] }
  }, [character.appearChapters])

  // 结构化关系
  const relations = useMemo(() => {
    try { return JSON.parse(character.relations || '[]') as Array<{ target: string; type: string; label: string; sinceChapter: number }> }
    catch { return [] }
  }, [character.relations])

  // 反向关系：哪些角色提到了当前角色
  const backlinks = useMemo(() => {
    const result: Array<{ name: string; type: string; label: string }> = []
    for (const other of allCharacters) {
      if (other.name === character.name) continue
      try {
        const rels = JSON.parse(other.relations || '[]') as Array<{ target: string; type: string; label: string }>
        for (const r of rels) {
          if (r.target === character.name) {
            result.push({ name: other.name, type: r.type || 'other', label: r.label || '' })
          }
        }
      } catch { /* skip */ }
    }
    return result
  }, [character.name, allCharacters])

  // 通过关系关联但未在双向 relation 中出现的角色（图谱隐含关系）
  const implicitLinks = useMemo(() => {
    return allCharacters.filter(c =>
      c.name !== character.name &&
      !relations.some(r => r.target === c.name) &&
      !backlinks.some(b => b.name === c.name) &&
      appearChapters.length > 0
    ).slice(0, 5) // 只取前5个无关角色作为"潜在关联"
  }, [allCharacters, character.name, relations, backlinks, appearChapters])

  return (
    <div className="space-y-4 px-4 py-3">
      {/* 出场章节 */}
      <Section icon={<Hash size={12} />} title="出场章节">
        {appearChapters.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {appearChapters.map(ch => (
              <span
                key={ch}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                第{ch}章
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">暂无出场记录</span>
        )}
      </Section>

      {/* 正向关系 */}
      {relations.length > 0 && (
        <Section icon={<Users size={12} />} title="关联角色">
          <div className="space-y-1">
            {relations.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs py-0.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <span className="font-medium text-[var(--color-text)]">{r.target}</span>
                <span className="opacity-50">{r.label || r.type}</span>
                {r.sinceChapter > 0 && (
                  <span className="opacity-30 ml-auto">第{r.sinceChapter}章</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 反向链接（被谁提及） */}
      {backlinks.length > 0 && (
        <Section icon={<MessageCircle size={12} />} title="被提及于">
          <div className="space-y-1">
            {backlinks.map((b, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs py-0.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <span className="font-medium text-[var(--color-text)]">{b.name}</span>
                <span className="opacity-50">→ {b.label || b.type}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 状态摘要 */}
      {character.currentState && (
        <Section icon={<Hash size={12} />} title="当前状态摘要">
          <div className="text-xs space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {character.currentState.location && <div>📍 {character.currentState.location}</div>}
            {character.currentState.powerLevel && <div>⚡ {character.currentState.powerLevel}</div>}
            {character.currentState.recentEvents && (
              <div className="opacity-70">最近：{character.currentState.recentEvents}</div>
            )}
          </div>
          <div className="text-[0.65rem] mt-1 opacity-40">
            最后更新：第{character.currentState.updatedAtChapter || 0}章
          </div>
        </Section>
      )}

      {/* 空状态 */}
      {relations.length === 0 && backlinks.length === 0 && appearChapters.length === 0 && (
        <div className="text-center py-6">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">暂无关系数据</div>
          <div className="text-[0.65rem] opacity-50">
            定稿后 AI 将自动分析角色关系
          </div>
          {implicitLinks.length > 0 && (
            <div className="mt-2 text-[0.6rem] opacity-30">
              潜在关联：{implicitLinks.map(c => c.name).join('、')}等
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, children }: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
        <span className="text-xs font-medium text-[var(--color-text)]">{title}</span>
      </div>
      {children}
    </div>
  )
}
