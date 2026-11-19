/**
 * 支付宝 ACSS 限制：一个选择器里只能出现一个 class（`.a.b` 会被拒绝）。
 *
 * 做法：把组合 class 拆成独立语义类名，
 *   CSS:  .tag.brand  ->  .tag-brand
 *   AXML: class="tag brand" -> class="tag tag-brand"
 *
 * 映射表由 CSS_RULES 显式声明，避免误伤。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 基础类 -> 变体类
const VARIANTS = {
  'sub-tab': { on: 'sub-tab-on' },
  'idx-pct': { up: 'idx-pct-up', down: 'idx-pct-down' },
  'tag': { brand: 'tag-brand', warn: 'tag-warn' },
  'btn': { primary: 'btn-primary', danger: 'btn-danger', small: 'btn-small' },
  'ov-value': { big: 'ov-value-big' },
  'group-tab': { on: 'group-tab-on' },
  'move-pick': { on: 'move-pick-on' },
  'watch-star': { on: 'watch-star-on' },
};

function walk(dir, filter, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter.test(e.name)) out.push(p);
  }
  return out;
}

// ---------- 1. ACSS: .base.variant -> .base-variant ----------
let cssChanged = 0;
for (const file of walk(root, /\.acss$/i)) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  for (const [base, variants] of Object.entries(VARIANTS)) {
    for (const [variant, newName] of Object.entries(variants)) {
      const re = new RegExp(`\\.${base}\\.${variant}(?![\\w-])`, 'g');
      if (re.test(out)) {
        out = out.replace(re, `.${newName}`);
        cssChanged++;
      }
    }
  }
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    console.log('CSS:', path.relative(root, file));
  }
}
console.log(`acss: ${cssChanged} 条规则已拆分`);

// ---------- 2. AXML: class="base variant" -> class="base base-variant" ----------
let axmlChanged = 0;
for (const file of walk(root, /\.axml$/i)) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  // 只处理静态 class="..." 属性（不含 {{}} 插值）
  out = out.replace(/class="([^"{}]*)"/g, (m, cls) => {
    const parts = cls.trim().split(/\s+/).filter(Boolean);
    const next = [];
    for (const p of parts) {
      next.push(p);
      for (const [base, variants] of Object.entries(VARIANTS)) {
        if (variants[p] && parts.includes(base)) {
          next.push(variants[p]);
        }
      }
    }
    const merged = [...new Set(next)];
    return merged.length === parts.length ? m : `class="${merged.join(' ')}"`;
  });
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    axmlChanged++;
    console.log('AXML:', path.relative(root, file));
  }
}
console.log(`axml: ${axmlChanged} 个文件已更新`);
