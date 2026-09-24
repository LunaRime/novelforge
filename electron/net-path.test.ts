/**
 * net-path 模块测试（智能模型下载 T1：路径候选 / 测速排序 / 换路判定）
 *
 * 契约（T2/T3 依赖，签名锁定）：
 * - buildPathCandidates：direct 恒在；proxy 仅在 enabled && host && port 齐全时加入
 *   ⚠️ proxyRules 形如 `host:port`，**不带 `http://` 前缀**——Chromium 会静默忽略带前缀的值
 * - rankPaths：成功的按吞吐降序在前；失败的按候选原序垫后（保证全失败时仍有可用候选）
 * - scoreProbe：0 字节 / 非正耗时 → null（判失败，不能当成 0 B/s 混进排序）
 * - decideSwitch：停滞 或 连续错误达上限 → 换路；换路上限或候选耗尽 → 放弃
 *
 * 说明：本模块不 import electron，可无 electron 二进制直接单测。
 */

import { describe, expect, it } from 'vitest'
import {
  buildPathCandidates,
  decideSwitch,
  isStalled,
  MAX_PATH_ERRORS,
  MAX_SWITCHES,
  rankPaths,
  scoreProbe,
  STALL_TIMEOUT_MS,
  type NetPath,
  type PathProbe,
} from './net-path'

const direct: NetPath = { id: 'direct', label: 'direct' }
const proxy: NetPath = { id: 'proxy', label: '127.0.0.1:7897', proxyRules: '127.0.0.1:7897' }

describe('buildPathCandidates', () => {
  it('无代理配置 → 只有直连', () => {
    expect(buildPathCandidates(undefined)).toEqual([direct])
  })

  it('代理未启用 → 只有直连', () => {
    expect(buildPathCandidates({ enabled: false, host: '127.0.0.1', port: 7897 })).toEqual([direct])
  })

  it('代理启用且 host/port 齐全 → 直连 + 代理', () => {
    const paths = buildPathCandidates({ enabled: true, host: '127.0.0.1', port: 7897 })
    expect(paths).toHaveLength(2)
    expect(paths[0]).toEqual(direct)
    expect(paths[1].id).toBe('proxy')
  })

  it('proxyRules 不带 http:// 前缀（带前缀会被 Chromium 静默忽略）', () => {
    const paths = buildPathCandidates({ enabled: true, host: '127.0.0.1', port: 7897 })
    expect(paths[1].proxyRules).toBe('127.0.0.1:7897')
    expect(paths[1].proxyRules).not.toContain('://')
  })

  it('缺 host 或 port → 只有直连（不发无效请求）', () => {
    expect(buildPathCandidates({ enabled: true, port: 7897 })).toEqual([direct])
    expect(buildPathCandidates({ enabled: true, host: '127.0.0.1' })).toEqual([direct])
    expect(buildPathCandidates({ enabled: true, host: '  ', port: 7897 })).toEqual([direct])
  })
})

describe('scoreProbe', () => {
  it('正常：按字节/耗时算吞吐', () => {
    expect(scoreProbe(1_000_000, 1000)).toBe(1_000_000)
    expect(scoreProbe(500_000, 1000)).toBe(500_000)
  })

  it('一个字节都没收到 → null（判失败，不与 0 B/s 混淆）', () => {
    expect(scoreProbe(0, 1000)).toBeNull()
  })

  it('亚毫秒耗时按 1ms 计（不能把最快的那条路判成不通）', () => {
    expect(scoreProbe(1000, 0)).toBe(1_000_000)
    expect(scoreProbe(1000, -5)).toBe(1_000_000)
  })
})

describe('rankPaths', () => {
  it('成功的按吞吐降序排在前，失败的按候选原序垫后', () => {
    const probes: PathProbe[] = [
      { path: direct, bytesPerSec: 200_000 },
      { path: proxy, bytesPerSec: 1_500_000 },
    ]
    expect(rankPaths(probes).map((p) => p.id)).toEqual(['proxy', 'direct'])

    const withFailure: PathProbe[] = [
      { path: direct, bytesPerSec: null },
      { path: proxy, bytesPerSec: 900_000 },
    ]
    expect(rankPaths(withFailure).map((p) => p.id)).toEqual(['proxy', 'direct'])
  })

  it('全部探测失败 → 保持候选原序（仍要有候选可试）', () => {
    const probes: PathProbe[] = [
      { path: direct, bytesPerSec: null },
      { path: proxy, bytesPerSec: null },
    ]
    expect(rankPaths(probes).map((p) => p.id)).toEqual(['direct', 'proxy'])
  })
})

describe('isStalled', () => {
  it('达到停滞阈值 → true', () => {
    expect(isStalled(STALL_TIMEOUT_MS)).toBe(true)
    expect(isStalled(STALL_TIMEOUT_MS + 1)).toBe(true)
  })

  it('未达阈值 → false', () => {
    expect(isStalled(STALL_TIMEOUT_MS - 1)).toBe(false)
    expect(isStalled(0)).toBe(false)
  })
})

describe('decideSwitch', () => {
  const base = { stalled: false, consecutiveErrors: 0, triedCount: 1, totalCandidates: 2 }

  it('一切正常 → 不换', () => {
    expect(decideSwitch(base)).toEqual({ switch: false, exhausted: false })
  })

  it('停滞 → 换路', () => {
    expect(decideSwitch({ ...base, stalled: true })).toEqual({ switch: true, exhausted: false })
  })

  it('连续错误达上限 → 换路；未达上限 → 不换', () => {
    expect(decideSwitch({ ...base, consecutiveErrors: MAX_PATH_ERRORS - 1 }).switch).toBe(false)
    expect(decideSwitch({ ...base, consecutiveErrors: MAX_PATH_ERRORS }).switch).toBe(true)
  })

  it('候选已试完 → 判定放弃（不换）', () => {
    expect(decideSwitch({ ...base, stalled: true, triedCount: 2, totalCandidates: 2 }))
      .toEqual({ switch: false, exhausted: true })
  })

  it('换路次数达上限 → 判定放弃', () => {
    const triedCount = MAX_SWITCHES + 1 // 已试 N 条 = 已换 N-1 次
    expect(decideSwitch({ ...base, stalled: true, triedCount, totalCandidates: 99 }))
      .toEqual({ switch: false, exhausted: true })
  })
})
