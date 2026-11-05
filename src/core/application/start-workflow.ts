export type ChapterWorkflow = 'generate_draft' | 'review' | 'refine' | 'finalize'
export interface ChapterCreation {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  characters: string[]
  keyEvents: string
  suspenseHook?: string
  userGuidance?: string
  knowledgeQueryHint?: string
}
export interface ImportedChapterData { number: number; title: string; content: string; wordCount: number }
export type ConfigField = 'coreOutline' | 'worldSetting' | 'goldenFinger' | 'protagonistProfile' | 'globalGuidance' | 'writingStyle'
export interface ArchitectureGeneration {
  selectedSteps?: Array<'premise' | 'characters' | 'worldbuilding' | 'synopsis'>
  stepGuidance?: Record<string, string>
}
export interface ConfigGenerationSize { totalChapters?: number; wordsPerChapter?: number }
export interface CharacterExtraction { projectPath: string; characterDynamicsContent: string; genre: string }
export interface EditorDraft {
  draftPath: string
  draftContent: string
  chapterTitle: string
  userRefinePrompt?: string
  reviewFocus?: string
  reviewReport?: string
  reviewFileName?: string
}
export interface BookWorkflowRequest {
  workflow: 'generate_book'
  chapterStart: number
  chapterEnd: number
  autoReview?: boolean
  reuseExistingDrafts?: boolean
}
export interface BlueprintGeneration {
  mode: 'full' | 'append'
  startChapter?: number
  count?: number
  pacingGuidance?: string
  generationMode?: 'single' | 'batch'
  batchChapterCount?: number
}
export interface BlueprintGapRequest {
  missingChapterNumbers: readonly number[]
  gapSize: number
  context: string
}
export type WorkflowStartRequest =
  | { workflow: 'generate_draft'; chapterNumber: number; chapterInfo?: ChapterCreation }
  | { workflow: 'repair_finalize'; chapterNumber: number }
  | { workflow: 'review' | 'refine' | 'finalize'; chapterNumber: number; draft?: EditorDraft }
  | { workflow: 'generate_blueprint'; directory?: BlueprintGeneration }
  | { workflow: 'generate_architecture'; architecture?: ArchitectureGeneration }
  | { workflow: 'fill_blueprint_gaps'; gaps: readonly BlueprintGapRequest[] }
  | ({ workflow: 'config_generation'; idea: string } & ConfigGenerationSize)
  | { workflow: 'generate_config_field'; fieldKey: ConfigField }
  | { workflow: 'import_novel'; chapters: ImportedChapterData[] }
  | ({ workflow: 'extract_arch_characters' } & CharacterExtraction)
  | { workflow: 'repair_arch_characters'; projectPath: string }
  | BookWorkflowRequest

export interface PreparedWorkflow<Definition> {
  definition: Definition
  displayName: string
  chapterTag?: string
  stepByStep?: boolean
}
export interface WorkflowStartPort<Definition> {
  chapter(workflow: ChapterWorkflow, chapterNumber: number, draft?: EditorDraft): Promise<PreparedWorkflow<Definition>>
  repair(chapterNumber: number): Promise<PreparedWorkflow<Definition>>
  write(chapter: ChapterCreation): Promise<PreparedWorkflow<Definition>>
  importNovel(chapters: ImportedChapterData[]): Promise<PreparedWorkflow<Definition>>
  configField(field: ConfigField): Promise<PreparedWorkflow<Definition>>
  extractCharacters(params: CharacterExtraction): Promise<PreparedWorkflow<Definition>>
  repairCharacters(projectPath: string): Promise<PreparedWorkflow<Definition>>
  blueprint(params?: BlueprintGeneration): Promise<PreparedWorkflow<Definition>>
  fillGaps(gaps: readonly BlueprintGapRequest[]): Promise<PreparedWorkflow<Definition>>
  architecture(params?: ArchitectureGeneration): Promise<PreparedWorkflow<Definition>>
  book(request: BookWorkflowRequest): Promise<PreparedWorkflow<Definition>>
  config(idea: string, size?: ConfigGenerationSize): Promise<PreparedWorkflow<Definition>>
  /** Resolves as soon as the run has started, independently of completion. */
  start(definition: Definition, stepByStep?: boolean): Promise<string>
}
export class WorkflowStartError extends Error {
  constructor(readonly code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT', message: string) {
    super(message)
    this.name = 'WorkflowStartError'
  }
}
export class WorkflowValidationError extends Error {
  constructor(readonly reason: 'range' | 'range-too-large' | 'idea' | 'unsupported' | 'draft') {
    super(reason)
    this.name = 'WorkflowValidationError'
  }
}
export interface WorkflowReceipt { runId: string; displayName: string; chapterTag: string }

