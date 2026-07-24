import { useState } from 'react'
import { Sparkles, FolderOpen, Clock, BookOpen, FileUp, Settings, PenLine, ArrowRight, X, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useTranslation } from '../../hooks/useTranslation'
import { confirmDeleteProject } from '../ui/Confirm'

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
  onOpenProject: () => void
  onImportNovel?: () => void
  onOpenSettings?: () => void
}

/** 欢迎页面 — 无项目打开时显示，首次使用展示 3 步引导 */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel, onOpenSettings }: WelcomePageProps) {
  const { t } = useTranslation()
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const [showGuide, setShowGuide] = useState(isFirstRun())

  const dismissGuide = () => {
    setShowGuide(false)
    markFirstRunDone()
  }

  return (
    <div
      className="w-full h-full overflow-y-auto"
      style={{ backgroundColor: 'var(--color-editor-bg)' }}
    >
      <div className="max-w-lg w-full mx-auto px-8 py-16">
        {/* Logo 区域 — 品牌极光光环 */}
        <div className="text-center mb-12">
          <div
            className="ai-glow inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5"
            style={{
              boxShadow: '0 8px 32px rgba(126, 200, 227, 0.25), 0 0 60px rgba(155, 142, 200, 0.12)',
            }}
          >
            <BookOpen size={36} color="var(--color-text)" style={{ position: 'relative', zIndex: 1 }} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
            {currentProject ? currentProject.name : t('welcome.title')}
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {currentProject ? currentProject.path : t('welcome.subtitle')}
          </p>
        </div>

        {/* 首次使用引导 — 3 步快速上手 */}
        {showGuide && (
          <div
            className="mb-8 p-5 rounded-xl"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid rgba(126, 200, 227, 0.3)',
              boxShadow: '0 4px 24px rgba(126, 200, 227, 0.08)',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('welcome.quickStart')}
              </h2>
              <button
                onClick={dismissGuide}
                className="p-0.5 rounded hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
                title={t('welcome.dismissGuide')}
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <StepItem
                step={1}
                title={t('welcome.configAI')}
                desc={t('welcome.configAIDesc')}
                icon={<Settings size={14} />}
                action={onOpenSettings ? { label: t('welcome.openSettings'), onClick: onOpenSettings } : undefined}
              />
              <StepItem
                step={2}
                title={t('welcome.newOrOpen')}
                desc={t('welcome.newOrOpenDesc')}
                icon={<FolderOpen size={14} />}
                action={{ label: t('welcome.newProject'), onClick: onNewProject }}
              />
              <StepItem
                step={3}
                title={t('welcome.startCreate')}
                desc={t('welcome.startCreateDesc')}
                icon={<PenLine size={14} />}
              />
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          <button
            onClick={onNewProject}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(126, 200, 227, 0.4)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(126, 200, 227, 0.10)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div
              className="ai-glow flex items-center justify-center w-10 h-10 rounded-xl transition-transform group-hover:scale-105"
            >
              <Sparkles size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.newProject')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.createNovel')}
            </span>
          </button>

          <button
            onClick={onOpenProject}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(201, 167, 108, 0.4)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(201, 167, 108, 0.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl transition-transform group-hover:scale-105"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
            >
              <FolderOpen size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.openProject')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.openExisting')}
            </span>
          </button>

          <button
            onClick={onImportNovel}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-all hover:scale-[1.02]"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(134, 193, 120, 0.4)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(134, 193, 120, 0.10)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl transition-transform group-hover:scale-105"
              style={{ backgroundColor: 'rgba(134, 193, 120, 0.12)', color: 'var(--color-success)' }}
            >
              <FileUp size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.importNovel')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.importExisting')}
            </span>
          </button>
        </div>

        {/* 最近项目 */}
        {recentProjects.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {t('project.recent')}
              </span>
            </div>
            <div className="space-y-1">
              {recentProjects.map((p, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                  style={{ backgroundColor: 'transparent', borderLeft: '2px solid transparent' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                    e.currentTarget.style.borderLeftColor = 'var(--color-accent)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                    e.currentTarget.style.borderLeftColor = 'transparent'
                  }}
                  onClick={() => openProject(p.path)}
                >
                  <BookOpen size={14} style={{ color: 'var(--color-accent)', opacity: 0.6 }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm block truncate" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                    </span>
                    <span className="text-xs block truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {p.path}
                    </span>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 flex-shrink-0 cursor-pointer transition-opacity"
                    style={{ color: 'var(--color-text-muted)' }}
                    title="删除项目"
                    onClick={async (e) => {
                      e.stopPropagation()
                      const action = await confirmDeleteProject()
                      if (action === 'delete') {
                        await useProjectStore.getState().deleteProjectFolder(p.path)
                      } else if (action === 'remove') {
                        await useProjectStore.getState().removeRecentProject(p.path)
                      }
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-error)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-text-muted)'
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center mt-12">
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
            {t('welcome.footer')}
          </p>
        </div>
      </div>
    </div>
  )
}

/** 引导步骤条 */
function StepItem({
  step,
  title,
  desc,
  icon,
  action,
}: {
  step: number
  title: string
  desc: string
  icon: React.ReactNode
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: 'var(--color-text)',
          fontSize: '0.7rem',
          fontWeight: 600,
        }}
      >
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{desc}</p>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs flex-shrink-0 transition-colors"
          style={{
            backgroundColor: 'var(--color-hover)',
            color: 'var(--color-accent)',
            border: '1px solid var(--color-border)',
          }}
        >
          {action.label}
          <ArrowRight size={10} />
        </button>
      )}
    </div>
  )
}
