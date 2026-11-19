/**
 * 校验项目里没有残留的微信小程序写法，确保是纯支付宝小程序。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const RULES = [
  // [正则, 说明]
  [/\bwx\.[a-zA-Z]/, '微信 API 调用 wx.*（应改为 my.*）'],
  [/\bwx:(if|elif|else|for|for-item|for-index|key)\b/, '微信模板指令 wx:*（应为 a:*）'],
  [/\bbind:?[a-zA-Z]+\s*=/, '微信事件绑定 bind*（应为 on*）'],
  [/\bcatch:?[a-z]+\s*=/, '微信事件绑定 catch*（应为 catch* 驼峰）'],
  [/\.wxml\b/, '微信模板扩展名 .wxml（应为 .axml）'],
  [/\.wxss\b/, '微信样式扩展名 .wxss（应为 .acss）'],
  [/\bnavigationBarTitleText\b/, '微信页面标题字段（应为 defaultTitle）'],
  [/\bproject\.config\.json\b/, '微信项目配置文件（应为 mini.project.json）'],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const CODE_EXT = /\.(js|mjs|axml|acss|json|md)$/i;
// 这些文件本身就是"微信->支付宝"的转换工具或迁移说明，允许出现微信写法
const ALLOW = [
  'tools/check-alipay-only.js',
  'tools/wxml-to-axml.js',
  'tools/page-json-to-alipay.js',
  'README.md',
  'AGENTS.md', // 指导文档，说明"微信写法 vs 支付宝写法"的差异，属合理提及
];
const problems = [];

for (const file of walk(root)) {
  if (!CODE_EXT.test(file)) continue;
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (ALLOW.includes(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [re, desc] of RULES) {
      if (re.test(line)) {
        problems.push(`${rel}:${i + 1}  [${desc}]\n    ${line.trim().slice(0, 140)}`);
      }
    }
  });
}

if (problems.length) {
  console.log(`发现 ${problems.length} 处疑似微信写法：\n`);
  problems.forEach(p => console.log('  ' + p));
  process.exitCode = 1;
} else {
  console.log('PASS: 未发现微信小程序残留写法（纯支付宝）');
}
