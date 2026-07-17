/**
 * 构建后整理脚本 — 将 electron-builder 产物组织到 portable/ 和 installer/ 子文件夹
 *
 * 结构:
 *   release/${version}/
 *     ├── portable/       ← win-unpacked 内容（用户自行压缩为便携版）
 *     └── installer/      ← NSIS 安装程序（用户自行压缩发布）
 */
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = pkg.version;
const releaseDir = path.join(__dirname, '..', 'release', version);
const winUnpacked = path.join(releaseDir, 'win-unpacked');
const portableDir = path.join(releaseDir, 'portable');

if (!fs.existsSync(releaseDir)) {
  console.log(`[organize] release/${version} 不存在，跳过整理`);
  process.exit(0);
}

// 1. 将 win-unpacked 重命名为 portable
if (fs.existsSync(winUnpacked)) {
  if (fs.existsSync(portableDir)) {
    fs.rmSync(portableDir, { recursive: true, force: true });
  }
  fs.renameSync(winUnpacked, portableDir);
  console.log(`[organize] win-unpacked → portable/`);
}

// 2. 清理构建调试文件 + blockmap
const cleanupFiles = ['builder-debug.yml', 'builder-effective-config.yaml', 'latest.yml'];
for (const file of cleanupFiles) {
  const filePath = path.join(releaseDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[organize] 已清理 ${file}`);
  }
}

// 清理 installer 中的 .blockmap 文件
if (fs.existsSync(installerDir)) {
  for (const file of fs.readdirSync(installerDir)) {
    if (file.endsWith('.blockmap')) {
      fs.unlinkSync(path.join(installerDir, file));
      console.log(`[organize] 已清理 installer/${file}`);
    }
  }
}

// 3. 确认产物
const installerDir = path.join(releaseDir, 'installer');
if (fs.existsSync(installerDir)) {
  const files = fs.readdirSync(installerDir);
  console.log(`[organize] installer/: ${files.join(', ')}`);
}
if (fs.existsSync(portableDir)) {
  const count = fs.readdirSync(portableDir).length;
  console.log(`[organize] portable/: ${count} 个文件/目录`);
}

console.log(`[organize] release/${version} 整理完成`);
