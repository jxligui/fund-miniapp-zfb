/**
 * 本地数据库层。
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

// --- 表定义（与 SQLite 版本同构） -------------------------------------------

const TABLES = {
  fund_base: {},
  index_base: {},
  etf_base: {},
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
//
// 分键存储：支付宝 my.setStorageSync 单键上限约 200KB（官方文档），2 万只基金库 + 净值
// 塞一个键必然静默失败。改为每张表一个键，大表（净值）再分片：
//   ft.db.fund_base   基金库（2 万条约 1.5MB —— 也超限，按代码首两位分片）
//   ft.db.fund_nav.s0 分片 0（代码首两位 00-19）
//   ft.db.fund_nav.s2 分片 2（代码首两位 20-39）...
//   ft.db.index_base / ft.db.etf_base / ft.db.user_settings / ft.db.meta
// 兼容：旧版单键 ft.db 若存在，首次 load 时迁移到分键。

const DB_PREFIX = 'ft.db.';
const NAV_SHARD_SIZE = 20; // 净值分片：按代码前两位数字分组，每组一个键

const TABLE_KEYS = {  fund_base: DB_PREFIX + 'fund_base',
  index_base: DB_PREFIX + 'index_base',
  etf_base: DB_PREFIX + 'etf_base',
  user_settings: DB_PREFIX + 'user_settings',
  meta: DB_PREFIX + 'meta',
};

/** 从 Storage 读值并拆包：
 * 支付宝 my.getStorageSync 的签名是对象入参 { key }、返回对象 { data }，
 * 不是微信式的 getStorageSync(key) -> 裸值。这里统一拆包，兼容裸值兜底。 */
function normalizeRead(res) {
  if (res && typeof res === 'object' && ('data' in res)) return res.data;
  return res;
}

/** 读一个键（自动拆 {data, success} 包装）。 */
function storageGet(key) {
  try {
    const v = normalizeRead(my.getStorageSync({ key }));
    return v === '' || v === null || v === undefined ? '' : v;
  } catch (e) {
    console.error('[db] get failed:', key, e && e.message ? e.message : e);
    return '';
  }
}

/** 写一个键并做写后读校验。 */
function storageSet(key, value) {
  try {
    my.setStorageSync({ key, data: value });
    let back = normalizeRead(my.getStorageSync({ key }));
    if (back === '' || back === null || back === undefined) {
      console.error('[db] 写后读为空，重试:', key);
      my.setStorageSync({ key, data: value });
      back = normalizeRead(my.getStorageSync({ key }));
      if (back === '' || back === null || back === undefined) {
        console.error('[db] 重试后仍为空（模拟器 Storage 未落盘）:', key);
        return false;
      }
    }
    return true;
  } catch (e) {
    // 单键超限等真实失败必须暴露 —— 此前静默吞掉导致"数据没保存"
    console.error('[db] SAVE FAILED:', key, '大小约', Math.round(JSON.stringify(value).length / 1024), 'KB', e && e.message ? e.message : e);
    return false;
  }
}

/** 删除一个键。支付宝 API 同样是对象入参 { key }。 */
function storageRemove(key) {
  try { my.removeStorageSync({ key }); } catch (e) {}
}

/** 旧版单键数据迁移到分键 */
function migrateLegacy() {
  const raw = storageGet('ft.db');
  if (!raw) return false;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return false;
    let migrated = false;
    for (const t of Object.keys(TABLE_KEYS)) {
      if (parsed[t] && typeof parsed[t] === 'object') {
        storageSet(TABLE_KEYS[t], JSON.stringify(parsed[t]));
        migrated = true;
      }
    }
    if (parsed.fund_nav && typeof parsed.fund_nav === 'object') {
      writeNavShards(parsed.fund_nav);
      migrated = true;
    }
    if (migrated) {
      try { storageRemove('ft.db'); } catch (e) {}
      console.log('[db] 已从旧版单键迁移到分键存储');
    }
    return migrated;
  } catch (e) {
    return false;
  }
}

/** 分片索引键：记录当前实际存在的分片编号，读盘只读 1 键 + N 分片（不再盲枚举 81 次） */
const IDX_KEY = DB_PREFIX + 'index';

