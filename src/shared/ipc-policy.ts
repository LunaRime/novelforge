/**
 * IPC 通道权限策略表（L4 设计 §4.1）—— **唯一真源，纯数据、零运行时 import**。
 *
 * ⚠️ 为什么放 src/shared/ 且只允许 `import type`：
 *   `vite.config.ts` 的 preload 构建块**没有** `rollupOptions.external`（main 块有）——
 *   preload import 什么就被打进 dist-electron/preload.cjs。若本文件 import 了
 *   ipc-guard / grants / electron 等主进程模块，会把主进程代码打进 sandbox preload。
 *   `import type` 会被完全擦除，故类型约束与运行时安全可兼得。
 *
 * `Record<InvokeChannel, ChannelPolicy>` 让 **tsc 双向把关**：漏登记或多登记都编译失败。
 * 通道集合以 `src/shared/ipc-channels.ts` 的 `InvokeChannel` 为准（事件通道不进本表）。
 *
 * authority 语义见设计 §4.2；destructive / spawn 将在 S10 起要求显式授权上下文。
 */
import type { InvokeChannel } from './ipc-channels'

/** 权限类（设计 §4.2 + S2 新增 `dialog`：打开原生对话框，是授权的**签发源**） */
export type IpcAuthority =
  | 'read-project'
  | 'write-project'
  | 'read-global'
  | 'write-global'
  | 'destructive'
  | 'spawn'
  | 'network-secret'
  | 'dev-bridge'
  | 'dialog'

/**
 * 路径参数声明（S8 启用）：入参下标 + 意图。
 * ⚠️ 必须支持**多下标**——例如 `db:get-daily-activity` 的路径在第 2/3 位
 * （`[days?, projectPath?, currentProjectPath?]`，见设计 §0.2 M4）。
 */
export interface PathArgSpec {
  index: number
  intent: 'read' | 'write' | 'delete'
}

export interface ChannelPolicy {
  authority: IpcAuthority
  /** S8 起填充；为空表示该通道当前不做路径校验 */
  pathArgs?: PathArgSpec[]
}

/**
 * 主→渲染**事件**通道的运行时清单（L4 S7）——与 invoke 通道分开的单一真源。
 *
 * 为什么需要它：preload 的事件前缀白名单此前是手工维护的元组，与事件通道的实际使用
 * **发生过漂移**（`import:progress` 一直被 `import-controller` 发送却不在白名单里 →
 * 渲染层订阅被 `checkChannel` 抛错，成了一条静默死通道，直到 S1 才发现）。
 * 现在 preload 的 event 前缀由本清单派生，这类漂移在结构上不可能再发生。
 *
 * 新增事件通道时改这里 + `AllEventChannels`（类型侧）；parity 测试会校验两者一致。
 */
export const IPC_EVENT_CHANNELS = [
  'llm:stream-chunk',
  'llm:stream-done',
  'llm:stream-error',
  'update:status-changed',
  'update:download-progress',
  'import:progress',
  'menu:check-update',
] as const

/**
 * 通道 → 策略。S2 阶段只填 authority；pathArgs 由 S8 补齐。
 */
