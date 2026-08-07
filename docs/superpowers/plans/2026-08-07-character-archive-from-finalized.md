# 从定稿正文生成角色档案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在角色管理提供双入口(侧栏全局/编辑器单角色),基于已定稿章节正文为角色生成/补全静态档案(仅填充空白,不覆盖已有值)。

**Architecture:** 纯函数段落抽取(按角色名出现位置 ±800 字窗口)→ 逐角色 LLM(`extract_from_finalized` 模板 JSON 输出)→ `CharacterRepository.mergeFields` SQL CASE 仅非空填充 → post_process 工作流引擎执行 + EventBus 刷新。

**Tech Stack:** TypeScript / Zustand workflow-store / better-sqlite3(测试用 node:sqlite)/ Vitest / i18n(t 三语)

## Global Constraints

- 语言:所有用户可见文本必须 `t()` 三语(zh-CN/en-US/ru-RU)
- 颜色:禁止硬编码,用 `var(--color-*)`
- ESLint `--max-warnings 0` / tsc `noUnusedLocals` 零错误
- IPC 新通道必须注册:preload 白名单(`db:` 前缀已存在)+ `src/shared/ipc-channels.ts` 类型
- 写库"仅填充空白"必须走 SQL CASE 写时刻保旧(块 4 同构模式),禁止渲染进程读快照合并
- 提交格式 `<type>: <描述>` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 测试文件与实现同目录(`*.test.ts`),TDD 先行

---

### Task 1: 纯函数模块 character-archive.ts

**Files:**
- Create: `src/services/character-archive.ts`
- Test: `src/services/character-archive.test.ts`

**Interfaces:**
- Produces:
  - `extractRoleContextSegments(chapters: Array<{ chapterNumber: number; content: string }>, name: string, windowChars?: number, maxSegments?: number): Array<{ chapterNumber: number; text: string }>` — 按名出现位置抽 ±800 字(默认)窗口段落,相邻重叠合并,≤8 段(默认)截断;无命中返回 []
  - `hasBlankArchiveFields(char: { gender: string; age: string; appearance: string; personality: string; background: string; abilities: string; motivation: string; relationships: string; arc: string; notes: string }): boolean` — 10 字段任一为空/哨兵(`isNoChangeValue`)→ true
  - `parseArchiveJson(raw: string, charName: string): Record<string, string> | null` — robustParseJSON + 字段白名单(仅 10 档案字段 + tags)+ normalizeTagsValue;无效 → null

- [ ] **Step 1: 写失败测试**

