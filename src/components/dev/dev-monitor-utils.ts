export interface LlmHistoryRow {
  modelName?: string
  success?: number
  durationMs?: number
}

export function successRate(success: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '—'
  return `${((Math.max(0, success) / total) * 100).toFixed(1)}%`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`
}

export function aggregateRecentByModel(
  rows: LlmHistoryRow[],
): Array<{ model: string; calls: number; errors: number; avgMs: number }> {
  const map = new Map<string, { calls: number; errors: number; totalMs: number }>()
  for (const row of rows) {
    const model = row.modelName || 'unknown'
    const current = map.get(model) ?? { calls: 0, errors: 0, totalMs: 0 }
    current.calls += 1
    if (row.success !== 1) current.errors += 1
    current.totalMs += Number.isFinite(row.durationMs) ? Number(row.durationMs) : 0
    map.set(model, current)
  }
  return [...map.entries()]
    .map(([model, value]) => ({
      model,
      calls: value.calls,
      errors: value.errors,
      avgMs: value.calls > 0 ? Math.round(value.totalMs / value.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model))
}