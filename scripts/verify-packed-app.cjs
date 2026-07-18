/**
 * 打包后 asar 内容审计 — 防止 CJS/ESM 冲突 + 垃圾文件进入分发产物
 *
 * 在 electron-builder 打包后、organize-release 之前运行。
 * 所有检查失败以 exit(1) 终止构建。
 *
 * 审计标记: [R8-2026-07-18] — 见 .codewhale-plans/2026-07-18/audit-log.md #R8-07
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
let errors = 0;
let warnings = 0;

function fail(msg) { console.error(`❌ ${msg}`); errors++; }
function warn(msg) { console.warn(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// ===== 定位 asar =====
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;
const releaseDir = path.join(ROOT, 'release', version);

// 尝试多个可能的 asar 路径
const asarCandidates = [
  path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar'),
  path.join(releaseDir, 'NovelForge-' + version + '-Portable', 'resources', 'app.asar'),
  path.join(releaseDir, 'NovelForge-' + version + '-Portable-r8', 'resources', 'app.asar'),
  path.join(releaseDir, 'NovelForge-' + version + '-Portable-v2', 'resources', 'app.asar'),
];

let asarPath = null;
for (const candidate of asarCandidates) {
  if (fs.existsSync(candidate)) {
    asarPath = candidate;
    break;
  }
}

if (!asarPath) {
  warn('未找到 app.asar，跳过 asar 内容审计。如果尚未执行 electron-builder 打包步骤，这属于预期行为。');
  // 非阻断 — CI smoke check 阶段不执行 electron-builder，asar 尚未生成
  process.exit(0);
}

console.log(`📦 审计: ${asarPath}`);

// ===== 获取 asar 文件列表 =====
let fileList;
try {
  fileList = execSync(`npx asar list "${asarPath}"`, { encoding: 'utf-8', cwd: ROOT });
} catch (e) {
  fail(`asar list 失败: ${e.message}`);
  process.exit(1);
}

const files = fileList.split('\n').filter(Boolean);
const rootFiles = files.filter(f => !f.includes('/'));

// ===== 检查 A：package.json 不含 "type":"module" =====
let pkgJsonContent;
try {
  pkgJsonContent = execSync(`npx asar extract-file "${asarPath}" "package.json"`, {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], cwd: ROOT,
  });
} catch {
  fail('检查 A: 无法从 asar 中提取 package.json');
}
if (pkgJsonContent) {
  const asarPkg = JSON.parse(pkgJsonContent);
  if (asarPkg.type === 'module') {
    fail(
      '检查 A: asar 内 package.json 含 "type":"module" — ' +
      '这会导致主进程以 ESM 模式运行，require 不可用。' +
      '请在 electron-builder.json5 的 extraMetadata 中添加 "type":"commonjs"。'
    );
  } else if (asarPkg.type === 'commonjs' || asarPkg.type === undefined) {
    ok(`检查 A: asar 内 package.json type = "${asarPkg.type || '(默认 commonjs)'}" — 安全`);
  }
}

// ===== 检查 B：asar 根目录不含 node_modules/react =====
if (files.some(f => f.startsWith('node_modules/react/'))) {
  fail(
    '检查 B: asar 内包含 node_modules/react — ' +
    '前端依赖应由 Vite 打包进 dist/，不应出现在 asar 中。' +
    '请检查 electron-builder.json5 files 白名单。'
  );
} else {
  ok('检查 B: asar 不含前端 node_modules（正确，已被 Vite tree-shake）');
}

// ===== 检查 C：asar 不含开发/审计目录 =====
const forbiddenDirs = ['.codewhale', '.codewhale-plans', 'coverage', '.storybook'];
for (const dir of forbiddenDirs) {
  if (rootFiles.includes(dir) || files.some(f => f.startsWith(dir + '/'))) {
    fail(`检查 C: asar 包含禁止目录 "${dir}" — 这是开发/审计目录，不应分发给用户`);
  }
}
const forbiddenPatterns = [/^tsconfig\./, /^vitest\./, /^\.git/, /^\.eslint/, /^\.npmrc/];
for (const f of rootFiles) {
  for (const re of forbiddenPatterns) {
    if (re.test(f)) {
      fail(`检查 C: asar 根目录包含禁止文件 "${f}" — 不应分发给用户`);
    }
  }
}
if (errors === 0) ok('检查 C: asar 不含开发/审计目录');

// ===== 检查 D：preload 文件扩展名与内容一致 =====
// Unix 用 /, Windows asar 用 \ — 同时支持两种路径分隔符
const preloadFile = files.find(f => f.match(/[\/\\]dist-electron[\/\\]preload\.\w+$/));
if (!preloadFile) {
  fail('检查 D: asar 中未找到 dist-electron/preload.* 文件');
} else {
  const ext = path.extname(preloadFile);
  let preloadContent;
  try {
    preloadContent = execSync(`npx asar extract-file "${asarPath}" "${preloadFile}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], cwd: ROOT,
    });
  } catch { /* ignore */ }

  if (preloadContent) {
    const hasRequire = /require\s*\(/.test(preloadContent);

    if (ext === '.mjs' && hasRequire) {
      fail(
        `检查 D: preload 文件 "${preloadFile}" 使用 .mjs 扩展名，` +
        '但内容包含 require() — 在 ESM 模式下会崩溃。请改为 .cjs + CJS 格式。'
      );
    } else if (ext === '.cjs') {
      ok(`检查 D: preload "${preloadFile}" 使用 .cjs 扩展名 — 格式正确`);
    } else {
      ok(`检查 D: preload "${preloadFile}" — 格式检查通过`);
    }
  } else {
    warn(`检查 D: 无法读取 preload 内容，跳过格式检查`);
  }
}

// ===== 检查 E：asar 大小警告（非阻断） =====
try {
  const stat = fs.statSync(asarPath);
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB > 80) {
    warn(`检查 E: asar 大小 ${sizeMB.toFixed(1)} MB > 80 MB 警告线。` +
      '建议检查 files 白名单排除不必要文件。');
  } else {
    ok(`检查 E: asar 大小 ${sizeMB.toFixed(1)} MB — 正常`);
  }
} catch { /* ignore */ }

// ===== 总结 =====
console.log('');
if (errors > 0) {
  console.error(`❌ asar 审计失败: ${errors} 错误, ${warnings} 警告`);
  process.exit(1);
} else {
  console.log(`✅ asar 审计通过${warnings > 0 ? ` (${warnings} 个非阻断警告)` : ''}`);
}
