import { useState, type ReactNode } from 'react'
import { ArrowRight, FileUp, FolderOpen, PenLine, Settings, Sparkles, X } from 'lucide-react'
import appIcon from '../../../build/icon.png'
import { useProjectStore } from '../../stores/project-store'
import { useTranslation } from '../../hooks/useTranslation'
import { Button } from '../ui/Button'

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
  } catch { /* ignore */ }
}

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void | Promise<void>
  onImportNovel?: () => void
  onOpenSettings?: () => void
  onStartCreate?: () => void
}

/** Recent projects remain available in the Home sidebar. */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel, onOpenSettings, onStartCreate }: WelcomePageProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const [showGuide, setShowGuide] = useState(isFirstRun)
  const [opening, setOpening] = useState(false)
  const [failedToOpen, setFailedToOpen] = useState(false)

  const dismissGuide = () => {
    setShowGuide(false)
    markFirstRunDone()
  }

  async function openProject() {
    setFailedToOpen(false)
    setOpening(true)
    try {
      await onOpenProject()
    } catch {
      setFailedToOpen(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--color-editor-bg)]">
      <div className="mx-auto w-full max-w-xl px-[clamp(1rem,4cqi,2rem)] py-8">
        <header className="mb-8 text-center">
          <img src={appIcon} alt="" width={72} height={72} className="mx-auto mb-4" />
          <h1 className="mb-2 break-words text-2xl font-semibold text-[var(--color-text)]">
            {currentProject ? currentProject.name : t('welcome.title')}
          </h1>
          <p className="break-words text-sm text-[var(--color-text-secondary)]">
            {currentProject ? currentProject.path : t('welcome.subtitle')}
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
          <WelcomeAction label={t('welcome.newProject')} description={t('welcome.createNovel')}
            icon={<Sparkles size={18} />} onClick={onNewProject} primary />
          <WelcomeAction label={t('welcome.openProject')} description={t('welcome.openExisting')}
            icon={<FolderOpen size={18} />} onClick={() => void openProject()} disabled={opening} />
          {onImportNovel && (
            <WelcomeAction label={t('welcome.importNovel')} description={t('welcome.importExisting')}
              icon={<FileUp size={18} />} onClick={onImportNovel} />
          )}
        </div>
        {failedToOpen && <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{t('dialog.openFailed')}</p>}

        {showGuide && (
          <section className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-sidebar)] p-4">
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

function WelcomeAction({ label, description, icon, onClick, disabled, primary }: {
  label: string
  description: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}) {
  return (
    <Button type="button" variant="outline" onClick={onClick} disabled={disabled}
      aria-label={label} title={description}
      className="h-auto min-w-0 justify-start gap-3 whitespace-normal rounded-lg px-3 py-3 text-left">
      <span aria-hidden="true" className={primary ? 'shrink-0 text-[var(--color-accent)]' : 'shrink-0'}>{icon}</span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold">{label}</span>
        <span className="mt-1 block break-words text-xs font-normal text-[var(--color-text-muted)]">{description}</span>
      </span>
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
