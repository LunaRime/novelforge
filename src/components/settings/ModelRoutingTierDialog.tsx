/**
 * ModelRoutingTierDialog —— 单个路由层（elite / standard / budget）的**模型 + 优先级**弹窗。
 *
 * 用户诉求（2026-10 六项 UI 改动 §2.3）：把「每行一个 Select 添加 + ArrowUp 一格一格挪」换成
 * **勾选加数字序号**：勾 = 加入该层，行首序号 1/2/3… = 优先级；下移/上移在下方「已选」列表里调。
 *
 * 三条语义契约（测试逐条钉着）：
 * 1. **顺序即优先级** —— 提交的数组顺序 = ModelRouter 的取用顺序，序号与「已选」列表严格同序；
 * 2. **只有点「保存」才写库** —— 草稿在本地 state；取消 / Esc / 点遮罩一律丢弃（`onSave` 不被调用）；
 * 3. **空层合法** —— 一个都不勾 = 该层回退默认模型（`route.dialogHint` 已写明这一口径），保存 `[]` 是合法提交。
 *
 * a11y：走 `ui/Dialog`（Radix）—— Esc / 焦点陷阱 / 背景锁 / 关闭后归还焦点全部自带，**不手写**。
 * modal 关闭口径（`ui-interaction-standard` §1）：这是**非表单**的配置类弹窗 → 显式出口（右上 X + 底部「取消」）+
 * Esc + 遮罩点击可关，**刻意不写** `onInteractOutside` 阻止（那是表单类「防填一半丢了」的口径，本项目先例
 * `GenerateConfigDialog.tsx`；本弹窗没有自由文本输入，丢草稿的代价只是一次重新勾选）。
 *
 * 生命周期：**父级条件渲染**（`{editingTier && <ModelRoutingTierDialog … />}`），草稿由 `useState` 初始化器从
 * `routeIds` 播种 —— 于是「每次打开都是最新已存值」靠挂载/卸载保证，不需要 effect 内同步 setState
 * （项目惯例，见 `ModelPickerDialog` 的注释）。
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import type { ModelTier } from '../../services/llm/model-router'
import type { ModelProfile } from '../../shared/ipc-channels'

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

/** 模型展示名：`name (provider)`，`name` 为空时回落 `modelName` */
function labelOf(m: ModelProfile): string {
  return `${m.name || m.modelName} (${m.provider})`
}

export function ModelRoutingTierDialog({
  tier, tierLabel, routeIds, candidates, onSave, onClose,
}: ModelRoutingTierDialogProps) {
  const { t } = useTranslation()

  /** 草稿（有序 = 优先级）。挂载时从已存值播种；取消即随卸载丢弃 */
  const [draft, setDraft] = useState<string[]>(() => [...routeIds])
  /** 候选 id → 显示名（草稿里的 id 可能已不在候选中：模型被删过 —— 仍按原顺序展示，不静默丢） */
  const labelById = new Map(candidates.map((m) => [m.id, labelOf(m)]))
  const draftSet = new Set(draft)

  /** 勾 / 取消勾：勾上追加到**尾部**（= 最低优先级），取消即从列表移除，序号自动重排 */
  const toggle = (id: string) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** ↑/↓ 单格交换（v1 不做拖拽，`docs/ui-6items-plan.md` §2.3 允许） */
  const move = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      next[index] = prev[target]
      next[target] = prev[index]
      return next
    })
  }

  const save = () => {
    onSave(tier, draft)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[520px]" data-testid="route-tier-dialog">
        <DialogHeader>
          <DialogTitle>{t('route.dialogTitle').replace('{tier}', tierLabel)}</DialogTitle>
          <DialogDescription className="text-micro leading-relaxed">
            {t('route.dialogHint')}
          </DialogDescription>
        </DialogHeader>

        {/* DialogContent 自身不带 padding（头/脚各自 px-6）——中段必须自己包一层 */}
        <div className="px-5 py-4 space-y-4">
          {/* 上半：候选勾选列表 */}
          <section className="space-y-1.5">
            <h3 className="text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('route.candidatesTitle')}
            </h3>
            {candidates.length === 0 && (
              <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('route.noCandidates')}</p>
            )}
            <div
              className="max-h-52 overflow-y-auto rounded-lg p-1 space-y-0.5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {candidates.map((m) => {
                const picked = draftSet.has(m.id)
                return (
                  // 整行可点（label 包住 checkbox + 文本）：热区 = 行片边界，不留「亮了点不动」的死带
                  <label
                    key={m.id}
                    data-testid={`route-candidate-${m.id}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer flex-shrink-0"
                      checked={picked}
                      onChange={() => toggle(m.id)}
                    />
                    {/* 序号 = 优先级（仅已勾选时出现）；行首是关键位置，固定宽度防止勾选时文本左右跳 */}
                    <span
                      className="w-4 flex-shrink-0 text-center font-mono text-micro"
                      style={{ color: picked ? 'var(--color-accent)' : 'transparent' }}
                      aria-hidden="true"
                    >
                      {picked ? draft.indexOf(m.id) + 1 : ''}
                    </span>
                    <span className="truncate flex-1 min-w-0" style={{ color: 'var(--color-text)' }} title={labelOf(m)}>
                      {labelOf(m)}
                    </span>
                    {picked && (
                      <span className="text-2xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                        {t('route.priority').replace('{n}', String(draft.indexOf(m.id) + 1))}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </section>

          {/* 下半：已选列表（顺序即优先级，可上移/下移/移除） */}
          <section className="space-y-1.5">
            <h3 className="text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('route.selectedTitle')}
            </h3>
            {draft.length === 0 ? (
              // 空层合法：保存在这里也是合法提交（该层回退默认模型）
              <p className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('route.tierEmpty')}</p>
            ) : (
              <ul
                className="max-h-44 overflow-y-auto rounded-lg p-1 space-y-0.5"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {draft.map((id, i) => {
                  const name = labelById.get(id) ?? id
                  return (
                    <li
                      key={id}
                      data-testid={`route-selected-${id}`}
                      className="flex items-center gap-2 h-8 rounded px-2"
                      style={{ backgroundColor: 'var(--color-hover)' }}
                    >
                      <span
                        className="w-4 flex-shrink-0 text-center font-mono text-micro"
                        style={{ color: 'var(--color-accent)' }}
                        aria-hidden="true"
                      >
                        {i + 1}
                      </span>
                      <span className="truncate flex-1 min-w-0 text-xs" style={{ color: 'var(--color-text)' }} title={name}>
                        {name}
                      </span>
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={t('route.moveUp')}
                        title={t('route.moveUp')}
                        className="flex items-center justify-center rounded transition-colors hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent flex-shrink-0"
                        style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === draft.length - 1}
                        aria-label={t('route.moveDown')}
                        title={t('route.moveDown')}
                        className="flex items-center justify-center rounded transition-colors hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent flex-shrink-0"
                        style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-label={t('route.removeModel')}
                        title={t('route.removeModel')}
                        className="flex items-center justify-center rounded transition-colors hover:bg-[var(--color-hover)] flex-shrink-0"
                        style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
                      >
                        <X size={12} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="default" onClick={save}>{t('action.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
