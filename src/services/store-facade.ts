/**
 * Store 访问门面（Facade）
 *
 * 为服务层提供统一的 Store 状态访问入口。
 * 所有非 React 代码应通过此模块访问 Store 状态，而非直接导入各 Store 文件。
 *
 * 设计原则：
 *   - 暴露 getState() 返回完整 state 对象（兼容现有调用模式）
 *   - 同时提供常用操作的便捷 getter/方法
 *   - 未来重构 Store 结构时，只需修改此文件即可兼容所有调用方
 */
import { useProjectStore } from '../stores/project-store'
import { useLLMStore } from '../stores/llm-store'
import { useEditorStore } from '../stores/editor-store'
import { useWorkflowStore } from '../stores/workflow-store'
import { useUsageStore } from '../stores/usage-store'

// ===== 项目 Store =====
export const projectStore = {
  getState: () => useProjectStore.getState(),
  get currentProject() { return useProjectStore.getState().currentProject },
  get recentProjects() { return useProjectStore.getState().recentProjects },
  loadRecentProjects: () => { useProjectStore.getState().loadRecentProjects() },
  openProject: (path: string) => { useProjectStore.getState().openProject(path) },
  closeProject: () => { useProjectStore.getState().closeProject() },
}

// ===== LLM Store =====
export const llmStore = {
  getState: () => useLLMStore.getState(),
  get models() { return useLLMStore.getState().models },
  get modelRouter() { return useLLMStore.getState().modelRouter },
  init: () => { useLLMStore.getState().init() },
  getModelForPurpose: (purpose: string) => useLLMStore.getState().getModelForPurpose(purpose as never),
}

// ===== 编辑器 Store =====
export const editorStore = {
  getState: () => useEditorStore.getState(),
  get tabs() { return useEditorStore.getState().tabs },
}

// ===== 工作流 Store =====
export const workflowStore = {
  getState: () => useWorkflowStore.getState(),
  get activeRuns() { return useWorkflowStore.getState().activeRuns },
  get globalLogs() { return useWorkflowStore.getState().globalLogs },
  addLog: (level: string, message: string) => { useWorkflowStore.getState().addLog(level as never, message) },
  clearLogs: () => { useWorkflowStore.getState().clearLogs() },
}

// ===== 用量 Store =====
export const usageStore = {
  getState: () => useUsageStore.getState(),
  recordCall: (call: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (useUsageStore.getState() as any).recordCall(call)
  },
}
