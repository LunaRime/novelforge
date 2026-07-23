/**
 * ModelsView — 底部面板模型调用统计视图
 *
 * 从 BottomPanel 中提取的独立子组件，展示 LLM 调用用量统计与历史记录。
 */
import { useState, useEffect, memo } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { DEFAULT_LOCALE, t } from '../../shared/locale'

export default memo(function ModelsView() {
  const [stats, setStats] = useState<{
    totalCalls: number; totalTokens: number
    totalPromptTokens: number; totalCompletionTokens: number
  } | null>(null)
  const [history, setHistory] = useState<Array<{
    id: number; modelName: string; purpose: string
    promptTokens: number; completionTokens: number; totalTokens: number
    durationMs: number; success: boolean; createdAt: string
  }>>([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { loadLLMData } = await import('../../services/stats-service')
      const { stats: s, history: h } = await loadLLMData(30)
      setStats(s)
      setHistory(h)
    } catch (e) { console.warn('[ModelsView] 加载 LLM 用量统计数据失败:', e) }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {stats && (
        <div
          className="flex items-center gap-4 px-4 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="text-[0.7rem] text-[var(--color-text-muted)]">
            <span className="font-bold text-sm text-[var(--color-text)]">{stats.totalCalls}</span>{t('models.calls')}
          </div>
          <div className="text-[0.7rem] text-[var(--color-text-muted)]">
            <span className="font-bold text-sm text-[var(--color-text)]">{(stats.totalTokens / 1000).toFixed(1)}k</span> Tokens
          </div>
          <div className="text-[0.7rem] text-[var(--color-text-muted)]">
            {t('models.input')} <span className="font-mono text-[var(--color-text-secondary)]">{(stats.totalPromptTokens / 1000).toFixed(1)}k</span>
          </div>
          <div className="text-[0.7rem] text-[var(--color-text-muted)]">
            {t('models.output')} <span className="font-mono text-[var(--color-text-secondary)]">{(stats.totalCompletionTokens / 1000).toFixed(1)}k</span>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {history.length === 0 ? (
          <div className="flex items-center justify-center h-full opacity-30 text-sm">{t('status.noRecords')}</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr
                className="text-[0.7rem] text-[var(--color-text-muted)]"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <th className="text-left px-4 py-1 font-medium">{t('models.time')}</th>
                <th className="text-left px-2 py-1 font-medium">{t('models.model')}</th>
                <th className="text-left px-2 py-1 font-medium">{t('models.purpose')}</th>
                <th className="text-right px-2 py-1 font-medium">Tokens</th>
                <th className="text-right px-2 py-1 font-medium">{t('models.duration')}</th>
                <th className="text-center px-2 py-1 font-medium">{t('models.status')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-[var(--color-hover)] transition-colors"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <td className="px-4 py-1 text-[var(--color-text-muted)]">
                    {new Date(row.createdAt).toLocaleString(DEFAULT_LOCALE, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-text-secondary)]">{row.modelName || '-'}</td>
                  <td className="px-2 py-1 text-[var(--color-text-secondary)]">{row.purpose || '-'}</td>
                  <td className="px-2 py-1 text-right text-[var(--color-text)]">{row.totalTokens.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right text-[var(--color-text-muted)]">{(row.durationMs / 1000).toFixed(1)}s</td>
                  <td className="px-2 py-1 text-center">{row.success ? <CheckCircle2 size={12} style={{ color: 'var(--color-success)', display: 'inline' }} /> : <XCircle size={12} style={{ color: 'var(--color-error)', display: 'inline' }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
})
