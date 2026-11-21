import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowUpRight, ChevronRight, Maximize2, Network, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { parseAliases } from '../../services/character-normalize'
import { groupByTier, type CharacterCard } from '../../stores/character-store'
import { Button } from '../ui/Button'
import { FilterButtons } from '../ui/ChoiceControls'
import CountBadge from '../ui/CountBadge'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { SemanticLabel } from '../ui/SemanticLabel'
import { characterRole, characterRoles, characterTier } from './character-labels'
import { readCharacterRelations, relationLabels } from './character-links'

type Point = { x: number; y: number }
type GraphNode = Point & { card: CharacterCard; radius: number }
type GraphEdge = { source: string; target: string; type: string; label: string; id: string }

const RELATION_COLORS: Record<string, string> = {
  ally: 'var(--color-success)',
  enemy: 'var(--color-error)',
  family: 'var(--color-warning)',
  master_student: 'var(--color-info)',
  lover: 'var(--color-accent)',
  rival: 'var(--color-gold)',
  neutral: 'var(--color-text-muted)',
  other: 'var(--color-text-secondary)',
}

const ORIGIN = { x: 0, y: 0 }
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3.5

function buildEdges(characters: CharacterCard[]): GraphEdge[] {
  const names = new Set(characters.map(card => card.name))
  const edges = new Map<string, GraphEdge>()
  for (const card of characters) {
    for (const relation of readCharacterRelations(card)) {
      if (relation.target === card.name || !names.has(relation.target)) continue
      // 双向记录共用一条连线，具体方向与说明仍可在反向链接中查阅。
      const id = JSON.stringify([card.name, relation.target].sort())
      if (!edges.has(id)) edges.set(id, { ...relation, source: card.name, id })
    }
  }
  return [...edges.values()]
}

function layoutNodes(characters: CharacterCard[]) {
  const groups = groupByTier(characters)
  const nodes: GraphNode[] = []
  let previousRing = 0
  for (const tier of [1, 2, 3]) {
    const cards = groups[tier]
    if (cards.length === 0) continue
    // 较大的分组扩展环半径，为姓名和节点留出空间。
    const ring = nodes.length === 0 && cards.length === 1
      ? 0
      : Math.max(previousRing + 118, cards.length * 105 / (2 * Math.PI))
    previousRing = ring
    const radius = tier === 1 ? 27 : tier === 2 ? 23 : 19
    cards.forEach((card, index) => {
      const theta = index * Math.PI * 2 / cards.length - Math.PI / 2 + (tier === 2 ? Math.PI / cards.length : 0)
      nodes.push({ card, radius, x: Math.cos(theta) * ring, y: Math.sin(theta) * ring })
    })
  }
  let width = 500
  let height = 340
  for (const node of nodes) {
    width = Math.max(width, 2 * Math.abs(node.x) + 160)
    height = Math.max(height, 2 * Math.abs(node.y) + 160)
  }
  return { nodes, width, height }
}

function abbreviate(text: string, length: number) {
  const characters = Array.from(text)
  return characters.length > length ? characters.slice(0, length).join('') + '…' : text
}

interface Props {
  characters: CharacterCard[]
  selectedName: string | null
  onSelect: (name: string) => void
}

interface Drag {
  id: number
  name?: string
  moved: boolean
  start: Point
  origin: Point
  scale: number
}

