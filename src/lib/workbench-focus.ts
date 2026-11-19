/** 当前面板被卸载时，把焦点移到标题区仍可操作的模式按钮。 */
export function focusActiveWorkbenchMode() {
  document.querySelector<HTMLButtonElement>('[data-workbench-controls] button[aria-pressed="true"]')
    ?.focus({ preventScroll: true })
}
