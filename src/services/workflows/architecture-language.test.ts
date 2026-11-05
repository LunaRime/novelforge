import { afterEach, expect, test } from 'vitest'
import { getPlotStructureGuide, getNarrativePOVLabel } from './architecture-workflow'
import { getCurrentLocale, setCurrentLocale } from '../../shared/locale'
import { getPromptTemplate } from '../prompt-templates'
import { ArchitecturePromptBuilder } from '../prompts/prompt-builder'
const original = getCurrentLocale()
afterEach(() => setCurrentLocale(original))
test.each(['en-US', 'ru-RU'] as const)('%s plot outline receives localized structure and viewpoint with an output-language constraint', locale => {
  setCurrentLocale(locale)
  for (const structure of ['three_act', 'heros_journey', 'save_the_cat', 'kishotenketsu', 'multi_thread', 'freeform']) {
    expect(getPlotStructureGuide(structure, 151)).not.toMatch(/[\u4e00-\u9fff]/u)
    expect(getPlotStructureGuide(structure, 151)).toContain('151')
  }
  expect(getNarrativePOVLabel('third_limited')).not.toMatch(/[\u4e00-\u9fff]/u)
  const prompt = new ArchitecturePromptBuilder(getPromptTemplate('synopsis')!)
    .withPlotStructureGuide(getPlotStructureGuide('three_act', 151)).withNarrativePov(getNarrativePOVLabel('third_limited')).build()
  expect(prompt).toContain(locale === 'en-US' ? 'English' : 'Русский')
})
