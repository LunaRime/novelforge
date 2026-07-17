/**
 * 历史版本整理脚本 — 将旧版本 release/ 目录重组为 portable/ + installer/ 结构
 *
 * 旧结构: release/X.Y.Z/win-unpacked/ + setup.exe + portable.exe + .yml + .blockmap
 * 新结构:
 *   release/X.Y.Z/
 *     ├── portable/   ← win-unpacked 内容
 *     └── installer/  ← 仅有安装程序 exe
 */
const fs = require('node:fs');
const path = require('node:path');

const releaseDir = path.join(__dirname, '..', 'release');

const versions = fs.readdirSync(releaseDir).filter(name => {
  const fullPath = path.join(releaseDir, name);
  return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
});

for (const version of versions) {
  const verDir = path.join(releaseDir, version);

  // 1. win-unpacked → portable
  const winUnpacked = path.join(verDir, 'win-unpacked');
  const portableDir = path.join(verDir, 'portable');
  if (fs.existsSync(winUnpacked)) {
    if (fs.existsSync(portableDir)) {
      fs.rmSync(portableDir, { recursive: true, force: true });
    }
    fs.renameSync(winUnpacked, portableDir);
    console.log(`[${version}] win-unpacked → portable/`);
  } else if (!fs.existsSync(portableDir)) {
    console.log(`[${version}] ⚠ 无 win-unpacked 也无 portable/`);
  } else {
    console.log(`[${version}] portable/ 已存在，跳过`);
  }

  // 2. 移动安装程序到 installer/
  const installerDir = path.join(verDir, 'installer');
  if (!fs.existsSync(installerDir)) {
    fs.mkdirSync(installerDir, { recursive: true });
  }

  // 匹配 setup/installer exe
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
      if (fs.existsSync(dst)) {
        fs.unlinkSync(src);
        console.log(`[${version}] ${file} 已在 installer/，删除源文件`);
        movedCount++;
      } else {
        fs.renameSync(src, dst);
        console.log(`[${version}] ${file} → installer/`);
        movedCount++;
      }
    }
  }
  if (movedCount === 0) {
    console.log(`[${version}] ℹ 无安装程序需要移动`);
  }

  // 3. 清理不需要的文件
  const cleanupPatterns = [
    /\.blockmap$/,
    /\.yml$/,
    /\.yaml$/,
    /-portable\.exe$/i,
  ];

  const remaining = fs.readdirSync(verDir).filter(f => {
    const fp = path.join(verDir, f);
    return fs.statSync(fp).isFile();
  });

  for (const file of remaining) {
    if (cleanupPatterns.some(p => p.test(file))) {
      const fp = path.join(verDir, file);
      fs.unlinkSync(fp);
      console.log(`[${version}] 已清理 ${file}`);
    }
  }
}

console.log('\n整理完成！');
