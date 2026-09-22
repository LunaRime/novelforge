import { useEffect } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import AgentHeader from './agent/AgentHeader'
import AgentConversation from './agent/AgentConversation'

/**
 * 右侧 AI Agent 面板
 * 重构后采用多会话管理架构，参考 Antigravity agent-side-panel 设计
 * - 顶部：AgentHeader（新建/历史/更多/关闭）
 * - 主体：AgentConversation（空状态/对话/历史三态）
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
      className="w-full h-full flex flex-col"
      style={{
        backgroundColor: 'var(--color-sidebar)',
        // ⚠️ 这里**不能**用 overflow-hidden：面板底部那排浮层（+/深度/模型/@提及）都是向上弹出的，
        //    面板一矮就被裁掉上半截（skill 记录过的老坑）。滚动由内层 flex-1 容器自管。
        //    圆角改由本层自己画——卡片层已放开裁剪（见 novel-editor.css [data-region="ai"]），
        //    补上左侧两角才能和卡片外框保持一致。
        borderRadius: '6px 0 0 6px',
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
