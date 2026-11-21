import { useEffect } from 'react'
import { useLLMStore } from '../../stores/llm-store'
import AgentHeader from './agent/AgentHeader'
import AgentConversation from './agent/AgentConversation'

/**
 * 写作搭档的对话视图。会话工具区负责对话名称、新建和历史入口，
 * 消息视图负责读取同一会话的内容与输入状态。
 */
export default function AIPanel() {
  // 确保 LLM store 已初始化
  const init = useLLMStore(s => s.init)
  const loaded = useLLMStore(s => s.loaded)
  useEffect(() => {
    if (!loaded) init()
  }, [init, loaded])

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* 顶部工具栏 */}
      <AgentHeader />

      {/* 主对话区：占满剩余高度 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AgentConversation />
      </div>
    </div>
  )
}
