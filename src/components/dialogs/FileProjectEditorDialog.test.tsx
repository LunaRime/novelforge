// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { FileProjectEditorDialog } from './FileProjectEditorDialog'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

let root: Root
let host: HTMLDivElement
async function render() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<FileProjectEditorDialog />))
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)!
  await act(async () => button.click())
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); invoke.mockReset() })

test('saves with the displayed revision and restores the selected read-only document on reopen', async () => {
  const current = 'doc://chapter/ch_12345678'
  const history = 'doc://history/1'
  const documents = [{ locator: current, name: 'Current' }, { locator: history, name: 'History' }]
  let content = 'current draft'
  invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'dialog:select-folder') return '/candidate'
    if (channel === 'project:file-editor-open') return {
      token: 'session', documents, missing: [],
      tabs: (args[1] as string[]).map(locator => locator === current
        ? { locator, content, revision: 'revision' }
        : { locator, content: 'old draft', readOnly: true }),
    }
    if (channel === 'project:file-editor-save') { content = args[3]; return { revision: 'updated', indexed: true } }
  })
  const launch = async () => {
    await click('project.fileEditor')
    await click('project.fileEditorChoose')
    return document.querySelector<HTMLTextAreaElement>('textarea')!
  }
  await render()
  const body = await launch()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'saved draft')
    body.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('action.save')
  expect(invoke).toHaveBeenCalledWith('project:file-editor-save', 'session', current, 'revision', 'saved draft')
  const select = document.querySelector('select')!
  await act(async () => { select.value = history; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(body.readOnly && body.value === 'old draft').toBe(true)
  await act(async () => root.unmount())
  host.remove()
  await render()
  const restored = await launch()
  expect(restored.value).toBe('old draft')
  expect(restored.readOnly).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
})
