/**
 * 构建前契约检查 — 防止 CJS/ESM 冲突复发
 *
 * 在 tsc + vite build 之前运行，验证构建配置的一致性。
 * 所有检查失败以 exit(1) 终止构建。
 *
 * 审计标记: [R8-2026-07-18] — 见 .codewhale-plans/2026-07-18/audit-log.md #R8-06
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let errors = 0;
let warnings = 0;

function fail(msg) { console.error(`❌ ${msg}`); errors++; }
function warn(msg) { console.warn(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// ===== 读取配置 =====
function readConfig(filepath) {
  try { return fs.readFileSync(path.join(ROOT, filepath), 'utf-8'); }
  catch { return null; }
}

const viteConfig = readConfig('vite.config.ts');
const builderConfig = readConfig('electron-builder.json5');
const mainTs = readConfig('electron/main.ts');
const pkgJson = JSON.parse(readConfig('package.json'));

if (!viteConfig || !builderConfig || !mainTs || !pkgJson) {
  console.error('❌ 无法读取必要的配置文件');
  process.exit(1);
}

// ===== 检查 A：root package.json 不得含有 "type":"module" =====
// R9 修复：移除 "type":"module" 后，vite-plugin-electron 自动输出 CJS，
// 整个模块系统统一为 CommonJS。重新引入 "type":"module" 会导致：
// 1. vite-plugin-electron 输出 ESM → 主进程 import 语句在 CJS 环境下崩溃
// 2. Rolldown CJS shim 与 ESM 模块系统冲突
const rootTypeModule = pkgJson.type === 'module';

if (rootTypeModule) {
  fail(
    '检查 A: root package.json 含有 "type":"module" — ' +
    '这会导致 vite-plugin-electron 输出 ESM 格式的主进程代码，' +
    '在 Electron CJS 运行时崩溃。请移除该字段（默认 CJS）。'
  );
} else {
  ok('检查 A: root package.json 无 type:module — vite-plugin-electron 输出 CJS');
}

// ===== 检查 A2：native 模块必须在 external 列表中 =====
const externalMatch = viteConfig.match(/external:\s*\[([^\]]+)\]/);
const hasBothNativeExternals = externalMatch &&
  externalMatch[1].includes('better-sqlite3') &&
  externalMatch[1].includes('@lancedb/lancedb');
if (hasBothNativeExternals) {
  ok('检查 A2: native 模块 better-sqlite3 + @lancedb/lancedb 已 externalize');
} else {
  fail(
    '检查 A2: vite.config.ts 的 external 列表中缺少原生模块。' +
    'Rolldown 无法打包 .node 二进制文件（better-sqlite3, @lancedb/lancedb），' +
    '必须在 main.vite.build.rollupOptions.external 中声明。'
  );
}

// ===== 检查 B：preload 文件名一致性 =====
const preloadEntryMatch = viteConfig.match(/entryFileNames:\s*['"]([^'"]+)['"]/);
const preloadPathMatch = mainTs.match(/preload:\s*path\.join\([^,]+,\s*['"]([^'"]+)['"]\)/);
const preloadEntryName = preloadEntryMatch ? preloadEntryMatch[1] : null;
const preloadPathName = preloadPathMatch ? preloadPathMatch[1] : null;

if (preloadEntryName && preloadPathName) {
  if (preloadEntryName !== preloadPathName) {
    fail(
      `检查 B: preload 文件名不一致 — ` +
      `vite.config.ts entryFileNames = "${preloadEntryName}", ` +
      `但 electron/main.ts 引用 "${preloadPathName}"`
    );
  } else {
    ok(`检查 B: preload 文件名一致 — "${preloadEntryName}"`);
  }
} else if (!preloadEntryName) {
  warn('检查 B: 未在 vite.config.ts 中找到 preload entryFileNames，跳过');
} else {
  warn('检查 B: 未在 electron/main.ts 中找到 preload 路径引用，跳过');
}

// ===== 检查 C：files 白名单审计（仅警告） =====
const filesMatch = builderConfig.match(/"files"\s*:\s*\[([\s\S]*?)\]/);
const filesBlock = filesMatch ? filesMatch[1] : '';
const hasAsteriskStar = filesBlock.includes('"**/*"') || filesBlock.includes("'**/*'");
const hasExclusions = /\s"![^"]+"/.test(filesBlock);
if (hasAsteriskStar && !hasExclusions) {
  fail(
    '检查 C: electron-builder.json5 files 白名单仅包含 "**/*"，没有排除规则。' +
    '建议收紧为明确的正向模式（参考 00-build-cjs-esm-conflict.md）'
  );
} else if (hasAsteriskStar) {
  ok('检查 C: files 白名单有排除规则保护');
} else {
  ok('检查 C: files 使用明确正向模式，安全');
}

// ===== 检查 D：asarUnpack 模块 → files 白名单对应 =====
const asarUnpackSection = builderConfig.match(/"asarUnpack"\s*:\s*\[([\s\S]*?)\]/);
const filesSection = builderConfig.match(/"files"\s*:\s*\[([\s\S]*?)\]/);
if (asarUnpackSection && filesSection) {
  const unpacked = [...asarUnpackSection[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const filesPatterns = [...filesSection[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  for (const mod of unpacked) {
    // 去除通配符后缀做前缀匹配
    const prefix = mod.replace(/\/?\*\*\/?\*?$/, '');
    const found = filesPatterns.some(p => {
      const pPrefix = p.replace(/\/?\*\*\/?\*?$/, '');
      return pPrefix.includes(prefix) || prefix.includes(pPrefix) || pPrefix === prefix;
    });
    // asarUnpack 模块不一定在 files 中（electron-builder 根据 dependencies 自动包含）
    // 仅检查 files 无正向模式时的风险
    if (!found && !hasAsteriskStar) {
      warn(`检查 D: asarUnpack 模块 "${mod}" 未在 files 白名单中找到明确匹配。` +
        'electron-builder 可能根据 dependencies 自动包含，但建议显式列出。');
    }
  }
  if (errors === 0) ok('检查 D: asarUnpack 与 files 白名单无冲突');
}

// ===== 总结 =====
console.log('');
if (errors > 0) {
  console.error(`❌ 构建契约检查失败: ${errors} 错误, ${warnings} 警告`);
  process.exit(1);
} else {
  console.log(`✅ 构建契约检查通过${warnings > 0 ? ` (${warnings} 个非阻断警告)` : ''}`);
}
