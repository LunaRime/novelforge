import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererKnowledgeApplication } from './knowledge-adapter'
const { invoke, generate, scope } = vi.hoisted(() => ({ invoke: vi.fn(), generate: vi.fn(), scope: { currentProject: { id:'a',path:'/a' }, projectSession:1 } }))
vi.mock('../ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../stores/project-store', () => ({ useProjectStore: { getState: () => scope } }))
vi.mock('../../stores/llm-store', () => ({ useLLMStore: { getState: () => ({ generate }) } }))
const doc = { id:'1',filePath:'vela://manuscript/7',fileName:'chapter_1.md',chunkCount:1,importedAt:'' }
beforeEach(() => { vi.clearAllMocks(); scope.projectSession=1; generate.mockResolvedValue({success:true,content:'summary'}) })
describe('knowledge renderer adapter', () => {
  it('resolves DB-backed knowledge locators without filesystem reads', async () => {
    invoke.mockResolvedValue({content:'body'})
    await expect(createRendererKnowledgeApplication().summarize(doc,'prompt')).resolves.toEqual({status:'ready',text:'summary'})
    expect(invoke).toHaveBeenCalledWith('db:draft-get-full',7)
    expect(generate).toHaveBeenCalledWith([{role:'system',content:'prompt'},{role:'user',content:'body'}])
  })
  it('does not call a model after filesystem read failure', async () => {
    invoke.mockResolvedValue({success:false,error:'disk failed'})
    await expect(createRendererKnowledgeApplication().summarize({...doc,filePath:'a.md'},'prompt')).rejects.toThrow('disk failed')
    expect(generate).not.toHaveBeenCalled()
  })
  it.each([{success:false,error:'offline'},{success:true,content:' '}])('rejects failed or empty model answers', async response => {
    invoke.mockResolvedValue({content:'body'}); generate.mockResolvedValue(response)
    await expect(createRendererKnowledgeApplication().summarize(doc,'prompt')).rejects.toThrow()
  })
  it('rejects a false delete result and never reloads projections', async () => {
    invoke.mockResolvedValue({success:false})
    await expect(createRendererKnowledgeApplication().remove(doc)).rejects.toThrow()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('kb:remove-document','1')
  })
  it('rejects explicitly stale render scope before IO', async () => {
    const app=createRendererKnowledgeApplication({id:'a',path:'/a',session:0})
    await expect(app.load()).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled()
  })
})
