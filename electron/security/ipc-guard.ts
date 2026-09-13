/**
 * IPC 收口守卫（L4 设计 §4.1 / §4.4）
 *
 * `guardedHandle` 是主进程**唯一**的 IPC 注册入口，替代裸 `ipcMain.handle`。
 * 它保持与 `ipcMain.handle` **完全相同的回调签名**，因此迁移是机械替换：
 *   `ipcMain.handle('x:y', async (_e, a) => …)` → `guardedHandle('x:y', async (_e, a) => …)`
 * 且 handler 收到的仍是**原始 `event`**（S3 实测：4 处用活 event 的 handler 零改动）。
 *
 * 阶段职责：
 *   - S2：策略表存在性校验（缺失即抛，纵深防御；正常情况是 tsc 编译错误）。
 *   - S6（本阶段）：来源校验——只接受应用自己的 top frame。
 *   - S8：追加 `pathArgs` 路径校验（按策略表声明的下标与意图）。
 *
 * ⚠️ 为什么这里可以「缺失即抛」而不会让应用启动即死：
 *   `IPC_CHANNEL_POLICY` 的类型是 `Record<InvokeChannel, ChannelPolicy>`，
 *   漏登记是 **tsc 编译错误**；channel 参数类型也是 `InvokeChannel`，写错通道名同样编译失败。
 *   这里的 throw 只是防御 `as any` 之类的强制绕过。
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNEL_POLICY } from '../../src/shared/ipc-policy'
import type { InvokeChannel } from '../../src/shared/ipc-channels'
import { logger } from '../utils/logger'

/** 与 `ipcMain.handle` 一致的回调签名（刻意不改，见文件头） */
export type GuardedHandler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown

// ===== 来源校验（S6）=====

/**
 * 一次调用的来源快照。
 * 刻意做成**纯数据**：`isSenderTrusted` 不碰 Electron，可以伪造入参单测
 * （CI 无 electron 二进制，且来源校验的失败模式是「应用启动即不可用」，必须能离线验证）。
 */
export interface SenderProbe {
  /** `event.sender.id`（webContents id） */
  senderId: number
  /** top frame 的 URL；帧已销毁时为 null */
  frameUrl: string | null
  /** 是否为 top frame（`event.senderFrame.parent === null`） */
  isTopFrame: boolean
  /** 帧是否仍然存活（帧已销毁时 Electron 访问属性会抛错，探针阶段就记 false） */
  alive: boolean
}

export interface SenderTrustPolicy {
  /** 己方窗口 webContents id 白名单（main.ts 在窗口创建/销毁时维护） */
  trustedIds: ReadonlySet<number>
  /** 开发服务器 URL；未设置 = 生产构建 */
  devServerUrl?: string
}

/** 己方窗口登记表 */
const trustedWebContentsIds = new Set<number>()

/** 主窗口创建后登记；窗口销毁时注销 */
export function trustWebContents(id: number): void {
  trustedWebContentsIds.add(id)
}
export function untrustWebContents(id: number): void {
  trustedWebContentsIds.delete(id)
}
/** 仅供测试：清空白名单 */
export function resetTrustedWebContentsForTest(): void {
  trustedWebContentsIds.clear()
}

/**
 * 判断调用方是否是「应用自己的 top frame」。**纯函数**，可离线单测。
 *
 * 规则（全部满足才放行）：
 *  ① 帧存活且是 top frame（子帧/iframe/webview 一律拒绝）；
 *  ② webContents 在己方白名单内（未来新增窗口若不显式登记 → 默认拒绝）；
 *  ③ URL 命中：dev 构建比对 `VITE_DEV_SERVER_URL` 的 origin；生产必须是 `file:`。
 */
export function isSenderTrusted(probe: SenderProbe, policy: SenderTrustPolicy): boolean {
  if (!probe.alive || !probe.isTopFrame) return false
  if (!policy.trustedIds.has(probe.senderId)) return false
  if (!probe.frameUrl) return false

  let url: URL
  try {
    url = new URL(probe.frameUrl)
  } catch {
    return false
  }

  if (policy.devServerUrl) {
    try {
      return url.origin === new URL(policy.devServerUrl).origin
    } catch {
      return false
    }
  }
  // 生产：只接受本地打包页面（file://）。不钉死具体路径——RENDERER_DIST 位置随打包形态变化，
  // 钉死会让「换打包路径」变成「应用整体不可用」，而 protocol 判定已排除远程页面。
  return url.protocol === 'file:'
}

/** 从真实 event 取来源快照（属性访问可能抛错，一律降级为不可信） */
function probeFrom(event: IpcMainInvokeEvent): SenderProbe {
  try {
    const frame = event.senderFrame
    return {
      senderId: event.sender.id,
      frameUrl: frame ? frame.url : null,
      isTopFrame: frame ? frame.parent === null : false,
      alive: Boolean(frame),
    }
  } catch {
    return { senderId: -1, frameUrl: null, isTopFrame: false, alive: false }
  }
}

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

  ipcMain.handle(channel, (event, ...args) => {
    // S6：来源校验。失败即拒绝（默认拒绝），并留下可诊断的日志——
    //   ⚠️ 这条日志是「真机启动后 IPC 全被拒」时唯一的排查线索，字段必须齐全。
    const probe = probeFrom(event)
    const trusted = isSenderTrusted(probe, {
      trustedIds: trustedWebContentsIds,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
    })
    if (!trusted) {
      logger.error('IPCGuard', `[ipc-guard] 拒绝来源不可信的调用: channel=${channel} senderId=${probe.senderId} top=${probe.isTopFrame} alive=${probe.alive} url=${probe.frameUrl ?? 'null'}`)
      throw new Error(`[ipc-guard] sender not trusted: ${channel}`)
    }
    // S8 将在此前插入 assertPathArgs(channel, policy, args)
    return handler(event, ...(args as never[]))
  })
}
