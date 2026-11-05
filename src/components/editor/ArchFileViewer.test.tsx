// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setCurrentLocale, type SupportedLocale } from '../../shared/locale'

vi.mock('../panels/sidebar/SidebarShared', () => ({ renderIcon: () => null }))
vi.mock('../dialogs/ArchitectureConfirmDialog', () => ({ default: () => null }))
vi.mock('./CodeMirrorEditor', () => ({ default: ({ onChange }: { onChange: (s: string) => void }) =>
  <button onClick={() => onChange('modified')}>edit fixture</button> }))
vi.mock('../../stores/editor-store', () => ({ useEditorStore: { getState: () => ({ updateTabContent: vi.fn(), syncTabContent: vi.fn(), markTabSaved: vi.fn() }) } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: (selector: (s: unknown) => unknown) => selector({ currentProject: null }) }))
vi.mock('../../stores/character-store', () => ({ useCharacterStore: (selector: (s: unknown) => unknown) => selector({ characters: [] }) }))
vi.mock('../../stores/workflow-store', () => ({ useWorkflowStore: (selector: (s: unknown) => unknown) => selector({ isTypeRunning: () => false }) }))
vi.mock('../../services/workflows/architecture-workflow', () => ({ runArchCharacterExtract: vi.fn() }))
vi.mock('../../services/workflows/start-workflow', () => ({ startWorkflow: vi.fn() }))
vi.mock('../../services/ipc-client', () => ({ ipc: { isElectron: false, invoke: vi.fn() } }))
import ArchFileViewer from './ArchFileViewer'

let root: Root | undefined
let container: HTMLDivElement
const reactGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = reactGlobals.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => { reactGlobals.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => { reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  setCurrentLocale('zh-CN')
})

test.each<[SupportedLocale, string, string]>([
  ['zh-CN', '保存', '保存（Cmd+S）'],
  ['en-US', 'Save', 'Save (Cmd+S)'],
  ['ru-RU', 'Сохранить', 'Сохранить (Cmd+S)'],
])('architecture save button follows %s for its visible label and tooltip (#41)', (locale, label, title) => {
  setCurrentLocale(locale)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ArchFileViewer filePath="vela://core/worldbuilding" content="old" />))
  const edit = [...container.querySelectorAll('button')].find(button => button.textContent === 'edit fixture')!
  act(() => edit.click())
  const save = container.querySelector(`button[title="${title}"]`)
  expect(save?.textContent?.trim()).toBe(label)
})
