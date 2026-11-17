/** Execution semantics shared by every tool source. */
export interface ToolExecutionPolicy {
  requiresConfirmation: boolean
  isReadOnly: boolean
  isConcurrencySafe: boolean
  isDestructive: boolean
}

export function canExecuteConcurrently(tool: ToolExecutionPolicy | undefined): boolean {
  return tool !== undefined && tool.isReadOnly && tool.isConcurrencySafe
    && !tool.isDestructive && !tool.requiresConfirmation
}

export function requiresToolApproval(tool: ToolExecutionPolicy): boolean {
  return tool.requiresConfirmation || tool.isDestructive
}

/** Abandon an approval wait when the owning run is cancelled. */
export async function waitForToolApproval(approve: () => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return approve()
  if (signal.aborted) return false
  let cancel!: () => void
  const stopped = new Promise<boolean>(resolve => { cancel = () => resolve(false) })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await Promise.race([stopped, approve()])
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
