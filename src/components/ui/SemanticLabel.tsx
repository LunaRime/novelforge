import type { ReactNode } from 'react'
import { CircleCheck, CircleDot, CircleX, Compass, Flag, Info, Layers2, MapPin, Scissors, Shield, Sparkles, TriangleAlert, UserRound, UsersRound, Zap } from 'lucide-react'
import { cn } from '../../lib/utils'

const icons = {
  protagonist: Compass, antagonist: Shield, supporting: UsersRound, minor: UserRound,
  core: Flag, important: Layers2, incidental: CircleDot,
  success: CircleCheck, error: CircleX, warning: TriangleAlert, info: Info,
  location: MapPin, power: Zap, truncated: Scissors, update: Sparkles,
} as const

export type SemanticIconName = keyof typeof icons

/** 语义图标随字色缩放，读屏由同排文字提供名称。 */
export function SemanticIcon({ name, size = 13 }: { name: SemanticIconName; size?: number }) {
  const Icon = icons[name]
  return <Icon size={size} aria-hidden="true" className="shrink-0" />
}

export function SemanticLabel({ name, children, className }: {
  name: SemanticIconName
  children: ReactNode
  className?: string
}) {
  return <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
    <SemanticIcon name={name} />
    <span>{children}</span>
  </span>
}
