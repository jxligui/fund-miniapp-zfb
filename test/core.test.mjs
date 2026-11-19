/**
 * 小程序核心逻辑自测（不依赖支付宝开发者工具）。
 * 用 Node 模拟 my.* API 与 localStorage，验证 store / util 层的关键行为。
 */
import assert from 'node:assert/strict';

// --- 模拟支付宝小程序运行时 ---
const storage = new Map();
global.my = {
  getStorageSync: k => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: k => storage.delete(k),
  showToast: () => {},
  showModal: () => {},
  request: ({ url, success }) => {
    // 模拟网络：返回空数据
    success({ statusCode: 200, data: {} });
  },
};

const store = await import('../utils/store.js');
const util = await import('../utils/util.js');

// 1. PIN 设置与校验
assert.equal(store.hasPin(), false);
store.setPin('1234');
assert.equal(store.hasPin(), true);
assert.equal(store.verifyPin('1234'), true);
assert.equal(store.verifyPin('9999'), false);

// 2. 持仓 upsert / watch / 分组
store.upsertHolding({ code: '000001', name: '华夏成长混合', shares: 100, cost: 0.96 });
store.upsertHolding({ code: '161725', name: '招商中证白酒', shares: 200, cost: 0.579, watch: true });
let list = store.listHoldings();
assert.equal(list.length, 2);
assert.equal(list.find(x => x.code === '000001').shares, 100);
assert.equal(list.find(x => x.code === '161725').watch, true);

// 3. 分组：新增 / 改名 / 移动 / 删除
store.addGroup('白酒');
store.addGroup('科技');
assert.deepEqual(store.listGroups().sort(), ['白酒', '科技']);
store.moveToGroup('161725', '白酒');
assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, '白酒');
assert.equal(store.moveBatchToGroup(['161725'], '科技'), 1);
assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, '科技');
store.renameGroup('科技', '半导体');
assert.ok(store.listGroups().includes('半导体'));
assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, '半导体');
store.deleteGroup('半导体');
assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, null);

// 4. 持仓金额计算（净值来自缓存）
// 缓存净值日期为 2026-11-18，非今日 -> 按「昨日净值」计算（prevNav=1.1）
store.putNav('000001', { date: '2026-11-18', nav: 1.2, prevNav: 1.1, pct: 9.09 });
const { rows, totals } = store.buildPortfolio(store.listHoldings(), null);
const r1 = rows.find(x => x.code === '000001');
assert.equal(r1.usingYesterday, true);      // 今日净值未公布 -> 用昨日净值
assert.equal(r1.nav, 1.1);                 // 计算用昨日净值
assert.equal(r1.amount, 110);              // 100 份 × 1.1
assert.ok(Math.abs(r1.totalPct - 14.58) < 0.01); // (1.1-0.96)/0.96
assert.equal(totals.amount, 110);

// 4b. 今日净值已公布时按今日净值计算
const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
store.putNav('000001', { date: todayStr, nav: 1.2, prevNav: 1.1, pct: 9.09 });
const t2 = store.buildPortfolio(store.listHoldings(), null);
const r1b = t2.rows.find(x => x.code === '000001');
assert.equal(r1b.usingYesterday, false);
assert.equal(r1b.amount, 120);             // 100 份 × 1.2（今日净值）

// 5. 待确认金额计入持仓金额
store.upsertHolding({ code: '005827', name: '易方达蓝筹', pendingAmount: 500 });
const p2 = store.buildPortfolio(store.listHoldings(), null);
const r2 = p2.rows.find(x => x.code === '005827');
assert.equal(r2.amount, 500);   // 只有待确认买入金额
assert.equal(r2.pending, 500);

// 6. 批量导入解析
const parsed = util.parseBatch('000001 1000\n161725, 500.50\n005827\t2000\n无效行');
assert.equal(parsed.length, 3);
assert.equal(parsed.find(p => p.code === '161725').amount, 500.5);
assert.equal(parsed.find(p => p.code === '005827').amount, 2000);

// 7. 金额制折算（份额 = 金额 ÷ 净值）
const nav = 1.2;
const shares = Number((1000 / nav).toFixed(2));
assert.equal(shares, 833.33);

// 8. 格式化
assert.equal(util.money(1234.5), '1,234.50');
assert.equal(util.pct(1.234), '+1.23%');
assert.equal(util.signedMoney(-100), '−100.00');
assert.equal(util.compactAmt(60132016153.5), '601.32亿');

// 9. 今日净值判断
assert.equal(store.isToday('2026-11-19'), true);
assert.equal(store.isToday('2026-11-18'), false);

