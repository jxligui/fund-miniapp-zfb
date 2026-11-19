/**
 * 微信/支付宝 AXML 文本规则转换：
 *   支付宝要求「非空文本内容必须在 <text> 组件内」（button 除外），
 *   而微信允许 <view>文本</view>。
 *
 * 做法：把 <view ...>纯文本</view> 改成 <view ...><text>纯文本</text></view>。
 * 已是 <text> 的不动；含插值 {{...}} 的也一并包进 text（支付宝同样要求）。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 匹配 <view ...> ... </view>，要求内部没有子标签、只有文本与插值
const VIEW_TEXT = /<view\b([^>]*)>([^<>]*(?:\{\{[^<>]*\}\}[^<>]*)*)<\/view>/g;

function convertAxml(src) {
  let count = 0;
  const out = src.replace(VIEW_TEXT, (m, attrs, body) => {
    const text = body.trim();
    if (!text) return m;                 // 空 view 不动
    if (/<text[\s>]/i.test(text)) return m; // 内含 text 标签，不动
    count++;
    return `<view${attrs}><text>${body}</text></view>`;
  });
  return { out, count };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.axml')) out.push(p);
  }
  return out;
}

let total = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const { out, count } = convertAxml(src);
  if (count) {
    fs.writeFileSync(file, out, 'utf8');
    total += count;
    console.log(`${path.relative(root, file)}: ${count} 处文本已包入 <text>`);
  }
}
console.log(`done: ${total} 处`);
