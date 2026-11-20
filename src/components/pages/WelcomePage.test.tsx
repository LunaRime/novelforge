// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { t } from '../../shared/locale'
import WelcomePage from './WelcomePage'

vi.mock('../../stores/project-store', () => ({
  useProjectStore: (select: (state: { currentProject: null }) => null) => select({ currentProject: null }),
}))

it('keeps the welcome actions available after a folder chooser error or cancellation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onNewProject = vi.fn()
  const onImportNovel = vi.fn()
  const onOpenProject = vi.fn().mockRejectedValueOnce(new Error('chooser unavailable')).mockResolvedValueOnce(undefined)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(<WelcomePage onNewProject={onNewProject} onOpenProject={onOpenProject} onImportNovel={onImportNovel} />)
    })
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    const open = button(t('welcome.openProject'))
    await act(async () => { open.click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t('dialog.openFailed'))
    await act(async () => { open.click() })
    expect(onOpenProject).toHaveBeenCalledTimes(2)
    expect(open.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { button(t('welcome.newProject')).click(); button(t('welcome.importNovel')).click() })
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onImportNovel).toHaveBeenCalledOnce()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
  }
})
