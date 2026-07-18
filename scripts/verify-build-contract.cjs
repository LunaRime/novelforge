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

// ===== 检查 A：CJS 主进程 → extraMetadata 必须有 type 覆盖 =====
const mainFormatCJS = /format:\s*['"]cjs['"]/.test(viteConfig);
// 仅在 extraMetadata 块内搜索 type 字段（避免匹配注释中的 "type":"module"）
const extraMetaBlock = builderConfig.match(/"extraMetadata"\s*:\s*\{([^}]+)\}/);
const extraType = extraMetaBlock ? extraMetaBlock[1].match(/"type"\s*:\s*"([^"]+)"/) : null;
const hasExtraTypeOverride = extraType && extraType[1] === 'commonjs';
const rootTypeModule = pkgJson.type === 'module';

if (mainFormatCJS && rootTypeModule && !hasExtraTypeOverride) {
  fail(
    '主进程为 CJS 格式，但 root package.json 设为 "type":"module"，' +
    '且 electron-builder.json5 的 extraMetadata 中缺少 "type":"commonjs" 覆盖。' +
    '这会导致构建产物启动时 require 不可用而崩溃。'
  );
} else if (mainFormatCJS && rootTypeModule && hasExtraTypeOverride) {
  ok('检查 A: extraMetadata 已正确覆盖 type 为 commonjs');
} else if (!mainFormatCJS) {
  ok('检查 A: 主进程非 CJS 格式，跳过 type 检查');
} else {
  ok('检查 A: root package.json 无 type:module，无需覆盖');
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
