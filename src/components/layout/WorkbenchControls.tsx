import { useShallow } from 'zustand/shallow'
import { useTranslation } from '../../hooks/useTranslation'
import { selectWorkbenchPanels, useLayoutStore, type WorkbenchMode } from '../../stores/layout-store'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'

export default function WorkbenchControls() {
  const { t } = useTranslation()
  const { workbenchMode, setWorkbenchMode, focusMode, partnerExpanded, tasksExpanded } = useLayoutStore(useShallow(state => {
    const { aiPanelOpen, rightView, bottomPanelOpen, bottomTab } = selectWorkbenchPanels(state)
    return {
      workbenchMode: state.workbenchMode, setWorkbenchMode: state.setWorkbenchMode, focusMode: state.focusMode,
      partnerExpanded: aiPanelOpen && rightView === 'agent', tasksExpanded: bottomPanelOpen && bottomTab === 'tasks',
    }
  }))

  return (
    <div data-workbench-controls role="group" aria-label={t('command.toggleWorkbenchMode')}
      className="flex shrink-0 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <SegmentedControl<WorkbenchMode>
        items={[{ value: 'build', label: t('workbench.build') }, { value: 'write', label: t('workbench.write') }]}
        value={workbenchMode}
        onChange={setWorkbenchMode}
      />
      {workbenchMode === 'write' && !focusMode && (
        <>
          <Button type="button" variant="ghost" size="sm" active={partnerExpanded} aria-expanded={partnerExpanded}
            aria-controls={partnerExpanded ? 'writing-ai-panel' : undefined}
            onClick={() => {
              const { setAIPanelOpen, openRightPanel } = useLayoutStore.getState()
              if (partnerExpanded) setAIPanelOpen(false)
              else openRightPanel('agent')
            }}
          >{t('workbench.partner')}</Button>
          <Button type="button" variant="ghost" size="sm" active={tasksExpanded} aria-expanded={tasksExpanded}
            aria-controls={tasksExpanded ? 'writing-bottom' : undefined}
            onClick={() => useLayoutStore.getState().setBottomTab('tasks')}
          >{t('panel.tasks')}</Button>
        </>
      )}
    </div>
  )
}
