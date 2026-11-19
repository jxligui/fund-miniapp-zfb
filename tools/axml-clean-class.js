/**
 * 清理 AXML 里遗留的旧 class 名。
 *
 * 转换脚本把 `.a.b` 拆成 `.a-b` 时，为兼容旧样式同时保留了 `a` 与 `a-b`，
 * 导致元素上出现 `class="btn small btn-small"` 这类冗余。
 * 这里只保留新的语义类名（带连字符的变体），删除被替代的旧变体名。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 旧变体名 -> 新语义类名（与之共存时删除旧名）
const REPLACED = {
  small: 'btn-small',
  primary: 'btn-primary',
  danger: 'btn-danger',
  brand: 'tag-brand',
  warn: 'tag-warn',
  up: 'idx-pct-up',
  down: 'idx-pct-down',
  on: null,          // 视上下文：sub-tab-on / group-tab-on / move-pick-on / watch-star-on
};

// 只有当同一元素上存在对应的新类名时才删除旧名
const PAIRS = {
  'btn-small': 'small',
  'btn-primary': 'primary',
  'btn-danger': 'danger',
  'tag-brand': 'brand',
  'tag-warn': 'warn',
  'idx-pct-up': 'up',
  'idx-pct-down': 'down',
  'sub-tab-on': 'on',
  'group-tab-on': 'on',
  'move-pick-on': 'on',
  'watch-star-on': 'on',
  'ov-value-big': 'big',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.axml')) out.push(p);
  }
  return out;
}

let total = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/class="([^"]*)"/g, (m, cls) => {
    const parts = cls.trim().split(/\s+/).filter(Boolean);
    const kept = parts.filter(p => {
      // 若存在 "新类名 旧类名" 的组合，则删掉旧类名
      for (const [newName, oldName] of Object.entries(PAIRS)) {
        if (p === oldName && parts.indexOf(newName) >= 0) return false;
      }
      return true;
    });
    const uniq = [...new Set(kept)];
    if (uniq.length !== parts.length) {
      total += parts.length - uniq.length;
    }
    return `class="${uniq.join(' ')}"`;
  });
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    console.log('updated:', path.relative(root, file));
  }
}
console.log(`done: 移除 ${total} 个冗余 class`);
