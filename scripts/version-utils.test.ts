import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  parseVersionType,
  isSemverVersion,
  isValidPrereleaseSuffix,
  find7zaExecutable,
  VERSION_TYPE_LABELS,
} from './version-utils.cjs'

describe('parseVersionType（三分类）', () => {
  it('内测版编号式 prerelease（-alpha.N）→ alpha', () => {
    expect(parseVersionType('0.1.5-alpha.1')).toBe('alpha')
    expect(parseVersionType('0.1.5-alpha.12')).toBe('alpha')
  })

  it('历史日期式内测版（-YYYYMMDD）→ alpha', () => {
    expect(parseVersionType('0.1.4-20260804')).toBe('alpha')
  })

  it('公测版（-beta.N）→ beta', () => {
    expect(parseVersionType('0.1.5-beta.1')).toBe('beta')
  })

  it('正式版（x.y.z）→ release', () => {
    expect(parseVersionType('0.1.5')).toBe('release')
    expect(parseVersionType('1.0.0')).toBe('release')
  })

  it('非字符串安全回退 release', () => {
    expect(parseVersionType(undefined)).toBe('release')
  })
})

describe('isSemverVersion', () => {
  it('合法 SemVer（含 prerelease）', () => {
    expect(isSemverVersion('0.1.5')).toBe(true)
    expect(isSemverVersion('0.1.5-alpha.1')).toBe(true)
    expect(isSemverVersion('0.1.4-20260804')).toBe(true)
    expect(isSemverVersion('2.5.2')).toBe(true)
  })

  it('非法格式', () => {
    expect(isSemverVersion('v0.1.5')).toBe(false)
    expect(isSemverVersion('0.1')).toBe(false)
    expect(isSemverVersion('')).toBe(false)
    expect(isSemverVersion(undefined)).toBe(false)
  })
})

describe('isValidPrereleaseSuffix（白名单）', () => {
  it('白名单内：alpha.N / beta.N / 日期式 / 无后缀', () => {
    expect(isValidPrereleaseSuffix('0.1.5-alpha.1')).toBe(true)
    expect(isValidPrereleaseSuffix('0.1.5-beta.2')).toBe(true)
    expect(isValidPrereleaseSuffix('0.1.4-20260804')).toBe(true)
    expect(isValidPrereleaseSuffix('0.1.5')).toBe(true)
  })

  it('白名单外：自定义 prerelease 后缀拒绝（防被误判为正式版）', () => {
    expect(isValidPrereleaseSuffix('0.1.5-rc.1')).toBe(false)
    expect(isValidPrereleaseSuffix('0.1.5-dev')).toBe(false)
    expect(isValidPrereleaseSuffix('0.1.5-alpha')).toBe(false) // 缺编号
  })
})

describe('find7zaExecutable', () => {
  it('在真实项目 node_modules/.pnpm 中找到 7za.exe', () => {
    const root = path.join(__dirname, '..')
    const exe = find7zaExecutable(root)
    expect(exe).toBeTruthy()
    expect(exe.endsWith('7za.exe')).toBe(true)
  })

  it('目录不存在时返回 null', () => {
    expect(find7zaExecutable(path.join(__dirname, '..', '不存在的目录'))).toBeNull()
  })
})

describe('VERSION_TYPE_LABELS', () => {
  it('三分类标签齐全（构建日志输出用）', () => {
    expect(VERSION_TYPE_LABELS.alpha).toBe('内测（alpha）')
    expect(VERSION_TYPE_LABELS.beta).toBe('公测（beta）')
    expect(VERSION_TYPE_LABELS.release).toBe('正式版')
  })
})
