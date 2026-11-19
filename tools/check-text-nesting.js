/** 检查 AXML 中 <text> 嵌套 <text>（支付宝不允许 text 有子元素）。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.axml')) out.push(p);
  }
  return out;
}

let found = 0;
for (const f of walk(root)) {
  const text = fs.readFileSync(f, 'utf8');
  // 逐个 <text ...> ... </text> 块，检查内部是否还有 <text
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (/<text[\s>]/i.test(m[1])) {
      const line = text.slice(0, m.index).split('\n').length;
      console.log(`${path.relative(root, f)}:${line}  <text> 内嵌 <text>`);
      console.log('   ' + m[0].replace(/\s+/g, ' ').slice(0, 160));
      found++;
    }
  }
}
console.log(found ? `\n共 ${found} 处` : '没有 <text> 嵌套 <text>');
process.exitCode = found ? 1 : 0;
