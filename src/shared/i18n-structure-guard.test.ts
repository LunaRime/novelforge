/**
 * i18n 字典结构守卫 —— 防止分片重新膨胀回单文件（2026-09-25 拆分时建立）
 *
 * 与 `i18n-key-guard.test.ts`（管「引用了不存在的 key」）互补：本守卫管**文件结构**。
 *
 * **为什么需要**：字典曾是**单个 3485 行 / 757 KB 的文件**（2026-09-25 按
 * `docs/superpowers/specs/2026-09-25-i18n-restructure-design.md` 路径 A 拆成 11 份）。
 * 拆完不加护栏的话，半年后又会冒出一个大文件 —— 拆分本身不产生约束。
 *
 * ⚠️ 阈值刻意留了余量（当前最大分片 `log.ts` 493 行 / 448 条）：守卫的职责是拦
 * **重新膨胀**，不是逼人给每条新增 key 重新分片。真的撞上限时，**正确做法是拆出
 * 新分片，而不是调高这个数字** —— 调高等于把守卫关掉。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DICT_DIR = path.join(ROOT, 'src/shared/locale-data')

/** 单分片上限：约为拆分前那个 3485 行单文件的 1/6 —— 留足余量，只拦重新膨胀 */
const MAX_LINES = 600
const MAX_ENTRIES = 550

/** 分片数下限：防止有人把 11 份又合并回去 */
const MIN_SLICES = 8

const sliceFiles = fs
  .readdirSync(DICT_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')

describe('i18n 字典结构守卫', () => {
  it('字典已拆分为多份（不是单文件）', () => {
    expect(sliceFiles.length).toBeGreaterThanOrEqual(MIN_SLICES)
  })

  it('旧的单文件 locale-data.ts 不得复活', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/shared/locale-data.ts'))).toBe(false)
  })

  it.each(sliceFiles)('分片 %s 未超过行数/条目上限', (file) => {
    const src = fs.readFileSync(path.join(DICT_DIR, file), 'utf8')
    const lines = src.split(/\r?\n/).length
    // 条目判定用行首锚定是安全的：本守卫只数「形如条目的行」，
    // 且下面另有一条断言保证每条都落在分片里（见「无孤儿分片」）
    const entries = (src.match(/^ {2}'[^']+': \{$|^ {2}'[^']+': \{.*\},$/gm) ?? []).length

    expect(lines, `${file} 行数 ${lines} 超过 ${MAX_LINES} —— 请拆出新分片，不要调高阈值`).toBeLessThanOrEqual(MAX_LINES)
    expect(entries, `${file} 条目数 ${entries} 超过 ${MAX_ENTRIES} —— 请拆出新分片，不要调高阈值`).toBeLessThanOrEqual(MAX_ENTRIES)
  })

  it('每个分片都被 index.ts 引入（无孤儿分片）', () => {
    const index = fs.readFileSync(path.join(DICT_DIR, 'index.ts'), 'utf8')
    for (const file of sliceFiles) {
      const name = file.replace(/\.ts$/, '')
      expect(index, `index.ts 未引入 ${name}`).toContain(`from './${name}'`)
      expect(index, `index.ts 未展开 ${name}`).toContain(`...${name}Texts`)
    }
  })

  it('分片条数之和等于合并后的 key 数（搬运无遗漏、无重复）', () => {
    let sum = 0
    for (const file of sliceFiles) {
      const src = fs.readFileSync(path.join(DICT_DIR, file), 'utf8')
      sum += (src.match(/^ {2}'[^']+': \{$|^ {2}'[^']+': \{.*\},$/gm) ?? []).length
    }
    // 动态 import 取真值：Object.keys 是唯一对两种条目写法都不漏的方法
    return import('./locale-data').then(({ UI_TEXTS_DATA }) => {
      expect(sum).toBe(Object.keys(UI_TEXTS_DATA).length)
    })
  })
})
