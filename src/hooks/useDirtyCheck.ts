/**
 * useDirtyCheck — 未保存修改追踪 Hook
 *
 * 封装 editor-store 的 dirty 状态查询，简化组件中的重复代码。
 *
 * @param filePath 当前编辑的文件路径
 * @returns 是否有未保存的修改
 */
import { useEditorStore } from '../stores/editor-store'

export function useDirtyCheck(filePath: string): boolean {
  return useEditorStore(s =>
    s.tabs.find(t => t.filePath === filePath)?.dirty ?? false
  )
}
