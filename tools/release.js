'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2];
const notes = process.argv[3] || 'Обновление Kvinta';

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Использование: node tools/release.js <major.minor.patch> ["что нового"]');
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });

const jdks = path.join(process.env.USERPROFILE, '.jdks');
const jdkDir = fs.existsSync(jdks) ? fs.readdirSync(jdks).find(d => d.startsWith('jdk')) : null;
if (!jdkDir) { console.error('Не найден JDK в ' + jdks); process.exit(1); }
const JAVA_HOME = path.join(jdks, jdkDir);

const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

const gradleFile = path.join(ROOT, 'mobile', 'android', 'app', 'build.gradle');
const [maj, min, pat] = version.split('.').map(Number);
let gradle = fs.readFileSync(gradleFile, 'utf8');
gradle = gradle
  .replace(/versionCode \d+/, 'versionCode ' + (maj * 10000 + min * 100 + pat))
  .replace(/versionName "[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradleFile, gradle);

run('node mobile/sync.js');
run('npx electron-builder --win --publish never');
run('.\\gradlew.bat assembleRelease', {
  cwd: path.join(ROOT, 'mobile', 'android'),
  env: { ...process.env, JAVA_HOME, PATH: path.join(JAVA_HOME, 'bin') + ';' + process.env.PATH }
});

const apkSrc = path.join(ROOT, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const apkDst = path.join(ROOT, 'dist', `Kvinta-${version}.apk`);
fs.copyFileSync(apkSrc, apkDst);

run(`git add -A && git commit -m "v${version}"`);
run('git push');
const assets = [
  path.join(ROOT, 'dist', `Kvinta-${version}-Setup.exe`),
  path.join(ROOT, 'dist', `Kvinta-${version}-Setup.exe.blockmap`),
  path.join(ROOT, 'dist', 'latest.yml'),
  apkDst
].map(p => `"${p}"`).join(' ');
run(`gh release create v${version} ${assets} --title "Kvinta ${version}" --notes "${notes.replace(/"/g, "'")}"`);

console.log(`\nРелиз v${version} опубликован.`);