function readShardIndex() {
  const raw = storageGet(IDX_KEY);
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {}
  return null;
}

function writeShardIndex(idx) {
  storageSet(IDX_KEY, JSON.stringify(idx));
}

/** 清理上一代布局的残留分片（按前缀分组的旧键） */
function cleanLegacyShards() {
  for (let g = 0; g < 100; g++) {
    const k = DB_PREFIX + 'fund_base.' + String(g).padStart(2, '0');
    if (storageGet(k)) { try { storageRemove(k); } catch (e) {} }
  }
  const xk = DB_PREFIX + 'fund_base.x';
  if (storageGet(xk)) { try { storageRemove(xk); } catch (e) {} }
}

/** 索引里的分片数：写盘格式是数字，兼容旧版数组格式 */
function shardCountOf(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number' && isFinite(v) && v > 0) return Math.floor(v);
  return 0;
}

/** 净值表分片写盘：按数量切（每片 ≤500 条，防单键超 200KB） */
function writeNavShards(fundNav) {
  const codes = Object.keys(fundNav);
  const PER = 500;
  const shardCount = Math.max(1, Math.ceil(codes.length / PER));
  let ok = true;
  const prev = readShardIndex();
  const prevNavCount = prev ? shardCountOf(prev.navShards) : 0;
  for (let g = 0; g < shardCount; g++) {
    const shard = {};
    for (const code of codes.slice(g * PER, (g + 1) * PER)) {
      shard[code] = fundNav[code];
    }
    if (!storageSet(DB_PREFIX + 'fund_nav.s' + g, JSON.stringify(shard))) ok = false;
  }
  // 数据变少时清掉多余的历史分片
  for (let g = shardCount; g < prevNavCount; g++) {
    try { storageRemove(DB_PREFIX + 'fund_nav.s' + g); } catch (e) {}
  }
  cleanLegacyShards();
  return ok;
}

/** 净值表分片读盘 */
function readNavShards(idx) {
  const out = {};
  const count = idx ? shardCountOf(idx.navShards) : 0;
  for (let g = 0; g < count; g++) {
    const raw = storageGet(DB_PREFIX + 'fund_nav.s' + g);
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') continue;   // 防 null/非对象分片
      for (const code of Object.keys(parsed)) {
        if (parsed[code] && typeof parsed[code] === 'object') out[code] = parsed[code];
      }
    } catch (e) { /* 跳过坏分片 */ }
  }
  return out;
}

/** 基金库分片写盘：按数量切（每片 ≤400 条，防单键超 200KB） */
function writeFundBaseShards(fundBase) {
  const codes = Object.keys(fundBase);
  const PER = 400;
  const shardCount = Math.max(1, Math.ceil(codes.length / PER));
  let ok = true;
  const prev = readShardIndex();
  const prevBaseCount = prev ? shardCountOf(prev.baseShards) : 0;
  for (let g = 0; g < shardCount; g++) {
    const shard = {};
    for (const code of codes.slice(g * PER, (g + 1) * PER)) {
      shard[code] = fundBase[code];
    }
    if (!storageSet(DB_PREFIX + 'fund_base.p' + g, JSON.stringify(shard))) ok = false;
  }
  for (let g = shardCount; g < prevBaseCount; g++) {
    try { storageRemove(DB_PREFIX + 'fund_base.p' + g); } catch (e) {}
  }
  return ok;
}

/** 基金库分片读盘 */
function readFundBaseShards(idx) {
  const out = {};
  const count = idx ? shardCountOf(idx.baseShards) : 0;
  for (let g = 0; g < count; g++) {
    const raw = storageGet(DB_PREFIX + 'fund_base.p' + g);
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') continue;   // 防 null/非对象分片
      for (const code of Object.keys(parsed)) {
        if (parsed[code] && typeof parsed[code] === 'object') out[code] = parsed[code];  // 只收有效行
      }
    } catch (e) { /* 跳过坏分片 */ }
  }
  return out;
}

/** 同步后写分片索引（在 saveDb 末尾调用） */
function writeShardIndexFromCounts() {
  if (!cache) return;
  writeShardIndex({
    baseShards: Math.max(1, Math.ceil(Object.keys(cache.fund_base || {}).length / 400)),
    navShards: Math.max(1, Math.ceil(Object.keys(cache.fund_nav || {}).length / 500)),
    baseCount: Object.keys(cache.fund_base || {}).length,   // 读盘自检用
    navCount: Object.keys(cache.fund_nav || {}).length,
    updatedAt: Date.now(),
  });
}