// 10. 万能密码（最多 6 个、8 位数字）
const db = await import('../utils/db.js');
assert.equal(store.hasMasterPasswords(), false);
assert.equal(store.isValidMasterPassword('12345678'), true);
assert.equal(store.isValidMasterPassword('1234567'), false);   // 7 位
assert.equal(store.isValidMasterPassword('123456789'), false);  // 9 位
assert.equal(store.isValidMasterPassword('1234567a'), false);   // 非数字
assert.equal(store.addMasterPassword('1234567').ok, false);    // 格式非法
assert.equal(store.addMasterPassword('12345678').ok, true);
assert.equal(store.hasMasterPasswords(), true);
assert.equal(store.verifyMasterPassword('12345678'), true);
assert.equal(store.verifyMasterPassword('87654321'), false);
assert.equal(store.addMasterPassword('12345678').ok, false);    // 重复
// 填满 6 个
for (const p of ['11111111', '22222222', '33333333', '44444444', '55555555']) {
  assert.equal(store.addMasterPassword(p).ok, true);
}
assert.equal(store.listMasterPasswords().length, 6);
assert.equal(store.addMasterPassword('66666666').ok, false);    // 超过 6 个
// 统一解锁校验：PIN 与万能密码都可
assert.equal(store.verifyAnyPassword('1234'), 'pin');
assert.equal(store.verifyAnyPassword('12345678'), 'master');
assert.equal(store.verifyAnyPassword('00000000'), 'none');
// 删除
assert.equal(store.removeMasterPassword(0).ok, true);
assert.equal(store.listMasterPasswords().length, 5);
assert.equal(store.verifyMasterPassword('12345678'), false);
assert.equal(store.clearMasterPasswords().ok, true);
assert.equal(store.listMasterPasswords().length, 0);

// 11. 本地数据库（对齐 fund-tracker 的表结构）
db.initDb();
let info = db.libInfo();
assert.equal(info.etfCount, 24);          // ETF 基础库已播种
assert.equal(info.indexCount, 28);        // 指数基础库已播种
assert.ok(info.fundCount >= 2);           // 持仓同步进了基金库

// 基金库写入与检索
assert.equal(db.upsertFundBase({ code: '110022', name: '易方达消费行业股票', type: '股票型' }), true);
db.upsertFundBase({ code: '161725', name: '招商中证白酒指数(LOF)A', type: '指数型' });
let page = db.fundBasePage({ query: '白酒' });
assert.equal(page.total, 1);
assert.equal(page.items[0].code, '161725');
page = db.fundBasePage({ type: '股票型' });
assert.ok(page.items.some(x => x.code === '110022'));

// 类型统计
const types = db.fundBaseTypes();
assert.ok(types.some(t => t.type === '股票型'));

// 设置项
db.setSetting('refreshSec', 30);
assert.equal(db.getSetting('refreshSec'), 30);
assert.equal(db.getSetting('missing', 'def'), 'def');

// 净值缓存
db.putNavDb('000001', { date: '2026-11-19', nav: 1.2, prevNav: 1.1, pct: 9, updatedAt: Date.now() });
assert.equal(db.getNavDb('000001').nav, 1.2);

// 导出 / 导入
const dumped = db.exportDb();
assert.ok(dumped.includes('fund_base'));
assert.equal(db.importDb('not json').ok, false);
assert.equal(db.importDb(dumped).ok, true);

// 清空基金库（保留其它数据）
db.clearFundBase();
assert.equal(db.libInfo().fundCount, 0);
assert.equal(db.libInfo().etfCount, 24);

// 12. 基金库全量同步（模拟东财分页接口）
const pagesData = {
  1: { date: '2026-11-18', total: 5, pages: 2, rows: [
    { code: '000001', name: '基金A', pinyin: 'JJA', nav: 1.2, prevNav: 1.1, pct: 9.09, sg: '开放申购', sh: '开放赎回' },
    { code: '110022', name: '基金B', pinyin: 'JJB', nav: 3.01, prevNav: 3.027, pct: -0.56, sg: '开放申购', sh: '开放赎回' },
  ] },
  2: { date: '2026-11-18', total: 5, pages: 2, rows: [
    { code: '161725', name: '基金C', pinyin: 'JJC', nav: 0.5791, prevNav: 0.5864, pct: -1.24, sg: '开放申购', sh: '开放赎回' },
  ] },
};
const progressCalls = [];
const syncRes = await db.syncFundLibrary(
  async (page, size, onlySale) => pagesData[page] || null,
  { force: true, onProgress: (p, pages, count) => progressCalls.push({ p, pages, count }) }
);
assert.equal(syncRes.onSale, 3);
assert.equal(syncRes.navRows, 3);
assert.equal(syncRes.date, '2026-11-18');
assert.equal(progressCalls.length, 2);
assert.equal(db.libInfo().fundCount, 3);
assert.ok(db.getFundBase('161725').onSale === 1);
// 净值也同步进了缓存
assert.equal(db.getNavDb('000001').nav, 1.2);
// pinyin 检索
page = db.fundBasePage({ query: 'JJB' });
assert.equal(page.total, 1);
assert.equal(page.items[0].code, '110022');
// 节流：非 force 的第二次调用不再拉取
const fetched = [];
const throttled = await db.syncFundLibrary(async (p) => { fetched.push(p); return null; });
assert.equal(fetched.length, 0);
assert.ok(throttled.onSale >= 3);

console.log('ALL PASS: 12 组用例通过');
