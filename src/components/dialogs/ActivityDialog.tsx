import { Activity } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/Dialog'
import ActivityView from '../panels/activity/ActivityView'
import { useTranslation } from '../../hooks/useTranslation'

/**
 * 写作统计弹窗（2026-09-22）
 *
 * 从「编辑区页面」改为弹窗：它是结果型看板（5 个指标卡 + 全年热力图），
 * 属于偶发查看、不该常占一个编辑区页签；弹窗宽度更大，热力图也展得开。
 * 开关由 layout-store 的 `activityDialogOpen` 控制（与其它全局弹窗同一模式）。
 */
export default function ActivityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[900px] w-[86vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity size={16} strokeWidth={1.75} />
            {t('panel.activityShort')}
          </DialogTitle>
          {/* Radix 要求 Title 下方有 Description（可读性），视觉上不需要 → sr-only */}
          <DialogDescription className="sr-only">
            {t('panel.activityShort')}
          </DialogDescription>
        </DialogHeader>
        {/* 内容区：限制高度并内部滚动，避免矮窗口下弹窗顶出屏幕 */}
        <div className="mt-2 max-h-[70vh] overflow-y-auto">
          <ActivityView />
        </div>
      </DialogContent>
    </Dialog>
  )
}
