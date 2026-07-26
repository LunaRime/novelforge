/**
 * RelationshipGraph — 交互式角色关系图谱 (v7 Obsidian 风格)
 *
 * 特性：SVG + React 渲染、拖拽/点击/缩放/筛选、Tier 分级布局、关系类型颜色编码
 */
import { useState, useRef, useMemo, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import type { CharacterCard } from '../../stores/character-store'

// ===== 类型 =====

interface GraphNode {
  name: string
  role: string
  tier: number
  x: number
  y: number
}

interface GraphEdge {
  from: string
  to: string
  type: string
  label: string
}

const RELATION_COLORS: Record<string, string> = {
  ally: '#22c55e',
  enemy: '#ef4444',
  family: '#f59e0b',
  master_student: '#3b82f6',
  lover: '#ec4899',
  rival: '#f97316',
  neutral: '#94a3b8',
  other: '#6b7280',
}

const ROLE_SIZES: Record<string, number> = {
  protagonist: 28,
  antagonist: 26,
  supporting: 20,
  minor: 16,
}

// ===== 关系解析 =====

function parseRelations(characters: CharacterCard[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  const allNames = new Set(characters.map(c => c.name))

  for (const char of characters) {
    // 优先解析结构化 relations
    try {
      const rels = JSON.parse(char.relations || '[]') as Array<{
        target: string; type: string; label: string
      }>
      for (const r of rels) {
        if (r.target && allNames.has(r.target)) {
          // 去重：避免双向关系重复绘制
          const key = [char.name, r.target].sort().join('::')
          if (!edges.some(e => [e.from, e.to].sort().join('::') === key)) {
            edges.push({ from: char.name, to: r.target, type: r.type || 'other', label: r.label || '' })
          }
        }
      }
      if (rels.length > 0) continue
    } catch { /* fallback */ }

    // 回退：解析旧版文本 relationships
    if (!char.relationships) continue
    try {
      const parsed = JSON.parse(char.relationships)
      if (Array.isArray(parsed)) {
        for (const rel of parsed) {
          const target = rel.name || rel.target
          if (target && allNames.has(target)) {
            const key = [char.name, target].sort().join('::')
            if (!edges.some(e => [e.from, e.to].sort().join('::') === key)) {
              edges.push({ from: char.name, to: target, type: rel.type || 'other', label: rel.relation || rel.label || '' })
            }
          }
        }
        continue
      }
    } catch { /* text fallback */ }

    const lines = char.relationships.split(/[,;，；\n]/).filter(Boolean)
    for (const line of lines) {
      const match = line.match(/(.+?)[：:—-]\s*(.+)/)
      if (match && allNames.has(match[1].trim())) {
        const key = [char.name, match[1].trim()].sort().join('::')
        if (!edges.some(e => [e.from, e.to].sort().join('::') === key)) {
          edges.push({ from: char.name, to: match[1].trim(), type: 'other', label: match[2].trim() })
        }
      }
    }
  }
  return edges
}

// ===== 布局引擎 =====

function computeLayout(characters: CharacterCard[], width: number, height: number): GraphNode[] {
  const cx = width / 2
  const cy = height / 2

  // Tier 1 居中，Tier 2 中层环，Tier 3 外层环
  const tierConfig: Record<number, { radius: number }> = {
    1: { radius: Math.min(width, height) * 0.12 },
    2: { radius: Math.min(width, height) * 0.30 },
    3: { radius: Math.min(width, height) * 0.44 },
  }

  const grouped: Record<number, CharacterCard[]> = { 1: [], 2: [], 3: [] }
  for (const c of characters) {
    const t = c.tier || 2
    grouped[t]?.push(c)
  }

  const nodes: GraphNode[] = []
  for (const tier of [1, 2, 3]) {
    const chars = grouped[tier] || []
    const r = tierConfig[tier].radius
    chars.forEach((c, i) => {
      const angle = (i / Math.max(chars.length, 1)) * Math.PI * 2 - Math.PI / 2
      nodes.push({
        name: c.name,
        role: c.role,
        tier: c.tier || 2,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      })
    })
  }
  return nodes
}

// ===== 组件 =====

interface Props {
  characters: CharacterCard[]
  onSelect?: (name: string) => void
}

export default function RelationshipGraph({ characters, onSelect }: Props) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 })
  const [dragging, setDragging] = useState<{ name: string; sx: number; sy: number } | null>(null)
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const edges = useMemo(() => parseRelations(characters), [characters])

  // 基础布局（memo，避免 effect 中 setState）
  const baseLayout = useMemo(
    () => computeLayout(characters, viewBox.w, viewBox.h),
    [characters, viewBox.w, viewBox.h]
  )
  // 可拖拽覆盖的节点位置
  const [dragOffsets, setDragOffsets] = useState<Record<string, { dx: number; dy: number }>>({})
  const visibleNodes = useMemo(() => {
    const filtered = tierFilter ? baseLayout.filter(n => n.tier === tierFilter) : baseLayout
    return filtered.map(n => {
      const off = dragOffsets[n.name]
      return off ? { ...n, x: n.x + off.dx, y: n.y + off.dy } : n
    })
  }, [baseLayout, tierFilter, dragOffsets])

  const visibleEdges = useMemo(() => tierFilter
    ? edges.filter(e => visibleNodes.some(n => n.name === e.from) && visibleNodes.some(n => n.name === e.to))
    : edges, [edges, tierFilter, visibleNodes])

  // 缩放
  const zoom = (factor: number) => {
    setViewBox(vb => {
      const newW = Math.max(300, Math.min(2000, vb.w * factor))
      const newH = Math.max(200, Math.min(1500, vb.h * factor))
      return { ...vb, w: newW, h: newH }
    })
  }

  // 重置视图
  const resetView = () => {
    setViewBox({ x: 0, y: 0, w: 800, h: 600 })
    setDragOffsets({})
  }

  // 拖拽节点
  const handleMouseDown = useCallback((name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDragging({ name, sx: e.clientX, sy: e.clientY })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const dx = (e.clientX - dragging.sx) * (viewBox.w / 800)
    const dy = (e.clientY - dragging.sy) * (viewBox.h / 600)
    setDragOffsets(prev => ({
      ...prev,
      [dragging.name]: {
        dx: (prev[dragging.name]?.dx || 0) + dx,
        dy: (prev[dragging.name]?.dy || 0) + dy,
      },
    }))
    setDragging({ ...dragging, sx: e.clientX, sy: e.clientY })
  }, [dragging, viewBox])

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-muted)]">
        {t('relationshipGraph.empty')}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      {/* 工具栏 */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {/* tier 筛选 */}
        {([null, 1, 2, 3] as Array<number | null>).map(ti => (
          <button
            key={String(ti)}
            className="text-[0.65rem] px-1.5 py-0.5 rounded transition-colors border cursor-pointer"
            style={{
              backgroundColor: tierFilter === ti ? 'rgba(var(--color-accent-rgb),0.15)' : 'var(--color-bg-elevated)',
              borderColor: tierFilter === ti ? 'var(--color-accent)' : 'var(--color-border)',
              color: tierFilter === ti ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            onClick={() => setTierFilter(ti)}
            type="button"
          >
            {ti === null ? t('graph.filterAll') : ti === 1 ? t('graph.tierCore') : ti === 2 ? t('graph.tierImportant') : t('graph.tierMinor')}
          </button>
        ))}
        <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <button
          className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] cursor-pointer"
          onClick={() => zoom(0.8)} title={t('zoom.out')} type="button"
        >
          <ZoomOut size={14} />
        </button>
        <button
          className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] cursor-pointer"
          onClick={() => zoom(1.25)} title={t('zoom.in')} type="button"
        >
          <ZoomIn size={14} />
        </button>
        <button
          className="p-1 rounded hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] cursor-pointer"
          onClick={resetView} title={t('zoom.reset')} type="button"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* 图例 */}
      <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 text-[0.6rem]"
        style={{ color: 'var(--color-text-muted)' }}>
        {Object.entries(RELATION_COLORS).slice(0, 6).map(([k, v]) => (
          <span key={k} className="flex items-center gap-0.5">
            <span className="w-2 h-0.5 rounded" style={{ backgroundColor: v }} />
            {k === 'ally' ? t('character.relType.ally') : k === 'enemy' ? t('character.relType.enemy') : k === 'family' ? t('character.relType.family') :
             k === 'master_student' ? t('character.relType.masterStudent') : k === 'lover' ? t('character.relType.lover') : k === 'rival' ? t('character.relType.rival') : t('character.relType.other')}
          </span>
        ))}
      </div>

      {/* SVG 画布 */}
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        {/* 连线 */}
        {visibleEdges.map((edge, i) => {
          const a = visibleNodes.find(n => n.name === edge.from)
          const b = visibleNodes.find(n => n.name === edge.to)
          if (!a || !b) return null
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          return (
            <g key={i}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={RELATION_COLORS[edge.type] || '#94a3b8'}
                strokeOpacity={0.4}
                strokeWidth={1.5}
              />
              {edge.label && (
                <text x={mx} y={my - 4} textAnchor="middle" fontSize={11}
                  fill="var(--color-text-muted)" opacity={0.7}
                >
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}

        {/* 节点 */}
        {visibleNodes.map(node => {
          const color = node.role === 'protagonist' ? 'var(--color-success)'
            : node.role === 'antagonist' ? 'var(--color-error)'
            : 'var(--color-accent)'
          const r = ROLE_SIZES[node.role] || 18

          return (
            <g key={node.name} style={{ cursor: 'pointer' }}>
              {/* 光晕 */}
              <circle cx={node.x} cy={node.y} r={r + 8} fill={color} opacity={0.08} />
              {/* 节点圆 */}
              <circle
                cx={node.x} cy={node.y} r={r}
                fill={color} fillOpacity={0.2}
                stroke={color} strokeWidth={2}
                onMouseDown={(e) => handleMouseDown(node.name, e)}
                onClick={() => onSelect?.(node.name)}
              />
              {/* 名字 */}
              <text
                x={node.x} y={node.y + r + 14}
                textAnchor="middle" fontSize={12}
                fill={color} fontWeight="bold"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
