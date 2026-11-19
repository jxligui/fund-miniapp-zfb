/**
 * 校验源码里所有 import / require 的相对路径都能真实解析到文件。
 * （支付宝编译器的 "cannot resolve module" 就是由此类问题引起的）
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC_EXT = /\.(js|mjs)$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0;

for (const file of walk(root)) {
  if (!SRC_EXT.test(file)) continue;
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);

  // import ... from 'xxx'  /  require('xxx')
  const re = /(?:from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1];
    checked++;
    const target = path.resolve(dir, spec);
    const exists =
      fs.existsSync(target) ||
      fs.existsSync(target + '.js') ||
      fs.existsSync(target + '.mjs') ||
      fs.existsSync(path.join(target, 'index.js'));
    if (!exists) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${line}  无法解析  '${spec}'  ->  ${path.relative(root, target)}`);
    }
  }
}

if (problems.length) {
  console.log(`发现 ${problems.length} 个无法解析的模块路径（检查了 ${checked} 个）：\n`);
  problems.forEach(p => console.log('  - ' + p));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checked} 个 import/require 路径全部可解析`);
}
