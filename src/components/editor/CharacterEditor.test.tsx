// @vitest-environment jsdom
/**
 * CharacterEditor — 角色编辑器排布（2026-09-25 重构）
 *
 * 重构前的病灶：36px 的一条工具栏里塞了 **9 个控件**（4 个视图/动作按钮 + 生成档案 +
 * 试演 + 2 个模板图标 + 删除 + 保存）。编辑区下限是 320px（`EDITOR_MIN_PX`），
 * 而那一行光按钮就要 ~340px —— 窄编辑区必然挤出界；且视图切换靠「按钮标签在两态间互换」，
 * 看不出有四个视图。
 *
 * 重构后：工具栏只留「保存 + 更多」，其余低频操作进 ⋯ 菜单；四视图各自成段；
 * 长表单按分区组织出标题锚点。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CharacterEditor from './CharacterEditor'
import { useCharacterStore, EMPTY_CARD, type CharacterCard } from '../../stores/character-store'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { draftListScope, useDraftStore } from '../../stores/draft-store'
import { useEditorStore } from '../../stores/editor-store'
import CharactersView from '../panels/sidebar/CharactersView'
import * as sidebarNavigation from '../panels/sidebar/SidebarShared'
import { t } from '../../shared/locale'

let container: HTMLDivElement | null = null
let root: Root | null = null

function card(name: string, extra: Partial<CharacterCard> = {}): CharacterCard {
  return { ...EMPTY_CARD, name, ...extra }
}

/** 播种：一个 tier1 主角被选中（走完整字段分支），外加一个配角 */
function seed(dirty = false): void {
  useCharacterStore.setState({
    characters: [card('小明', { tier: 1, role: 'protagonist', tags: '["主角","少年"]' }), card('小红')],
    selectedName: '小明',
    view: 'edit',
    saving: false,
    dirty,
  })
  useProjectStore.setState({ currentProject: { name: '测试项目', path: 'E:/tmp/novel' } as never })
}

function render(withRoster = false): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<>{withRoster && <aside data-test-roster><CharactersView /></aside>}<CharacterEditor /></>)
  })
  return container
}

function buttons(box: HTMLElement): HTMLButtonElement[] {
  return Array.from(box.querySelectorAll('button')) as HTMLButtonElement[]
}

/** 按可见文字找按钮（工具栏/菜单项都走这条） */
function byText(box: HTMLElement, text: string): HTMLButtonElement | undefined {
  return buttons(box).find((b) => (b.textContent || '').includes(text))
}

/** ⋯ 菜单锚点按钮：图标按钮，靠 title 定位 */
function moreButton(box: HTMLElement): HTMLButtonElement | undefined {
  return buttons(box).find((b) => b.title === t('charList.more'))
}

beforeEach(() => { seed() })

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
  useDraftStore.getState().reset()
  useEditorStore.getState().clearTabs()
})

describe('CharacterEditor — 工具栏只留主操作 + 更多菜单', () => {
  it('shows one roster and preserves the same profile elements when the sidebar closes', () => {
    const layout = useLayoutStore.getState()
    useLayoutStore.setState({ sidebarView: 'characters', sidebarOpen: true, focusMode: false })
    try {
      const box = render()
      const input = [...box.querySelectorAll('input')].find(element => element.value === '小明')
      expect(input).toBeDefined()
      expect(box.querySelector('[data-feature-list]')).toBeNull()
      act(() => useLayoutStore.getState().toggleSidebar())
      expect(box.querySelector('[data-feature-list]')?.textContent).toContain('小红')
      expect(box.contains(input!)).toBe(true)
      act(() => useLayoutStore.getState().toggleSidebar())
      expect(box.querySelector('[data-feature-list]')).toBeNull()
      expect(box.contains(input!)).toBe(true)
    } finally { act(() => useLayoutStore.setState(layout)) }
  })

  it('低频操作默认不在工具栏上（生成档案 / 试演 / 存为模板 / 删除）', () => {
    const box = render()

    // 保存按钮已改图标（10-18 评审统一入口形态），靠 title 定位，不再有「保存」文字
    const saveBtn = buttons(box).find((b) => b.title === t('tip.saveShortcut'))
    expect(saveBtn).toBeTruthy()
    expect(moreButton(box)).toBeTruthy()

    for (const key of ['character.archiveBtn', 'roleplay.enter', 'template.saveAs', 'action.delete'] as const) {
      expect(byText(box, t(key))).toBeFalsy()
    }
  })

  it('展开「更多」后低频操作才出现，删除也在菜单内', async () => {
    const box = render()

    await act(async () => { moreButton(box)!.click() })

    expect(byText(box, t('character.archiveBtn'))).toBeTruthy()
    expect(byText(box, t('roleplay.enter'))).toBeTruthy()
    expect(byText(box, t('template.saveAs'))).toBeTruthy()
    expect(byText(box, t('action.delete'))).toBeTruthy()
  })

  it('有未保存修改时给出标记', () => {
    useCharacterStore.setState({ dirty: true })
    const box = render()

    expect(box.textContent).toContain(t('character.unsaved'))
  })
})

