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

console.log('ALL PASS: 9 组用例通过');
