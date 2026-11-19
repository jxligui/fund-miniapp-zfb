/** 通用格式化与小工具。 */

export function money(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v) {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function signedMoney(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs}`;
}

/** 成交额：亿 / 万 */
export function compactAmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return String(Math.round(v));
}

/** 涨跌配色：涨红跌绿（A股习惯，深色主题高对比版本） */
export function signColor(v) {
  if (v == null || !isFinite(v) || v === 0) return '#94a3b8';
  return v > 0 ? '#ef4444' : '#22c55e';
}

/** 「基金代码 金额」批量导入解析 */
export function parseBatch(text) {
  const found = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    // 只去掉首尾空白字符，保留 Tab 作为「代码 + 金额」的分隔符
    const trimmed = line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = /(?:^|[^\d])(\d{6})(?=[^\d]|$)/.exec(trimmed);
    if (!m) continue;
    const code = m[1];
    const rest = trimmed.slice(m.index + m[0].length);
    // 金额：允许 ¥ 与千分位，但不能以逗号开头（否则分隔用的逗号会被当成金额）
    const am = /(?:[¥￥]\s*)?(\d[\d,]*\.?\d*)/.exec(rest);
    const amount = am ? Number(am[1].replace(/,/g, '')) : null;
    if (amount == null || !isFinite(amount) || amount <= 0) continue;
    const prev = found.get(code);
    found.set(code, { code, amount: prev ? prev.amount + amount : amount });
  }
  return [...found.values()];
}

/** 轻提示 */
export function toast(title, icon = 'none') {
  my.showToast({ title: String(title).slice(0, 30), icon, duration: 1800 });
}

/** 确认弹窗 */
export function confirm(content, title = '提示') {
  return new Promise(resolve => {
    my.showModal({
      title, content,
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
}

/** 简单防抖 */
export function debounce(fn, wait = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
