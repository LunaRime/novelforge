import { describe, it, expect, vi } from 'vitest'
import { createScheduler, type SchedulerDeps } from './scheduler'
import type { AutomationTask, TriggerOutcomeInput } from './types'
import type { AutomationExecutor } from './executor'

const chapters = [
  { number: 1, title: '第1章', wordCount: 3000 },
  { number: 2, title: '第2章', wordCount: 3000 },
  { number: 3, title: '第3章', wordCount: 3000 },
]

function task(over: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: 'a1', name: '每3章后处理', enabled: true,
    targetType: 'workflow', targetRef: '{"type":"post_process"}',
    sessionStrategy: 'per_run',
    triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
    defaultActionPolicy: 'confirm',
    createdAt: 1, updatedAt: 1, ...over,
  }
}

function deps(over: Partial<SchedulerDeps> = {}): SchedulerDeps & {
  applied: TriggerOutcomeInput[]
  started: string[]
} {
  const applied: TriggerOutcomeInput[] = []
  const started: string[] = []
  const executor: AutomationExecutor = {
    start: vi.fn(async () => { started.push('x'); return { refId: 'run-1', kind: 'workflow' as const } }),
    isAlive: vi.fn(async () => true),
  }
  return {
    getTasks: async () => [task()],
    getTriggerStates: async () => ({}),
    getChapters: async () => chapters,
    applyOutcome: async (input) => { applied.push(input) },
    markRunRef: vi.fn(async () => {}),
    markRunFailed: vi.fn(async () => {}),
    markInboxError: vi.fn(async () => {}),
    executor,
    now: () => 1_000_000,
    getChapterTexts: async () => ({ 1: '正文1', 2: '正文2', 3: '正文3' }),
    callModel: async () => '{}',
    applied, started,
    ...over,
  }
}

describe('createScheduler', () => {
  it('confirm 策略 → 只入箱、不执行', async () => {
    const d = deps()
    const r = await createScheduler(d).tick()
    expect(r.inboxed).toBe(1)
    expect(r.started).toBe(0)
    expect(d.applied[0].inboxItems[0].status).toBe('pending')
    expect(d.executor.start).not.toHaveBeenCalled()
  })

  it('auto_run 策略 → 入箱记录 + 调用 executor.start', async () => {
    const d = deps({ getTasks: async () => [task({ defaultActionPolicy: 'auto_run' })] })
    const r = await createScheduler(d).tick()
    expect(r.started).toBe(1)
    expect(d.applied[0].inboxItems[0].status).toBe('auto_run')
    expect(d.executor.start).toHaveBeenCalledTimes(1)
  })

  it('notify_only 策略 → 入箱且绝不执行', async () => {
    const d = deps({ getTasks: async () => [task({ defaultActionPolicy: 'notify_only' })] })
    const r = await createScheduler(d).tick()
    expect(r.inboxed).toBe(1)
    expect(r.started).toBe(0)
    expect(d.executor.start).not.toHaveBeenCalled()
  })

  it('指纹已处置 → 跳过（不重复入箱）', async () => {
    const d = deps({
      getTriggerStates: async () => ({ a1: { t1: { lastFingerprint: 'chapter_batch:t1:1:1,2,3' } } }),
    })
    const r = await createScheduler(d).tick()
    expect(r.inboxed).toBe(0)
    expect(d.applied).toHaveLength(0)
  })

  it('触发器级 actionPolicy 覆盖任务默认值', async () => {
    const d = deps({
      getTasks: async () => [task({
        defaultActionPolicy: 'confirm',
        triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3, actionPolicy: 'auto_run' }],
      })],
    })
    const r = await createScheduler(d).tick()
    expect(r.started).toBe(1)
  })

  it('某触发器评估抛错 → 该触发器跳过，同任务其余触发器照常', async () => {
    const bad = task({
      triggers: [
        { id: 'bad', type: 'semantic', enabled: true, semanticCondition: 'x' },
        { id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 },
      ],
    })
    const d = deps({
      getTasks: async () => [bad],
      callModel: async () => { throw new Error('model down') },
    })
    const r = await createScheduler(d).tick()
    expect(r.inboxed).toBe(1)                       // chapter_batch 仍入箱
    expect(d.applied[0].inboxItems[0].triggerId).toBe('t1')
  })

  it('trigger_state 随产物在同一次 applyOutcome 中推进（事务语义）', async () => {
    const d = deps()
    await createScheduler(d).tick()
    expect(d.applied).toHaveLength(1)
    expect(d.applied[0].triggerState.t1.lastFingerprint).toBe('chapter_batch:t1:1:1,2,3')
  })

  it('重入保护：tick 进行中再次调用直接返回（不并发评估）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const d = deps({ getTasks: async () => { await gate; return [task()] } })
    const s = createScheduler(d)
    const first = s.tick()
    const second = await s.tick()               // 应立刻返回空结果
    expect(second.inboxed).toBe(0)
    release()
    await first
  })
})

describe('评审修复（Important 4/5/9）', () => {
  it('auto_run 启动失败 → run 同步标 failed（不留幽灵 running）', async () => {
    const d = deps({ getTasks: async () => [task({ defaultActionPolicy: 'auto_run' })] })
    d.executor.start = vi.fn(async () => { throw new Error('启动失败') }) as never
    await createScheduler(d).tick()
    expect(d.markRunFailed).toHaveBeenCalledTimes(1)
    expect(d.markInboxError).toHaveBeenCalledTimes(1)
  })

  it('单任务写入失败 → 其余任务照常评估（隔离，不中断整 tick）', async () => {
    const bad = task({ id: 'a-bad' })
    const good = task({ id: 'a-good' })
    let calls = 0
    const d = deps({
      getTasks: async () => [bad, good],
      applyOutcome: async (input) => {
        calls++
        if (input.automationId === 'a-bad') throw new Error('外键违约')
      },
    })
    const r = await createScheduler(d).tick()
    expect(calls).toBe(2)                    // 两个任务都被处理
    expect(r.inboxed).toBe(1)                // 只有好的那个产出入箱
  })

  it('semantic 章节身份未变 → 跳过模型调用（成本短路）', async () => {
    const semanticTask = task({
      triggers: [{ id: 's1', type: 'semantic', enabled: true, semanticCondition: '伏笔过多' }],
    })
    const callModel = vi.fn(async () => '{"matched":false,"confidence":0,"reason":"","title":"","evidence_refs":[]}')
    const d = deps({ getTasks: async () => [semanticTask], callModel })
    const s = createScheduler(d)

    await s.tick()
    expect(callModel).toHaveBeenCalledTimes(1)      // 首次评估（未命中也会记录观察身份）

    // 模拟状态已落库：第二次 tick 章节未变 → 不再调用
    d.getTriggerStates = async () => ({ a1: { s1: { lastObservationFingerprint: '1,2,3' } } })
    await s.tick()
    expect(callModel).toHaveBeenCalledTimes(1)      // 未新增调用
  })
})
