/**
 * dev 脚本前置 UTF-8 控制台代码页切换（Windows 中文乱码根治）
 *
 * 原理：Windows 控制台默认代码页 936（GBK），而 Node/Electron 输出 UTF-8 字节，
 * 终端按 GBK 解释 → 中文乱码。chcp 65001 将当前控制台代码页切换为 UTF-8。
 *
 * 为什么放在这里而不是主进程：chcp 修改的是"持有控制台的进程"的控制台。
 * npm/pnpm 脚本进程持有终端控制台（继承自 cmd/Git Bash），此处调用有效；
 * Electron 主进程被 Vite 以管道方式启动（不持有控制台），内部调用 chcp 无效。
 *
 * 跨平台安全：非 Windows 直接退出（chcp 不存在于 POSIX）；
 * chcp 失败静默（重定向到 nul），不影响 dev 继续启动。
 */
const { spawnSync } = require('node:child_process')

if (process.platform === 'win32') {
  spawnSync('chcp', ['65001'], { stdio: 'ignore' })
}
