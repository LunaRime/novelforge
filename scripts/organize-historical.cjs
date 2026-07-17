/**
 * 历史版本整理脚本 — 将旧版本 release/ 目录重组为命名子文件夹
 *
 * 结构:
 *   release/X.Y.Z/
 *     ├── {productName}-{version}-Portable/   ← win-unpacked 内容
 *     └── {productName}-{version}-Installer/  ← 仅有安装程序 exe
 *
 * 命名规则: 版本 < 2.0 → "Vela", >= 2.0 → "NovelForge"
 */
const fs = require('node:fs');
const path = require('node:path');

const releaseDir = path.join(__dirname, '..', 'release');

function getProductName(version) {
  const major = parseInt(version.split('.')[0], 10);
  return major >= 2 ? 'NovelForge' : 'Vela';
}

const versions = fs.readdirSync(releaseDir).filter(name => {
  const fullPath = path.join(releaseDir, name);
  return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
});

for (const version of versions) {
  const productName = getProductName(version);
  const verDir = path.join(releaseDir, version);

  // 1. win-unpacked → {productName}-{version}-Portable
  const winUnpacked = path.join(verDir, 'win-unpacked');
  const portableDir = path.join(verDir, `${productName}-${version}-Portable`);
  if (fs.existsSync(winUnpacked)) {
    if (fs.existsSync(portableDir)) {
      fs.rmSync(portableDir, { recursive: true, force: true });
    }
    fs.renameSync(winUnpacked, portableDir);
    console.log(`[${version}] win-unpacked → ${productName}-${version}-Portable/`);
  } else if (!fs.existsSync(portableDir)) {
    console.log(`[${version}] ⚠ 无 win-unpacked 也无 Portable/`);
  }

  // 2. 移动安装程序到 {productName}-{version}-Installer/
  const installerDir = path.join(verDir, `${productName}-${version}-Installer`);
  if (!fs.existsSync(installerDir)) {
    fs.mkdirSync(installerDir, { recursive: true });
  }

  const allFiles = fs.readdirSync(verDir).filter(f => {
    const fp = path.join(verDir, f);
    return fs.statSync(fp).isFile();
  });

  let movedCount = 0;
  for (const file of allFiles) {
    const lower = file.toLowerCase();
    if ((lower.includes('setup') || lower.includes('installer')) && lower.endsWith('.exe')) {
      const src = path.join(verDir, file);
      const dst = path.join(installerDir, file);
      fs.renameSync(src, dst);
      console.log(`[${version}] ${file} → ${productName}-${version}-Installer/`);
      movedCount++;
    }
  }
  if (movedCount === 0) {
    console.log(`[${version}] ℹ 无安装程序需要移动`);
  }

  // 3. 清理不需要的文件
  const cleanupPatterns = [/\.blockmap$/, /\.yml$/, /\.yaml$/, /-portable\.exe$/i];

  const remaining = fs.readdirSync(verDir).filter(f => {
    const fp = path.join(verDir, f);
    return fs.statSync(fp).isFile();
  });

  for (const file of remaining) {
    if (cleanupPatterns.some(p => p.test(file))) {
      fs.unlinkSync(path.join(verDir, file));
      console.log(`[${version}] 已清理 ${file}`);
    }
  }
}

console.log('\n整理完成！');
