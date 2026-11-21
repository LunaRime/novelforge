import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { draftListScope, useDraftStore, type DraftsByChapter } from '../../stores/draft-store'
import { useProjectStore } from '../../stores/project-store'
import { openChapterFile, openDraftById } from '../panels/sidebar/SidebarShared'

export function CharacterChapterLink({ chapter, drafts }: { chapter: number; drafts: DraftsByChapter }) {
  const { t } = useTranslation()
  const title = t('chapter.label').replace('{n}', String(chapter))
  const candidates = drafts[chapter]
  const draft = candidates?.find(item => item.status === 'finalized') ?? candidates?.find(item => item.status !== 'archived')
  if (!draft) return <span>{title}</span>

  return (
    <button type="button" className="nf-character-chapter-link" title={t('action.openChapter')}
      onClick={() => {
        // 项目切换或草稿变更时，旧行不得打开新项目中碰巧同号的草稿。
        const project = useProjectStore.getState()
        const currentDrafts = useDraftStore.getState()
        if (project.loading || currentDrafts.draftsScope !== draftListScope(project) || currentDrafts.draftsByChapter !== drafts) return
        if (draft.status === 'finalized') void openChapterFile(`vela://manuscript/${draft.id}`, title)
        else void openDraftById(draft.id, title)
      }}>
      {title} <ArrowUpRight size={12} aria-hidden="true" />
    </button>
  )
}