export const IPC_CHANNEL_POLICY: Record<InvokeChannel, ChannelPolicy> = {
  'browser:list-tabs': { authority: 'dev-bridge' },
  'browser:test': { authority: 'dev-bridge' },
  'config:get': { authority: 'read-global' },
  'config:get-vela-home': { authority: 'read-global' },
  'config:set': { authority: 'write-global' },
  'config:set-locale': { authority: 'write-global' },
  'db:blueprint-delete': { authority: 'destructive' },
  'db:blueprint-get': { authority: 'read-project' },
  'db:blueprint-get-all': { authority: 'read-project' },
  'db:blueprint-get-all-sorted': { authority: 'read-project' },
  'db:blueprint-get-gaps': { authority: 'read-project' },
  'db:blueprint-update-notes': { authority: 'write-project' },
  'db:blueprint-update-priority': { authority: 'write-project' },
  'db:blueprint-update-priority-batch': { authority: 'write-project' },
  'db:blueprint-update-sort-order': { authority: 'write-project' },
  'db:blueprint-upsert': { authority: 'write-project' },
  'db:blueprint-upsert-many': { authority: 'write-project' },
  'db:character-delete': { authority: 'destructive' },
  'db:character-get-all': { authority: 'read-project' },
  'db:character-merge': { authority: 'write-project' },
  'db:character-merge-fields': { authority: 'write-project' },
  'db:character-save-all': { authority: 'write-project' },
  'db:character-update-appearance-stats': { authority: 'read-project' },
  'db:character-update-state': { authority: 'write-project' },
  'db:character-upsert': { authority: 'write-project' },
  'db:checkpoint-clear': { authority: 'destructive' },
  'db:checkpoint-load': { authority: 'write-project' },
  'db:checkpoint-save': { authority: 'write-project' },
  'db:close': { authority: 'write-project' },
  'db:draft-create': { authority: 'write-project' },
  'db:draft-get-all-chapter-numbers': { authority: 'read-project' },
  'db:draft-get-finalized': { authority: 'read-project' },
  'db:draft-get-full': { authority: 'read-project' },
  'db:draft-get-latest': { authority: 'read-project' },
  'db:draft-get-max-finalized-chapter': { authority: 'read-project' },
  'db:draft-get-meta': { authority: 'read-project' },
  'db:draft-list': { authority: 'read-project' },
  'db:draft-next-version': { authority: 'write-project' },
  'db:draft-update-content': { authority: 'write-project' },
  'db:draft-update-status': { authority: 'write-project' },
  'db:evaluation-create': { authority: 'write-project' },
  'db:evaluation-list-by-draft': { authority: 'read-project' },
  'db:get-daily-activity': { authority: 'read-project' },
  'db:get-latest-summary': { authority: 'read-project' },
  'db:get-llm-history': { authority: 'read-project' },
  'db:get-llm-stats': { authority: 'read-project' },
  'db:log-llm-call': { authority: 'write-project' },
  'db:post-process-create-run': { authority: 'write-project' },
  'db:post-process-get-latest-run': { authority: 'read-project' },
  'db:post-process-get-steps': { authority: 'read-project' },
  'db:post-process-is-all-passed': { authority: 'write-project' },
  'db:post-process-mark-step-failed': { authority: 'write-project' },
  'db:post-process-mark-step-ok': { authority: 'write-project' },
  'db:preference-get-top': { authority: 'read-project' },
  'db:preference-record': { authority: 'write-project' },
  'db:project-core-get': { authority: 'read-project' },
  'db:project-core-update': { authority: 'write-project' },
  'db:publication-delete': { authority: 'destructive' },
  'db:publication-list': { authority: 'read-project' },
  'db:publication-save': { authority: 'write-project' },
  'db:review-create': { authority: 'write-project' },
  'db:review-get-full': { authority: 'read-project' },
  'db:review-get-latest': { authority: 'read-project' },
  'db:review-list': { authority: 'read-project' },
  'db:review-next-index': { authority: 'write-project' },
  'db:revision-create': { authority: 'write-project' },
  'db:revision-get-full': { authority: 'read-project' },
  'db:revision-get-pending': { authority: 'read-project' },
  'db:revision-list': { authority: 'read-project' },
  'db:revision-mark-discarded': { authority: 'write-project' },
  'db:revision-mark-merged': { authority: 'write-project' },
  'db:revision-next-index': { authority: 'write-project' },
  'db:save-summary-snapshot': { authority: 'write-project' },
  'db:usage-stats': { authority: 'read-project' },
  'db:usage-stats-global': { authority: 'read-global' },
  'db:volume-delete': { authority: 'destructive' },
  'db:volume-get-all': { authority: 'read-project' },
  'db:volume-get-by-chapter': { authority: 'read-project' },
  'db:volume-upsert': { authority: 'write-project' },
  'dev:invoke': { authority: 'dev-bridge' },
  'dev:test': { authority: 'dev-bridge' },
  'dialog:save-file': { authority: 'dialog' },
  'dialog:select-files': { authority: 'dialog' },
  'dialog:select-folder': { authority: 'dialog' },
  'dialog:select-import-folder': { authority: 'dialog' },
  'dialog:select-novel-files': { authority: 'dialog' },
  'dialog:select-skill-file': { authority: 'dialog' },
  'embedding:cache-stats': { authority: 'network-secret' },
  'embedding:clear-cache': { authority: 'network-secret' },
  'embedding:clear-dedup': { authority: 'network-secret' },
  'embedding:compare': { authority: 'network-secret' },
  'embedding:dedup-stats': { authority: 'network-secret' },
  'embedding:generate': { authority: 'network-secret' },
  'embedding:generate-batch': { authority: 'network-secret' },
  'embedding:generate-with-llm': { authority: 'network-secret' },
  'embedding:get-llm-config': { authority: 'network-secret' },
  'embedding:get-model': { authority: 'network-secret' },
  'embedding:list-llm-candidates': { authority: 'network-secret' },
  'embedding:list-models': { authority: 'network-secret' },
  'embedding:set-llm-config': { authority: 'network-secret' },
  'embedding:set-model': { authority: 'network-secret' },
  'embedding:similarity-search': { authority: 'network-secret' },
  'embedding:test-llm': { authority: 'network-secret' },
  'export:export-chapters': { authority: 'write-global' },
  'export:select-output-dir': { authority: 'dialog' },
  'fs:agent-archive-delete': { authority: 'destructive' },
  'fs:agent-archive-list': { authority: 'read-project' },
  'fs:agent-archive-read': { authority: 'read-project' },
  'fs:agent-archive-write': { authority: 'write-project' },
  'fs:agent-result-write': { authority: 'write-project' },
  'fs:check-exists': { authority: 'read-project' },
  'fs:delete-file': { authority: 'destructive' },
  'fs:list-dir': { authority: 'read-project' },
  'fs:mkdir': { authority: 'write-project' },
  'fs:read-external-file': { authority: 'read-project' },
  'fs:read-file': { authority: 'read-project' },
  'fs:read-json': { authority: 'read-project' },
  'fs:workflow-output-append': { authority: 'write-project' },
  'fs:workflow-output-delete-run': { authority: 'destructive' },
  'fs:workflow-output-tail': { authority: 'read-project' },
  'fs:write-buffer': { authority: 'write-project' },
  'fs:write-file': { authority: 'write-project' },
  'fs:write-json': { authority: 'write-project' },
  'health:check': { authority: 'read-global' },
  'health:check-llm': { authority: 'read-global' },
  'import:split-chapters': { authority: 'read-project' },
  'kb:backfill-tokens': { authority: 'read-project' },
  'kb:backfill-vectors': { authority: 'read-project' },
  'kb:get-vectorless-count': { authority: 'read-project' },
  'kb:import-document': { authority: 'read-project' },
  'kb:import-folder': { authority: 'read-project' },
  'kb:import-text': { authority: 'read-project' },
  'kb:list-documents': { authority: 'read-project' },
  'kb:remove-document': { authority: 'read-project' },
  'kb:search': { authority: 'read-project' },
  'kb:search-with-scope': { authority: 'read-project' },
  'kb:stats': { authority: 'read-project' },
  'llm:cancel': { authority: 'network-secret' },
  'llm:concurrency-config': { authority: 'network-secret' },
  'llm:concurrency-status': { authority: 'network-secret' },
  'llm:delete-model': { authority: 'network-secret' },
  'llm:generate': { authority: 'network-secret' },
  'llm:generate-stream': { authority: 'network-secret' },
  'llm:get-default-embedding-model': { authority: 'network-secret' },
  'llm:get-default-model': { authority: 'network-secret' },
  'llm:get-routes': { authority: 'network-secret' },
  'llm:list-models': { authority: 'network-secret' },
  'llm:save-model': { authority: 'network-secret' },
  'llm:set-default-embedding-model': { authority: 'network-secret' },
  'llm:set-default-model': { authority: 'network-secret' },
  'llm:set-routes': { authority: 'network-secret' },
  'llm:test-connection': { authority: 'network-secret' },
  'log:get-today': { authority: 'read-global' },
  'log:list-files': { authority: 'read-global' },
  'log:open-dir': { authority: 'write-global' },
  'log:read-file': { authority: 'read-global' },
  'log:write': { authority: 'write-global' },
  'mcp:add-server': { authority: 'spawn' },
  'mcp:call-tool': { authority: 'spawn' },
  'mcp:connect': { authority: 'spawn' },
  'mcp:disconnect': { authority: 'write-global' },
  'mcp:disconnect-all': { authority: 'write-global' },
  'mcp:get-config-path': { authority: 'read-global' },
  'mcp:get-servers-status': { authority: 'read-global' },
  'mcp:list-resources': { authority: 'read-global' },
  'mcp:list-tools': { authority: 'read-global' },
  'mcp:load-config': { authority: 'spawn' },
  'mcp:remove-server': { authority: 'write-global' },
  'memory:delete': { authority: 'destructive' },
  'memory:list': { authority: 'read-project' },
  'memory:mark-stale': { authority: 'write-project' },
  'memory:read': { authority: 'read-project' },
  'memory:write': { authority: 'write-project' },
  'project:create': { authority: 'write-project' },
  'project:delete-folder': { authority: 'destructive' },
  'project:get-summary': { authority: 'read-project' },
  'project:open': { authority: 'write-project' },
  'project:recent-list': { authority: 'read-project' },
  'project:remove-recent': { authority: 'write-global' },
  'project:save': { authority: 'write-project' },
  'project:update-config': { authority: 'write-project' },
  'report:render-html': { authority: 'read-project' },
  'skill:delete': { authority: 'write-global' },
  'skill:import': { authority: 'write-global' },
  'skill:list': { authority: 'read-global' },
  'styles:get': { authority: 'read-global' },
  'styles:list': { authority: 'read-global' },
  'templates:delete': { authority: 'write-global' },
  'templates:get': { authority: 'read-global' },
  'templates:list': { authority: 'read-global' },
  'templates:save': { authority: 'write-global' },
  'uninstall:clean-user-data': { authority: 'destructive' },
  'uninstall:trigger': { authority: 'destructive' },
  'update:check': { authority: 'spawn' },
  'update:download': { authority: 'spawn' },
  'update:get-status': { authority: 'read-global' },
  'update:get-version': { authority: 'read-global' },
  'update:install': { authority: 'spawn' },
  'update:open-releases': { authority: 'write-global' },
}
