/**
 * 本地数据库层（对齐 DSH 插件 dsh-plugin-fund-tracker 的 SQLite 表结构）。
 *
 * 支付宝小程序没有 SQLite，这里用 my.setStorageSync 模拟「表」：
 *   fund_base     基金基础库 { code, name, pinyin, type, kind, onSale }
 *   index_base    指数基础库 { code, name, secid, category }
 *   etf_base      ETF 基础库 { code, name, secid, theme }
 *   fund_nav      净值缓存 { code: { date, nav, prevNav, pct } }
 *   user_settings 设置项 { key: value }
 *   meta          元信息（库更新时间等）
 *
 * 所有数据仅存本机，不上传服务器。
 */

import { INDEX_LIBRARY, ETF_LIBRARY } from './constants.js';

const DB_KEY = 'ft.db';

// --- 表定义（与 SQLite 版本同构） -------------------------------------------

const TABLES = {
  fund_base: { code: '', name: '', pinyin: '', type: '', kind: 'fund', onSale: 1 },
  index_base: { code: '', name: '', secid: '', category: '' },
  etf_base: { code: '', name: '', secid: '', theme: '' },
  fund_nav: {},
  user_settings: {},
  meta: {},
};

function emptyDb() {
  return {
    fund_base: {},
    index_base: {},
    etf_base: {},
    fund_nav: {},
    user_settings: {},
    meta: {},
  };
}

// --- 读写 -------------------------------------------------------------------

function load() {
  let raw = '';
  try { raw = my.getStorageSync(DB_KEY); } catch (e) { raw = ''; }
  if (!raw) return emptyDb();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const db = emptyDb();
    for (const t of Object.keys(TABLES)) {
      if (parsed && parsed[t] && typeof parsed[t] === 'object') db[t] = parsed[t];
    }
    return db;
  } catch (e) {
    return emptyDb();
  }
}

let cache = null;
let dirty = false;

function db() {
  if (!cache) cache = load();
  return cache;
}

export function saveDb() {
  if (!cache) return;
  try {
    my.setStorageSync(DB_KEY, JSON.stringify(cache));
    dirty = false;
  } catch (e) {
    console.error('[db] save failed', e);
  }
}

function touch() { dirty = true; }

// --- 初始化（首次启动播种基础库） -------------------------------------------

export function initDb() {
  const d = db();
  let changed = false;

  // 指数库
  if (!d.index_base || Object.keys(d.index_base).length === 0) {
    d.index_base = {};
    for (const [secid, code, name, category] of INDEX_LIBRARY) {
      d.index_base[code] = { code, name, secid, category };
    }
    changed = true;
  }
  // ETF 库
  if (!d.etf_base || Object.keys(d.etf_base).length === 0) {
    d.etf_base = {};
    for (const [secid, code, name, theme] of ETF_LIBRARY) {
      d.etf_base[code] = { code, name, secid, theme };
    }
    changed = true;
  }
  if (changed) saveDb();
  return d;
}

// --- fund_base：基金基础库 ---------------------------------------------------

/** 写入/更新一条基金基础信息 */
export function upsertFundBase(item) {
  if (!item || !item.code) return false;
  const d = db();
  const prev = d.fund_base[item.code] || {};
  d.fund_base[item.code] = {
    code: item.code,
    name: item.name || prev.name || '',
    pinyin: item.pinyin != null ? item.pinyin : (prev.pinyin || ''),
    type: item.type != null ? item.type : (prev.type || ''),
    kind: item.kind || prev.kind || 'fund',
    onSale: item.onSale != null ? (item.onSale ? 1 : 0) : (prev.onSale != null ? prev.onSale : 1),
  };
  touch();
  saveDb();
  return true;
}

/** 批量写入 */
export function upsertFundBaseBatch(list) {
  const d = db();
  let n = 0;
  for (const item of list || []) {
    if (!item || !item.code) continue;
    upsertFundBase(item);
    n++;
  }
  return n;
}

export function getFundBase(code) {
  return db().fund_base[code] || null;
}

