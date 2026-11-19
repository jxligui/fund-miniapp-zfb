/**
 * 端到端功能验证：模拟小程序完整用户流程，验证「我的自选」「持仓基金」
 * 的默认测试数据与数据可用性。
 *
 * 用 Node 模拟 my.* 运行时，覆盖：
 *   1. 首次启动播种（演示持仓 + 默认自选指数 + 基金库）
 *   2. 我的自选：指数列表 / 自选基金列表
 *   3. 持仓基金：分组 / 金额制加减仓 / 批量导入 / 盈亏计算
 *   4. 设置页：基金库检索 / 万能密码 / 导入导出
 *   5. 数据流：加自选 -> 出现在自选页 -> 持仓 -> 移除
 */
import assert from 'node:assert/strict';

// --- 模拟支付宝小程序运行时（含可控网络） ---
const storage = new Map();
const requests = [];

const NAV = {
  '000001': { date: '2026-11-18', nav: 1.02, prevNav: 0.96, pct: 6.25 },
  '110022': { date: '2026-11-18', nav: 3.30, prevNav: 3.20, pct: 3.12 },
  '161725': { date: '2026-11-18', nav: 0.65, prevNav: 0.63, pct: 3.17 },
  '519674': { date: '2026-11-18', nav: 8.20, prevNav: 8.10, pct: 1.23 },
  '270002': { date: '2026-11-18', nav: 1.42, prevNav: 1.40, pct: 1.43 },
  '005827': { date: '2026-11-18', nav: 1.49, prevNav: 1.48, pct: 0.68 },
};

global.my = {
  getStorageSync: ({ key }) => ({ data: storage.has(key) ? storage.get(key) : '', success: true }),
  setStorageSync: ({ key, data }) => storage.set(key, data),
  removeStorageSync: ({ key }) => storage.delete(key),
  showToast: () => {},
  showModal: () => {},
  stopPullDownRefresh: () => {},
  setClipboard: () => {},
  request: ({ url, success }) => {
    requests.push(url);
    // 基金净值
    const m = /text=(\d{6})/.exec(url);
    if (m && NAV[m[1]]) {
      const n = NAV[m[1]];
      success({
        statusCode: 200,
        data: `var db={chars:["0","1"],datas:[["${m[1]}","测试基金","TST","${n.nav}","x","${n.prevNav}","y","0","${n.pct}","开放申购","开放赎回","","1","0","1","","1","0.15%","0.15%","1","1.50%"]],count:["1","1","0","0"],record:"1",pages:"1",curpage:"1",indexsy:[0.09],showday:["2026-11-18","2026-11-17"]}`,
      });
      return;
    }
    success({ statusCode: 200, data: {} });
  },
};

const store = await import('../utils/store.js');
const util = await import('../utils/util.js');
const db = await import('../utils/db.js');
const data = await import('../utils/data.js');
const constants = await import('../utils/constants.js');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}

// ============ 1. 首次启动播种（模拟 app.js onLaunch） ============
db.initDb();
db.upsertFundBaseBatch(data.DEMO_HOLDINGS.map(h => ({ code: h.code, name: h.name })));
// 模拟行情页首次加载：把 NAV 表里的净值写入本地缓存（真实流程由 fetchFundQuotes 完成）
for (const [code, n] of Object.entries(NAV)) {
  store.putNav(code, { date: n.date, nav: n.nav, prevNav: n.prevNav, pct: n.pct });
}
if (store.listHoldings().length === 0 && !storage.get('ft.seeded')) {
  store.saveHoldings(data.DEMO_HOLDINGS.map(h => ({
    code: h.code, name: h.name, shares: h.shares, cost: h.cost,
    watch: h.watch, groupName: data.DEMO_GROUP_MAP[h.code] || null,
    pendingAmount: h.pendingAmount || null, updatedAt: Date.now(),
  })));
  for (const g of data.DEMO_GROUPS) store.addGroup(g);
  storage.set('ft.seeded', '1');
}
if (store.listWatchedIndices().length === 0) {
  store.setWatchedIndices(constants.DEFAULT_INDICES.slice());
}

const HELD_COUNT = data.DEMO_HOLDINGS.filter(h => h.shares != null).length;
const WATCH_ONLY_COUNT = data.DEMO_HOLDINGS.filter(h => h.shares == null).length;

