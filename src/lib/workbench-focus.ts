/** 当前面板被卸载时，把焦点移到标题区仍可操作的模式按钮。 */
export function focusWorkbenchEditor() {
  document.getElementById('main-editor-area')?.focus({ preventScroll: true })
}
