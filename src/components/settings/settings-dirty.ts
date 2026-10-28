/**
 * 设置页脏数据登记（审计 P0-5 / 批次 2）
 *
 * 各分区把自己的「有未保存改动」登记进来，关闭设置页时统一判断。
 * 用模块级 Set 而不是 Context：设置页是单例模态，关闭动作发生在外层组件，
 * 用 Context 反而要把弹窗拆成内外两层才能读到子分区状态。
 *
 * 用法（分区内）：
 *   const dirty = proxy !== baseline
 *   useSettingsDirty(dirty)
 */
import { useEffect, useId } from 'react'

const dirtyOwners = new Set<string>()

export function markSettingsDirty(ownerId: string, dirty: boolean): void {
  if (dirty) dirtyOwners.add(ownerId)
  else dirtyOwners.delete(ownerId)
}

/** 是否有分区存在未保存改动（关闭设置页前调用） */
export function hasUnsavedSettings(): boolean {
  return dirtyOwners.size > 0
}

/** 测试用：清空登记表 */
export function resetSettingsDirtyForTest(): void {
  dirtyOwners.clear()
}

/** 分区登记自身的脏状态（组件卸载或 dirty 变 false 时自动注销） */
export function useSettingsDirty(dirty: boolean): void {
  const ownerId = useId()
  useEffect(() => {
    markSettingsDirty(ownerId, dirty)
    return () => markSettingsDirty(ownerId, false)
  }, [ownerId, dirty])
}
