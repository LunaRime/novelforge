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

// 2. 清理构建调试文件
const cleanupFiles = ['builder-debug.yml', 'builder-effective-config.yaml', 'latest.yml'];
for (const file of cleanupFiles) {
  const filePath = path.join(releaseDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[organize] 已清理 ${file}`);
  }
}

// 3. 清理 installer 目录中的 .blockmap 文件
const installerDir = path.join(releaseDir, `${productName}-${version}-Installer`);
if (fs.existsSync(installerDir)) {
  for (const file of fs.readdirSync(installerDir)) {
    if (file.endsWith('.blockmap')) {
      fs.unlinkSync(path.join(installerDir, file));
      console.log(`[organize] 已清理 ${file}`);
    }
  }
  const files = fs.readdirSync(installerDir).filter(f => !f.endsWith('.blockmap'));
  console.log(`[organize] ${productName}-${version}-Installer/: ${files.join(', ')}`);
}

if (fs.existsSync(portableDir)) {
  const count = fs.readdirSync(portableDir).length;
  console.log(`[organize] ${productName}-${version}-Portable/: ${count} 个文件/目录`);
}

console.log(`[organize] release/${version} 整理完成`);
