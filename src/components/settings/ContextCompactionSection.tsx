/**
 * ContextCompactionSection — 设置页「上下文与压缩」分区（§7.1-C2 保留偏好 + 自学习压缩开关）。
 *
 * 三个旋钮写在 `GlobalConfig.compaction`：历史预算 / 最小降幅 / 保留批数。
 * ⚠️ 口径诚实（设计要点）：**只影响之后的压缩** —— 已压缩的批次不会重算、不重写历史；
 * `keepBatches > 0` 会**释放更旧批次的分卷原文**（该卡片的「恢复原文」随之消失），
 * 故默认 0 = 不裁剪（维持 B 档第二轮「原文永不删」的承诺）。
 *
 * 自学习压缩 v1（实验性，默认关闭）状态写在**独立顶层键** `GlobalConfig.compactionLearning`
 * （config:set 是顶层浅合并——若与 compaction 同键会被本分区的保存覆盖）；
 * 未触碰学习控件时保存不写该键（防用陈旧统计覆盖实时学习结果）；**触碰过**时也只覆盖
 * 「开关」这一个用户可控项（统计/规则/倍率取盘上最新值），除非用户点了「重置」。
 */
import { useEffect, useState } from 'react'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Button } from '../ui/Button'
import { Disclosure } from '../ui/Disclosure'
import { Switch } from '../ui/Switch'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { renderLog } from '../../services/render-logger'
import { DEFAULT_COMPACTION_PREFS, resolveCompactionPrefs, type CompactionPrefs } from '../../services/agent/compaction-prefs'
import {
  defaultCompressionLearning, resolveCompressionLearning, resetCompressionLearning,
  activeRuleLabels, type CompressionLearningState,
} from '../../services/agent/compression-learning'

