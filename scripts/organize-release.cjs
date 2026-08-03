/**
 * 构建后整理脚本 — 将 electron-builder 产物组织到命名子文件夹
 *
 * 结构:
 *   release/${version}/
 *     ├── {productName}-{version}-Portable/   ← win-unpacked 内容
 *     └── {productName}-{version}-Installer/  ← NSIS 安装程序
 */
const fs = require('node:fs');
const path = require('node:path');

// 从 electron-builder.json5 读取 productName（JSON5 兼容）
const configRaw = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.json5'), 'utf-8');
const productNameMatch = configRaw.match(/"productName"\s*:\s*"([^"]+)"/);
const productName = productNameMatch ? productNameMatch[1] : 'NovelForge';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = pkg.version;
const releaseDir = path.join(__dirname, '..', 'release', version);
const winUnpacked = path.join(releaseDir, 'win-unpacked');
const portableDir = path.join(releaseDir, `${productName}-${version}-Portable`);

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

if (fs.existsSync(portableDir)) {
  const count = fs.readdirSync(portableDir).length;
  console.log(`[organize] ${productName}-${version}-Portable/: ${count} 个文件/目录`);
}

console.log(`[organize] release/${version} 整理完成`);
