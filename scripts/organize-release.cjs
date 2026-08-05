/**
 * 构建后整理脚本 — 将 electron-builder 产物组织到命名子文件夹
 *
 * 三版本分类分流（2026-08-05）：
 * - alpha（内测版）：保留 Portable 目录，**跳过便携版 7z 压缩**（仅本地分发）
 * - beta（公测版）/ release（正式版）：自动压缩 Portable.7z（发布必需资产，失败阻断）
 *
 * 结构:
 *   release/${version}/
 *     ├── {productName}-{version}-Portable/   ← win-unpacked 内容
 *     ├── {productName}-{version}-Portable.7z ← 便携版压缩包（beta/release）
 *     └── {productName}-{version}-Installer/  ← NSIS 安装程序
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

// 1. 将 win-unpacked 重命名为 {productName}-{version}-Portable
if (fs.existsSync(winUnpacked)) {
  if (fs.existsSync(portableDir)) {
    fs.rmSync(portableDir, { recursive: true, force: true });
  }
  fs.renameSync(winUnpacked, portableDir);
  console.log(`[organize] win-unpacked → ${productName}-${version}-Portable/`);
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
if (fs.existsSync(portableDir)) {
  const count = fs.readdirSync(portableDir).length;
  console.log(`[organize] ${productName}-${version}-Portable/: ${count} 个文件/目录`);

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

console.log(`[organize] release/${version} 整理完成`);
