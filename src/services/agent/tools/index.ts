/**
 * 内置 Tool 汇总注册
 *
 * 将所有内置 Tool 注册到 ToolRegistry。
 * 在 Agent 初始化时调用 registerBuiltinTools()。
 */

import { toolRegistry } from '../tool-registry'
import { readFileTool } from './read-file.tool'
import { searchKnowledgeTool } from './search-knowledge.tool'
import { readArchitectureTool } from './read-architecture.tool'
import { readBlueprintTool } from './read-blueprint.tool'
import { readCharactersTool } from './read-characters.tool'
import { readProjectStateTool } from './read-project-state.tool'
import { readDraftsTool } from './read-drafts.tool'
import { listChaptersTool } from './list-chapters.tool'
import { writeFileTool } from './write-file.tool'
import { openEditorTool } from './open-editor.tool'
import { startWorkflowTool } from './start-workflow.tool'
import { updateConfigTool } from './update-config.tool'
import { embedTextTool } from './embed-text.tool'
import { compareTextsTool } from './compare-texts.tool'
import { indexContentTool } from './index-content.tool'
import { countCharactersTool } from './count-characters.tool'
import { calculatorTool } from './calculator.tool'
import { queryForeshadowingTool } from './query-foreshadowing.tool'
import { settingSamplerTool } from './setting-sampler.tool'
import { callExternalApiTool } from './call-external-api.tool'
import { browserListTabsTool } from './browser-list-tabs.tool'

/** 所有内置 Tool（供外部引用） */
export const builtinTools = [
  // 只读 Tool（自动执行）
  readFileTool,
  searchKnowledgeTool,
  readArchitectureTool,
  readBlueprintTool,
  readCharactersTool,
  readProjectStateTool,
  readDraftsTool,
  listChaptersTool,
  // 字数统计（只读，自动执行）— 字数限制场景免 LLM 逐字计数
  countCharactersTool,
  // 防缺陷工具（只读，自动执行）— 计算/伏笔/设定多样性
  calculatorTool,
  queryForeshadowingTool,
  settingSamplerTool,
  // 向量模块 Tool（只读，自动执行）
  embedTextTool,
  compareTextsTool,
  // 浏览器接入（只读，自动执行）— 内置 CDP 桥接查询标签页
  browserListTabsTool,
  // 行动 Tool（需确认）
  writeFileTool,
  openEditorTool,
  startWorkflowTool,
  updateConfigTool,
  indexContentTool, // 写入知识库，需确认
  callExternalApiTool, // 开发者模式外部 API（需确认）
]

/**
 * 注册所有内置 Tool
 * 在 Agent 模块初始化时调用
 */
export function registerBuiltinTools(): void {
  toolRegistry.registerAll(builtinTools)
  console.log(`[Agent] 已注册 ${builtinTools.length} 个内置 Tool`)
}
