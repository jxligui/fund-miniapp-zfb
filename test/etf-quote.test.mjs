/**
 * 验证 ETF 行情修复：fetchFundQuotes 对 ETF 应走 push2 实时行情，
 * 返回与场外基金一致的 { nav, prevNav, pct } 结构。
 */
const H = { referer: 'https://fund.eastmoney.com/' };

// --- 模拟 my.request，记录请求的 URL ---
const requested = [];
global.my = {
  request: ({ url, success, fail }) => {
    requested.push(url);
    if (url.includes('Fund_JJJZ_Data')) {
      const m = /text=(\d{6})/.exec(url);
      success({
        statusCode: 200,
        data: `var db={chars:["0","1"],datas:[["${m[1]}","测试基金","TST","1.20","x","1.10","y","0","9.09","开放申购","开放赎回","","1","0","1","","1","0.15%","0.15%","1","1.50%"]],count:["1","1","0","0"],record:"1",pages:"1",curpage:"1",indexsy:[0.09],showday:["2026-11-18","2026-11-17"]}`,
      });
      return;
    }
    if (url.includes('ulist.np')) {
      success({
        statusCode: 200,
        data: {
          data: {
            diff: [
              { f2: 0.777, f3: 0.78, f4: 0.006, f6: 12345678, f12: '512480', f14: '半导体ETF国联安', f15: 0.79, f16: 0.77, f17: 0.771, f18: 0.771 },
            ],
          },
        },
      });
      return;
    }
    success({ statusCode: 200, data: {} });
  },
};

const api = await import('../utils/api.js');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}

await check('ETF 走 push2 实时行情接口', async () => {
  const quotes = await api.fetchFundQuotes(['512480']);
  assert(quotes['512480'], '应返回 ETF 行情');
  assert(quotes['512480'].nav === 0.777, `nav=${quotes['512480'].nav}`);
  assert(quotes['512480'].prevNav === 0.771, `prevNav=${quotes['512480'].prevNav}`);
  assert(quotes['512480'].pct === 0.78, `pct=${quotes['512480'].pct}`);
  assert(requested.some(u => u.includes('ulist.np')), '应请求 push2');
  assert(!requested.some(u => u.includes('512480') && u.includes('Fund_JJJZ')), 'ETF 不应走净值接口');
});

await check('场外基金仍走净值接口', async () => {
  const before = requested.length;
  const quotes = await api.fetchFundQuotes(['000001']);
  assert(quotes['000001'], '应返回基金净值');
  assert(quotes['000001'].nav === 1.20, `nav=${quotes['000001'].nav}`);
  assert(quotes['000001'].pct === 9.09, `pct=${quotes['000001'].pct}`);
  assert(requested.slice(before).some(u => u.includes('Fund_JJJZ')), '应请求净值接口');
});

await check('深市 ETF（15 开头）secid 正确', async () => {
  requested.length = 0;
  global.my.request = ({ url, success }) => {
    requested.push(url);
    success({ statusCode: 200, data: { data: { diff: [{ f2: 0.708, f3: 0.14, f4: 0.001, f6: 999, f12: '159928', f14: '消费ETF汇添富', f15: 0.71, f16: 0.70, f17: 0.707, f18: 0.707 }] } } });
  };
  const quotes = await api.fetchFundQuotes(['159928']);
  assert(quotes['159928'], '应返回深市 ETF 行情');
  assert(requested.some(u => u.includes('0.159928')), `secid 应为 0.159928，实际: ${requested.join(',')}`);
});

await check('混合请求（场外 + ETF）都能拿到', async () => {
  global.my.request = ({ url, success }) => {
    if (url.includes('Fund_JJJZ_Data')) {
      const m = /text=(\d{6})/.exec(url);
      success({ statusCode: 200, data: `var db={chars:["0"],datas:[["${m[1]}","测试","T","1.20","x","1.10","y","0","9.09","","","","1","0","1","","1","","","1",""]],count:["1"],record:"1",pages:"1",curpage:"1",indexsy:[0.09],showday:["2026-11-18"]}` });
      return;
    }
    success({ statusCode: 200, data: { data: { diff: [{ f2: 0.777, f3: 0.78, f4: 0.006, f6: 1, f12: '512480', f14: '半导体ETF', f15: 1, f16: 1, f17: 1, f18: 0.771 }] } } });
  };
  const quotes = await api.fetchFundQuotes(['000001', '512480']);
  assert(quotes['000001'] && quotes['512480'], '两者都应有行情');
  assert(quotes['000001'].nav === 1.20);
  assert(quotes['512480'].nav === 0.777);
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

console.log('\n=== ETF 行情修复验证 ===\n');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  -> ' + r.msg}`);
const failed = results.filter(r => !r.ok).length;
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
if (failed) process.exitCode = 1;
