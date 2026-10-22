import { describe, expect, it } from 'vitest'
import { buildBookPipelinePlan, createBookPipelineWorkflow } from './book-pipeline-workflow'

describe('book-pipeline-workflow', () => {
  it('generates strict per-chapter write-review-finalize plan', () => {
    const plan = buildBookPipelinePlan({ chapterStart: 1, chapterEnd: 3 })
    expect(plan.map(p => p.phase)).toEqual(['write','review','finalize','write','review','finalize','write','review','finalize'])
    expect(plan.filter(p => p.phase === 'write').map(p => p.chapterNumber)).toEqual([1,2,3])
  })

  it('skips review steps when autoReview is false', () => {
    const plan = buildBookPipelinePlan({ chapterStart: 4, chapterEnd: 5, autoReview: false })
    expect(plan.map(p => p.phase)).toEqual(['write','finalize','write','finalize'])
  })

  it('builds a workflow with one step per plan entry', () => {
    const workflow = createBookPipelineWorkflow({ chapterStart: 1, chapterEnd: 2 })
    expect(workflow.type).toBe('book_pipeline')
    expect(workflow.steps).toHaveLength(6)
    expect(workflow.steps[0].name).toContain('第1章')
    expect(workflow.steps[5].name).toContain('第2章')
  })
})
