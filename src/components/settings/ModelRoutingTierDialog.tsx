import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Layers3, ListOrdered, Plus, X } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import CountBadge from '../ui/CountBadge'
import { Button } from '../ui/Button'
import {
  Dialog, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import type { ModelTier } from '../../services/llm/model-router'
import type { ModelProfile } from '../../shared/ipc-channels'
import './model-routing-tier.css'

export interface ModelRoutingTierDialogProps {
  tier: ModelTier
  /** 层名（已本地化，"创意写作层"这类）—— 由调用方给，避免本组件重复查 tier → key 的映射 */
  tierLabel: string
  /** 该层**已存**的模型 id（有序 = 优先级）；只作草稿初值 */
  routeIds: string[]
  /** 候选模型（调用方已过滤掉 embedding 用途的） */
  candidates: ModelProfile[]
  /** 点「保存」才调用 —— patch 形状为 `{ [tier]: ids }`（单层 patch） */
  onSave: (tier: ModelTier, ids: string[]) => void
  onClose: () => void
}

/** 有序列表即路由回退顺序。未保存的变更随弹窗卸载丢弃。 */
export function ModelRoutingTierDialog({ tier, tierLabel, routeIds, candidates, onSave, onClose }: ModelRoutingTierDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string[]>(() => [...routeIds])
  const [dragging, setDragging] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const byId = new Map(candidates.map(model => [model.id, model]))
  const toggle = (id: string) => setDraft(previous => previous.includes(id) ? previous.filter(modelId => modelId !== id) : [...previous, id])

  const move = (from: number, to: number) => {
    setDraft(previous => {
      if (from === to || from < 0 || to < 0 || from >= previous.length || to >= previous.length) return previous
      const models = [...previous]
      const [model] = models.splice(from, 1)
      models.splice(to, 0, model)
      return models
    })
  }
  const clearDrag = () => { dragId.current = null; setDragging(null) }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent preventOutsideClose hideCloseButton className="nf-route-dialog" data-testid="route-tier-dialog">
        <DialogHeader className="nf-route-header">
          <span className="nf-route-symbol"><Layers3 size={21} aria-hidden="true" /></span>
          <div><DialogTitle>{t('route.dialogTitle').replace('{tier}', tierLabel)}</DialogTitle>
            <DialogDescription>{t('route.dialogHint')}</DialogDescription></div>
          <DialogClose asChild><Button variant="ghost" size="icon" aria-label={t('dialog.close')}><X size={16} aria-hidden="true" /></Button></DialogClose>
        </DialogHeader>
        <div className="nf-route-columns">
          <section className="nf-route-priority">
            <h3><ListOrdered size={16} aria-hidden="true" />{t('route.selectedTitle')}<CountBadge value={draft.length} /></h3>
            {draft.length === 0 ? <p className="nf-route-empty">{t('route.tierEmpty')}</p> : <>
              {draft.length > 1 && <p className="nf-route-tip">{t('route.reorderHint')}</p>}
              <ol>
                {draft.map((id, index) => {
                  const model = byId.get(id)
                  return <li key={id} data-testid={`route-selected-${id}`} data-dragging={dragging === id || undefined}
                    draggable={draft.length > 1} onDragStart={event => {
                      dragId.current = id
                      setDragging(id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', id)
                    }} onDragEnd={clearDrag} onDragOver={event => { if (dragId.current) event.preventDefault() }}
                    onDrop={event => {
                      if (!dragId.current) return
                      event.preventDefault()
                      move(draft.indexOf(dragId.current), index)
                      clearDrag()
                    }}>
                    <span className="nf-route-order" aria-hidden="true">{index + 1}</span>
                    <div className="nf-route-name"><strong>{model?.name || model?.modelName || id}</strong>{model && <small>{model.provider}</small>}</div>
                    <div className="nf-route-actions">
                      <Button type="button" variant="ghost" size="icon" onClick={() => move(index, index - 1)} disabled={index === 0}
                        aria-label={t('route.moveUp')} title={t('route.moveUp')} style={{ width: 32, height: 32 }}><ArrowUp size={14} aria-hidden="true" /></Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => move(index, index + 1)} disabled={index === draft.length - 1}
                        aria-label={t('route.moveDown')} title={t('route.moveDown')} style={{ width: 32, height: 32 }}><ArrowDown size={14} aria-hidden="true" /></Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => toggle(id)}
                        aria-label={t('route.removeModel')} title={t('route.removeModel')} style={{ width: 32, height: 32 }}><X size={14} aria-hidden="true" /></Button>
                    </div>
                  </li>
                })}
              </ol>
            </>}
          </section>
          <section className="nf-route-candidates">
            <h3><Plus size={16} aria-hidden="true" />{t('route.candidatesTitle')}<CountBadge value={candidates.length} /></h3>
            {candidates.length === 0 && <p className="nf-route-empty">{t('route.noCandidates')}</p>}
            <div>
              {candidates.map(model => {
                const index = draft.indexOf(model.id)
                return <label key={model.id} data-testid={`route-candidate-${model.id}`} data-selected={index >= 0 || undefined}>
                  <input type="checkbox" checked={index >= 0} onChange={() => toggle(model.id)} />
                  <span className="nf-route-candidate-order" aria-hidden="true">{index >= 0 ? index + 1 : ''}</span>
                  <span className="nf-route-name"><strong>{model.name || model.modelName}</strong><small>{model.provider}</small></span>
                </label>
              })}
            </div>
          </section>
        </div>
        <DialogFooter className="nf-route-footer">
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button onClick={() => { onSave(tier, draft); onClose() }}>{t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
