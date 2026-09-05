/**
 * 三栏合并视图 — 基于相似度 DP 对齐的段落级 diff
 *
 * 核心算法改进：
 * - 使用字符重叠率计算段落相似度
 * - DP 动态规划支持 1:1、1:2、1:3、2:1、3:1 段落对齐
 * - 正确处理段落拆分（1段→2段）和合并（2段→1段）
 *
 * 布局：左栏原稿（只读）| 中栏合并结果（可编辑）| 右栏修稿（只读）
 */
import React, { useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import { Button } from '../ui/Button'
import './three-way-merge.css'
import { useTranslation } from '../../hooks/useTranslation'
import { buildMergeSegments, type MergeHunk, type MergeSegment } from '../../services/diff/paragraph-align'

interface ThreeWayMergeProps {
  originalContent: string
  modifiedContent: string
  onComplete: (mergedText: string) => void
  onCancel?: () => void
}

// ===== 渲染辅助 =====

function HunkLines({ lines, padCount, cls, emptyLabel }: {
  lines: string[]; padCount: number; cls: string; emptyLabel: string
}) {
  return (
    <>
      {lines.length > 0
        ? lines.map((l, i) => <div key={i} className={cls}>{l || '\u00A0'}</div>)
        : <div className="twm-line-placeholder">{emptyLabel}</div>}
      {Array.from({ length: padCount }).map((_, i) => (
        <div key={`p${i}`} className="twm-line-padding">{'\u00A0'}</div>
      ))}
    </>
  )
}

/** contentEditable 子组件 — 仅在挂载时设置内容 */
function EditableCell({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const initialTextRef = useRef(text)
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = initialTextRef.current || '\u00A0'
  }, [])
  return (
    <div ref={ref} className="twm-editable" contentEditable
      suppressContentEditableWarning
      onInput={e => onChange((e.target as HTMLDivElement).innerText)} />
  )
}

// ===== 主组件 =====