export default function ContextCompactionSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<CompactionPrefs>(DEFAULT_COMPACTION_PREFS)
  const [learning, setLearning] = useState<CompressionLearningState>(() => defaultCompressionLearning())
  /** 本轮是否触碰过学习控件——未触碰时保存不写 compactionLearning（防陈旧统计覆盖实时学习结果） */
  const [learningDirty, setLearningDirty] = useState(false)
  /** 用户是否点过「重置学习数据」（保存时按此语义合并，见 save 注释） */
  const [learningReset, setLearningReset] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await ipc.invoke('config:get') as { compaction?: unknown; compactionLearning?: unknown } | null
        if (!cancelled) {
          setPrefs(resolveCompactionPrefs(cfg))
          setLearning(resolveCompressionLearning(cfg?.compactionLearning))
        }
      } catch {
        // 读失败 → 用缺省，但**明确告知**（下面显示的不是盘上的值，保存会把默认值写回）
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /** 输入改动：允许中间态（空串/超范围），保存时统一钳制 */
  const patch = (key: keyof CompactionPrefs, raw: string): void => {
    setPrefs(p => ({ ...p, [key]: raw === '' ? Number.NaN : Number(raw) }))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      // 钳制口径与读取侧同一真源（resolveCompactionPrefs）：写进去的一定能被读回
      const clamped = resolveCompactionPrefs({ compaction: prefs })
      const payload: Record<string, unknown> = { compaction: clamped }
      if (learningDirty) {
        // 防陈旧覆盖（修复）：本组件只在 mount 时读一次配置，而聊天期间的压缩/截断会实时
        // `config:set compactionLearning`。若整段写回 mount 快照，会把这段累积的统计/规则抹掉。
        // 故保存时按**用户意图**合并：
        // - 点过「重置」→ 统计/规则/倍率清零（保留 UI 当前的开关值）；
        // - 否则只在**盘上最新状态**之上覆盖「开关」这一个用户可控项，实时统计/规则原样保留。
        // 读配置失败 → 回落 mount 快照（与修复前行为一致，不阻断保存）。
        let fresh: CompressionLearningState | null = null
        try {
          const cfg = await ipc.invoke('config:get') as { compactionLearning?: unknown } | null
          fresh = resolveCompressionLearning(cfg?.compactionLearning)
        } catch { /* 读失败：用 mount 快照 */ }
        payload.compactionLearning = learningReset
          ? resetCompressionLearning(learning.enabled)
          : { ...(fresh ?? learning), enabled: learning.enabled }
      }
      const res = await ipc.invoke('config:set', payload) as { success?: boolean } | null
      if (res && res.success === false) throw new Error('config:set failed')
      setPrefs(clamped)
      setLearningDirty(false)
      setLearningReset(false)
      toast.success(t('settings.compactionSaved'))
      // 仓库规范：设置页保存同时进 LogsView（对照 DeveloperModeSection / ProviderEditorCard）
      renderLog('info', 'Save:Settings', t('log.render.compactionPrefsSaved')
        .replace('{percent}', String(clamped.budgetPercent))
        .replace('{history}', String(clamped.historyMaxTokens))
        .replace('{minChange}', String(clamped.minimumChangeTokens))
        .replace('{keep}', String(clamped.keepBatches)))
    } catch (e) {
      toast.error(t('settings.compactionSaveFailed').replace('{error}', String(e)))
      renderLog('error', 'Save:Settings', t('log.render.compactionPrefsSaveFailed').replace('{error}', String(e)))
    } finally {
      setSaving(false)
    }
  }

  /** 重置学习数据 = 破坏性操作（清空累计统计 / 已激活规则 / 倍率，保存后生效、不可撤销）
   *  → 先确认（防呆：与同目录 PromptSettings「恢复默认」同款，避免误点丢掉长期累积的学习结果） */
  const resetLearning = async (): Promise<void> => {
    const ok = await confirm(t('settings.learningResetConfirm'), {
      title: t('settings.learningResetConfirmTitle'),
      confirmText: t('settings.learningResetConfirmBtn'),
      danger: true,
    })
    if (!ok) return
    setLearning(l => resetCompressionLearning(l.enabled))
    setLearningDirty(true)
    setLearningReset(true)
    toast.success(t('settings.learningResetDone'))
  }

  const row = (key: keyof CompactionPrefs, min: number, max: number, labelKey: string, descKey: string): React.ReactElement => (
    <div key={key} className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <Label htmlFor={`cmp-${key}`} className="text-xs">{t(labelKey as never)}</Label>
        <p className="text-micro mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t(descKey as never)}
        </p>
      </div>
      <Input
        id={`cmp-${key}`}
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(prefs[key]) ? prefs[key] : ''}
        onChange={e => patch(key, e.target.value)}
        className="w-24 flex-shrink-0"
      />
    </div>
  )

  return (
    <div
      className="rounded-xl p-4 space-y-4"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.compactionTitle')}</p>
        <Disclosure label={t('settings.cardHint')}>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.compactionDesc')}
          </p>
        </Disclosure>
      </div>

      {loadFailed && (
        <p className="text-micro" style={{ color: 'var(--color-warning)' }}>
          {t('settings.compactionLoadFailed')}
        </p>
      )}

      {row('budgetPercent', 50, 95, 'settings.compactionPercent', 'settings.compactionPercentDesc')}
      {row('historyMaxTokens', 1000, 32000, 'settings.compactionHistory', 'settings.compactionHistoryDesc')}
      {row('minimumChangeTokens', 0, 2000, 'settings.compactionMinChange', 'settings.compactionMinChangeDesc')}
      {row('keepBatches', 0, 20, 'settings.compactionKeep', 'settings.compactionKeepDesc')}

      {/* 自学习压缩 v1（实验性，默认关）：信号来自本地压缩事件（跳过/截断/保真缺失/移除），
          只调提示与阈值倍率、只影响之后的压缩；可随时重置 */}
      <div
        className="rounded-lg p-3 space-y-2"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Label className="text-xs">{t('settings.learningTitle')}</Label>
            <p className="text-micro mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.learningDesc')}
            </p>
          </div>
          <Switch
            checked={learning.enabled}
            onCheckedChange={v => {
              setLearning(l => ({ ...l, enabled: v }))
              setLearningDirty(true)
            }}
            aria-label={t('settings.learningEnable')}
          />
        </div>
        <p className="text-micro leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('settings.learningStats')
            .replace('{compressions}', String(learning.stats.compressions))
            .replace('{skipped}', String(learning.stats.skipped))
            .replace('{truncations}', String(learning.stats.truncations))
            .replace('{warns}', String(learning.stats.fidelityWarns))
            .replace('{reverts}', String(learning.stats.reverts))
            .replace('{regen}', String(learning.stats.regenerations))}
        </p>
        <div className="flex items-center justify-between gap-3">
          <p className="text-micro leading-relaxed min-w-0" style={{ color: 'var(--color-text-muted)' }}>
            {activeRuleLabels(learning).length > 0
              ? t('settings.learningRules').replace('{rules}', activeRuleLabels(learning).join(t('settings.learningRulesSeparator')))
              : t('settings.learningNoRules')}
          </p>
          <Button onClick={() => void resetLearning()} disabled={!loaded || saving}>
            {t('settings.learningReset')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <Button onClick={() => void save()} disabled={!loaded || saving}>
          {t('action.save')}
        </Button>
      </div>
    </div>
  )
}
