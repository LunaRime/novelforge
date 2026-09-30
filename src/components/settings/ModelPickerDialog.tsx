import { useEffect, useMemo, useState } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import type { LLMModelCandidate, ProviderModelQuery } from '../../shared/ipc-channels'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'

/**
 * 一个被采纳的模型（候选的「可落盘子集」，模型管理 v3 §5）。
 *
 * ⚠️ 三个名字要分清：`name` 是**模型 ID**（进 `modelNames`、派生条目 id 的后半），
 * `displayName` 才是给人看的显示名（缺省 = 无 → 界面回落模型 ID）。
 */
export interface AdoptedModel {
  /** 模型 ID（`LLMModelCandidate.id`） */
  name: string
  /** 显示名（`LLMModelCandidate.name`）；缺省 = 这一项没有显示名 */
  displayName?: string
  contextWindow?: number
  maxTokens?: number
  inputTypes?: Array<'text' | 'image'>
}

/** 候选 → 采纳项（只搬实值键：`undefined` 不许在交付里出现，否则会覆盖目录里的真值） */
function adoptedOf(candidate: LLMModelCandidate): AdoptedModel {
  return {
    name: candidate.id,
    ...(candidate.name !== undefined ? { displayName: candidate.name } : {}),
    ...(candidate.contextWindow !== undefined ? { contextWindow: candidate.contextWindow } : {}),
    ...(candidate.maxTokens !== undefined ? { maxTokens: candidate.maxTokens } : {}),
    ...(candidate.inputTypes !== undefined ? { inputTypes: [...candidate.inputTypes] } : {}),
  }
}

export interface ModelPickerDialogProps {
  open: boolean
  /**
   * 拉取用的凭据（v3 §4.7）：密钥二选一 —— `apiKeyRef`（已存值由主进程解析）或
   * `apiKeyDraft`（表单里刚输入、尚未保存的一次性草稿）。
   */
  credentials: ProviderModelQuery
  /** 目录里**已有**的模型 ID：默认不勾（但可勾 —— 采纳时只补齐缺失字段） */
  existing: string[]
  /** 批量采纳：勾选的模型（含规格；手工输入的项只有 id）。合并由目录区做 */
  onAdopt: (models: AdoptedModel[]) => void
  onClose: () => void
}

/**
 * ModelPickerDialog —— 「获取可用模型」的候选多选 Modal（dsh 式，2026-09-28 / v3 §5 规则升级）。
 *
 * 打开即用**当前凭据**拉取（未保存的 key 也生效；有内置目录的 provider 由主进程免网络直答）。
 *
 * 五条规则（v3 §5，逐条都有用例钉着）：
 * 1. **新候选默认勾选**（端点/目录给的清单就是「可用的」，用户要的是取消掉不要的那几个）；
 * 2. **已存在默认不勾但可勾** —— 已存在不代表不该重采纳（端点可能带来了新的容量/显示名），
 *    要覆盖就交给目录区那条「保留用户值、只补齐缺失字段」的合并规则，而不是在这里禁死；
 * 3. **全选只作用可见项**（搜索挡住的项不该被顺手勾上），**「取消全选」清全部**（防误采纳隐藏项）；
 * 4. 搜索匹配 **id 与显示名**；行上等宽 id + `title=显示名`（无显示名回落 id）；
 * 5. 失败不是死路：手工输入行常驻，拉不到清单也能加模型。
 *
 * 「采用所选（N）」一次交付 `AdoptedModel[]`——提交门控在父级，本组件用
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
  /** 手工加入的 id（有先后）—— 它们不在候选表里，交付时要单独拼上（无规格） */
  const [manualPicked, setManualPicked] = useState<string[]>([])
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
        // 默认勾选 = **新候选**（目录里还没有的）——已存在的留给用户显式勾
        setPicked(new Set(list.filter((c) => !existingSet.has(c.id)).map((c) => c.id)))
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

  const needle = query.trim().toLowerCase()
  const visible = candidates.filter((c) =>
    needle === '' || c.id.toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle))
  /** 可见项全勾 —— 「取消全选」的显示条件（可见项为空时不算「全勾」） */
  const allVisiblePicked = visible.length > 0 && visible.every((c) => picked.has(c.id))
  /**
   * 按钮的两种形态：可见项全勾 → 「取消全选」（清全部）；
   * 没可见项但有勾选（失败态下手工加的）→ 也给「取消全选」，否则那个勾就没法撤。
   */
  const showDeselect = allVisiblePicked || (visible.length === 0 && picked.size > 0)
  const toggleDisabled = visible.length === 0 && picked.size === 0

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
      // 「取消全选」清的是**全部**（§5）：被搜索挡住的行、手工加的 id 一并清掉
      if (showDeselect) return new Set<string>()
      const next = new Set(prev)
      visible.forEach((c) => next.add(c.id))  // 「全选」只加可见项
      return next
    })
  }

  const addManual = () => {
    const name = manual.trim()
    if (!name) return
    setPicked((prev) => new Set(prev).add(name))
    setManualPicked((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setManual('')
  }

  const adopt = () => {
    if (adoptionLock || picked.size === 0) return
    setAdoptionLock(true)
    // 候选序（端点/目录序）优先，随后是手工项（加入序）——不含未勾选者
    const models: AdoptedModel[] = candidates.filter((c) => picked.has(c.id)).map(adoptedOf)
    const emitted = new Set(models.map((m) => m.name))
    for (const name of manualPicked) {
      if (picked.has(name) && !emitted.has(name)) models.push({ name })
    }
    onAdopt(models)
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
          <Button variant="ghost" size="sm" disabled={toggleDisabled} onClick={toggleAllVisible}>
            {showDeselect ? t('provider.deselectAll') : t('provider.selectAll')}
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
              >
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer flex-shrink-0"
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {/* 等宽 id + title=显示名（§5）：模型 ID 是标识符，不是散文 —— 对齐着看才分得清 */}
                <span
                  className="truncate flex-1 font-mono"
                  style={{ color: 'var(--color-text)' }}
                  title={c.name ?? c.id}
                >
                  {c.id}
                </span>
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
          {/* 手工输入：端点无列表/拉取失败时的出路（也是「清单里没有的模型」的出路） */}
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