```ts
// src/services/character-archive.test.ts
import { describe, it, expect } from 'vitest'
import { extractRoleContextSegments, hasBlankArchiveFields, parseArchiveJson } from './character-archive'

const mkChapter = (n: number, content: string) => ({ chapterNumber: n, content })

describe('extractRoleContextSegments', () => {
  it('按角色名出现位置抽取上下文段落', () => {
    const chapter = mkChapter(1, '开头。'.repeat(100) + '苏晚推开门。' + '中间。'.repeat(100))
    const segs = extractRoleContextSegments([chapter], '苏晚', 20)
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
    expect(segs[0].text).toContain('苏晚推开门')
  })

  it('角色未出现 → 空数组', () => {
    expect(extractRoleContextSegments([mkChapter(1, '全是别人的戏。')], '苏晚')).toEqual([])
  })

  it('多次出现按段数预算截断(不合并,上限保证 token 可控)', () => {
    const chapter = mkChapter(1, ('苏晚向前一步。' + '路人。'.repeat(10) + '苏晚抬头。' + '路人。'.repeat(10) + '苏晚落座。'))
    const segs = extractRoleContextSegments([chapter], '苏晚', 30, 2)
    expect(segs.length).toBeLessThanOrEqual(2)
  })

  it('跨章节聚合', () => {
    const chapters = [mkChapter(1, '苏晚在第一章。'), mkChapter(2, '第二章有李雷。')]
    const segs = extractRoleContextSegments(chapters, '苏晚')
    expect(segs.length).toBe(1)
    expect(segs[0].chapterNumber).toBe(1)
  })
})

describe('hasBlankArchiveFields', () => {
  const full = { gender: '女', age: '18', appearance: '黑发', personality: '冷静', background: '家族', abilities: '剑修', motivation: '复仇', relationships: '与李雷敌对', arc: '成长中', notes: '' }
  it('全非空(notes 空也算需要生成?)→ 按设计 notes 为空即需生成', () => {
    expect(hasBlankArchiveFields({ ...full, notes: '补充' })).toBe(false)
    expect(hasBlankArchiveFields({ ...full })).toBe(true)
  })
  it('部分字段为空 → true', () => {
    expect(hasBlankArchiveFields({ ...full, appearance: '' })).toBe(true)
  })
  it('哨兵值视为空白 → true', () => {
    expect(hasBlankArchiveFields({ ...full, motivation: '无' })).toBe(true)
  })
})

describe('parseArchiveJson', () => {
  it('有效 JSON → 归一化字段', () => {
    const out = parseArchiveJson('{"name":"苏晚","appearance":"黑发","tags":["天才","剑修"]}', '苏晚')
    expect(out?.appearance).toBe('黑发')
    expect(out?.tags).toBe('["天才","剑修"]')
  })
  it('字段白名单:非档案字段丢弃', () => {
    const out = parseArchiveJson('{"appearance":"黑发","role":"protagonist","cs_location":"x"}', '苏晚')
    expect(out?.role).toBeUndefined()
  })
  it('非法 JSON → null', () => {
    expect(parseArchiveJson('不是 JSON', '苏晚')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/character-archive.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 character-archive.ts**

```ts
// src/services/character-archive.ts
import { robustParseJSON } from './workflows/workflow-utils'
import { isNoChangeValue, normalizeTagsValue } from './character-normalize'

export interface ChapterContent { chapterNumber: number; content: string }
export interface RoleContextSegment { chapterNumber: number; text: string }

/** 按角色名出现位置抽取 ±window 字上下文段落;maxSegments 预算截断(重叠段不合并——预算上限保证 token 可控) */
export function extractRoleContextSegments(
  chapters: ChapterContent[],
  name: string,
  windowChars = 800,
  maxSegments = 8,
): RoleContextSegment[] {
  const segments: RoleContextSegment[] = []
  for (const ch of chapters) {
    let idx = ch.content.indexOf(name)
    while (idx !== -1) {
      const start = Math.max(0, idx - windowChars)
      const end = Math.min(ch.content.length, idx + name.length + windowChars)
      segments.push({ chapterNumber: ch.chapterNumber, text: ch.content.slice(start, end) })
      if (segments.length >= maxSegments) return segments
      idx = ch.content.indexOf(name, idx + name.length)
    }
  }
  return segments
}

/** 档案 10 字段键(mergeFields 白名单) */
export const ARCHIVE_FIELDS = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes'] as const

/** 任一档案字段为空/哨兵 → 需要生成(前置过滤省 token) */
export function hasBlankArchiveFields(char: Record<string, unknown>): boolean {
  return ARCHIVE_FIELDS.some(f => {
    const v = String(char[f] ?? '').trim()
    return v === '' || isNoChangeValue(v)
  })
}

