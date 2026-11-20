import { createContext, useContext, useState } from 'react'

export interface NavigationSession {
  scope: string
  isExpanded(key: string): boolean | undefined
  saveExpanded(key: string, expanded: boolean): void
  readScrollTop(): number
  saveScrollTop(top: number): void
}

export function createNavigationSession(scope: string): NavigationSession {
  const open = new Map<string, boolean>()
  let scrollTop = 0
  return { scope, isExpanded: key => open.get(key), saveExpanded: (key, expanded) => { open.set(key, expanded) },
    readScrollTop: () => scrollTop, saveScrollTop: top => { scrollTop = top } }
}

export const NavigationSessionContext = createContext<NavigationSession | null>(null)

export function useNavigationExpansion(key: string | undefined, initial = false) {
  const session = useContext(NavigationSessionContext)
  const [expanded, setExpanded] = useState(() => key ? session?.isExpanded(key) ?? initial : initial)
  function toggle() {
    const next = !expanded
    if (key) session?.saveExpanded(key, next)
    setExpanded(next)
  }
  return [expanded, toggle] as const
}
