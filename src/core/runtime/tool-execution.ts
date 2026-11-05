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
