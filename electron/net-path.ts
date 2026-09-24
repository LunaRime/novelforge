/**
 * 智能模型下载 — 网络路径选择器（纯逻辑，零 electron 依赖）
 *
 * 背景：Ollama 自身下载走的是**它进程启动时**定死的路由，运行期改不了；实测本机
 * 直连 registry.ollama.ai（Cloudflare R2）245 KB/s vs 经本地代理 1,624 KB/s（6.6×），
 * 1.2 GB 的 bge-m3 实拉 1h43m50s。因此下载改由应用自己做，路由选择权在应用手里。
 *
 * 本模块只做三件事，不认识 HTTP 也不认识文件系统：
 * 1. 枚举候选路径（直连 / 用户配置的代理）
 * 2. 按探测吞吐排序（并保证全失败时仍有候选可试）
 * 3. 判定「当前路径是否该换了」
 *
 * 约束：不 import electron（保持可在 CI 无 electron 二进制下直接单测）。
 */

/** 代理配置里本模块需要的字段（与 GlobalConfig.proxy 结构对齐但更宽松，便于单测） */
export interface ProxyConfigLike {
  enabled?: boolean
  host?: string
  port?: number
}

export interface NetPath {
  id: 'direct' | 'proxy'
  /** 供日志 / UI 展示：'direct' 或 '127.0.0.1:7897' */
  label: string
  /** 传给 `session.setProxy` 的 proxyRules；直连时为 undefined */
  proxyRules?: string
}

/** 单次探测的采样量：2 MiB 足以区分「KB/s 级」与「MB/s 级」，对 GB 级模型开销可忽略 */
export const PROBE_BYTES = 2 * 1024 * 1024

/** 单条路径的探测硬上限：慢到 8s 还拿不满 2 MiB 的路径本身就不该被选中 */
export const PROBE_TIMEOUT_MS = 8_000

/** 下载中「多久没收到任何字节」判定为停滞（实测本机就是这种形态：文件 mtime 在动、大小不变） */
export const STALL_TIMEOUT_MS = 20_000

/** 同一条路径连续出错多少次后放弃它（unexpected EOF / 连接被重置） */
export const MAX_PATH_ERRORS = 3

/** 一条下载最多换几次路——防止在两条烂路之间来回横跳 */
export const MAX_SWITCHES = 3

const DIRECT: NetPath = { id: 'direct', label: 'direct' }

/**
 * 枚举候选路径。直连恒在（它是「代理没配 / 代理挂了」时的兜底），
 * 代理仅在 `enabled && host && port` 齐全时加入——缺字段的代理配置发出去只会得到
 * 一条必然失败的候选，徒增换路次数。
 */
export function buildPathCandidates(proxy?: ProxyConfigLike): NetPath[] {
  const candidates: NetPath[] = [DIRECT]
  const host = proxy?.host?.trim()
  if (proxy?.enabled && host && typeof proxy.port === 'number' && proxy.port > 0) {
    // ⚠️ Chromium 的 proxyRules **不接受** `http://` 前缀（实测带前缀时 setProxy 静默不生效，
    // 请求仍然直连）；这里只给 `host:port`
    const rules = `${host}:${proxy.port}`
    candidates.push({ id: 'proxy', label: rules, proxyRules: rules })
  }
  return candidates
}

export interface PathProbe {
  path: NetPath
  /** null = 该路径探测失败（拿不到字节 / 超时 / 报错） */
  bytesPerSec: number | null
}

/**
 * 探测采样 → 吞吐。**拿不到字节一律 null**，不能记成 0 B/s：
 * 0 会参与排序并被当成「有效但极慢」，而事实是这条路根本不通。
 *
 * 耗时按 1ms 下界钳制：`Date.now()` 只有毫秒粒度，亚毫秒返回的采样会得到 `elapsed = 0`，
 * 若判失败就把**最快的那条路**当成不通（实测在 mock 下必现；真实环境里回环代理同样可能命中）。
 */
export function scoreProbe(bytesReceived: number, elapsedMs: number): number | null {
  if (bytesReceived <= 0) return null
  return Math.round((bytesReceived / Math.max(elapsedMs, 1)) * 1000)
}

/**
 * 按探测结果排序。成功的按吞吐降序在前；失败的按**候选原序**垫后——
 * 全失败时（探测本身被限流/抖动）仍要留一条能试的候选，不能返回空列表。
 */
export function rankPaths(probes: PathProbe[]): NetPath[] {
  const succeeded = probes
    .filter((p): p is { path: NetPath; bytesPerSec: number } => p.bytesPerSec !== null)
    .sort((a, b) => b.bytesPerSec - a.bytesPerSec)
  const failed = probes.filter((p) => p.bytesPerSec === null)
  return [...succeeded, ...failed].map((p) => p.path)
}

/** 距上次收到字节的毫秒数是否已达停滞阈值 */
export function isStalled(msSinceLastByte: number): boolean {
  return msSinceLastByte >= STALL_TIMEOUT_MS
}

export interface SwitchDecision {
  /** 是否切换到下一条候选 */
  switch: boolean
  /** 是否已无路可走（候选试完 / 换路上限）——调用方据此返回失败并触发回退 */
  exhausted: boolean
}

/**
 * 换路决策。`triedCount` = 已经尝试过的路径条数（≥1），故已换路次数 = triedCount - 1。
 * 无路可走时返回 `{switch:false, exhausted:true}`——注意**不是** switch:true，
 * 否则调用方会去取一个不存在的候选。
 */
export function decideSwitch(input: {
  stalled: boolean
  consecutiveErrors: number
  triedCount: number
  totalCandidates: number
}): SwitchDecision {
  const failing = input.stalled || input.consecutiveErrors >= MAX_PATH_ERRORS
  if (!failing) return { switch: false, exhausted: false }

  const switches = input.triedCount - 1
  if (input.triedCount >= input.totalCandidates || switches >= MAX_SWITCHES) {
    return { switch: false, exhausted: true }
  }
  return { switch: true, exhausted: false }
}