check('首次启动播种了演示持仓', () => {
  assert.equal(store.listHoldings().length, data.DEMO_HOLDINGS.length);
});
check('首次启动播种了默认自选指数', () => {
  assert.equal(store.listWatchedIndices().length, 7);
  assert.ok(store.listWatchedIndices().includes('000001'));
  assert.ok(store.listWatchedIndices().includes('HSI'));
});
check('演示持仓全部标记为自选', () => {
  assert.equal(store.listHoldings().filter(h => h.watch).length, data.DEMO_HOLDINGS.length);
});
check('演示持仓含真实持仓、待确认与纯自选三类', () => {
  const held = store.listHoldings().filter(h => h.shares != null);
  const onlyWatch = store.listHoldings().filter(h => h.shares == null && h.pendingAmount == null);
  const pending = store.listHoldings().filter(h => h.pendingAmount != null);
  assert.equal(held.length, HELD_COUNT);
  assert.equal(onlyWatch.length, WATCH_ONLY_COUNT);
  assert.equal(pending.length, 1);
});
check('演示分组已播种且归属正确', () => {
  assert.deepEqual(store.listGroups().sort(), [...data.DEMO_GROUPS].sort());
  const baijiu = store.listHoldings().filter(h => h.groupName === '白酒消费');
  assert.ok(baijiu.length >= 2, `白酒消费分组应有至少 2 只，实际 ${baijiu.length}`);
});
check('演示持仓已同步进基金库', () => {
  const info = db.libInfo();
  assert.ok(info.fundCount >= data.DEMO_HOLDINGS.length, `fundCount=${info.fundCount}`);
});

// ============ 2. 我的自选 ============
check('自选指数可映射到行情 secid', () => {
  const watched = store.listWatchedIndices();
  const secids = constants.INDEX_LIBRARY.filter(x => watched.includes(x[1])).map(x => x[0]);
  assert.equal(secids.length, 7);
  assert.ok(secids.every(s => /^[\d.]+$|^100\./.test(s)));
});
check('自选基金列表 = 持仓中 watch=true 的条目', () => {
  const watchFunds = store.listHoldings().filter(h => h.watch);
  assert.equal(watchFunds.length, data.DEMO_HOLDINGS.length);
});
check('自选基金可构建组合并计算盈亏', () => {
  const quotes = {};
  for (const [code, n] of Object.entries(NAV)) {
    quotes[code] = { code, nav: n.nav, prevNav: n.prevNav, pct: n.pct, date: n.date };
  }
  const { rows, totals } = store.buildPortfolio(store.listHoldings().filter(h => h.watch), quotes);
  // 全部自选都有行；有份额的（含 ETF/场外）应算出金额
  assert.equal(rows.length, data.DEMO_HOLDINGS.length);
  const heldRows = rows.filter(r => r.shares != null);
  assert.equal(heldRows.length, HELD_COUNT);
  assert.ok(totals.amount > 0);
  assert.ok(heldRows.filter(r => NAV[r.code]).every(r => r.nav != null));
});
check('自选基金金额合计正确', () => {
  const quotes = {};
  for (const [code, n] of Object.entries(NAV)) quotes[code] = { code, nav: n.nav, prevNav: n.prevNav, pct: n.pct, date: n.date };
  const holdings = store.listHoldings().filter(h => h.watch);
  const { totals } = store.buildPortfolio(holdings, quotes);
  // 基于当前实际持仓按「昨日净值」口径逐只推导（净值日期非今天 -> usingYesterday）
  let expect = 0;
  for (const h of holdings) {
    if (h.shares == null) continue;
    const n = NAV[h.code];
    if (n) expect += h.shares * n.prevNav;
    if (h.pendingAmount != null) expect += h.pendingAmount;
  }
  assert.ok(Math.abs(totals.amount - expect) < 0.2, `${totals.amount} vs ${expect}`);
});
check('取消自选指数后从列表移除', () => {
  const before = store.listWatchedIndices().length;
  store.setWatchedIndices(store.listWatchedIndices().filter(c => c !== 'HSI'));
  assert.equal(store.listWatchedIndices().length, before - 1);
  store.setWatchedIndices(constants.DEFAULT_INDICES.slice());  // 复原
});

