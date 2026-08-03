import { useEffect } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import AgentHeader from './agent/AgentHeader'
import AgentConversation from './agent/AgentConversation'

/**
 * AI Agent 对话面板（2026-08-03 起位于底部面板 bottomTab='agent'）
 * 重构后采用多会话管理架构，参考 Antigravity agent-side-panel 设计
 * - 顶部：AgentHeader（新建/历史/更多/关闭）
 * - 主体：AgentConversation（空状态/对话/历史三态）
 *
 * 注意：根节点必须 overflow-visible——输入框的弹出菜单（@提及/+/模型选择）
 * 为 absolute 定位，被 overflow-hidden 裁剪后在底部有限高度下面板内不可见；
 * 内部滚动由 AgentConversation 自管理。
 */
export default function AIPanel() {
  // 确保 LLM store 已初始化
  const init = useLLMStore(s => s.init)
  const loaded = useLLMStore(s => s.loaded)
  useEffect(() => {
    if (!loaded) init()
  }, [init, loaded])

  return (
    <div
      className="w-full h-full flex flex-col overflow-visible"
      style={{
        backgroundColor: 'var(--color-sidebar)',
      }}
    >
      {/* 顶部工具栏 */}
      <AgentHeader />

      {/* 主对话区：占满剩余高度 */}
      <div className="flex-1 overflow-hidden">
        <AgentConversation />
      </div>
    </div>
  )
}
