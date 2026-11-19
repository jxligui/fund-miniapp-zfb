/**
 * 微信页面配置 -> 支付宝页面配置。
 *   navigationBarTitleText -> defaultTitle
 *   enablePullDownRefresh  -> 删除（支付宝在 app.json 的 window.pullRefresh 统一开启）
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pagesDir = path.join(root, 'pages');

function walk(dir) {
  const res = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) res.push(...walk(p));
    else if (entry.name.endsWith('.json')) res.push(p);
  }
  return res;
}

let changed = 0;
for (const file of walk(pagesDir)) {
  const src = fs.readFileSync(file, 'utf8');
  let obj;
  try {
    obj = JSON.parse(src);
  } catch (e) {
    console.error('skip (invalid json):', file);
    continue;
  }
  const next = {};
  if (obj.defaultTitle) next.defaultTitle = obj.defaultTitle;
  else if (obj.navigationBarTitleText) next.defaultTitle = obj.navigationBarTitleText;
  if (obj.usingComponents) next.usingComponents = obj.usingComponents;
  const out = JSON.stringify(next, null, 2) + '\n';
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    changed++;
    console.log('converted:', path.relative(root, file));
  }
}
console.log(`done: ${changed} file(s) changed`);
