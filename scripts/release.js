// 发布脚本：升版本 -> 构建 -> 算 sha256 -> 生成 update.json -> 上传 GitHub Release
// 用法： node scripts/release.js [patch|minor|major]   （默认 patch）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const DIST = path.join(ROOT, 'dist');
const REPO = process.env.NIULAI_REPO || 'huangshen70/niulai-memo';

// 优先用仓库内自带的 gh（tools/bin/gh.exe），其次 PATH
function findGh() {
  const local = path.join(ROOT, 'tools', 'bin', process.platform === 'win32' ? 'gh.exe' : 'gh');
  if (fs.existsSync(local)) return local;
  return 'gh';
}

const bump = process.argv[2] || 'patch';
const pkgPath = path.join(APP, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = bump === 'major' ? `${maj + 1}.0.0`
  : bump === 'minor' ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
console.log(`版本 ${next}`);

console.log('构建中…');
execFileSync('npx', ['electron-builder', '--win', 'portable'], { cwd: APP, stdio: 'inherit', shell: true });

const exe = path.join(DIST, `niulai-memo-${next}.exe`);
if (!fs.existsSync(exe)) {
  console.error('未找到构建产物：', exe);
  process.exit(1);
}
const buf = fs.readFileSync(exe);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const size = buf.length;

const manifest = {
  version: next,
  url: `https://github.com/${REPO}/releases/download/v${next}/niulai-memo-${next}.exe`,
  sha256,
  size,
  notes: process.env.NIULAI_NOTES || `v${next}`,
  minVersion: process.env.NIULAI_MIN_VERSION || '1.0.0',
  publishedAt: new Date().toISOString(),
};
const manifestPath = path.join(DIST, 'update.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log('update.json 已生成', manifestPath);
console.log('sha256', sha256);

console.log('上传到 GitHub Release…');
try {
  execFileSync(findGh(), [
    'release', 'create', `v${next}`, exe, manifestPath,
    '--repo', REPO,
    '--title', `v${next}`,
    '--notes', manifest.notes,
    '--latest',
  ], { stdio: 'inherit' });
  console.log(`\n✓ 已发布 v${next}。所有旧版本会在下次启动 / 6 小时内自动更新。`);
} catch (e) {
  console.error('\n上传失败。请确认已安装并登录 GitHub CLI：');
  console.error('  gh auth login');
  console.error('产物已生成，可手动上传：');
  console.error('  ' + exe);
  console.error('  ' + manifestPath);
  process.exit(1);
}