export default function RelationshipGraph({ characters, selectedName, onSelect }: Props) {
  const { t } = useTranslation()
  const [tier, setTier] = useState(0)
  const [search, setSearch] = useState('')
  const [focusedName, setFocusedName] = useState(selectedName)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>(ORIGIN)
  const [offsets, setOffsets] = useState(() => new Map<string, Point>())
  const gridId = useId()
  const drag = useRef<Drag | null>(null)
  const edges = useMemo(() => buildEdges(characters), [characters])
  const tiers = useMemo(() => groupByTier(characters), [characters])
  const tierCharacters = tier === 0 ? characters : tiers[tier]
  const query = search.trim().toLowerCase()
  const matches = useMemo(() => new Set(tierCharacters
    .filter(card => [card.name, ...parseAliases(card.aliases)].some(value => value.toLowerCase().includes(query)))
    .map(card => card.name)), [query, tierCharacters])
  const displayed = useMemo(() => {
    if (!query) return tierCharacters
    const neighbors = new Set(matches)
    for (const edge of edges) {
      if (matches.has(edge.source)) neighbors.add(edge.target)
      if (matches.has(edge.target)) neighbors.add(edge.source)
    }
    return tierCharacters.filter(card => neighbors.has(card.name))
  }, [query, tierCharacters, matches, edges])
  const layout = useMemo(() => layoutNodes(displayed), [displayed])
  const nodes = new Map(layout.nodes.map(node => {
    const offset = offsets.get(node.card.name) ?? ORIGIN
    return [node.card.name, { ...node, x: node.x + offset.x, y: node.y + offset.y }]
  }))
  const visibleEdges = edges.filter(edge => nodes.has(edge.source) && nodes.has(edge.target))
  const types = [...new Set(visibleEdges.map(edge => edge.type))]
  const focused = focusedName === null ? undefined : nodes.get(focusedName)
  const focusedEdges = focused ? visibleEdges.filter(edge => edge.source === focusedName || edge.target === focusedName) : []
  const neighbors = new Set(focusedEdges.map(edge => edge.source === focusedName ? edge.target : edge.source))
  const width = layout.width / zoom
  const height = layout.height / zoom
  const left = -width / 2 - pan.x
  const top = -height / 2 - pan.y

  const resetViewport = () => {
    setZoom(1)
    setPan(ORIGIN)
    setOffsets(new Map())
  }

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    const name = (event.target as Element).closest<SVGGElement>('[data-graph-node]')?.dataset.graphNode
    drag.current = {
      id: event.pointerId,
      name,
      moved: false,
      start: { x: event.clientX, y: event.clientY },
      origin: name === undefined ? pan : offsets.get(name) ?? ORIGIN,
      scale: Math.max(width / bounds.width, height / bounds.height),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current
    if (current?.id !== event.pointerId) return
    const dx = event.clientX - current.start.x
    const dy = event.clientY - current.start.y
    if (!current.moved && Math.hypot(dx, dy) < 4) return
    current.moved = true
    const x = current.origin.x + dx * current.scale
    const y = current.origin.y + dy * current.scale
    const name = current.name
    if (name === undefined) setPan({ x, y })
    else setOffsets(previous => new Map(previous).set(name, { x, y }))
  }

  const handlePointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current
    if (current?.id !== event.pointerId) return
    drag.current = null
    if (event.type === 'pointerup' && !current.moved) setFocusedName(current.name ?? null)
  }

  if (characters.length === 0) return <EmptyState icon={<Network size={32} />} message={t('relationshipGraph.empty')} />

  return (
    <div className="nf-relationship-graph">
      <div className="nf-graph-toolbar">
        <div className="nf-character-search">
          <Search size={14} aria-hidden="true" />
          <Input type="search" value={search} placeholder={t('charList.searchPlaceholder')} aria-label={t('charList.searchPlaceholder')}
            onChange={event => {
              setSearch(event.currentTarget.value)
              setFocusedName(null)
              resetViewport()
            }} />
        </div>
        <FilterButtons size="sm" value={tier} onChange={value => { setTier(value); resetViewport() }}
          items={[0, 1, 2, 3].map(value => ({
            value,
            label: value === 0 ? t('graph.filterAll') : t(characterTier(value).label),
          }))} />
        <div className="nf-graph-zoom" aria-label={t('graph.canvasControls')} role="group">
          <Button type="button" variant="ghost" size="icon" className="size-[32px]" title={t('zoom.out')} aria-label={t('zoom.out')}
            disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(value => Math.max(MIN_ZOOM, value / 1.25))}>
            <ZoomOut size={14} aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-[32px]" onClick={resetViewport}
            title={t('graph.resetView')} aria-label={t('graph.resetView')}><Maximize2 size={14} aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-[32px]" title={t('zoom.in')} aria-label={t('zoom.in')}
            disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(value => Math.min(MAX_ZOOM, value * 1.25))}>
            <ZoomIn size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {nodes.size === 0 ? <EmptyState message={t('charList.noMatches')} /> : (
        <div className="nf-graph-workspace">
          <div className="nf-graph-main">
            <svg
              role="group"
              aria-label={t('character.relationGraph')}
              viewBox={`${left} ${top} ${width} ${height}`}
              className="nf-graph-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
            >
              <defs>
                <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="12" cy="12" r="0.9" fill="var(--color-border)" />
                </pattern>
              </defs>
              <rect x={left} y={top} width={width} height={height} fill={`url(#${gridId})`} aria-hidden="true" />
              {visibleEdges.map(edge => {
                const start = nodes.get(edge.source)!
                const end = nodes.get(edge.target)!
                const connected = edge.source === focusedName || edge.target === focusedName
                // 近垂直的连线把标签放在侧边，避免盖住节点下方的姓名。
                const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x)
                return (
                  <g key={edge.id} className="nf-graph-edge" data-dimmed={!!focused && !connected} aria-hidden="true">
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                      stroke={RELATION_COLORS[edge.type]} strokeWidth={connected ? 2.5 : 1.5} />
                    {connected && (
                      <text className="nf-graph-edge-label" textAnchor={vertical ? 'start' : 'middle'}
                        x={(start.x + end.x) / 2 + (vertical ? 10 : 0)} y={(start.y + end.y) / 2 + (vertical ? 4 : -9)}>
                        {abbreviate(edge.label || t(relationLabels[edge.type]), 22)}
                      </text>
                    )}
                  </g>
                )
              })}
              {[...nodes.values()].map(({ card, radius, x, y }) => {
                const active = focusedName === card.name
                const name = card.name || t('character.unnamed')
                return (
                  <g key={card.name} data-graph-node={card.name} className="nf-graph-node" role="button"
                    tabIndex={0} aria-pressed={active} aria-label={name} data-role={characterRole(card.role)}
                    data-muted={!active && (focused ? !neighbors.has(card.name) : !matches.has(card.name))}
                    transform={`translate(${x} ${y})`}
                    onClick={event => { if (event.detail === 0) setFocusedName(card.name) }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setFocusedName(card.name)
                    }}>
                    <title>{name}</title>
                    <circle className="nf-graph-node-ring" r={radius + 5} />
                    <circle className="nf-graph-node-circle" r={radius} />
                    <text className="nf-graph-node-initial" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
                      {Array.from(name)[0]}
                    </text>
                    <text className="nf-graph-node-label" textAnchor="middle" y={radius + 18} aria-hidden="true">
                      {abbreviate(name, 16)}
                    </text>
                  </g>
                )
              })}
            </svg>
            <div className="nf-graph-footer">
              <span className="nf-character-note" role="status">
                {t('graph.summary').replace('{characters}', String(nodes.size)).replace('{links}', String(visibleEdges.length))}
              </span>
              {types.length > 0 && (
                <ul className="nf-graph-legend">
                  {types.map(type => <li key={type}><span style={{ background: RELATION_COLORS[type] }} />{t(relationLabels[type])}</li>)}
                </ul>
              )}
            </div>
          </div>
          <aside className="nf-graph-inspector" aria-label={t('character.relations')}>
            {focused ? (
              <>
                <div className="nf-graph-inspector-profile">
                  <div className="min-w-0">
                    <h3 title={focused.card.name}>{focused.card.name || t('character.unnamed')}</h3>
                    <SemanticLabel name={characterRole(focused.card.role)}>{t(characterRoles[characterRole(focused.card.role)])}</SemanticLabel>
                  </div>
                  <Button type="button" variant="outline" size="icon" className="size-[32px] shrink-0" title={t('graph.openProfile')}
                    aria-label={t('graph.openProfile')} onClick={() => onSelect(focused.card.name)}>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Button>
                </div>
                <div className="nf-graph-inspector-heading">
                  <h4>{t('character.relations')}</h4>
                  <CountBadge value={focusedEdges.length} />
                </div>
                {focusedEdges.length === 0 ? <p className="nf-character-note">{t('character.backlinks.noRelations')}</p> : (
                  <ul className="nf-graph-neighbors">
                    {focusedEdges.map(edge => {
                      const name = edge.source === focusedName ? edge.target : edge.source
                      return (
                        <li key={edge.id}>
                          <button type="button" title={name} onClick={() => setFocusedName(name)}>
                            <span className="min-w-0">
                              <strong>{name}</strong>
                              <span className="block truncate">{edge.label || t(relationLabels[edge.type])}</span>
                            </span>
                            <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            ) : <p className="nf-character-note">{t('graph.selectCharacter')}</p>}
          </aside>
        </div>
      )}
    </div>
  )
}
