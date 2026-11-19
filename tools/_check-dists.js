// 检查 IDE 各产物目录的渲染层/worker 是否包含指定关键字。
const fs = require('fs');
const path = require('path');
const distRoot = 'C:\\Windows\\TEMP\\_volans_temp_\\ide_dists\\mini';

const KEYWORDS = ['runDiag', 'diagResults', 'failReason', 'loadFailed'];

const dirs = fs.readdirSync(distRoot, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => ({ name: d.name, mtime: fs.statSync(path.join(distRoot, d.name)).mtime }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, 4);

for (const dir of dirs) {
  console.log(`--- ${dir.name}  (${dir.mtime.toLocaleTimeString('zh-CN')}) ---`);
  const files = [];
  const walk = p => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(distRoot, dir.name));
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    const hits = KEYWORDS.map(k => `${k}:${c.includes(k) ? 'Y' : 'n'}`).join(' ');
    console.log(`  ${path.basename(f).padEnd(18)} ${hits}  (${(c.length / 1024).toFixed(0)}KB)`);
  }
}
