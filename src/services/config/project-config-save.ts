import { NovelConfigRequestCancelled, type NovelConfigScope } from '../../core'
import { t } from '../../shared/locale'

interface ProjectWriteReceipt { success: boolean; error?: string }

export class ProjectConfigResultUnknown extends Error {
  constructor() { super(t('novelConfig.saveUnknown')) }
}

const inFlight = new Map<string, { verifiedByReopen: boolean }>()
const unverified = new Set<string>()

export function markProjectConfigReloaded(path: string, writeToken?: string) {
  unverified.delete(path)
  const request = inFlight.get(path)
  if (request && writeToken) {
    request.verifiedByReopen = true
    inFlight.delete(path)
  }
}

export async function commitProjectConfig(
  source: NovelConfigScope,
  isCurrent: () => boolean,
  write: () => Promise<ProjectWriteReceipt>,
  onPending: () => void,
  onCommitted?: () => void,
): Promise<ProjectWriteReceipt> {
  if (!isCurrent()) throw new NovelConfigRequestCancelled()
  if (unverified.has(source.path)) throw new ProjectConfigResultUnknown()
  if (inFlight.has(source.path)) throw new Error(t('novelConfig.saveInProgress'))
  const request = { verifiedByReopen: false }
  inFlight.set(source.path, request)
  const timer = setTimeout(() => {
    if (!request.verifiedByReopen && isCurrent()) onPending()
  }, 15_000)
  try {
    let receipt: ProjectWriteReceipt
    try {
      receipt = await write()
      if (typeof receipt?.success !== 'boolean') throw new ProjectConfigResultUnknown()
    } catch {
      if (!request.verifiedByReopen) unverified.add(source.path)
      if (!isCurrent()) throw new NovelConfigRequestCancelled()
      throw new ProjectConfigResultUnknown()
    }
    if (!isCurrent()) throw new NovelConfigRequestCancelled()
    if (receipt.success) onCommitted?.()
    return receipt
  } finally {
    clearTimeout(timer)
    if (inFlight.get(source.path) === request) inFlight.delete(source.path)
  }
}
