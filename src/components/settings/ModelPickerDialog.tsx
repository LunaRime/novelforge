import { useEffect, useMemo, useState } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import type { LLMModelCandidate, ProviderAccount } from '../../shared/ipc-channels'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'

export interface ModelPickerDialogProps {
  open: boolean
  /**
   * 拉取用的凭据（v3 §4.7）：密钥二选一 —— `apiKeyRef`（已存值由主进程解析）或
   * `apiKeyDraft`（表单里刚输入、尚未保存的一次性草稿）。
   */
  credentials: Pick<ProviderAccount, 'provider' | 'protocol' | 'baseUrl' | 'apiKeyRef'> & { apiKeyDraft?: string }
  /** 已在卡内的模型名（禁用勾选 + 「已添加」标） */
  existing: string[]
  /** 批量采纳：勾选的模型名 + 其规格（仅含实值键；非流式拉不到的模型无规格） */
  onAdopt: (names: string[], specs: Record<string, { contextWindow?: number; maxTokens?: number }>) => void
  onClose: () => void
}

/**
 * ModelPickerDialog —— 「+ 添加模型」的拉取多选 Modal（dsh 式，2026-09-28）。
 *
 * 打开即用**当前凭据**拉取（未保存的 key 也生效）；候选 checkbox 多选 + 搜索 + 全选
 * （只作用可见项）；已在卡内的禁用并标「已添加」；失败不是死路（手工输入仍可添加）。
 * 「采用所选（N）」一次交付（names + specs）——提交门控在父级（saving），本组件用
 * adoptionLock 防连点（Review Focus 1）。
 */
export function ModelPickerDialog({ open, credentials, existing, onAdopt, onClose }: ModelPickerDialogProps) {
  const { t } = useTranslation()
  // ⚠️ 生命周期约定：**打开时应新挂载**（父级条件渲染或 key）——重置靠挂载而非 effect 内
  // 同步 setState（后者会触发 react-hooks 的"cascading renders"规则，且本来就是 key 的职责）。
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<LLMModelCandidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  /** 采用已发出：防连点（父级提交期间再次点击不重复交付） */
  const [adoptionLock, setAdoptionLock] = useState(false)

  const existingSet = useMemo(() => new Set(existing), [existing])

  useEffect(() => {
    if (!open) return
    let stale = false
    // 打开即拉取（挂载时 loading 初值已是 true；结果只在异步回调里 setState）
    void useLLMStore.getState().listProviderModels(credentials)
      .then((res) => {
        if (stale) return
        setLoading(false)
        if (!res.success) {
          setError(res.error ?? t('status.unknown'))
          return
        }
        const list = res.models ?? []
        setCandidates(list)
        if (list.length === 0) setError(t('provider.fetchedEmpty'))
      })
      .catch((e) => {
        if (stale) return
        setLoading(false)
        setError(String(e))
      })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials 为同一卡内的稳定值；打开一次拉取一次
  }, [open])

  const visible = candidates.filter((c) => c.id.toLowerCase().includes(query.trim().toLowerCase()))
  const pickableVisible = visible.filter((c) => !existingSet.has(c.id))
  const allPicked = pickableVisible.length > 0 && pickableVisible.every((c) => picked.has(c.id))

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (allPicked) pickableVisible.forEach((c) => next.delete(c.id))
      else pickableVisible.forEach((c) => next.add(c.id))
      return next
    })
  }

  const addManual = () => {
    const name = manual.trim()
    if (!name) return
    setPicked((prev) => new Set(prev).add(name))
    setManual('')
  }

  const adopt = () => {
    if (adoptionLock || picked.size === 0) return
    setAdoptionLock(true)
    const specs: Record<string, { contextWindow?: number; maxTokens?: number }> = {}
    for (const c of candidates) {
      if (!picked.has(c.id)) continue
      const s: { contextWindow?: number; maxTokens?: number } = {}
      if (c.contextWindow !== undefined) s.contextWindow = c.contextWindow
      if (c.maxTokens !== undefined) s.maxTokens = c.maxTokens
      if (Object.keys(s).length > 0) specs[c.id] = s
    }
    onAdopt([...picked], specs)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('modelPicker.title')}</DialogTitle>
          <DialogDescription>{t('provider.hintBeforeFetch')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 mt-1">
          <Input
            type="search"
            className="h-6 text-micro flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('provider.searchPlaceholder')}
            aria-label={t('provider.searchPlaceholder')}
          />
          <Button variant="ghost" size="sm" disabled={pickableVisible.length === 0} onClick={toggleAllVisible}>
            {allPicked ? t('provider.deselectAll') : t('provider.selectAll')}
          </Button>
        </div>

        {loading && (
          <p className="text-2xs" style={{ color: 'var(--color-text-muted)' }}>{t('provider.fetching')}</p>
        )}
        {error && (
          <p className="text-2xs break-all" style={{ color: 'var(--color-error)' }}>{error}</p>
        )}

        <div
          className="max-h-72 overflow-y-auto rounded-lg p-1 space-y-0.5"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {visible.map((c) => {
            const isExisting = existingSet.has(c.id)
            return (
              <label
                key={c.id}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-[var(--color-hover)]"
                style={{ opacity: isExisting ? 0.55 : 1 }}
              >
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer flex-shrink-0"
                  checked={picked.has(c.id)}
                  disabled={isExisting}
                  onChange={() => toggle(c.id)}
                />
                <span className="truncate flex-1" style={{ color: 'var(--color-text)' }}>{c.id}</span>
                {isExisting && (
                  <span className="text-2xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {t('modelPicker.alreadyAdded')}
                  </span>
                )}
              </label>
            )
          })}
          {!loading && visible.length === 0 && (
            <p className="text-2xs px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>{t('modelPicker.empty')}</p>
          )}
          {/* 手工输入：端点无列表/拉取失败时的出路 */}
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Input
              type="text"
              className="h-6 text-micro"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addManual() }}
              placeholder={t('modelPicker.manualPlaceholder')}
            />
            <Button variant="outline" size="sm" disabled={!manual.trim()} onClick={addManual}>
              {t('modelPicker.manualAdd')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button disabled={picked.size === 0 || adoptionLock} onClick={adopt}>
            {t('modelPicker.adopt').replace('{n}', String(picked.size))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
