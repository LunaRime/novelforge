import { useState, type ReactNode } from 'react'
import { ArrowRight, Clock, FileUp, FolderOpen, PenLine, Settings, X } from 'lucide-react'
import appIcon from '../../../build/icon.png'
import { useProjectStore } from '../../stores/project-store'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'
import './welcome.css'

const FIRST_RUN_KEY = 'vela-first-run'

function isFirstRun(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== 'done'
  } catch {
    return true
  }
}

function markFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, 'done')
  } catch { /* 无法持久化时，本次仍可关闭引导。 */ }
}

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void | Promise<void>
  onImportNovel?: () => void
  onOpenSettings?: () => void
  onStartCreate?: () => void
}

/** 欢迎页提供创作入口，主页侧栏负责完整的项目管理列表。 */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel, onOpenSettings, onStartCreate }: WelcomePageProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const recentProject = useProjectStore(s => s.recentProjects[0])
  const [showGuide, setShowGuide] = useState(isFirstRun)
  const [opening, setOpening] = useState(false)
  const [failedToOpen, setFailedToOpen] = useState(false)
  const primaryLabel = t(currentProject ? 'chapter.newChapter' : 'welcome.newProject')

  const dismissGuide = () => {
    setShowGuide(false)
    markFirstRunDone()
  }

  async function openProject(open: () => void | Promise<unknown>) {
    setFailedToOpen(false)
    setOpening(true)
    try {
      await open()
    } catch {
      setFailedToOpen(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="nf-welcome">
      <div className="nf-welcome-sheet">
        <header className="nf-welcome-hero">
          <div className="nf-welcome-copy">
            <h1>{currentProject?.name ?? t('welcome.title')}</h1>
            <p>{currentProject?.path ?? t('welcome.subtitle')}</p>
            <Button type="button" variant="default" className="min-h-9 whitespace-normal text-left"
              aria-label={primaryLabel}
              onClick={currentProject ? onStartCreate ?? onNewProject : onNewProject}>
              <PenLine size={16} className="shrink-0" aria-hidden="true" />
              {primaryLabel}
            </Button>
          </div>
          {/* 定稿标志嵌入封面。折角和下方工作台的页签采用同一品牌色。 */}
          <div className="nf-welcome-cover" aria-hidden="true">
            <img src={appIcon} alt="" width={104} height={104} />
          </div>
        </header>

        <div className="nf-welcome-actions">
          {currentProject && (
            <WelcomeAction label={t('welcome.newProject')} description={t('welcome.createNovel')}
              icon={<PenLine size={18} />} onClick={onNewProject} />
          )}
          <WelcomeAction label={t('welcome.openProject')} description={t('welcome.openExisting')}
            icon={<FolderOpen size={18} />} onClick={() => void openProject(onOpenProject)} disabled={opening} />
          {onImportNovel && (
            <WelcomeAction label={t('welcome.importNovel')} description={t('welcome.importExisting')}
              icon={<FileUp size={18} />} onClick={onImportNovel} />
          )}
        </div>
        {!currentProject && recentProject && (
          <div className="nf-welcome-recent">
            <h2>{t('project.recent')}</h2>
            <WelcomeAction label={recentProject.name} description={recentProject.path}
              icon={<Clock size={18} />} disabled={opening}
              onClick={() => void openProject(() => useProjectStore.getState().openProject(recentProject.path))} />
          </div>
        )}
        {failedToOpen && <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{t('dialog.openFailed')}</p>}

        {showGuide && (
          <section className="nf-welcome-guide">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('welcome.quickStart')}</h2>
              <Button type="button" variant="ghost" size="icon" onClick={dismissGuide}
                className="size-[32px] shrink-0" aria-label={t('welcome.dismissGuide')} title={t('welcome.dismissGuide')}>
                <X size={14} />
              </Button>
            </div>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              <StepItem title={t('welcome.configAI')} description={t('welcome.configAIDesc')} icon={<Settings size={14} />}
                action={onOpenSettings ? { label: t('welcome.openSettings'), onClick: onOpenSettings } : undefined} />
              <StepItem title={t('welcome.newOrOpen')} description={t('welcome.newOrOpenDesc')} icon={<FolderOpen size={14} />}
                action={{ label: t('welcome.newProject'), onClick: onNewProject }} />
              <StepItem title={t('welcome.startCreate')} description={t('welcome.startCreateDesc')} icon={<PenLine size={14} />}
                action={{ label: t('welcome.startCreateAction'), onClick: onStartCreate ?? onNewProject }} />
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}

function WelcomeAction({ label, description, icon, onClick, disabled }: {
  label: string
  description: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={disabled}
      aria-label={label} title={description}
      className="nf-welcome-action h-auto min-w-0 justify-start gap-3 whitespace-normal rounded-lg px-3 py-3 text-left">
      <span aria-hidden="true" className="nf-welcome-action-icon">{icon}</span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold">{label}</span>
        <span className="mt-1 block break-words text-xs font-normal text-[var(--color-text-secondary)]">{description}</span>
      </span>
      <ArrowRight size={15} className="ms-auto shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
    </Button>
  )
}

function StepItem({ title, description, icon, action }: {
  title: string
  description: string
  icon: ReactNode
  action?: { label: string; onClick: () => void }
}) {
  return (
    <li className="flex flex-wrap items-start gap-2">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <div className="min-w-[min(100%,12rem)] flex-1">
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{description}</p>
      </div>
      {action && (
        <Button type="button" variant="ghost" size="sm" onClick={action.onClick} className="h-auto min-h-6 whitespace-normal text-left">
          {action.label}
          <ArrowRight size={10} className="shrink-0" />
        </Button>
      )}
    </li>
  )
}
