/**
 * 微信 WXML -> 支付宝 AXML 语法转换。
 *
 * 微信 -> 支付宝 对照：
 *   wx:if / wx:elif / wx:else  ->  a:if / a:elif / a:else
 *   wx:for / wx:for-item / wx:for-index / wx:key  ->  a:for / a:for-item / a:for-index / a:key
 *   bindtap / bindinput / bindfocus / bindblur / bindchange ...
 *                              ->  onTap / onInput / onFocus / onBlur / onChange ...
 *   catchtap / catchinput ...  ->  catchTap / catchInput ...
 *   bind:tap                   ->  onTap
 */
const fs = require('fs');
const path = require('path');

// 事件名映射：微信 kebab-case -> 支付宝 PascalCase
const EVENT_MAP = {
  tap: 'Tap',
  input: 'Input',
  focus: 'Focus',
  blur: 'Blur',
  change: 'Change',
  submit: 'Submit',
  confirm: 'Confirm',
  longpress: 'LongTap',
  longtap: 'LongTap',
  touchstart: 'TouchStart',
  touchend: 'TouchEnd',
  touchmove: 'TouchMove',
  touchcancel: 'TouchCancel',
  scroll: 'Scroll',
  scrolltolower: 'ScrollToLower',
  scrolltoupper: 'ScrollToUpper',
  scrolltolowerthresholds: 'ScrollToLowerThreshold',
  keydown: 'KeyDown',
  keyup: 'KeyUp',
  load: 'Load',
  error: 'Error',
  animationstart: 'AnimationStart',
  animationiteration: 'AnimationIteration',
  animationend: 'AnimationEnd',
  transitionend: 'TransitionEnd',
  appear: 'Appear',
  disappear: 'Disappear',
  columnchange: 'ColumnChange',
  columnlayout: 'ColumnLayout',
  select: 'Select',
  reset: 'Reset',
  linechange: 'LineChange',
  check: 'Check',
};

function toEventName(raw) {
  // 已是 PascalCase，保持
  if (/^[A-Z]/.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (EVENT_MAP[key]) return EVENT_MAP[key];
  // 兜底：kebab-case -> PascalCase
  return raw.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function convert(src) {
  let out = src;

  // 1) 微信指令前缀 wx: -> 支付宝 a:
  out = out.replace(/\bwx:(if|elif|else|for|for-item|for-index|key)\b/g, 'a:$1');

  // 2) 事件属性：catchXxx / bindXxx / bind:xxx -> catchXxx / onXxx
  out = out.replace(/\bcatch:([a-zA-Z-]+)/g, (_, ev) => 'catch' + toEventName(ev));
  out = out.replace(/\bcatch([a-zA-Z]+)\b(?==)/g, (_, ev) => 'catch' + toEventName(ev));
  out = out.replace(/\bbind:([a-zA-Z-]+)/g, (_, ev) => 'on' + toEventName(ev));
  out = out.replace(/\bbind([a-zA-Z]+)\b(?==)/g, (_, ev) => 'on' + toEventName(ev));

  // 3) 兜底：残留的 wx. API 调用（模板里少见）
  out = out.replace(/\bwx\./g, 'my.');

  return out;
}

function walk(dir) {
  const res = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) res.push(...walk(p));
    else if (entry.name.endsWith('.axml')) res.push(p);
  }
  return res;
}

const root = path.resolve(__dirname, '..');
let changed = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = convert(src);
  if (out !== src) {
    fs.writeFileSync(file, out, 'utf8');
    changed++;
    console.log('converted:', path.relative(root, file));
  }
}
console.log(`done: ${changed} file(s) changed`);