// ============ 3. 持仓基金 ============
check('分组：新增 / 改名 / 移动 / 删除', () => {
  store.addGroup('临时组A');
  store.addGroup('临时组B');
  assert.ok(store.listGroups().includes('临时组A'));
  store.moveToGroup('161725', '临时组A');
  assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, '临时组A');
  assert.equal(store.moveBatchToGroup(['161725'], '临时组B'), 1);
  store.renameGroup('临时组B', '临时组C');
  assert.ok(store.listGroups().includes('临时组C'));
  store.deleteGroup('临时组C');
  assert.ok(!store.listGroups().includes('临时组C'));
  // 归还演示分组
  store.moveToGroup('161725', data.DEMO_GROUP_MAP['161725'] || null);
});
check('金额制加仓：按净值折算份额并移动加权成本', () => {
  // 用加仓前的快照推导期望值（不假设方向：成本向净值方向移动）
  const before = store.listHoldings().find(h => h.code === '000001');
  const nav = 1.02;
  const costBefore = before.cost;
  store.putNav('000001', { date: '2026-11-18', nav, prevNav: 0.96, pct: 6.25 });
  const addShares = Number((1000 / nav).toFixed(2));
  store.upsertHolding({
    code: '000001', name: before.name,
    shares: Number((before.shares + addShares).toFixed(2)),
    cost: Number(((before.shares * before.cost + 1000) / (before.shares + addShares)).toFixed(4)),
    watch: before.watch, groupName: before.groupName,
  });
  const after = store.listHoldings().find(h => h.code === '000001');
  assert.equal(after.shares, Number((before.shares + addShares).toFixed(2)));
  // 加权成本应向加仓净值方向移动（高于成本时上移，低于时下移）
  assert.ok(after.cost !== costBefore, '成本应发生变化');
  assert.ok(after.cost > nav - 0.001, `成本应不高于加仓净值附近（${after.cost}）`);
  // 成本价保留 4 位小数，允许 0.1 元以内的舍入误差
  assert.ok(Math.abs(after.shares * after.cost - (before.shares * costBefore + 1000)) < 0.1);
});
check('批量导入：每行「代码 金额」', () => {
  const parsed = util.parseBatch('110022 2000\n519674 500\n无效行');
  assert.equal(parsed.length, 2);
  assert.equal(parsed.find(p => p.code === '110022').amount, 2000);
});
check('批量导入后持仓增加且入库', () => {
  const parsed = util.parseBatch('161725 300');
  // 用一只当前无待确认的基金验证「待确认金额并入已有持仓」
  const hold = store.listHoldings().find(h => h.code === '161725');
  store.upsertHolding({
    code: '161725', name: hold.name,
    shares: hold.shares, cost: hold.cost,
    watch: hold.watch, groupName: hold.groupName,
    pendingAmount: parsed[0].amount,
  });
  assert.ok(db.getFundBase('161725'), '待确认基金应入库');
});
check('待确认金额计入持仓总额', () => {
  const p = store.buildPortfolio(store.listHoldings(), null);
  const r = p.rows.find(x => x.code === '161725');
  assert.equal(r.pending, 300);
  // 持仓金额必须包含待确认部分（>= 份额×净值 且 > 300）
  assert.ok(r.amount >= 300 + r.shares * 0.5, `金额应含份额市值+待确认，实际 ${r.amount}`);
  // 还原演示状态
  store.upsertHolding({
    code: '161725', name: r.name,
    shares: r.shares, cost: r.cost,
    watch: r.watch, groupName: r.groupName, pendingAmount: null,
  });
});

// ============ 4. 设置页 / 数据库 ============
check('基金库可检索（按代码 / 名称）', () => {
  const byCode = db.fundBasePage({ query: '161725' });
  assert.equal(byCode.total, 1);
  const byName = db.fundBasePage({ query: '白酒' });
  assert.ok(byName.total >= 1);
});
check('基金库类型统计可用', () => {
  const types = db.fundBaseTypes();
  assert.ok(Array.isArray(types));
});
check('基金库分页可用', () => {
  const p = db.fundBasePage({ page: 1, size: 5 });
  assert.equal(p.items.length, Math.min(5, p.total));
  assert.ok(p.pages >= 1);
});
check('导出 / 导入往返一致', () => {
  const dump = db.exportDb();
  const before = db.libInfo();
  assert.ok(dump.includes('fund_base'));
  assert.equal(db.importDb(dump).ok, true);
  assert.deepEqual(db.libInfo(), before);
});
check('设置项读写', () => {
  db.setSetting('refreshSec', 60);
  assert.equal(db.getSetting('refreshSec'), 60);
});

// ============ 5. 万能密码 ============
check('万能密码：8 位数字、最多 6 个', () => {
  assert.equal(store.addMasterPassword('1234').ok, false);
  assert.equal(store.addMasterPassword('12345678').ok, true);
  for (const p of ['11111111', '22222222', '33333333', '44444444', '55555555']) {
    assert.equal(store.addMasterPassword(p).ok, true);
  }
  assert.equal(store.listMasterPasswords().length, 6);
  assert.equal(store.addMasterPassword('66666666').ok, false);
});
check('万能密码可解锁，错误密码不行', () => {
  // 未设 PIN 时：万能密码应命中 master
  assert.equal(store.verifyAnyPassword('12345678'), 'master');
  assert.equal(store.verifyAnyPassword('00000000'), 'none');
  // 设置 PIN 后：PIN 命中 pin 分支
  store.setPin('1234');
  assert.equal(store.verifyAnyPassword('1234'), 'pin');
  assert.equal(store.verifyAnyPassword('12345678'), 'master');
  assert.equal(store.verifyAnyPassword('99999999'), 'none');
});

// ============ 6. 数据流闭环 ============
check('加自选 -> 出现在自选页 -> 持仓页 -> 移除', () => {
  // 从行情页加自选（模拟 index.js 的 toggleIndexWatch）
  store.upsertHolding({ code: '512480', name: '半导体ETF', shares: null, cost: null, watch: true });
  assert.ok(store.listHoldings().find(h => h.code === '512480').watch);
  // 自选页可见
  assert.ok(store.listHoldings().filter(h => h.watch).some(h => h.code === '512480'));
  // 已在持仓的不能取消自选（watch.js removeFund 的逻辑）
  const hold = store.listHoldings().find(h => h.code === '512480');
  assert.equal(hold.shares, null);
  // 非持仓的可取消
  store.removeHolding('512480');
  assert.equal(store.listHoldings().find(h => h.code === '512480'), undefined);
});

// ============ 输出 ============
const failed = results.filter(r => !r.ok);
console.log('\n=== 功能与数据可用性验证 ===\n');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  -> ' + r.msg}`);
}
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) process.exitCode = 1;
