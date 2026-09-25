/**
 * 字典入口 —— 把各分片合并回**同一个扁平对象**，形状与切分前完全一致。
 *
 * ⚠️ 这里必须保持扁平（`UI_TEXTS['editor.save']`），不能改成嵌套
 * （`UI_TEXTS['zh-CN'].editor.save`）—— 3502 个调用点与 TextKey 都依赖扁平形状。
 *
 * 分片文件由 scripts/split-i18n-dict.cjs 生成；改条目请直接改对应分片。
 */
import { logTexts } from './log'
import { toolTexts } from './tool'
import { promptTexts } from './prompt'
import { errorTexts } from './error'
import { agentTexts } from './agent'
import { characterTexts } from './character'
import { workflowTexts } from './workflow'
import { settingsTexts } from './settings'
import { editorTexts } from './editor'
import { projectTexts } from './project'
import { uiTexts } from './ui'

export const UI_TEXTS_DATA = {
  ...logTexts,
  ...toolTexts,
  ...promptTexts,
  ...errorTexts,
  ...agentTexts,
  ...characterTexts,
  ...workflowTexts,
  ...settingsTexts,
  ...editorTexts,
  ...projectTexts,
  ...uiTexts,
} as const
