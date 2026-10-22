import { useCallback, useEffect, useState } from 'react'
import { Database, Play } from 'lucide-react'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { DevDbQueryResult, DevDbSchema, DevDbTable } from '../../shared/ipc-channels'

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

export default function DevDatabaseTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [tables, setTables] = useState<DevDbTable[]>([])
  const [selected, setSelected] = useState('')
  const [schema, setSchema] = useState<DevDbSchema | null>(null)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<DevDbQueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const loadSchema = useCallback(async (table: string) => {
    setSelected(table)
    setSchema(null)
    setSql(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 50`)
    try {
      setSchema(await ipc.invoke('dev:db-schema', table))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const loadTables = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ipc.invoke('dev:db-tables')
      setTables(list)
      setError('')
      if (list.length > 0) await loadSchema(list[0].name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [loadSchema])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void loadTables() }, 0)
    return () => clearTimeout(kickoff)
  }, [active, loadTables])

  const run = async () => {
    if (!sql.trim()) return
    setRunning(true)
    setError('')
    try {
      const next = await ipc.invoke('dev:db-query', sql, 200)
      setResult(next)
      if (!next.success) setError(next.error || t('dev.dbError'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[230px] flex-shrink-0 flex-col" style={{ borderRight: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          <span>{t('dev.dbTables')}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{tables.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex justify-center py-4"><Spinner size={14} /></div>
          ) : tables.length === 0 ? (
            <div className="px-2 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dev.dbNoProject')}</div>
          ) : (
            tables.map((table) => (
              <button
                key={table.name}
                type="button"
                onClick={() => void loadSchema(table.name)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--color-hover)]"
                style={{
                  color: selected === table.name ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  backgroundColor: selected === table.name ? 'var(--color-hover)' : 'transparent',
                }}
              >
                <Database size={11} className="flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono">{table.name}</span>
                <span className="flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{table.rows}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="mx-4 mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
            {error}
          </div>
        )}

        {schema ? (
          <div className="flex-shrink-0 px-4 pt-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
              <span className="font-mono">{schema.name}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{t('dev.dbSchema')}</span>
            </div>
            <div className="max-h-[150px] overflow-y-auto rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full border-collapse text-micro">
                <thead>
                  <tr style={{ color: 'var(--color-text-muted)' }}>
                    <th className="px-2 py-1 text-left font-medium">{t('dev.dbColumns')}</th>
                    <th className="px-2 py-1 text-left font-medium">Type</th>
                    <th className="px-2 py-1 text-left font-medium">PK</th>
                    <th className="px-2 py-1 text-left font-medium">Not null</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.columns.map((column) => (
                    <tr key={column.name} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-2 py-1 font-mono" style={{ color: 'var(--color-text)' }}>{column.name}</td>
                      <td className="px-2 py-1 font-mono" style={{ color: 'var(--color-text-muted)' }}>{column.type || '—'}</td>
                      <td className="px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>{column.pk ? '✓' : ''}</td>
                      <td className="px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>{column.notnull ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schema.indexes.length > 0 && (
              <div className="mt-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                {t('dev.dbIndexes')}: {schema.indexes.map((idx) => `${idx.name}(${idx.columns.join(', ')})`).join(' · ')}
              </div>
            )}
          </div>
        ) : (
          !loading && <div className="px-4 pt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('dev.dbSelectTable')}</div>
        )}

        <div className="flex flex-shrink-0 flex-col gap-2 px-4 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.dbQuery')}</span>
            <Button variant="default" size="sm" onClick={() => void run()} disabled={running || !sql.trim()}>
              {running ? <Spinner size={12} /> : <Play size={12} />}
              {t('dev.dbRun')}
            </Button>
          </div>
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={4}
            spellCheck={false}
            className="rounded-lg px-3 py-2 font-mono text-xs"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {!result ? (
            <EmptyState message={t('dev.dbSelectTable')} />
          ) : !result.success ? (
            <EmptyState message={result.error || t('dev.dbError')} />
          ) : (
            <>
              {result.truncated && (
                <div className="mb-2 text-micro" style={{ color: 'var(--color-warning)' }}>{t('dev.dbTruncated')}</div>
              )}
              <table className="border-collapse text-micro">
                <thead>
                  <tr style={{ color: 'var(--color-text-muted)' }}>
                    {(result.columns ?? []).map((column) => (
                      <th key={column} className="whitespace-nowrap px-2 py-1 text-left font-medium">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.rows ?? []).map((row, rowIndex) => (
                    <tr key={rowIndex} style={{ borderTop: '1px solid var(--color-border)' }}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="max-w-[320px] truncate whitespace-nowrap px-2 py-1 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                          {formatCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                {result.rowCount ?? 0} {t('dev.dbRows')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}