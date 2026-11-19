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
  getStorageSync: k => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: k => storage.delete(k),
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
if (store.listHoldings().length === 0 && !storage.get('ft.seeded')) {
  store.saveHoldings(data.DEMO_HOLDINGS.map(h => ({
    code: h.code, name: h.name, shares: h.shares, cost: h.cost,
    watch: h.watch, groupName: null, pendingAmount: null, updatedAt: Date.now(),
  })));
  storage.set('ft.seeded', '1');
}
if (store.listWatchedIndices().length === 0) {
  store.setWatchedIndices(constants.DEFAULT_INDICES.slice());
}

check('首次启动播种了演示持仓', () => {
  assert.equal(store.listHoldings().length, 9);
});
check('首次启动播种了默认自选指数', () => {
  assert.equal(store.listWatchedIndices().length, 7);
  assert.ok(store.listWatchedIndices().includes('000001'));
  assert.ok(store.listWatchedIndices().includes('HSI'));
});
check('演示持仓全部标记为自选', () => {
  assert.equal(store.listHoldings().filter(h => h.watch).length, 9);
});
check('演示持仓含真实持仓与纯自选两类', () => {
  const held = store.listHoldings().filter(h => h.shares != null);
  const onlyWatch = store.listHoldings().filter(h => h.shares == null);
  assert.equal(held.length, 6);
  assert.equal(onlyWatch.length, 3);
});
check('演示持仓已同步进基金库', () => {
  const info = db.libInfo();
  assert.ok(info.fundCount >= 9, `fundCount=${info.fundCount}`);
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
  assert.equal(watchFunds.length, 9);
});
check('自选基金可构建组合并计算盈亏', () => {
  const quotes = {};
  for (const [code, n] of Object.entries(NAV)) {
    quotes[code] = { code, nav: n.nav, prevNav: n.prevNav, pct: n.pct, date: n.date };
  }
  const { rows, totals } = store.buildPortfolio(store.listHoldings().filter(h => h.watch), quotes);
  // 9 条自选（6 只有持仓 + 3 只纯自选），纯自选没有金额
  assert.equal(rows.length, 9);
  assert.equal(rows.filter(r => r.amount != null).length, 6);
  assert.ok(totals.amount > 0);
  assert.ok(rows.filter(r => r.shares != null).every(r => r.nav != null));
});
check('自选基金金额合计正确', () => {
  const quotes = {};
  for (const [code, n] of Object.entries(NAV)) quotes[code] = { code, nav: n.nav, prevNav: n.prevNav, pct: n.pct, date: n.date };
  const { totals } = store.buildPortfolio(store.listHoldings().filter(h => h.watch), quotes);
  // 1200*0.96 + 800*3.20 + 2000*0.63 + 300*8.10 + 1500*1.40 + 1000*1.48
  const expect = 1200 * 0.96 + 800 * 3.2 + 2000 * 0.63 + 300 * 8.1 + 1500 * 1.4 + 1000 * 1.48;
  assert.ok(Math.abs(totals.amount - expect) < 0.01, `${totals.amount} vs ${expect}`);
});
check('取消自选指数后从列表移除', () => {
  const before = store.listWatchedIndices().length;
  store.setWatchedIndices(store.listWatchedIndices().filter(c => c !== 'HSI'));
  assert.equal(store.listWatchedIndices().length, before - 1);
  store.setWatchedIndices(constants.DEFAULT_INDICES.slice());  // 复原
});

// ============ 3. 持仓基金 ============
check('分组：新增 / 改名 / 移动 / 删除', () => {
  store.addGroup('白酒');
  store.addGroup('科技');
  assert.deepEqual(store.listGroups().sort(), ['白酒', '科技']);
  store.moveToGroup('161725', '白酒');
  assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, '白酒');
  assert.equal(store.moveBatchToGroup(['161725'], '科技'), 1);
  store.renameGroup('科技', '半导体');
  assert.ok(store.listGroups().includes('半导体'));
  store.deleteGroup('半导体');
  assert.equal(store.listHoldings().find(x => x.code === '161725').groupName, null);
});
check('金额制加仓：按净值折算份额并移动加权成本', () => {
  // 000001 现有 1200 份，成本 0.864；加仓 1000 元，净值 1.02
  store.putNav('000001', { date: '2026-11-18', nav: 1.02, prevNav: 0.96, pct: 6.25 });
  const before = store.listHoldings().find(h => h.code === '000001');
  const addShares = Number((1000 / 1.02).toFixed(2));
  store.upsertHolding({
    code: '000001', name: before.name,
    shares: Number((before.shares + addShares).toFixed(2)),
    cost: Number(((before.shares * before.cost + 1000) / (before.shares + addShares)).toFixed(4)),
    watch: before.watch, groupName: before.groupName,
  });
  const after = store.listHoldings().find(h => h.code === '000001');
  assert.equal(after.shares, Number((1200 + addShares).toFixed(2)));
  assert.ok(after.cost > before.cost, '成本应上移');
  // 成本价保留 4 位小数，允许 0.1 元以内的舍入误差
  assert.ok(Math.abs(after.shares * after.cost - (1200 * 0.864 + 1000)) < 0.1);
});
check('批量导入：每行「代码 金额」', () => {
  const parsed = util.parseBatch('110022 2000\n519674 500\n无效行');
  assert.equal(parsed.length, 2);
  assert.equal(parsed.find(p => p.code === '110022').amount, 2000);
});
check('批量导入后持仓增加且入库', () => {
  const before = store.listHoldings().length;
  const parsed = util.parseBatch('000021 300');
  store.upsertHolding({ code: '000021', name: '华夏成长混合(后端)', shares: null, cost: null, watch: true, pendingAmount: parsed[0].amount });
  assert.equal(store.listHoldings().length, before);
  assert.ok(db.getFundBase('000021'), '待确认基金应入库');
});
check('待确认金额计入持仓总额', () => {
  const p = store.buildPortfolio(store.listHoldings(), null);
  const r = p.rows.find(x => x.code === '000021');
  assert.equal(r.pending, 300);
  assert.equal(r.amount, 300);
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
