import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { renderLog } from '../services/render-logger'
import { toast } from '../components/ui/Toast'
import { t } from '../shared/locale'
import {
  DEFAULT_THINKING_LEVEL,
  isThinkingLevel,
  thinkingLevelSpec,
  type ThinkingLevel,
} from '../shared/thinking-level'

/**
 * 全局思考等级 —— 全局配置的唯一读写方。
 *
 * 四档（off/low/high/max）同时决定两件事：
 * - 所有 LLM 调用的温度（`getThinkingTemperature()`，供 llm-store 注入）
 * - Agent 的提示词强度分支（`thinkingLevelSpec(level).agentMode`，供 agent-store 路由）
 *
 * 持久化：`config:get` 读取，`config:set` 300ms 防抖写盘（滑块拖动只落最后一次）。
 */

export interface ThinkingState {
  level: ThinkingLevel
  initialized: boolean
  init: () => Promise<void>
  setLevel: (level: ThinkingLevel) => void
}

/** 写盘防抖窗口：拖动滑块期间只在停手后落盘一次 */
const PERSIST_DEBOUNCE_MS = 300

/** 模块级 timer：store 重载 / 重复 init 时先清掉旧任务，避免旧档位覆盖新选择 */
let persistTimer: ReturnType<typeof setTimeout> | null = null

function clearPersistTimer(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

/** 读全局配置中的思考等级；非 Electron / 读失败 / 非法旧值 → 默认档（High） */
async function loadPersistedLevel(): Promise<ThinkingLevel> {
  if (!ipc.isElectron) return DEFAULT_THINKING_LEVEL
  try {
    const config = await ipc.invoke('config:get')
    const stored = (config as { thinkingLevel?: unknown } | null | undefined)?.thinkingLevel
    return isThinkingLevel(stored) ? stored : DEFAULT_THINKING_LEVEL
  } catch (e) {
    renderLog('warn', 'Thinking:init', `读取思考等级失败，回退默认档: ${String(e)}`)
    return DEFAULT_THINKING_LEVEL
  }
}

async function persistLevel(level: ThinkingLevel): Promise<void> {
  try {
    const result = await ipc.invoke('config:set', { thinkingLevel: level })
    if (result && result.success === false) {
      throw new Error(result.error ?? t('status.unknown'))
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    toast.error(t('save.failed').replace('{error}', detail))
    renderLog('error', 'Save:ThinkingLevel', detail)
  }
}

export const useThinkingStore = create<ThinkingState>((set) => ({
  level: DEFAULT_THINKING_LEVEL,
  initialized: false,

  init: async () => {
    // 读盘尚未完成时若有排队写盘，先丢弃——以磁盘值为准，避免启动瞬间的旧选择覆盖持久化值
    clearPersistTimer()
    const level = await loadPersistedLevel()
    set({ level, initialized: true })
  },

  setLevel: (level) => {
    if (!isThinkingLevel(level)) return
    // 乐观更新：UI 立即响应，写盘失败时由 toast + 日志兜底提示
    set({ level })
    clearPersistTimer()
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persistLevel(level)
    }, PERSIST_DEBOUNCE_MS)
  },
}))

/** 当前档位对应的 LLM 采样温度（llm-store 每次调用前读取） */
export function getThinkingTemperature(): number {
  return thinkingLevelSpec(useThinkingStore.getState().level).temperature
}