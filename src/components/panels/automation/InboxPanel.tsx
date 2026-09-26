/**
 * InboxPanel — 自动化收件箱列表（底部面板的 inbox tab 内容，D 档）
 *
 * 数据源与任务面板同源（automation-store）；挂载时拉取一次，
 * 确认/忽略后的刷新由 store 内部处理（loadAll）。
 */
import { useEffect } from 'react'
import { useTranslation } from '../../../hooks/useTranslation'
import { useAutomationStore } from '../../../stores/automation-store'
import InboxItemCard from './InboxItemCard'

export default function InboxPanel() {
  const { t } = useTranslation()
  const inbox = useAutomationStore(s => s.inbox)
  const loadAll = useAutomationStore(s => s.loadAll)

  useEffect(() => {
    void loadAll()
    // 调度器在后台写入新条目（评审 Important 10）：轻量轮询让界面跟得上，
    // 30s 一次读两张表的成本可忽略；卸载即停
    const timer = setInterval(() => { void loadAll() }, 30_000)
    return () => clearInterval(timer)
  }, [loadAll])

  if (inbox.length === 0) {
    return (
      <div className="p-3 text-micro" style={{ color: 'var(--color-text-muted)' }}>
        {t('automation.inbox.empty')}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1.5 overflow-y-auto h-full">
      {inbox.map(item => <InboxItemCard key={item.id} item={item} />)}
    </div>
  )
}
