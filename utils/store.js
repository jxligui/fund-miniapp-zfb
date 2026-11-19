/**
 * 本地数据层：全部数据保存在手机本地（my.setStorageSync），不上传服务器。
 *
 * 存储键：
 *   ft.holdings   持仓 + 自选 + 分组（数组）
 *   ft.navs       每日净值缓存 { code: { date, nav, prevNav, pct } }
 *   ft.groups     自定义分组名数组
 *   ft.indices    关注的指数代码数组
 *   ft.pin        本地 PIN 码（哈希）
 */

const K = {
  holdings: 'ft.holdings',
  navs: 'ft.navs',
  groups: 'ft.groups',
  indices: 'ft.indices',
  pin: 'ft.pin',
};

function read(key, fallback) {
  try {
    const v = my.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return fallback;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) {
    return fallback;
  }
}

/** Read a raw (non-JSON) string value, e.g. the PIN hash. */
function readRaw(key, fallback = null) {
  try {
    const v = my.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return fallback;
    return String(v);
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    my.setStorageSync(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (e) {
    console.error('[storage] write failed', key, e);
  }
}

// --- PIN lock ---------------------------------------------------------------

export function hasPin() {
  return !!readRaw(K.pin, null);
}

export function setPin(pin) {
  write(K.pin, hash(pin));
}

export function verifyPin(pin) {
  const stored = readRaw(K.pin, null);
  if (!stored) return true;
  return stored === hash(pin);
}

export function clearPin() {
  try { my.removeStorageSync(K.pin); } catch (e) {}
}

function hash(text) {
  // 轻量哈希：足够用于本地 PIN 校验（非加密存储，仅避免明文）
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}-${text.length}`;
}

// --- holdings / watch / groups ---------------------------------------------

export function listHoldings() {
  return read(K.holdings, []) || [];
}

export function saveHoldings(list) {
  write(K.holdings, list || []);
}

/** Upsert a holding. Fields: code, name, shares, cost, watch, groupName, pendingAmount */
export function upsertHolding(item) {
  const list = listHoldings();
  const idx = list.findIndex(x => x.code === item.code);
  const prev = idx >= 0 ? list[idx] : {};
  const merged = {
    code: item.code,
    name: item.name || prev.name || '',
    shares: item.shares === undefined ? (prev.shares ?? null) : item.shares,
    cost: item.cost === undefined ? (prev.cost ?? null) : item.cost,
    watch: item.watch === undefined ? (prev.watch ?? false) : !!item.watch,
    groupName: item.groupName === undefined ? (prev.groupName ?? null) : item.groupName,
    pendingAmount: item.pendingAmount === undefined ? (prev.pendingAmount ?? null) : item.pendingAmount,
    updatedAt: Date.now(),
  };
  if (idx >= 0) list[idx] = merged; else list.unshift(merged);
  saveHoldings(list);
  return merged;
}

export function removeHolding(code) {
  saveHoldings(listHoldings().filter(x => x.code !== code));
}

export function setWatch(code, on) {
  const list = listHoldings();
  const item = list.find(x => x.code === code);
  if (!item) return null;
  item.watch = !!on;
  item.updatedAt = Date.now();
  saveHoldings(list);
  return item;
}

export function listGroups() {
  return read(K.groups, []) || [];
}

export function addGroup(name) {
  const groups = listGroups();
  if (!name || groups.includes(name)) return groups;
  groups.push(name);
  write(K.groups, groups);
  return groups;
}

export function renameGroup(oldName, newName) {
  const groups = listGroups().map(g => (g === oldName ? newName : g));
  write(K.groups, groups);
  const list = listHoldings().map(h => (h.groupName === oldName ? { ...h, groupName: newName } : h));
  saveHoldings(list);
  return groups;
}

export function deleteGroup(name) {
  write(K.groups, listGroups().filter(g => g !== name));
  saveHoldings(listHoldings().map(h => (h.groupName === name ? { ...h, groupName: null } : h)));
}

export function moveToGroup(code, groupName) {
  const list = listHoldings();
  const item = list.find(x => x.code === code);
  if (!item) return null;
  item.groupName = groupName || null;
  item.updatedAt = Date.now();
  saveHoldings(list);
  return item;
}

export function moveBatchToGroup(codes, groupName) {
  const set = new Set(codes || []);
  const list = listHoldings().map(h => (set.has(h.code) ? { ...h, groupName: groupName || null } : h));
  saveHoldings(list);
  return list.filter(h => set.has(h.code)).length;
}

// --- watchlist of indices ---------------------------------------------------

export function listWatchedIndices() {
  return read(K.indices, []) || [];
}

export function setWatchedIndices(codes) {
  write(K.indices, codes || []);
  return codes;
}

// --- NAV cache --------------------------------------------------------------

function listNavs() {
  return read(K.navs, {}) || {};
}

function saveNavs(navs) {
  write(K.navs, navs || {});
}

export function putNav(code, nav) {
  const navs = listNavs();
  navs[code] = nav;
  // 控制体积：最多保留 300 只基金的最新净值
  const keys = Object.keys(navs);
  if (keys.length > 300) {
    keys.slice(0, keys.length - 300).forEach(k => delete navs[k]);
  }
  saveNavs(navs);
}

export function navOf(code) {
  const navs = listNavs();
  return navs[code] || null;
}

// --- portfolio computation --------------------------------------------------

/**
 * 持仓资产计算：持仓金额 = 份额 × 净值 + 待确认买入金额。
 * nav 优先用缓存净值，其次用行情接口传入的 quotes。
 */
export function buildPortfolio(holdings, quotes) {
  const rows = holdings.map(h => {
    const q = quotes && quotes[h.code] ? quotes[h.code] : null;
    const cached = navOf(h.code);
    const nav = q && q.nav != null ? q.nav : (cached ? cached.nav : null);
    const prevNav = q && q.prevNav != null ? q.prevNav : (cached ? cached.prevNav : null);
    const changePct = q && q.pct != null ? q.pct : (cached ? cached.pct : null);
    // 净值日以实时行情为准，无行情时用本地缓存的净值日。
    const navDate = q && q.date ? q.date : (cached ? cached.date : null);
    const hasToday = !!(navDate && isToday(navDate));
    const usingYesterday = !hasToday && prevNav != null && prevNav > 0;
    const calcNav = usingYesterday ? prevNav : nav;
    const base = h.shares != null && calcNav != null ? h.shares * calcNav : null;
    const pendingBuy = h.pendingAmount != null && h.pendingAmount > 0 ? h.pendingAmount : 0;
    const amount = base != null || pendingBuy > 0 ? round2((base || 0) + pendingBuy) : null;
    const todayProfit = amount != null && changePct != null && hasToday
      ? round2(amount * changePct / (100 + changePct)) : null;
    const totalProfit = calcNav != null && h.cost != null && h.shares != null
      ? round2((calcNav - h.cost) * h.shares) : null;
    const totalPct = calcNav != null && h.cost ? (calcNav / h.cost - 1) * 100 : null;
    return {
      ...h, name: (q && q.name) || h.name || h.code,
      nav: calcNav, prevNav, changePct, usingYesterday,
      amount, todayProfit, totalProfit, totalPct,
      pending: pendingBuy > 0 ? pendingBuy : null,
    };
  });
  const totals = {
    amount: round2(rows.reduce((s, r) => s + (r.amount || 0), 0)),
    today: round2(rows.reduce((s, r) => s + (r.todayProfit || 0), 0)),
    profit: round2(rows.reduce((s, r) => s + (r.totalProfit || 0), 0)),
  };
  const base = rows.reduce((s, r) => s + (r.cost > 0 && r.shares != null ? r.cost * r.shares : 0), 0);
  totals.pct = base ? totals.profit / base * 100 : null;
  return { rows, totals };
}

export function isToday(dateStr) {
  if (!dateStr) return true;
  const p = String(dateStr).split('-').map(Number);
  if (p.length < 3 || !isFinite(p[0])) return true;
  const d = new Date();
  return p[0] === d.getFullYear() && p[1] === d.getMonth() + 1 && p[2] === d.getDate();
}

/** 金额保留 2 位小数（避免 110.00000000000001 这类浮点误差）。 */
function round2(v) {
  if (v == null || !isFinite(v)) return v;
  return Math.round(v * 100) / 100;
}
