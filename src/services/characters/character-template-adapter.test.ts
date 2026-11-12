import { beforeEach, expect, it, vi } from 'vitest'
import { listCharacterTemplates, readCharacterTemplate, saveCharacterTemplate } from './character-template-adapter'
import { EMPTY_CARD } from '../../stores/character-store'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
beforeEach(() => invoke.mockReset())

it('reads portable template fields and ignores stored character identity and history', async () => {
  invoke.mockResolvedValue({ name: 'Origin', uid: 'foreign', aliases: '["Origin"]', background: 'Story',
    status: 'dead', tier: 1, relationships: 'Other: ally', relations: '[{"target":"Other"}]', appearChapters: '[3]', currentState: { location: 'Somewhere' } })
  expect(await readCharacterTemplate('template.json')).toEqual({ background: 'Story', tier: 1 })
})

it('saves a portable snapshot under the selected name and propagates failed receipts', async () => {
  invoke.mockResolvedValueOnce({ success: false, error: 'disk full' })
  await expect(saveCharacterTemplate({ ...EMPTY_CARD, name: 'Origin', uid: 'local', notes: 'Text' })).rejects.toThrow('disk full')
  expect(invoke).toHaveBeenCalledWith('templates:save', {
    name: 'Origin', data: expect.objectContaining({ notes: 'Text' }),
  })
  const data = invoke.mock.calls[0][1].data
  expect(data).not.toHaveProperty('uid')
  expect(data).not.toHaveProperty('name')
  expect(data).not.toHaveProperty('relations')
})

it('distinguishes an empty catalogue from a failed read', async () => {
  invoke.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(null)
  await expect(listCharacterTemplates()).resolves.toEqual([])
  await expect(listCharacterTemplates()).rejects.toThrow('unavailable')
  await expect(readCharacterTemplate('Missing')).rejects.toThrow()
})