function load() {
  // 先读分片索引（1 个键），再按索引只读实际存在的分片
  const idx = readShardIndex();
  const d = emptyDb();
  for (const t of Object.keys(TABLE_KEYS)) {
    const raw = storageGet(TABLE_KEYS[t]);
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') d[t] = parsed;
    } catch (e) { /* 跳过坏键 */ }
  }
  d.fund_base = readFundBaseShards(idx);
  d.fund_nav = readNavShards(idx);
  // 读盘自检：与索引期望对比。分片全部丢失时（索引在、分片键不在，如模拟器
  // 未把大键落盘/换机丢数据），作废索引并解除 20h 同步节流，让用户能立即
  // 重新「同步全量基金」重建，而不是面对空库还被节流挡 20 小时。
  if (idx && idx.baseCount != null) {
    const got = Object.keys(d.fund_base).length;
    if (got !== idx.baseCount) {
      console.error('[db] 读盘自检失败：索引记录 fund_base 应有', idx.baseCount, '条，实际读到', got, '条；分片数', idx.baseShards);
      if (got === 0 && idx.baseCount > 0) {
        try { my.removeStorageSync({ key: IDX_KEY }); } catch (e) {}
        if (d.meta && d.meta.onsaleSyncedAt) d.meta.onsaleSyncedAt = 0;
        console.error('[db] 分片数据全部丢失：已作废分片索引并解除同步节流，请在设置页重新同步全量基金');
      }
    }
  }
  return d;
}

let cache = null;
let dirty = false;

function db() {
  if (!cache) cache = load();
  return cache;
}

export function saveDb() {
  if (!cache) return;
  let allOk = true;
  for (const t of Object.keys(TABLE_KEYS)) {
    if (t === 'fund_base') continue; // fund_base 走分片
    if (!storageSet(TABLE_KEYS[t], JSON.stringify(cache[t]))) allOk = false;
  }
  if (!writeFundBaseShards(cache.fund_base)) allOk = false;
  if (!writeNavShards(cache.fund_nav)) allOk = false;
  writeShardIndexFromCounts();  // 分片索引最后落盘
  dirty = false;
  return allOk;
}

function touch() { dirty = true; }

// --- 初始化（首次启动播种基础库） -------------------------------------------