describe('CharacterEditor — 四个视图各自成段', () => {
  it('四段并存且当前段被标记为选中', () => {
    const box = render()

    const segs = buttons(box).filter((b) => b.hasAttribute('aria-pressed'))
    expect(segs.map((s) => (s.textContent || '').trim())).toEqual([
      t('character.viewEdit'),
      t('character.viewState'),
      t('character.viewGraph'),
      t('character.backlinks'),
    ])
    expect(segs.filter((s) => s.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  it('切到「当前状态」后主体区跟着换', () => {
    const box = render()

    const stateSeg = buttons(box).find((b) => (b.textContent || '').trim() === t('character.viewState'))!
    act(() => { stateSeg.click() })

    expect(box.textContent).toContain(t('character.stateProfile'))
  })
})

describe('CharacterEditor — 长表单有分区锚点', () => {
  it('渲染分区标题：基础设定 / 角色档案 / 生命周期与合并', () => {
    const box = render()

    for (const key of ['character.basicSettings', 'character.viewProfile', 'character.lifecycleSection'] as const) {
      expect(box.textContent).toContain(t(key))
    }
  })

  it('从已有出场记录中显示首末章节，空记录不显示第 0 章', () => {
    useCharacterStore.setState({
      characters: [card('小明', { appearChapters: '[9,0,"2",9,null]' }), card('小红')],
    })
    const box = render()
    const stats = box.querySelector('.nf-character-appearance-stats')
    expect([...stats!.querySelectorAll('dd')].map(element => element.textContent)).toEqual([
      '2',
      t('chapter.label').replace('{n}', '2'),
      t('chapter.label').replace('{n}', '9'),
    ])
    act(() => { useCharacterStore.getState().setSelectedName('小红') })
    expect(box.textContent).toContain(t('character.backlinks.noChapters'))
    expect(box.querySelector('.nf-character-appearance-stats')).toBeNull()
  })
})

describe('CharacterEditor — 角色视图联动', () => {
  it('从搜索框上方打开图谱，通过键盘聚焦角色并打开档案，保留编辑', () => {
    useCharacterStore.setState({ dirty: true })
    const box = render(true)
    const sidebar = box.querySelector<HTMLElement>('[data-test-roster]')!
    const graphEntry = byText(sidebar, t('character.viewGraph'))!
    const search = sidebar.querySelector('input[type="search"]')!
    expect(graphEntry.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const core = buttons(sidebar).find(button => button.getAttribute('aria-expanded') === 'true'
      && button.textContent?.includes(t('character.tierLabel.core')))!
    const group = document.getElementById(core.getAttribute('aria-controls')!)!
    act(() => { core.click() })
    expect(core.getAttribute('aria-expanded')).toBe('false')
    expect(group.hidden).toBe(true)

    act(() => { graphEntry.click() })
    const node = box.querySelector('[data-graph-node="小红"]')!
    act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(node.getAttribute('aria-pressed')).toBe('true')
    const profile = buttons(box).find(button => button.getAttribute('aria-label') === t('graph.openProfile'))!
    act(() => { profile.click() })
    expect(useCharacterStore.getState()).toMatchObject({ selectedName: '小红', view: 'edit', dirty: true })
  })

  it('反向链接跳转本项目的定稿与关联角色，切换项目会移除旧章节入口', () => {
    const openChapter = vi.spyOn(sidebarNavigation, 'openChapterFile').mockResolvedValue(undefined)
    useCharacterStore.setState({
      dirty: true,
      characters: [
        card('小明', { appearChapters: '[3]', relations: '[{"target":"小红","type":"ally","sinceChapter":3}]' }),
        card('小红', { appearChapters: '[3]' }),
      ],
      view: 'backlinks',
    })
    useDraftStore.setState({
      draftsScope: draftListScope(useProjectStore.getState()),
      draftsByChapter: { 3: [{ id: 31, chapterNumber: 3, status: 'finalized', createdAt: 1, version: 1, source: 'write' }] },
    })
    const box = render()
    const chapter = box.querySelector<HTMLButtonElement>('.nf-character-chapter-list button')!
    act(() => { chapter.click() })
    expect(openChapter).toHaveBeenCalledWith('vela://manuscript/31', t('chapter.label').replace('{n}', '3'))

    const related = box.querySelector<HTMLButtonElement>('button.nf-character-relation-target')!
    act(() => { related.click() })
    expect(useCharacterStore.getState()).toMatchObject({ selectedName: '小红', view: 'backlinks', dirty: true })
    expect(box.textContent).toContain(t('character.backlinks.mentionedBy'))

    act(() => useProjectStore.setState(state => ({ projectSession: state.projectSession + 1 })))
    expect(box.querySelector('.nf-character-chapter-list button')).toBeNull()
    expect(box.querySelector('.nf-character-chapter-list')?.textContent).toBe(t('chapter.label').replace('{n}', '3'))
  })
})
