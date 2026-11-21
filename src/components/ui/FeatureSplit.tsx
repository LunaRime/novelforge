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
  const view = list == null ? 'full' : detailOpen ? 'detail' : 'list'
  const previous = useRef(view)

  useLayoutEffect(() => {
    // 窄栏的列表与详情交替可见。返回时恢复列表滚动与键盘位置。
    const prior = previous.current
    previous.current = view
    if (view === 'detail' && prior === 'list') {
      if (back.current?.checkVisibility?.() !== false) back.current?.focus()
    } else if (view === 'list' && prior === 'detail' && listRef.current) {
      listRef.current.scrollTop = scroll.current
      const row = listRef.current.querySelector<HTMLElement>('[aria-current="page"]') ?? listRef.current
      row.focus({ preventScroll: true })
    }
  }, [view])

  return (
    <div className="nf-feature-split">
      <div className="nf-feature-split-layout" data-feature-view={view}>
        {list != null && (
          <div ref={listRef} className="nf-feature-list" tabIndex={-1} data-feature-list data-v3-density-list
            onScroll={event => { if (event.currentTarget.checkVisibility?.() !== false) scroll.current = event.currentTarget.scrollTop }}>
            {list}
          </div>
        )}
        <div className="nf-feature-detail">
          {list != null && (
            <Button className="nf-feature-back" variant="ghost" type="button" ref={back} onClick={onBack}>
              <ChevronLeft size={14} aria-hidden="true" /> {t('feature.backToList')}
            </Button>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
