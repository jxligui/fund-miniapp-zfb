// 检查产物 bundle 里 new Function 的残留位置（区分业务代码 vs 框架代码）。
const fs = require('fs');
const path = require('path');
const dist = process.argv[2];
const files = [];
const walk = p => {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  }
};
walk(dist);
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8');
  let i = c.indexOf('new Function(');
  while (i >= 0) {
    const seg = c.slice(Math.max(0, i - 100), i + 140).replace(/\s+/g, ' ');
    console.log(`${path.basename(f)} @ ${i}:\n  ...${seg}...\n`);
    i = c.indexOf('new Function(', i + 1);
  }
}
console.log('done');
