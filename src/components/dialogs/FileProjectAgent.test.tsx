// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { t } from '../../shared/locale'
import { FileProjectAgent } from './FileProjectAgent'

const ask = vi.hoisted(() => vi.fn())
vi.mock('../../services/agent-adapters/file-project-agent', () => ({ askFileProjectAgent: ask }))

it('keeps cancellation pending until the file conversation turn settles', async () => {
  let finish!: (answer: { answer: string }) => void
  ask.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FileProjectAgent token="file-session" disabled={false} onApply={vi.fn()} />))
    const input = container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Write a scene')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === t('action.cancel'))!
    act(() => cancel.click())
    expect((ask.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t('status.cancelling'))
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    await act(async () => finish({ answer: 'Late answer' }))
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t('project.fileEditorAgentCancelled'))
    expect(container.textContent).not.toContain('Late answer')
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