export function initDb() {
  const d = db();
  let changed = false;

  // 指数库：数量不足即重建（混入旧分片残留时也会被纠正）
  if (!d.index_base || Object.keys(d.index_base).length < INDEX_LIBRARY.length) {
    d.index_base = {};
    for (const [secid, code, name, category] of INDEX_LIBRARY) {
      d.index_base[code] = { code, name, secid, category };
    }
    changed = true;
  }
  // ETF 库：同上
  if (!d.etf_base || Object.keys(d.etf_base).length < ETF_LIBRARY.length) {
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
      String(r.pinyin || '').indexOf(q) >= 0
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
  let fundCount = 0;
  let onSaleCount = 0;
  for (const k of Object.keys(d.fund_base)) {
    const r = d.fund_base[k];
    if (!r || typeof r !== 'object') continue;   // 防脏数据行
    fundCount++;
    if (r.onSale) onSaleCount++;
  }
  return {
    fundCount,
    onSaleCount,
    etfCount: Object.keys(d.etf_base || {}).length,
    indexCount: Object.keys(d.index_base || {}).length,
    navCount: Object.keys(d.fund_nav || {}).length,
    syncedAt: d.meta.onsaleSyncedAt || 0,
    refreshedAt: d.meta.libRefreshedAt || 0,
    syncedFundCount: d.meta.syncedFundCount || 0,   // 上次全量同步规模（库不完整检测用）
  };
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

/** 清空全部分片键 + 表键（危险操作用）。
 * 必须覆盖三代存储布局的键：分键表、pNN 分片、旧前缀分片、旧净值 sN、单键。 */
function removeAllDbKeys() {
  const keys = Object.keys(TABLE_KEYS).map(t => TABLE_KEYS[t]);
  keys.push(IDX_KEY);
  // 现行：pNN 数量分片
  for (let g = 0; g <= 80; g++) keys.push(DB_PREFIX + 'fund_base.p' + g);
  for (let g = 0; g <= 60; g++) keys.push(DB_PREFIX + 'fund_nav.s' + g);
  // 上一代：按代码前两位（00-99 + x）
  for (let g = 0; g < 100; g++) keys.push(DB_PREFIX + 'fund_base.' + String(g).padStart(2, '0'));
  keys.push(DB_PREFIX + 'fund_base.x');
  for (let g = 0; g <= 5; g++) keys.push(DB_PREFIX + 'fund_nav.s' + g);
  // 最初：单键
  keys.push('ft.db');
  for (const k of keys) {
    try { storageRemove(k); } catch (e) {}
  }
}

/** 清空全部本地数据 */
export function clearAll() {
  cache = emptyDb();
  removeAllDbKeys();
  saveDb();
  initDb();
  return true;
}

/** 仅清空基金基础库（保留持仓、自选与设置）。
 * 同时清掉三代布局的 fund_base/fund_nav 键，防止旧分片混读。 */
export function clearFundBase() {
  const d = db();
  d.fund_base = {};
  d.fund_nav = {};
  // 现行 pNN 分片
  for (let g = 0; g <= 80; g++) {
    try { storageRemove(DB_PREFIX + 'fund_base.p' + g); } catch (e) {}
  }
  // 上一代前缀分片
  for (let g = 0; g < 100; g++) {
    try { storageRemove(DB_PREFIX + 'fund_base.' + String(g).padStart(2, '0')); } catch (e) {}
  }
  try { storageRemove(DB_PREFIX + 'fund_base.x'); } catch (e) {}
  // 旧净值分片（s0-s5 曾被前缀分组用过）
  for (let g = 0; g <= 5; g++) {
    try { storageRemove(DB_PREFIX + 'fund_nav.s' + g); } catch (e) {}
  }
  touch();
  saveDb();
  initDb();  // 指数/ETF 基础库被净值连带清了分片也要重建？不需要 —— 它们是独立键，这里只重建基金库相关
  return true;
}

/**
 * 同步东财在售基金到本地基金库。
 * fetchPage 通常注入 utils/api.js 的 fetchFundPage，便于测试。
 * 每页 200 只、共约 103 页；进度通过 onProgress(page, pages, fundTotal) 上报，
 * fundTotal 是库内实际基金总数（跨续传累计），不是本次会话拉取数。
 *
 * 设计：
 *  - 断点续传：取消 / 网络中断 / 进程被杀后，断点（syncResumePage）随数据一起
 *    落盘，24h 内再次同步从上次页码继续，不从头拉
 *  - 数据完整性节流：20h 内不重复同步，但前提是库内条数达到上次同步规模
 *    （syncedFundCount/syncedNavCount），分片丢失或被清空时立即重建
 *  - 增量预留：完成时记录 syncedAt / pages / 条数，且每行净值带 date ——
 *    后续增量只需比较净值日期跳过未变化页，结构上无需再改
 *  - 每 saveEvery 页持久化一次；页间让出一帧，进度 UI 不卡顿
 * 返回 { onSale, navRows, date, cancelled, throttled, done, resumedFrom, lastPage, pages, fundCount, navCount }
 */
export async function syncFundLibrary(fetchPage, {
  force = false, onProgress = null, isCancelled = null, saveEvery = 5,
} = {}) {
  if (typeof fetchPage !== 'function') {
    return { onSale: 0, navRows: 0, date: null, cancelled: false, throttled: false, done: false, resumedFrom: 0, lastPage: 0, pages: 0 };
  }
  const d = db();

  // --- 节流：20h 内且数据完整才跳过 -----------------------------------------
  const last = d.meta.onsaleSyncedAt || 0;
  const syncedFund = d.meta.syncedFundCount || 0;
  const syncedNav = d.meta.syncedNavCount || 0;
  const curFund = Object.keys(d.fund_base).filter(k => d.fund_base[k].onSale).length;
  const curNav = Object.keys(d.fund_nav).length;
  // 20 小时节流 —— 前提是数据真的还在：当前条数少于上次同步规模（分片丢失 /
  // 被清空 / 换机）时不得谎报「已是最新」，必须立即重建。
  const hasSyncRecord = syncedFund > 0;
  const dataIntact = hasSyncRecord && curFund >= syncedFund && curNav >= syncedNav;
  if (!force && dataIntact && Date.now() - last < 20 * 3600 * 1000) {
    return {
      onSale: curFund, navRows: 0, date: null, cancelled: false,
      throttled: true, syncedAt: last, fundCount: curFund, navCount: curNav,
      done: false, resumedFrom: 0, lastPage: 0, pages: 0,
    };
  }

  // --- 断点续传：24h 内的未完成进度，从上次页码继续 -------------------------
  const RESUME_TTL = 24 * 3600 * 1000;
  const resumePage = d.meta.syncResumePage || 0;
  const resumeAt = d.meta.syncResumeAt || 0;
  const canResume = !force && resumePage > 1 && (Date.now() - resumeAt) < RESUME_TTL;
  const resumedFrom = canResume ? resumePage : 0;
  if (!canResume && resumePage > 1) d.meta.syncResumePage = 0;   // 过期断点作废

  const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
  let onSale = 0;
  let navRows = 0;
  let navDate = null;
  let page = resumedFrom || 1;
  let pages = canResume ? (d.meta.syncResumePages || 0) : 0;
  let fundTotal = Object.keys(d.fund_base).length;
  let sinceSave = 0;
  let cancelled = false;
  let cleanEnd = false;

  for (;;) {
    if (typeof isCancelled === 'function' && isCancelled()) { cancelled = true; break; }
    const data = await fetchPage(page, 200, 1);
    if (!data || !data.rows || data.rows.length === 0) break;   // 网络中断 / 没有更多数据
    pages = data.pages || pages;
    navDate = navDate || data.date;
    for (const r of data.rows) {
      d.fund_base[r.code] = {
        code: r.code,
        name: r.name || '',
        pinyin: r.pinyin || '',
        type: '',
        kind: 'fund',
        onSale: 1,
      };
      if (navDate && r.nav != null) {
        d.fund_nav[r.code] = {
          date: navDate, nav: r.nav, prevNav: r.prevNav, pct: r.pct,
          updatedAt: Date.now(),
        };
        navRows++;
      }
    }
    onSale += data.rows.length;
    fundTotal += data.rows.length;
    touch();
    // 断点随数据一起落盘：记录「下一页」（进程被杀也能续传）
    d.meta.syncResumePage = page + 1;
    d.meta.syncResumePages = pages;
    d.meta.syncResumeAt = Date.now();
    sinceSave++;
    const lastPage = (pages > 0 && page >= pages) || page > 200;
    if (sinceSave >= saveEvery || lastPage) { saveDb(); sinceSave = 0; }
    if (onProgress) { try { onProgress(page, pages, fundTotal); } catch (e) {} }
    if (lastPage) { cleanEnd = true; break; }
    page++;
    // 让出一帧：进度 UI / 取消按钮 / 页面其它交互得以渲染
    await yieldFrame();
  }
  saveDb();  // 无论正常结束 / 取消 / 网络中断，已入库数据 + 断点都落盘

  if (cleanEnd) {
    // 全量（可能含续传）完成：记录同步规模供节流判断，清除断点
    d.meta.onsaleSyncedAt = Date.now();
    d.meta.libRefreshedAt = Date.now();
    d.meta.syncedFundCount = Object.keys(d.fund_base).filter(k => d.fund_base[k].onSale).length;
    d.meta.syncedNavCount = Object.keys(d.fund_nav).length;
    d.meta.syncResumePage = 0;
    d.meta.syncResumeAt = 0;
    touch();
    saveDb();
  }
  return {
    onSale, navRows, date: navDate, cancelled, throttled: false,
    done: cleanEnd, resumedFrom,
    lastPage: cleanEnd ? page : Math.max(0, page - 1),   // 最后成功页（cleanEnd 时为末页）
    resumePage: cleanEnd ? 0 : page,                     // 下次续传起始页
    pages,
    fundCount: Object.keys(d.fund_base).filter(k => d.fund_base[k].onSale).length,
    navCount: Object.keys(d.fund_nav).length,
  };
}
