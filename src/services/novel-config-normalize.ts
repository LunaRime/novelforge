/**
 * novelConfig 枚举值归一化 — 纯函数，无依赖可单测
 *
 * 背景：生成/导入模板按界面语言要求 LLM 输出枚举值——英文模板输出
 * genre「fantasy/urban/sci-fi...」、audience「male-channel/female-channel...」，
 * 而编辑器下拉 value 为中文规范值（NovelConfigEditor）→ 英文值落库后
 * Select 找不到匹配项显示空白（beta.2 英文用户反馈"某些字段总是空的"，
 * 数据其实在，界面呈现为空）。
 *
 * 策略：有把握的英文值 → 中文规范值（或描述性变体 → 规范键）；
 * 未知值保留原样（不兜底——避免覆盖合法数据）。幂等：规范值原样返回。
 */

import type { NovelConfig } from '../shared/ipc-channels'
import type { TextKey } from '../shared/locale'

/** 压缩键：小写 + 去除空格/连字符/下划线/撇号（'three-act' → 'threeact'） */
function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-_'/]+/g, '')
}

// ===== genre：英文模板枚举（prompts/locales/en-US.ts）→ UI 中文规范值 =====

const GENRE_ALIASES: Record<string, string> = {
  xuanhuan: '玄幻',
  fairycultivation: '仙侠',
  urban: '都市',
  scifi: '科幻',
  history: '历史',
  mystery: '悬疑',
  game: '游戏',
  military: '军事',
  fantasy: '奇幻',
  wuxia: '武侠',
}

/** 归一化题材为 UI 中文规范值；未知值保留原样 */
export function normalizeGenre(value: string): string {
  if (!value) return value
  return GENRE_ALIASES[normKey(value)] ?? value.trim()
}

// ===== 显示翻译：中文规范值 → i18n key（#33：非 zh 界面直接显示存储值「言情/男频」） =====

/** genre 规范值（含未知值的 normKey 变体）→ i18n key；未知返回 null（调用方原样显示） */
const GENRE_KEYS: Record<string, TextKey> = {
  '玄幻': 'genre.xuanhuan', '仙侠': 'genre.xianxia', '都市': 'genre.urban', '科幻': 'genre.scifi',
  '历史': 'genre.history', '军事': 'genre.military', '游戏': 'genre.game', '末世': 'genre.apocalypse',
  '悬疑': 'genre.suspense', '灵异': 'genre.horror', '言情': 'genre.romance', '古言': 'genre.ancientRomance',
  '现言': 'genre.modernRomance', '奇幻': 'genre.fantasy', '武侠': 'genre.wuxia', '轻小说': 'genre.lightNovel',
  '同人': 'genre.fanfic', '职场': 'genre.workplace',
}

export function getGenreTextKey(genre: string): TextKey | null {
  if (!genre) return null
  return GENRE_KEYS[genre] ?? null
}

/** targetAudience 规范值 → i18n key；未知返回 null（调用方原样显示） */
const AUDIENCE_KEYS: Record<string, TextKey> = {
  '男频': 'novelConfig.audienceMale',
  '女频': 'novelConfig.audienceFemale',
  '双性向': 'novelConfig.audienceBoth',
  '全龄': 'novelConfig.audienceAll',
}

export function getAudienceTextKey(audience: string): TextKey | null {
  if (!audience) return null
  return AUDIENCE_KEYS[audience] ?? null
}

// ===== targetAudience：英文模板枚举 → UI 中文规范值 =====

const AUDIENCE_ALIASES: Record<string, string> = {
  malechannel: '男频',
  femalechannel: '女频',
  general: '全龄',
  通用: '全龄', // 中文模板值（语义等价）
}

/** 归一化受众为 UI 中文规范值；未知值保留原样 */
export function normalizeTargetAudience(value: string): string {
  if (!value) return value
  return AUDIENCE_ALIASES[normKey(value)] ?? value.trim()
}

// ===== plotStructure：英文描述性变体 → 规范键 =====

const PLOT_STRUCTURE_ALIASES: Record<string, string> = {
  threeact: 'three_act',
  threeactstructure: 'three_act',
  herosjourney: 'heros_journey',
  savethecat: 'save_the_cat',
  kishotenketsu: 'kishotenketsu',
  multithread: 'multi_thread',
  freeform: 'freeform',
}

/** 归一化情节结构为规范键；未知值保留原样 */
export function normalizePlotStructure(value: string): string {
  if (!value) return value
  return PLOT_STRUCTURE_ALIASES[normKey(value)] ?? value.trim()
}

// ===== narrativePOV：英文描述性变体 → 规范键 =====

const NARRATIVE_POV_ALIASES: Record<string, string> = {
  firstperson: 'first_person',
  thirdlimited: 'third_limited',
  thirdpersonlimited: 'third_limited',
  thirdomniscient: 'third_omniscient',
  thirdpersonomniscient: 'third_omniscient',
  omniscient: 'third_omniscient',
  multipov: 'multi_pov',
}

/** 归一化叙事视角为规范键；未知值保留原样 */
export function normalizeNarrativePOV(value: string): string {
  if (!value) return value
  return NARRATIVE_POV_ALIASES[normKey(value)] ?? value.trim()
}

/** 组合应用：对存在值的枚举字段逐一归一化（undefined 字段跳过） */
export function normalizeNovelConfigEnums(cfg: Partial<NovelConfig>): Partial<NovelConfig> {
  const result: Partial<NovelConfig> = { ...cfg }
  if (cfg.genre !== undefined) result.genre = normalizeGenre(String(cfg.genre))
  if (cfg.targetAudience !== undefined) result.targetAudience = normalizeTargetAudience(String(cfg.targetAudience))
  if (cfg.plotStructure !== undefined) result.plotStructure = normalizePlotStructure(String(cfg.plotStructure)) as NovelConfig['plotStructure']
  if (cfg.narrativePOV !== undefined) result.narrativePOV = normalizeNarrativePOV(String(cfg.narrativePOV)) as NovelConfig['narrativePOV']
  return result
}
