/**
 * 支付宝 ACSS 只支持「单一 class 选择器」，任何组合形式都会报
 *   should only be one class selector
 *
 * 这里把后代选择器 `.a .b` 拆成独立类 `.a-b`，
 * 并同步更新 AXML 里对应元素的 class。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 后代选择器 -> 独立类名（显式声明，避免误伤）
const SPLITS = [
  { css: '.list-row .name', newClass: 'list-row-name' },
  { css: '.list-row .sub', newClass: 'list-row-sub' },
  { css: '.list-row .right', newClass: 'list-row-right' },
  { css: '.hold-stat b', newClass: 'hold-stat-value' },
];

function walk(dir, filter, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter.test(e.name)) out.push(p);
  }
  return out;
}

// ---------- CSS ----------
for (const file of walk(root, /\.acss$/i)) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  for (const s of SPLITS) {
    out = out.replace(new RegExp(s.css.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'g'), '.' + s.newClass);
  }
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    console.log('CSS:', path.relative(root, file));
  }
}

// ---------- AXML ----------
// 元素上已有 class="a"，其后代 class="b" -> 额外加 "a-b"
for (const file of walk(root, /\.axml$/i)) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;

  for (const s of SPLITS) {
    const parts = s.css.split(/\s+/);       // ['.list-row', '.name']
    const parent = parts[0].slice(1);
    const child = parts[1].slice(1);
    const newClass = s.newClass;

    // 找到 class="parent" 的元素，向其内部、class="child" 的元素追加 newClass
    const re = new RegExp(
      `(<view\\b[^>]*class="[^"]*\\b${parent}\\b[^"]*"[^>]*>)([\\s\\S]*?)(</view>)`,
      'g'
    );
    out = out.replace(re, (m, open, inner, close) => {
      const inner2 = inner.replace(
        new RegExp(`(<view\\b[^>]*class="[^"]*\\b${child}\\b[^"]*)(")`, 'g'),
        `$1 ${newClass}$2`
      );
      return open + inner2 + close;
    });
  }
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    console.log('AXML:', path.relative(root, file));
  }
}
console.log('done');
