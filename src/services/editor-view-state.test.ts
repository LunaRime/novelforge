// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadEditorViewState, saveEditorViewState, clearEditorViewState, clampEditorViewState,
} from './editor-view-state'

const KEY = 'novelforge:editor-view-state:v1'

describe('editor-view-state', () => {
  beforeEach(() => localStorage.clear())

  it('按项目 + filePath 往返，不跨项目串数据', () => {
    saveEditorViewState('/p/a', 'vela://draft/1', { anchor: 3, head: 5, scrollTop: 120 })
    expect(loadEditorViewState('/p/a', 'vela://draft/1')).toEqual({ anchor: 3, head: 5, scrollTop: 120 })
    expect(loadEditorViewState('/p/b', 'vela://draft/1')).toBeNull()
  })

  it('坏 JSON 返回 null 且不抛', () => {
    localStorage.setItem(KEY, '{')
    expect(loadEditorViewState('/p', 'x')).toBeNull()
  })

  it('最多保留 200 条，淘汰最旧', () => {
    for (let i = 0; i < 205; i++) {
      saveEditorViewState('/p', `f${i}`, { anchor: 0, head: 0, scrollTop: i })
    }
    const raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(Object.keys(raw.entries)).toHaveLength(200)
    expect(loadEditorViewState('/p', 'f0')).toBeNull()
    expect(loadEditorViewState('/p', 'f204')).not.toBeNull()
  })

  it('clear 只删指定项', () => {
    saveEditorViewState('/p', 'a', { anchor: 0, head: 0, scrollTop: 1 })
    saveEditorViewState('/p', 'b', { anchor: 0, head: 0, scrollTop: 2 })
    clearEditorViewState('/p', 'a')
    expect(loadEditorViewState('/p', 'a')).toBeNull()
    expect(loadEditorViewState('/p', 'b')).not.toBeNull()
  })

  it('clamp 把越界偏移与滚动量收敛到合法范围', () => {
    expect(clampEditorViewState({ anchor: 99, head: -3, scrollTop: 999 }, 20, 100))
      .toEqual({ anchor: 20, head: 0, scrollTop: 100 })
  })
})