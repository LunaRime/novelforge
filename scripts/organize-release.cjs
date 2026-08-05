/**
 * 构建后整理脚本 — 将 electron-builder 产物组织到命名子文件夹并归位到四分类目录
 *
 * 三版本分类分流（2026-08-05）：
 * - alpha（内测版）：保留 Portable 目录，**跳过便携版 7z 压缩**（仅本地分发）
 * - beta（公测版）/ release（正式版）：自动压缩 Portable.7z（发布必需资产，失败阻断）
 *
 * 四分类产物结构（构建产物最终落位）:
 *   release/
 *     ├── alpha/{version}/       ← 内测版产物（本地分发，无 7z）
 *     ├── beta/{version}/        ← 公测版产物
 *     ├── stable/{version}/      ← 正式版产物
 *     └── historical/            ← 废弃版本（内部同构细分 alpha/beta/stable）
 *       ├── alpha/
 *       ├── beta/
 *       └── stable/
 *
 * 流程: electron-builder 输出 release/${version}（中间位置）
 *   → 整理（重命名 Portable / 清理调试文件 / 7z 压缩）
 *   → 整体归位 release/{type}/{version}（rename，失败回退复制+删除）
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  parseVersionType,
  VERSION_TYPE_LABELS,
  find7zaExecutable,
} = require('./version-utils.cjs');

// 从 electron-builder.json5 读取 productName（JSON5 兼容）
const configRaw = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.json5'), 'utf-8');
const productNameMatch = configRaw.match(/"productName"\s*:\s*"([^"]+)"/);
const productName = productNameMatch ? productNameMatch[1] : 'NovelForge';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = pkg.version;
const releaseDir = path.join(__dirname, '..', 'release', version);
const winUnpacked = path.join(releaseDir, 'win-unpacked');
const portableDir = path.join(releaseDir, `${productName}-${version}-Portable`);

// ===== 版本三分类 =====
const versionType = parseVersionType(version);
console.log(`[organize] 版本: ${version} | 类型: ${VERSION_TYPE_LABELS[versionType]}`);

if (!fs.existsSync(releaseDir)) {
  console.log(`[organize] release/${version} 不存在，跳过整理`);
  process.exit(0);
}

// 目录移动：rename 带重试（Windows Defender 实时扫描锁可致间歇性 EPERM（UV_EPERM/-4048），
// 构建产物刚生成时扫描队列高负载必现——electron-builder 原生创建的目录同样受影响），
// 仍失败则回退复制+删除（复制/删除不受扫描锁影响，实测可靠）
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function moveWithRetry(src, dest, label) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });

  let moved = false;
  for (let attempt = 1; attempt <= 5 && !moved; attempt++) {
    try {
      fs.renameSync(src, dest);
      moved = true;
    } catch (e) {
      if (attempt < 5) {
        console.warn(`[organize] ${label} rename 尝试 ${attempt}/5 失败（${e.code || e.message}），1s 后重试`);
        sleepSync(1000);
      }
    }
  }
  if (moved) {
    console.log(`[organize] ${label} → ${path.basename(dest)}/`);
    return true;
  }
  console.warn(`[organize] ${label} rename 连续失败（扫描锁持续），回退复制+删除`);
  fs.cpSync(src, dest, { recursive: true });
  fs.rmSync(src, { recursive: true, force: true });
  console.log(`[organize] ${label}（复制模式）→ ${path.basename(dest)}/`);
  return true;
}

// 1. 将 win-unpacked 重命名为 {productName}-{version}-Portable
if (fs.existsSync(winUnpacked)) {
  moveWithRetry(winUnpacked, portableDir, 'win-unpacked');
}

// 2. 清理构建调试文件（⚠️ 保留 latest.yml 与 .blockmap — electron-updater 自动更新的必需元数据，发布时必须一并上传）
const cleanupFiles = ['builder-debug.yml', 'builder-effective-config.yaml'];
for (const file of cleanupFiles) {
  const filePath = path.join(releaseDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[organize] 已清理 ${file}`);
  }
}

// 3. 列出 installer 目录内容（blockmap 保留，供增量更新）
const installerDir = path.join(releaseDir, `${productName}-${version}-Installer`);
if (fs.existsSync(installerDir)) {
  const files = fs.readdirSync(installerDir);
  console.log(`[organize] ${productName}-${version}-Installer/: ${files.join(', ')}`);
}

// 4. 便携版压缩（按版本类型分流）
// ⚠️ 压缩后不做源目录 readdir 计数——Windows Defender 实时扫描锁下，
// 触碰源目录会放大归位 rename 被拒（UV_EPERM）的概率，计数移到归位后
if (fs.existsSync(portableDir)) {
  if (versionType === 'alpha') {
    // 内测版：仅本地分发，跳过压缩（产物保留为目录，省构建时间）
    console.log(`[organize] 内测版（alpha）：跳过便携版 7z 压缩，产物保留为目录`);
  } else {
    // 公测/正式版：便携版 7z 是发布必需资产（4 资产之一），压缩失败阻断构建
    const sevenZip = find7zaExecutable(path.join(__dirname, '..'));
    if (!sevenZip) {
      console.error(`[organize] 未找到 7za.exe（node_modules/.pnpm/7zip-bin/），便携版压缩失败`);
      process.exit(1);
    }
    const archivePath = path.join(releaseDir, `${productName}-${version}-Portable.7z`);
    console.log(`[organize] 压缩便携版 → ${path.basename(archivePath)}（7za: ${sevenZip}）`);
    const result = spawnSync(sevenZip, ['a', '-mx=5', archivePath, portableDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`[organize] 便携版压缩失败（exit=${result.status}），发布资产缺失，构建阻断`);
      process.exit(1);
    }
    const size = fs.statSync(archivePath).size;
    console.log(`[organize] 便携版压缩完成: ${(size / 1024 / 1024).toFixed(1)} MB`);
  }
}

// 5. 产物归位到四分类目录（alpha / beta / stable）
// 分类目录映射：alpha → alpha/，beta → beta/，release（正式版）→ stable/
const categoryDirMap = { alpha: 'alpha', beta: 'beta', release: 'stable' };
const categoryRoot = path.join(__dirname, '..', 'release', categoryDirMap[versionType]);
const targetDir = path.join(categoryRoot, version);

fs.mkdirSync(categoryRoot, { recursive: true });

if (moveWithRetry(releaseDir, targetDir, '产物归位')) {
  console.log(`[organize] 产物归位 → release/${categoryDirMap[versionType]}/${version}`);
  // 归位后计数（源目录已移走，避免触碰源目录触发扫描锁）
  const movedPortable = path.join(targetDir, `${productName}-${version}-Portable`);
  if (fs.existsSync(movedPortable)) {
    console.log(`[organize] ${productName}-${version}-Portable/: ${fs.readdirSync(movedPortable).length} 个文件/目录`);
  }
}

console.log(`[organize] release/${version} 整理完成（已归位 ${categoryDirMap[versionType]}/${version}）`);
