/**
 * 版本三分类共享工具（构建流程用）
 *
 * 与三版本发版制（novelforge-release.md）对齐：
 * - alpha（内测版）：编号式 prerelease `-alpha.N` 或历史日期式 `-YYYYMMDD`（如 0.1.4-20260804）
 * - beta（公测版）：编号式 prerelease `-beta.N`
 * - release（正式版）：纯 SemVer `x.y.z`
 *
 * 判定规则与主进程日志环境（electron/utils/logger.ts detectLogEnvironment）
 * 一致：alpha/日期式 → 开发日志；beta/正式 → 发布日志。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 三分类版本类型 */
const VERSION_TYPES = ['alpha', 'beta', 'release'];

/** 分类中文标签（构建日志输出用） */
const VERSION_TYPE_LABELS = {
  alpha: '内测（alpha）',
  beta: '公测（beta）',
  release: '正式版',
};

/** 合法 prerelease 后缀白名单：alpha.N / beta.N / 日期式 YYYYMMDD（禁其他自定义后缀） */
const PRERELEASE_SUFFIX_PATTERN = /^-(alpha\.\d+|beta\.\d+|\d{8})$/i;

/**
 * 判定版本类型（三分类）
 * @param {string} version package.json version
 * @returns {'alpha'|'beta'|'release'}
 */
function parseVersionType(version) {
  if (typeof version !== 'string') return 'release';
  if (/-alpha\.\d+/i.test(version) || /-\d{8}$/.test(version)) return 'alpha';
  if (/-beta\.\d+/i.test(version)) return 'beta';
  return 'release';
}

/**
 * SemVer 格式校验（x.y.z[-prerelease]）
 * @param {string} version
 * @returns {boolean}
 */
function isSemverVersion(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version);
}

/**
 * prerelease 后缀白名单校验（拆出 - 后的后缀，必须匹配 alpha.N/beta.N/YYYYMMDD）
 * 无后缀（正式版）返回 true。
 * @param {string} version
 * @returns {boolean}
 */
function isValidPrereleaseSuffix(version) {
  if (typeof version !== 'string' || !version.includes('-')) return true;
  const suffix = '-' + version.split('-').slice(1).join('-');
  return PRERELEASE_SUFFIX_PATTERN.test(suffix);
}

/**
 * 查找 7za.exe（pnpm .pnpm 目录扫描，从新版本往旧版本找）
 * electron-builder 依赖 7zip-bin，但 pnpm 严格隔离下不提升到根 node_modules，
 * 实际路径为 node_modules/.pnpm/7zip-bin@x.y.z/node_modules/7zip-bin/win/x64/7za.exe
 * @param {string} rootDir 项目根目录
 * @returns {string|null} 7za.exe 绝对路径（未找到返回 null）
 */
function find7zaExecutable(rootDir) {
  const pnpmDir = path.join(rootDir, 'node_modules', '.pnpm');
  let dirs = [];
  try {
    dirs = fs.readdirSync(pnpmDir).filter(d => d.startsWith('7zip-bin@')).sort();
  } catch {
    return null;
  }
  for (const dir of dirs.reverse()) {
    const exe = path.join(pnpmDir, dir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

module.exports = {
  VERSION_TYPES,
  VERSION_TYPE_LABELS,
  PRERELEASE_SUFFIX_PATTERN,
  parseVersionType,
  isSemverVersion,
  isValidPrereleaseSuffix,
  find7zaExecutable,
};