/** Validate and dispatch before starting exactly one run through the injected port. */
export async function startWorkflow<Definition>(request: WorkflowStartRequest, port: WorkflowStartPort<Definition>): Promise<WorkflowReceipt> {
  let prepared: PreparedWorkflow<Definition>
  switch (request.workflow) {
    case 'generate_draft': case 'review': case 'refine': case 'finalize':
      if (!Number.isSafeInteger(request.chapterNumber) || request.chapterNumber < 1) throw new WorkflowValidationError('range')
      if (request.workflow === 'generate_draft' && request.chapterInfo) {
        const chapter = request.chapterInfo
        if (chapter.chapterNumber !== request.chapterNumber || !Array.isArray(chapter.characters)
          || chapter.characters.some(character => typeof character !== 'string')
          || [chapter.title, chapter.role, chapter.purpose, chapter.keyEvents].some(value => typeof value !== 'string')) throw new WorkflowValidationError('range')
        prepared = await port.write(chapter)
      } else if ('draft' in request && request.draft !== undefined) {
        const draft = request.draft
        if (!draft || !/^vela:\/\/(?:draft|manuscript)\/[1-9]\d*$/.test(draft.draftPath)
          || typeof draft.draftContent !== 'string' || typeof draft.chapterTitle !== 'string') throw new WorkflowValidationError('draft')
        prepared = await port.chapter(request.workflow, request.chapterNumber, draft)
      } else prepared = await port.chapter(request.workflow, request.chapterNumber)
      break
    case 'repair_finalize':
      if (!Number.isSafeInteger(request.chapterNumber) || request.chapterNumber < 1) throw new WorkflowValidationError('range')
      prepared = await port.repair(request.chapterNumber)
      break
    case 'generate_blueprint': {
      const params = request.directory
      if (params && (!['full', 'append'].includes(params.mode)
        || [params.startChapter, params.count, params.batchChapterCount].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 1)))) {
        throw new WorkflowValidationError('range')
      }
      prepared = await port.blueprint(params)
      break
    }
    case 'fill_blueprint_gaps':
      if (!Array.isArray(request.gaps) || !request.gaps.length || request.gaps.some(gap =>
        !Array.isArray(gap.missingChapterNumbers) || !gap.missingChapterNumbers.length || typeof gap.context !== 'string'
        || gap.gapSize !== gap.missingChapterNumbers.length || gap.missingChapterNumbers.some((n: number) => !Number.isSafeInteger(n) || n < 1))) {
        throw new WorkflowValidationError('range')
      }
      prepared = await port.fillGaps(request.gaps)
      break
    case 'generate_architecture': prepared = await port.architecture(request.architecture); break
    case 'extract_arch_characters':
      if (!request.projectPath || typeof request.characterDynamicsContent !== 'string' || typeof request.genre !== 'string') throw new WorkflowValidationError('range')
      prepared = await port.extractCharacters(request)
      break
    case 'repair_arch_characters':
      if (!request.projectPath) throw new WorkflowValidationError('range')
      prepared = await port.repairCharacters(request.projectPath)
      break
    case 'generate_config_field':
      if (!['coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile', 'globalGuidance', 'writingStyle'].includes(request.fieldKey)) throw new WorkflowValidationError('unsupported')
      prepared = await port.configField(request.fieldKey)
      break
    case 'import_novel': {
      const numbers = new Set<number>()
      if (!Array.isArray(request.chapters) || !request.chapters.length) throw new WorkflowValidationError('range')
      for (const chapter of request.chapters) {
        if (!Number.isSafeInteger(chapter.number) || chapter.number < 1 || numbers.has(chapter.number)
          || typeof chapter.title !== 'string' || typeof chapter.content !== 'string'
          || !Number.isSafeInteger(chapter.wordCount) || chapter.wordCount < 0) throw new WorkflowValidationError('range')
        numbers.add(chapter.number)
      }
      prepared = await port.importNovel(request.chapters)
      break
    }
    case 'config_generation':
      if (typeof request.idea !== 'string' || !request.idea.trim()) throw new WorkflowValidationError('idea')
      if ([request.totalChapters, request.wordsPerChapter].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 1))) throw new WorkflowValidationError('range')
      prepared = await port.config(request.idea.trim(), { totalChapters: request.totalChapters, wordsPerChapter: request.wordsPerChapter })
      break
    case 'generate_book':
      if (!Number.isSafeInteger(request.chapterStart) || !Number.isSafeInteger(request.chapterEnd)
        || request.chapterStart < 1 || request.chapterEnd < request.chapterStart) throw new WorkflowValidationError('range')
      if (request.chapterEnd - request.chapterStart + 1 > 100) throw new WorkflowValidationError('range-too-large')
      prepared = await port.book(request)
      break
    default: throw new WorkflowValidationError('unsupported')
  }
  const runId = prepared.stepByStep === undefined ? await port.start(prepared.definition) : await port.start(prepared.definition, prepared.stepByStep)
  return { runId, displayName: prepared.displayName, chapterTag: prepared.chapterTag ?? '' }
}