export default function ThreeWayMerge({
  originalContent, modifiedContent, onComplete, onCancel,
}: ThreeWayMergeProps) {
  const { t } = useTranslation()
  const segments = useMemo<MergeSegment[]>(() => buildMergeSegments(originalContent, modifiedContent),
    [originalContent, modifiedContent])
  const hunks = useMemo<MergeHunk[]>(() => segments.filter(s => s.type === 'hunk').map(s => s.hunk!), [segments])

  const [applied, setApplied] = useState<Record<number, boolean>>({})

  // 每个 segment 的编辑文本
  const [segTexts, setSegTexts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    segments.forEach((s, i) => {
      if (s.type === 'same') init[i] = (s.lines || []).join('\n')
      else if (s.hunk) init[i] = s.hunk.originalLines.join('\n')
    })
    return init
  })

  // hunk index → segment index 映射
  const hunkSegIdx = useMemo(() => {
    const m: Record<number, number> = {}
    segments.forEach((s, i) => { if (s.hunk) m[s.hunk.index] = i })
    return m
  }, [segments])

  const buildMergedText = useCallback(() => {
    return segments.map((_, i) => segTexts[i] ?? '').join('\n')
  }, [segments, segTexts])

  const toggleHunk = useCallback((idx: number) => {
    setApplied(prev => {
      const next = { ...prev, [idx]: !prev[idx] }
      const hunk = hunks.find(h => h.index === idx)
      const si = hunkSegIdx[idx]
      if (hunk && si !== undefined) {
        const text = next[idx] ? hunk.modifiedLines.join('\n') : hunk.originalLines.join('\n')
        setSegTexts(p => ({ ...p, [si]: text }))
      }
      return next
    })
  }, [hunks, hunkSegIdx])

  const applyAll = useCallback(() => {
    const next: Record<number, boolean> = {}
    const texts: Record<number, string> = {}
    hunks.forEach(h => { next[h.index] = true; texts[hunkSegIdx[h.index]] = h.modifiedLines.join('\n') })
    setApplied(next); setSegTexts(p => ({ ...p, ...texts }))
  }, [hunks, hunkSegIdx])

  const revertAll = useCallback(() => {
    const texts: Record<number, string> = {}
    hunks.forEach(h => { texts[hunkSegIdx[h.index]] = h.originalLines.join('\n') })
    setApplied({}); setSegTexts(p => ({ ...p, ...texts }))
  }, [hunks, hunkSegIdx])

  const processedCount = Object.values(applied).filter(Boolean).length

  const getPad = (oLen: number, mLen: number) => {
    const lV = oLen > 0 ? oLen : 1, rV = mLen > 0 ? mLen : 1
    return { leftPad: Math.max(0, rV - lV), rightPad: Math.max(0, lV - rV) }
  }

  return (
    <div className="three-way-merge">
      <div className="twm-toolbar">
        <Button variant="ghost" size="sm" onClick={revertAll}>{t('merge.revertAll')}</Button>
        <Button variant="ghost" size="sm" onClick={applyAll}>{t('merge.applyAll')}</Button>
        <span className="twm-toolbar-progress">{t('merge.progress').replace('{n}', String(processedCount)).replace('{total}', String(hunks.length))}</span>
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>{t('merge.cancel')}</Button>}
        <Button variant="success" size="sm" onClick={() => onComplete(buildMergedText())}>{t('merge.complete')}</Button>
      </div>

      {/* 固定表头 */}
      <div className="twm-headers">
        <div className="twm-header">{t('merge.original')} <span className="twm-tag readonly">{t('merge.readonly')}</span></div>
        <div className="twm-header">{t('merge.result')} <span className="twm-tag editable">{t('merge.editable')}</span></div>
        <div className="twm-header">{t('merge.revised')} <span className="twm-tag readonly">{t('merge.readonly')}</span></div>
      </div>

      {/* 单滚动容器 + CSS Grid 自动行高对齐 */}
      <div className="twm-scroll">
        <div className="twm-grid">
          {segments.map((seg, idx) => {
            if (seg.type === 'same') {
              // same 行：三栏静态文本，中栏可编辑
              return (
                <React.Fragment key={idx}>
                  <div className="twm-cell twm-cell-left">
                    {seg.lines?.map((l, i) => <div key={i} className="twm-line-same">{l || '\u00A0'}</div>)}
                  </div>
                  <div className="twm-cell twm-cell-center">
                    <EditableCell key={`s${idx}`} text={segTexts[idx] ?? ''}
                      onChange={t => setSegTexts(p => ({ ...p, [idx]: t }))} />
                  </div>
                  <div className="twm-cell twm-cell-right">
                    {seg.lines?.map((l, i) => <div key={i} className="twm-line-same">{l || '\u00A0'}</div>)}
                  </div>
                </React.Fragment>
              )
            }

            // hunk 行
            const hunk = seg.hunk!
            const isApplied = applied[hunk.index]
            const { leftPad, rightPad } = getPad(hunk.originalLines.length, hunk.modifiedLines.length)

            return (
              <React.Fragment key={idx}>
                {/* 左栏 */}
                <div className={`twm-cell twm-cell-left ${isApplied ? 'processed' : ''}`}>
                  <HunkLines lines={hunk.originalLines} padCount={leftPad} cls="twm-line-removed"
                    emptyLabel={t('merge.addedLines').replace('{n}', String(hunk.modifiedLines.length))} />
                </div>

                {/* 中栏 */}
                <div className={`twm-cell twm-cell-center ${isApplied ? 'adopted' : 'pending'}`}>
                  <EditableCell key={`h${idx}-${isApplied ? 1 : 0}`} text={segTexts[idx] ?? ''}
                    onChange={t => setSegTexts(p => ({ ...p, [idx]: t }))} />
                </div>

                {/* 右栏（含采用按钮） */}
                <div className={`twm-cell twm-cell-right ${isApplied ? 'processed' : ''}`}>
                  <div className="twm-hunk-row">
                    <button className={`twm-adopt ${isApplied ? 'adopted' : ''}`}
                      onClick={() => toggleHunk(hunk.index)}
                      title={isApplied ? t('merge.restoreOriginal') : t('merge.applyRevision')}>
                      {isApplied ? '✓' : '«'}
                    </button>
                    <div className="twm-hunk-text">
                      <HunkLines lines={hunk.modifiedLines} padCount={rightPad} cls="twm-line-added"
                        emptyLabel={t('merge.deletedLines').replace('{n}', String(hunk.originalLines.length))} />
                    </div>
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

