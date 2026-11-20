import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from './Button'
import './feature-split.css'

export function FeatureSplit({ detailOpen, onBack, list, children }: {
  detailOpen: boolean
  onBack: () => void
  list: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const back = useRef<HTMLButtonElement>(null)
  const previous = useRef(detailOpen)

  useLayoutEffect(() => {
    if (previous.current === detailOpen) return
    previous.current = detailOpen
    if (detailOpen) {
      if (back.current?.checkVisibility?.() !== false) back.current?.focus()
    } else if (listRef.current) {
      listRef.current.scrollTop = scroll.current
      const row = listRef.current.querySelector<HTMLElement>('[aria-current="page"]') ?? listRef.current
      row.focus({ preventScroll: true })
    }
  }, [detailOpen])

  return (
    <div className="nf-feature-split">
      <div className="nf-feature-split-layout" data-feature-view={detailOpen ? 'detail' : 'list'}>
        <div ref={listRef} className="nf-feature-list" tabIndex={-1} data-feature-list data-v3-density-list
          onScroll={event => { if (event.currentTarget.checkVisibility?.() !== false) scroll.current = event.currentTarget.scrollTop }}>
          {list}
        </div>
        <div className="nf-feature-detail">
          <Button className="nf-feature-back self-start my-1 mx-2" variant="ghost" type="button" ref={back} onClick={onBack}>
            <ChevronLeft size={14} aria-hidden="true" /> {t('feature.backToList')}
          </Button>
          {children}
        </div>
      </div>
    </div>
  )
}
