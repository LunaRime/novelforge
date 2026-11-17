// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import type { ProjectData } from '../../shared/ipc-channels'
import type { WorkflowContext, WorkflowStep } from '../../shared/workflow-types'
import { useProjectStore } from '../../stores/project-store'
import { VerifyBlueprintsCommand } from './commands/verify-blueprints.command'
import { createVerificationWorkflow, createGapFillWorkflow } from './verification-workflow'

const project: ProjectData = {
  id: 'a', path: '/a', name: 'Novel', characterStates: '', createdAt: 0, updatedAt: 0,
  novelConfig: {
    genre: '玄幻', subGenre: '', targetAudience: '男频', totalChapters: 4, wordsPerChapter: 3000,
    plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '',
    goldenFinger: '', protagonistProfile: '', globalGuidance: '',
  },
}
const blueprint = (chapterNumber: number): BlueprintData => ({
  chapterNumber, title: 'Title', role: 'Development', purpose: '', keyEvents: '', characters: [],
  suspenseHook: '', userGuidance: '', notes: '', notesUpdatedAt: '', sortOrder: chapterNumber, priority: 0,
})
const invoke = vi.fn<(channel: string) => Promise<unknown>>()
const createRequest = () => ({
  step: { id: 'verify', name: '', description: '', status: 'running', logs: [] } satisfies WorkflowStep,
  context: { data: {}, cancelled: false } as WorkflowContext,
  callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() },
})

beforeEach(() => {
  useProjectStore.setState({ currentProject: structuredClone(project), projectSession: 1 })
  Object.defineProperty(window, 'novelforgeAPI', { value: { invoke }, configurable: true })
  invoke.mockReset()
  invoke.mockImplementation(async channel => {
    if (channel === 'db:project-core-get') return null
    if (channel === 'db:blueprint-get-all') return [blueprint(1), blueprint(4)]
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
})

it('returns the command report from one blueprint list read', async () => {
  const request = createRequest()
  const report = await new VerifyBlueprintsCommand().execute(request)
  expect(report.gaps.map(gap => gap.missingChapterNumbers)).toEqual([[2, 3]])
  expect(invoke.mock.calls).toEqual([['db:blueprint-get-all']])
  expect(request.callbacks.setProgress).toHaveBeenCalledWith(100)
})

it.each(['workflow', 'command'])('propagates a blueprint read failure through the %s', async entry => {
  invoke.mockImplementation(async channel => {
    if (channel === 'db:project-core-get') return null
    throw new Error('read failed')
  })
  const { step, context, callbacks } = createRequest()
  const result = entry === 'workflow'
    ? createVerificationWorkflow().steps[0].executor(step, context, callbacks)
    : new VerifyBlueprintsCommand().execute({ step, context, callbacks })

  await expect(result).rejects.toThrow('read failed')
  expect(context.data).toEqual({})
  expect(callbacks.setProgress).not.toHaveBeenCalled()
})

it('can report from a saved load-step checkpoint without querying the database again', async () => {
  const workflow = createVerificationWorkflow()
  const { step, context, callbacks } = createRequest()
  await workflow.steps[0].executor(step, context, callbacks)
  const resumedContext = structuredClone(context)

  await createVerificationWorkflow().steps[1].executor(step, resumedContext, callbacks)

  expect(resumedContext.data).toMatchObject({
    blueprints: [{ chapterNumber: 1 }, { chapterNumber: 4 }],
    totalChapters: 4,
    verificationReport: { gaps: [{ missingChapterNumbers: [2, 3] }] },
    gaps: [{ missingChapterNumbers: [2, 3] }],
  })
  expect(invoke.mock.calls).toEqual([['db:project-core-get'], ['db:blueprint-get-all']])
})

it('does not query a reopened project after the workflow architecture read', async () => {
  invoke.mockImplementation(async channel => {
    if (channel === 'db:project-core-get') useProjectStore.setState({ projectSession: 2 })
    return null
  })
  const { step, context, callbacks } = createRequest()
  await expect(createVerificationWorkflow().steps[0].executor(step, context, callbacks))
    .rejects.toMatchObject({ name: 'ChapterBlueprintRequestCancelled' })
  expect(invoke.mock.calls).toEqual([['db:project-core-get']])
  expect(context.data).toEqual({})
})

it('cannot rebind a gap-fill factory to a reopened project before executing', async () => {
  const workflow = createGapFillWorkflow([{ missingChapterNumbers: [2], gapSize: 1, context: '', precedingChapter: null, followingChapter: null }])
  useProjectStore.setState({ projectSession: 2 })
  const { step, context, callbacks } = createRequest()
  await expect(workflow.steps[0].executor(step, context, callbacks)).rejects.toMatchObject({ name: 'ChapterBlueprintRequestCancelled' })
  expect(invoke).not.toHaveBeenCalled()
})
it('does not capture a new write token or publish architecture after gap-fill project changes during IO', async () => {
  const workflow = createGapFillWorkflow([{ missingChapterNumbers: [2], gapSize: 1, context: '', precedingChapter: null, followingChapter: null }])
  invoke.mockImplementation(async channel => {
    if (channel === 'db:project-core-get') { useProjectStore.setState({ projectSession: 2 }); return { premise: 'Premise '.repeat(10) } }
    throw new Error('Unexpected write')
  })
  const { step, context, callbacks } = createRequest()
  await expect(workflow.steps[0].executor(step, context, callbacks)).rejects.toMatchObject({ name: 'ChapterBlueprintRequestCancelled' })
  expect(invoke.mock.calls).toEqual([['db:project-core-get']])
  expect(context.data).toEqual({})
})
it.each(['reopened', 'cancelled'])('does not report an empty fill as successful after %s', async mode => {
  const workflow = createVerificationWorkflow({ autoFill: true })
  const { step, context, callbacks } = createRequest()
  context.data.gaps = []
  if (mode === 'reopened') useProjectStore.setState({ projectSession: 2 })
  else context.cancelled = true
  await expect(workflow.steps[2].executor(step, context, callbacks)).rejects.toThrow()
  expect(callbacks.setProgress).not.toHaveBeenCalledWith(100)
})
it('does not publish a report after the workflow source session changes between steps', async () => {
  const workflow = createVerificationWorkflow()
  const { step, context, callbacks } = createRequest()
  await workflow.steps[0].executor(step, context, callbacks)
  useProjectStore.setState({ projectSession: 2 })
  await expect(workflow.steps[1].executor(step, context, callbacks))
    .rejects.toMatchObject({ name: 'ChapterBlueprintRequestCancelled' })
  expect(context.data.verificationReport).toBeUndefined()
})
