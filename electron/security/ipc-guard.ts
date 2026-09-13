/**
 * IPC 收口守卫（L4 设计 §4.1，S2 阶段）
 *
 * `guardedHandle` 是主进程**唯一**的 IPC 注册入口，替代裸 `ipcMain.handle`。
 * 它保持与 `ipcMain.handle` **完全相同的回调签名**，因此迁移是机械替换：
 *   `ipcMain.handle('x:y', async (_e, a) => …)` → `guardedHandle('x:y', async (_e, a) => …)`
 *
 * 阶段职责（按设计 §7 推进）：
 *   - S2（本阶段）：策略表存在性校验 + 透传。行为与改造前完全一致。
 *   - S6：追加来源校验（`event.senderFrame` top frame + 己方 webContents + 己方 URL）。
 *   - S8：追加 `pathArgs` 路径校验（按策略表声明的下标与意图）。
 *
 * ⚠️ 为什么这里可以「缺失即抛」而不会让应用启动即死：
 *   `IPC_CHANNEL_POLICY` 的类型是 `Record<InvokeChannel, ChannelPolicy>`，
 *   漏登记是 **tsc 编译错误**；channel 参数类型也是 `InvokeChannel`，写错通道名同样编译失败。
 *   这里的 throw 只是防御 `as any` 之类的强制绕过，属纵深防御，不是唯一保障。
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNEL_POLICY } from '../../src/shared/ipc-policy'
import type { InvokeChannel } from '../../src/shared/ipc-channels'

/** 与 `ipcMain.handle` 一致的回调签名（刻意不改，见文件头） */
export type GuardedHandler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown

/**
 * 注册一个受策略约束的 IPC handler。
 *
 * @param channel 必须是 `InvokeChannel` 成员（事件通道不是 invoke，不进策略表）
 * @throws 当通道在策略表中缺失时（正常情况下是编译期错误，此处为纵深防御）
 */
export function guardedHandle(channel: InvokeChannel, handler: GuardedHandler): void {
  const policy = IPC_CHANNEL_POLICY[channel]
  if (!policy) {
    throw new Error(`[ipc-guard] 未登记策略的通道: ${channel}`)
  }
  // S2：透传。S6 在此前插入 assertSenderTrusted(event)，S8 插入 assertPathArgs(channel, policy, args)。
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as never[])))
}