/** 基金库分页查询 */
export function fundBasePage({ page = 1, size = 20, query = '', type = '', status = 'onsale' } = {}) {
  const d = db();
  const q = String(query || '').trim().toUpperCase();
  let rows = Object.keys(d.fund_base).map(k => d.fund_base[k]);
  if (status !== 'all') rows = rows.filter(r => r.onSale);
  if (type) rows = rows.filter(r => (r.type || '') === type);
  if (q) {
    rows = rows.filter(r =>
      String(r.code).toUpperCase().indexOf(q) >= 0 ||
      String(r.name || '').toUpperCase().indexOf(q) >= 0 ||
      String(r.pinyin || '').toUpperCase().indexOf(q) >= 0
    );
  }
  rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const total = rows.length;
  const p = Math.max(1, page);
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total, page: p, pages: Math.max(1, Math.ceil(total / size)) };
}

/** 基金类型统计 */
export function fundBaseTypes() {
  const d = db();
  const map = {};
  for (const k of Object.keys(d.fund_base)) {
    const r = d.fund_base[k];
    if (!r.onSale) continue;
    const t = r.type || '';
    if (!t) continue;
    map[t] = (map[t] || 0) + 1;
  }
  return Object.keys(map)
    .map(type => ({ type, count: map[type] }))
    .sort((a, b) => b.count - a.count);
}

/** 库统计 */
export function libInfo() {
  const d = db();
  const fundCount = Object.keys(d.fund_base).length;
  const etfCount = Object.keys(d.etf_base).length;
  const indexCount = Object.keys(d.index_base).length;
  const navCount = Object.keys(d.fund_nav).length;
  const refreshedAt = d.meta.libRefreshedAt || 0;
  return { fundCount, etfCount, indexCount, navCount, refreshedAt };
}

export function markLibRefreshed(at) {
  const d = db();
  d.meta.libRefreshedAt = at || Date.now();
  touch();
  saveDb();
}

// --- fund_nav：净值缓存 ------------------------------------------------------

export function putNavDb(code, nav) {
  if (!code || !nav) return;
  const d = db();
  d.fund_nav[code] = nav;
  touch();
  saveDb();
}

export function getNavDb(code) {
  return db().fund_nav[code] || null;
}

export function navDbAll() {
  return db().fund_nav;
}

/** 只保留最近 N 个基金的净值缓存，控制包体/存储占用 */
export function pruneNavs(keep = 300) {
  const d = db();
  const keys = Object.keys(d.fund_nav);
  if (keys.length <= keep) return 0;
  // 按更新时间排序，保留最近的
  const withTime = keys.map(k => ({ k, t: d.fund_nav[k].updatedAt || 0 }));
  withTime.sort((a, b) => b.t - a.t);
  const drop = withTime.slice(keep);
  for (const item of drop) delete d.fund_nav[item.k];
  touch();
  saveDb();
  return drop.length;
}

// --- user_settings：设置项 ---------------------------------------------------

export function getSetting(key, fallback = null) {
  const v = db().user_settings[key];
  return v === undefined || v === null ? fallback : v;
}

export function setSetting(key, value) {
  const d = db();
  d.user_settings[key] = value;
  touch();
  saveDb();
}

// --- meta --------------------------------------------------------------------

export function getMeta(key, fallback = null) {
  const v = db().meta[key];
  return v === undefined || v === null ? fallback : v;
}

export function setMeta(key, value) {
  const d = db();
  d.meta[key] = value;
  touch();
  saveDb();
}

// --- 导入 / 导出 / 清空 ------------------------------------------------------

export function exportDb() {
  return JSON.stringify(db());
}

/** 从 JSON 字符串导入（返回 {ok, message}） */
export function importDb(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: '不是合法的 JSON' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: '数据格式不正确' };
  }
  const next = emptyDb();
  let imported = 0;
  for (const t of Object.keys(TABLES)) {
    if (parsed[t] && typeof parsed[t] === 'object') {
      next[t] = parsed[t];
      imported++;
    }
  }
  if (!imported) return { ok: false, message: '未找到可导入的数据表' };
  cache = next;
  saveDb();
  return { ok: true, message: `已导入 ${imported} 张表` };
}

/** 清空全部本地数据 */
export function clearAll() {
  cache = emptyDb();
  saveDb();
  initDb();
  return true;
}

/** 仅清空基金基础库（保留持仓、自选与设置） */
export function clearFundBase() {
  const d = db();
  d.fund_base = {};
  touch();
  saveDb();
  return true;
}
