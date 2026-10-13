// @vitest-environment jsdom
/**
 * project-store 快照机制（线③ 产出审查层：前置快照 + 撤销出口）
 *
 * 契约：snapshotNovelConfig 深拷贝当前配置；restoreNovelConfigSnapshot 恢复快照
 * 并清空快照；无快照/无项目时 no-op 返回 false。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useProjectStore } from './project-store'
import type { ProjectData } from '../shared/ipc-channels'

vi.mock('../services/ipc-client', () => ({
  ipc: { invoke: vi.fn().mockResolvedValue(true) },
}))

const BASE: ProjectData = {
  id: 'p1',
  name: '测试小说',
  path: '/test',
  novelConfig: {
    genre: '玄幻',
    subGenre: '',
    targetAudience: '',
    totalChapters: 100,
    wordsPerChapter: 3000,
    plotStructure: 'three_act',
    narrativePOV: 'third_limited',
    coreOutline: '旧大纲',
    worldSetting: '',
    goldenFinger: '',
    protagonistProfile: '',
    globalGuidance: '',
  },
  characterStates: '',
  createdAt: 0,
  updatedAt: 0,
}

beforeEach(() => {
  useProjectStore.setState({
    currentProject: structuredClone(BASE),
    configSnapshot: null,
  })
})

afterEach(() => {
  useProjectStore.setState({ currentProject: null, configSnapshot: null })
})

describe('project-store 快照机制（线③）', () => {
  it('snapshot 深拷贝当前配置；update 后 restore 恢复原值', () => {
    const { snapshotNovelConfig, updateNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()

    snapshotNovelConfig()
    updateNovelConfig({ coreOutline: 'AI 生成的新大纲', genre: '仙侠' })

    // 应用后：配置已变，快照仍在
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('AI 生成的新大纲')

    const ok = restoreNovelConfigSnapshot()
    expect(ok).toBe(true)
    // 恢复：回到快照（旧大纲 + 旧题材），快照清空
    const cfg = useProjectStore.getState().currentProject!.novelConfig
    expect(cfg.coreOutline).toBe('旧大纲')
    expect(cfg.genre).toBe('玄幻')
    expect(useProjectStore.getState().configSnapshot).toBeNull()
  })

  it('快照是深拷贝——update 后快照不被浅合并污染', () => {
    const { snapshotNovelConfig, updateNovelConfig } = useProjectStore.getState()
    snapshotNovelConfig()
    updateNovelConfig({ coreOutline: '新值' })
    // 快照里的 coreOutline 仍是旧值
    expect(useProjectStore.getState().configSnapshot!.coreOutline).toBe('旧大纲')
  })

  it('无快照时 restore 返回 false 且不改动配置', () => {
    const { restoreNovelConfigSnapshot } = useProjectStore.getState()
    expect(restoreNovelConfigSnapshot()).toBe(false)
    expect(useProjectStore.getState().currentProject!.novelConfig.coreOutline).toBe('旧大纲')
  })

  it('无 currentProject 时 snapshot/restore 均 no-op', () => {
    useProjectStore.setState({ currentProject: null })
    const { snapshotNovelConfig, restoreNovelConfigSnapshot } = useProjectStore.getState()
    snapshotNovelConfig()
    expect(useProjectStore.getState().configSnapshot).toBeNull()
    expect(restoreNovelConfigSnapshot()).toBe(false)
  })
})
