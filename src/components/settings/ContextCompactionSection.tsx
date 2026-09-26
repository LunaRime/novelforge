/**
 * ContextCompactionSection — 设置页「上下文与压缩」分区（§7.1-C2 保留偏好）。
 *
 * 三个旋钮写在 `GlobalConfig.compaction`：历史预算 / 最小降幅 / 保留批数。
 * ⚠️ 口径诚实（设计要点）：**只影响之后的压缩** —— 已压缩的批次不会重算、不重写历史；
 * `keepBatches > 0` 会**释放更旧批次的分卷原文**（该卡片的「恢复原文」随之消失），
 * 故默认 0 = 不裁剪（维持 B 档第二轮「原文永不删」的承诺）。
 */
import { useEffect, useState } from 'react'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Button } from '../ui/Button'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import { DEFAULT_COMPACTION_PREFS, resolveCompactionPrefs, type CompactionPrefs } from '../../services/agent/compaction-prefs'

export default function ContextCompactionSection() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<CompactionPrefs>(DEFAULT_COMPACTION_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await ipc.invoke('config:get') as { compaction?: unknown } | null
        if (!cancelled) setPrefs(resolveCompactionPrefs(cfg))
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
      const res = await ipc.invoke('config:set', { compaction: clamped }) as { success?: boolean } | null
      if (res && res.success === false) throw new Error('config:set failed')
      setPrefs(clamped)
      toast.success(t('settings.compactionSaved'))
    } catch (e) {
      toast.error(t('settings.compactionSaveFailed').replace('{error}', String(e)))
    } finally {
      setSaving(false)
    }
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
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('settings.compactionTitle')}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('settings.compactionDesc')}
        </p>
      </div>

      {loadFailed && (
        <p className="text-micro" style={{ color: 'var(--color-warning)' }}>
          {t('settings.compactionLoadFailed')}
        </p>
      )}

      {row('historyMaxTokens', 1000, 32000, 'settings.compactionHistory', 'settings.compactionHistoryDesc')}
      {row('minimumChangeTokens', 0, 2000, 'settings.compactionMinChange', 'settings.compactionMinChangeDesc')}
      {row('keepBatches', 0, 20, 'settings.compactionKeep', 'settings.compactionKeepDesc')}

      <div className="flex items-center justify-end">
        <Button onClick={() => void save()} disabled={!loaded || saving}>
          {t('action.save')}
        </Button>
      </div>
    </div>
  )
}
