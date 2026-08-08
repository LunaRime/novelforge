/**
 * 章节互动检测纯函数（relation_detect 后处理步骤共享）
 *
 * 原实现（finalize-chapter.command.ts）对每个角色对做两次全文 indexOf——O(C² × N)。
 * 本模块预扫描正文一次收集全部名字位置（O(N + C×M)），角色对判断走双指针求最小间距，
 * 将复杂度降到 O(N + C²)，且语义升级为「任意位置间距」而非「首位置间距」。
 */

import { stripNameAlias } from '../character-normalize'

/** 收集每个名字在文本中的所有出现位置（升序）。名字未出现 → 空数组 */
export function buildNamePositions(text: string, names: string[]): Map<string, number[]> {
  const positions = new Map<string, number[]>()
  for (const name of names) {
    const list: number[] = []
    if (name) {
      // #34：双形态扫描——历史数据可能含「无名老乞丐（前魂师）」整名，正文只写
      // 「无名老乞丐」；同时扫完整名与剥离形态，位置去重后排序
      const forms = new Set([name, stripNameAlias(name)])
      for (const form of forms) {
        if (!form) continue
        let idx = text.indexOf(form)
        while (idx !== -1) {
          list.push(idx)
          idx = text.indexOf(form, idx + form.length)
        }
      }
      // 双形态可能命中同一位置（完整名包含剥离形态子串），去重后升序
      positions.set(name, [...new Set(list)].sort((a, b) => a - b))
    } else {
      positions.set(name, list)
    }
  }
  return positions
}

/** 双指针求两个升序位置数组的最小间距（无交叉扫描，O(a+b)） */
export function minGap(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  let i = 0
  let j = 0
  let min = Math.abs(a[0] - b[0])
  while (i < a.length && j < b.length) {
    const gap = Math.abs(a[i] - b[j])
    if (gap < min) min = gap
    if (min === 0) return 0
    if (a[i] < b[j]) i++
    else j++
  }
  return min
}

/** 两个角色是否在正文中存在间距小于 window 的位置对 */
export function hasProximity(posA: number[], posB: number[], window: number): boolean {
  return minGap(posA, posB) < window
}

/**
 * 检测章节互动：返回 Map<角色名, 互动角色名[]>（双向都记录）。
 * 语义：两角色在正文中任意出现位置间距 < window 即判定互动（原实现仅比较首位置）。
 */
export function detectChapterInteractions(
  text: string,
  names: string[],
  window: number,
): Map<string, string[]> {
  const positions = buildNamePositions(text, names)
  const interactions = new Map<string, string[]>()
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]
      const b = names[j]
      if (hasProximity(positions.get(a)!, positions.get(b)!, window)) {
        interactions.set(a, [...(interactions.get(a) ?? []), b])
        interactions.set(b, [...(interactions.get(b) ?? []), a])
      }
    }
  }
  return interactions
}