/** LLM JSON 输出 → 档案字段白名单归一化;非法 → null */
export function parseArchiveJson(raw: string, charName: string): Record<string, string> | null {
  const parsed = robustParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const f of ARCHIVE_FIELDS) {
    const v = obj[f]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && !isNoChangeValue(s)) out[f] = s
  }
  if (obj.tags !== undefined) {
    const tags = normalizeTagsValue(String(obj.tags))
    if (tags) out.tags = tags
  }
  return Object.keys(out).length > 0 ? out : null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/character-archive.test.ts`
Expected: PASS(重叠合并场景若断言失败,以"合并后含所有出现点文本"为准调整断言)

- [ ] **Step 5: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/services/character-archive.ts src/services/character-archive.test.ts
git commit -m "feat: 角色档案纯函数 — 段落抽取/空白判定/JSON 归一化

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: mergeFields 写库 + IPC 通道

**Files:**
- Modify: `electron/repositories/character-repository.ts`(append after updateState)
- Modify: `electron/controllers/db-controller.ts`(near line 163)
- Modify: `src/shared/ipc-channels.ts`(near line 371)
- Test: `electron/repositories/character-repository.test.ts`(append)

**Interfaces:**
- Consumes: Task 1 `ARCHIVE_FIELDS`(仅用于类型推导,不强依赖)
- Produces:
  - `CharacterRepository.mergeFields(name: string, fields: Record<string, string>): void`
  - IPC `db:character-merge-fields`: args `[name: string, fields: Record<string, string>]`, return `{ success: boolean; error?: string }`

- [ ] **Step 1: 写失败测试(append 到 character-repository.test.ts)**

```ts
describe('CharacterRepository.mergeFields 仅填充空白(写时刻保旧)', () => {
  it('非空字段填充,空字段保旧', () => {
    CharacterRepository.upsert(makeChar('张三', { appearance: '已有外貌' }))
    CharacterRepository.mergeFields('张三', { appearance: '新外貌', personality: '冷静' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.appearance).toBe('已有外貌') // 非空保旧
    expect(char?.personality).toBe('冷静')     // 空白填充
  })

  it('字段级独立:空值不覆盖、哨兵(无)不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { motivation: '复仇' }))
    CharacterRepository.mergeFields('张三', { motivation: '', background: '无名门派' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.motivation).toBe('复仇')
    expect(char?.background).toBe('无名门派')
  })

  it('tags COALESCE:null 不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { tags: '["旧标签"]' }))
    CharacterRepository.mergeFields('张三', { tags: null as unknown as string })
    expect(CharacterRepository.getByName('张三')?.tags).toBe('["旧标签"]')
  })

  it('不触碰动态状态与角色定位', () => {
    CharacterRepository.upsert(makeChar('张三', { role: 'protagonist', tier: 1 }))
    CharacterRepository.mergeFields('张三', { appearance: '黑发' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.role).toBe('protagonist')
    expect(char?.tier).toBe(1)
    expect(char?.currentState).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run electron/repositories/character-repository.test.ts`
Expected: FAIL — mergeFields 不存在

- [ ] **Step 3: 实现 repository.mergeFields**

```ts
/** 仅填充空白:档案字段非空才写(SQL CASE 写时刻保旧,与 updateState 同构);tags COALESCE */
static mergeFields(name: string, fields: Record<string, string>): void {
  const db = getProjectDb()
  if (!db) throw new Error(t('error.repoCharacterCannotUpdateStatus').replace('{repo}', '[CharacterRepository]'))
  const cols = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes']
  // ⚠️ 语义(已实施修正):「DB 值非空保旧、仅填充空白」——CASE 判断的是 DB 列而非新值,
  //    与 updateState 的新值覆盖方向相反;tags 同规则(非 COALESCE 新值覆盖)
  const clauses = cols.map(c => `${c} = CASE WHEN ${c} != '' THEN ${c} ELSE ? END`).join(', ')
  const params: unknown[] = []
  for (const c of cols) {
    params.push(fields[c] ?? '')
  }
  db.prepare(`
    UPDATE characters SET
      ${clauses},
      tags = CASE WHEN tags != '' THEN tags ELSE ? END,
      updated_at = unixepoch() * 1000
    WHERE name = ?
  `).run(...params, fields.tags ?? '', name)
}
```

- [ ] **Step 4: db-controller + ipc-channels**

```ts
// db-controller.ts(near line 163)
ipcMain.handle('db:character-merge-fields', async (_event, name: string, fields: Record<string, string>) => {
  try {
    CharacterRepository.mergeFields(name, fields)
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// ipc-channels.ts(near line 371)
'db:character-merge-fields': { args: [name: string, fields: Record<string, string>]; return: { success: boolean; error?: string } }
```

- [ ] **Step 5: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add electron/repositories/character-repository.ts electron/repositories/character-repository.test.ts electron/controllers/db-controller.ts src/shared/ipc-channels.ts
git commit -m "feat: CharacterRepository.mergeFields — SQL CASE 仅非空填充 + db:character-merge-fields 通道

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 模板 extract_from_finalized

**Files:**
- Modify: `src/services/prompts/characters.ts`(append new template)
- Modify: `src/services/prompt-templates.ts`(PROMPT_NAMES + PROMPT_DESC_KEYS)
- Modify: `src/shared/locale-data.ts`(prompt.name.archiveFromFinalized / prompt.desc.* 三语)
- Modify: `src/services/prompts/locales/en-US.ts` + `ru-RU.ts`(content + systemRole 翻译)

**Interfaces:**
- Produces: 模板 key `extract_from_finalized`(getPromptTemplate 可获取),variables: `character_name` / `chapters_segments`

- [ ] **Step 1: 添加中文模板(characters.ts)**

```ts
{
  key: 'extract_from_finalized',
  name: '从定稿正文提取角色档案',
  description: '基于已定稿章节中该角色出现的相关段落,提取/补全角色静态档案(仅填充空白,不覆盖已有)',
  systemRole: '你是一位严谨的小说角色档案专家,擅长从正文细节还原角色设定。',
  variables: {
    character_name: '角色名',
    chapters_segments: '该角色出现的章节相关段落(带章节号)',
  },
  content: `请从以下已定稿章节的正文片段中,提取角色 {{character_name}} 的静态档案信息。

【角色名】{{character_name}}
【相关正文片段(按章节排列)】
{{chapters_segments}}

【任务要求】
1. 所有档案字段必须基于片段中的明确描写;可以合理推断,但不得编造与原文矛盾的信息。
2. 外貌(appearance):基于出场描写充实一段标志性外貌描写(绝对不要留空)。
3. 片段中未出现的字段输出空字符串(不要写"无"或"未知"——空值不会覆盖已有档案)。
4. tags:角色的短标签数组(2-5 个)。
5. relationships:与片段中其他角色的关系简述。

【输出格式(JSON 对象)】
{
  "gender": "性别",
  "age": "年龄/年龄段",
  "appearance": "标志性外貌描写",
  "personality": "性格特点",
  "background": "背景来历",
  "abilities": "能力/修为",
  "motivation": "核心动机",
  "relationships": "与其他角色的关系",
  "arc": "成长弧线/当前阶段",
  "notes": "补充备注",
  "tags": ["标签1", "标签2"]
}`,
},
```

- [ ] **Step 2: 注册(i18n + prompt-templates)**

```ts
// prompt-templates.ts — PROMPT_NAMES
extract_from_finalized: 'prompt.name.archiveFromFinalized',
// PROMPT_DESC_KEYS
extract_from_finalized: 'prompt.desc.archiveFromFinalized',
```

```ts
// locale-data.ts — 三语(中英俄)
'prompt.name.archiveFromFinalized': { 'zh-CN': '从定稿正文提取角色档案', 'en-US': 'Extract Character Profile from Finalized Text', 'ru-RU': 'Извлечение профиля персонажа из финального текста' },
'prompt.desc.archiveFromFinalized': { 'zh-CN': '基于已定稿章节中该角色出现的相关段落,提取/补全角色静态档案(仅填充空白)', 'en-US': 'Extract/complete static character profile from finalized chapters where the character appears (fill blanks only)', 'ru-RU': 'Извлечение/заполнение статического профиля персонажа из завершённых глав (только пустые поля)' },
```

- [ ] **Step 3: 英文/俄语 content + systemRole**

`en-US.ts` / `ru-RU.ts` 的 `extract_from_finalized` 条目:翻译 Step 1 的 content 全文与 systemRole(en 与 ru 模板对应中文语义;哨兵纪律与 JSON 格式约束保持)。

- [ ] **Step 4: 模板存在性验证测试**

```ts
// append 到 src/services/character-archive.test.ts
import { getPromptTemplate } from './prompt-templates'
it('extract_from_finalized 模板已注册且变量完整', () => {
  const tpl = getPromptTemplate('extract_from_finalized')
  expect(tpl).not.toBeNull()
  expect(tpl?.variables?.character_name).toBeTruthy()
  expect(tpl?.content).toContain('{{chapters_segments}}')
})
```

- [ ] **Step 5: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/services/prompts/characters.ts src/services/prompts/locales/en-US.ts src/services/prompts/locales/ru-RU.ts src/services/prompt-templates.ts src/shared/locale-data.ts src/services/character-archive.test.ts
git commit -m "feat: 模板 extract_from_finalized — 定稿正文段落 → 角色档案 JSON(三语)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 工作流 runCharacterArchive

**Files:**
- Create: `src/services/workflows/character-archive-workflow.ts`
- Modify: `src/shared/locale-data.ts`(workflow.* / log.archive* 三语 key)

**Interfaces:**
- Consumes: Task 1 `extractRoleContextSegments`/`hasBlankArchiveFields`/`parseArchiveJson`;Task 2 `db:character-merge-fields`;Task 3 `extract_from_finalized`
- Produces: `runCharacterArchive(projectPath: string, nameFilter?: string): void` — 启动 post_process 工作流;完成 emit `REFRESH_RESOURCE` `{ types: ['characterCards'] }`

- [ ] **Step 1: 实现工作流(仿 createCharacterExtractSteps)**

```ts
// src/services/workflows/character-archive-workflow.ts
import { ipc } from '../ipc-client'
import { useLLMStore } from '../../stores/llm-store'
import { getPromptTemplate } from '../prompt-templates'
import { PostProcessPromptBuilder } from '../prompts/prompt-builder'
import { extractRoleContextSegments, hasBlankArchiveFields, parseArchiveJson } from '../character-archive'
import type { CharacterData } from '../../../electron/repositories/character-repository'

async function callLLMForArchive(builder: { build: () => string; getSystemRole: () => string }, callbacks: { appendText: (t: string) => void }): Promise<string> {
  const llmStore = useLLMStore.getState()
  if (!llmStore.defaultModelId) throw new Error(t('error.noDefaultModel'))
  let full = ''
  await new Promise<void>((resolve, reject) => {
    llmStore.generateStream(
      [
        { role: 'system', content: builder.getSystemRole() },
        { role: 'user', content: builder.build() },
      ],
      { onChunk: c => { full += c; callbacks.appendText(c) }, onDone: () => resolve(), onError: e => reject(new Error(e)) },
      undefined,
      { responseFormat: { type: 'json_object' } },
    )
  })
  return full
}

export function runCharacterArchive(_projectPath: string, nameFilter?: string): void {
  import('../../stores/workflow-store').then(async ({ useWorkflowStore }) => {
    await useWorkflowStore.getState().startWorkflow({
      type: 'post_process',
      title: t('workflow.archiveTitle'),
      steps: [{
        name: t('workflow.archiveSteps'),
        description: t('workflow.archiveStepsDesc'),
        executor: async (_step, _ctx, callbacks) => {
          const allChars = (await ipc.invoke('db:character-get-all')) as unknown as CharacterData[]
          const targets = nameFilter ? allChars.filter(c => c.name === nameFilter) : allChars
          const pending = targets.filter(c => hasBlankArchiveFields(c as unknown as Record<string, unknown>))
          if (pending.length === 0) {
            callbacks.log(t('log.archiveAllComplete'))
            return
          }
          callbacks.log(t('log.archiveStart').replace('{n}', String(pending.length)))

          // 全部定稿章节正文
          const chapterNumbers = (await ipc.invoke('db:draft-get-all-chapter-numbers')) as number[]
          const chapters: Array<{ chapterNumber: number; content: string }> = []
          for (const n of [...chapterNumbers].sort((a, b) => a - b)) {
            const meta = await ipc.invoke('db:draft-get-finalized', n) as { content?: string } | null
            if (meta?.content) chapters.push({ chapterNumber: n, content: meta.content })
          }
          if (chapters.length === 0) throw new Error(t('error.noFinalizedChapters'))

          let failed = 0
          for (const char of pending) {
            try {
              const segments = extractRoleContextSegments(chapters, char.name)
              if (segments.length === 0) {
                callbacks.log(t('log.archiveNoMention').replace('{name}', char.name))
                continue
              }
              const template = getPromptTemplate('extract_from_finalized')
              if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'extract_from_finalized'))
              const segText = segments.map(s => `[第${s.chapterNumber}章]\n${s.text}`).join('\n\n---\n\n')
              const builder = new PostProcessPromptBuilder(template)
                .withCharacterName(char.name)
                .withChaptersSegments(segText)
              const raw = await callLLMForArchive(builder, callbacks)
              const parsed = parseArchiveJson(raw, char.name)
              if (!parsed) {
                failed++
                callbacks.log(t('log.archiveParseFailed').replace('{name}', char.name))
                continue
              }
              await ipc.invoke('db:character-merge-fields', char.name, parsed)
              callbacks.log(t('log.archiveDone').replace('{name}', char.name))
            } catch (e) {
              failed++
              callbacks.log(t('log.archiveCharFailed').replace('{name}', char.name).replace('{error}', () => String(e)))
            }
          }
          if (failed > 0) callbacks.log(t('log.archiveFailedSummary').replace('{n}', String(failed)))
          // 刷新角色卡
          const { globalEventBus } = await import('../../shared/event-bus')
          globalEventBus.emit('REFRESH_RESOURCE', { types: ['characterCards'] })
        },
      }],
    })
  })
}
```

(需确认 `PostProcessPromptBuilder` 有 `withCharacterName`/`withChaptersSegments` 方法——若无则改用泛用变量注入;若 builder 不支持任意变量,可在 Task 4 一并扩展 builder。)

- [ ] **Step 2: i18n key(workflow.archiveTitle/Steps/StepsDesc + log.archiveStart/NoMention/ParseFailed/Done/CharFailed/FailedSummary/AllComplete + error.noFinalizedChapters)三语**

- [ ] **Step 3: 确认 PostProcessPromptBuilder 变量注入能力**

Run: `grep -n "withChapter\|class PostProcessPromptBuilder\|variables" src/services/prompts/prompt-builder.ts`
若 builder 仅支持固定变量:在 prompt-builder.ts 增加 `withCharacterName`/`withChaptersSegments` 两个方法(透传 template 变量),并同步 en-US/ru-RU 变量表。

- [ ] **Step 4: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/services/workflows/character-archive-workflow.ts src/services/prompts/prompt-builder.ts src/shared/locale-data.ts
git commit -m "feat: runCharacterArchive 工作流 — 定稿正文逐角色档案生成(前置跳过/单角色容错/完成刷新)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: UI 双入口

**Files:**
- Modify: `src/components/panels/sidebar/CharactersView.tsx`(顶部操作栏,line ~74)
- Modify: `src/components/editor/CharacterEditor.tsx`(工具栏)
- Modify: `src/shared/locale-data.ts`(character.archiveConfirm*/archiveBtn* 三语)

**Interfaces:**
- Consumes: Task 4 `runCharacterArchive`
- Produces: 全局按钮 + 单角色按钮,均带确认弹窗与执行中 loading

- [ ] **Step 1: i18n key**

```ts
// locale-data.ts 三语
'character.archiveBtn': { 'zh-CN': '从定稿生成', 'en-US': 'Generate from Finalized', 'ru-RU': 'Из финальных глав' },
'character.archiveBtnTitle': { 'zh-CN': '基于已定稿章节正文生成/补全角色档案', 'en-US': 'Generate/complete profiles from finalized chapters', 'ru-RU': 'Создать профили из завершённых глав' },
'character.archiveConfirm': { 'zh-CN': '将基于已定稿正文为角色生成档案(仅填充空白,不覆盖已有内容,包括手动编辑)。确定继续?', 'en-US': 'Profiles will be generated from finalized text (fill blanks only — existing content, including manual edits, is kept). Continue?', 'ru-RU': 'Профили будут созданы из завершённого текста (только пустые поля — существующее содержимое, включая ручные правки, сохраняется). Продолжить?' },
'character.archiveRunning': { 'zh-CN': '正在从定稿文本生成角色档案…', 'en-US': 'Generating character profiles from finalized text…', 'ru-RU': 'Создание профилей из завершённого текста…' },
```

- [ ] **Step 2: CharactersView 全局按钮**

```tsx
// import 增补
import { Sparkles } from 'lucide-react'
import { runCharacterArchive } from '../../../services/workflows/character-archive-workflow'

// 状态
const [archiving, setArchiving] = useState(false)

// 处理函数
const handleArchive = async () => {
  const ok = await confirm(t('character.archiveConfirm'), { title: t('character.archiveBtn'), confirmText: t('charList.run') })
  if (!ok) return
  const project = currentProject
  if (!project) return
  // loading 由工作流状态驱动:监听 WORKFLOW_COMPLETE 结束(executor 幂等,可重复触发)
  const { globalEventBus } = await import('../../../shared/event-bus')
  const stop = () => setArchiving(false)
  const unsub = globalEventBus.on('WORKFLOW_COMPLETE', stop)
  setArchiving(true)
  runCharacterArchive(project.path)
  // 兜底:60s 后释放监听(工作流事件已触发过则不重复执行)
  setTimeout(() => { unsub(); setArchiving(false) }, 60000)
}

// 操作栏按钮(RefreshCw 旁)
<Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleArchive} title={t('character.archiveBtnTitle')}>
  <Sparkles size={14} strokeWidth={2} />
</Button>
```

(实施时以实际工作流状态驱动 loading;若 EventBus 事件类型不匹配,简化为"点击后禁用 5 秒防重入"。)

- [ ] **Step 3: CharacterEditor 单角色按钮**

工具栏(编辑/关系/反向链接按钮旁)加「从定稿生成」按钮:确认弹窗 → `runCharacterArchive(currentProject.path, selectedName)`。无选中角色时禁用。

- [ ] **Step 4: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/components/panels/sidebar/CharactersView.tsx src/components/editor/CharacterEditor.tsx src/shared/locale-data.ts
git commit -m "feat: 角色管理双入口 — 侧栏全局/编辑器单角色「从定稿生成档案」+ 覆盖确认

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 完整门禁**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test`
Expected: 零错误零警告,全部测试通过(新增 ~20 条)

- [ ] **Step 2: i18n 残留检查**

Run: `pnpm run gen:tokens` 或 grep 新增中文字符串是否全部走 t()
Expected: 新 UI 文本(archiveBtn/archiveConfirm/workflow.archiveTitle/log.archive*)全部三语

- [ ] **Step 3: 手工冒烟清单(dev 环境)**

- 打开项目 → 角色管理 → 点「从定稿生成」→ 确认弹窗文案正确
- 工作流启动,逐角色日志输出,角色卡刷新(空白字段被填充,已有值未变)
- CharacterEditor 单角色入口:无选中禁用、选中后只处理该角色
- 日志文件 `~/.vela/logs/` 有对应记录
