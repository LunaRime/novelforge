import type { TextKey } from './locale'
/** Historical display only: never dispatched as a runtime fact. */
export interface ArchivedArtifactCard {
  name: string
  labelKey: TextKey
  summary?: string
}
