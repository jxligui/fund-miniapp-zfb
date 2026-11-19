/**
 * 验证 extractJsonArray 手写解析器（替代被 CSP 禁用的 new Function）。
 * 样本来自东财真实响应（单只查询 + 全量分页）。
 */
import assert from 'node:assert/strict';

global.my = {
  request: ({ success }) => success({ statusCode: 200, data: {} }),
  showToast: () => {}, showModal: () => {},
  getStorageSync: () => ({ data: '', success: true }), setStorageSync: () => {}, removeStorageSync: () => {},
};

const api = await import('../utils/api.js');

// —— fetchFundQuote：单只查询（真实样本格式）——
const singleText = 'var db={chars:["0","1"],datas:[["000001","华夏成长混合","HXCZHH","0.96","3.533","0.951","3.524","0.009","0.95","开放申购","开放赎回","","1","0","1","","1","0.15%","0.15%","1","1.50%"]],count:["1","1","0","0"],record:"1",pages:"1",curpage:"1",indexsy:[0.09],showday:["2026-11-18","2026-11-17"]}';

// —— fetchFundPage：全量分页（真实响应格式）——
const pageText = 'var db={chars:["0","3","5","8"],datas:[["257070","国联安优选行业混合A","GLAYXHYHHA","3.4869","3.7879","3.3059","3.6069","0.181","5.48","开放申购","开放赎回"],["000001","华夏成长混合","HXCZHH","0.96","1.05","0.951","1.04","0.009","0.95","开放申购","开放赎回"],["005827","易方达蓝筹精选混合","YFDLQJXHH","1.3578","1.42","1.3638","1.4010","-0.006","-0.44","开放申购","开放赎回"]],count:["3","3","0","0"],record:"20464",pages:"103",curpage:"1",indexsy:[0.09],showday:["2026-11-18","2026-11-17"]}';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}

await check('单只查询解析：代码/名称/净值/日期', async () => {
  global.my.request = ({ url, success }) => success({ statusCode: 200, data: singleText });
  const q = await api.fetchFundQuote('000001');
  assert.ok(q, '应返回结果');
  assert.equal(q.code, '000001');
  assert.equal(q.name, '华夏成长混合');
  assert.equal(q.nav, 0.96);
  assert.equal(q.prevNav, 0.951);
  assert.equal(q.pct, 0.95);
  assert.equal(q.date, '2026-11-18');
});

await check('代码不匹配时返回 null', async () => {
  global.my.request = ({ url, success }) => success({ statusCode: 200, data: singleText });
  const q = await api.fetchFundQuote('999999');
  assert.equal(q, null);
});

await check('分页解析：rows/total/pages/date', async () => {
  global.my.request = ({ url, success }) => success({ statusCode: 200, data: pageText });
  const res = await api.fetchFundPage(1, 200, 1);
  assert.ok(res, '应返回结果');
  assert.equal(res.rows.length, 3);
  assert.equal(res.total, 20464);
  assert.equal(res.pages, 103);
  assert.equal(res.date, '2026-11-18');
  assert.equal(res.rows[0].code, '257070');
  assert.equal(res.rows[0].nav, 3.4869);
  assert.equal(res.rows[0].pct, 5.48);
});

await check('风控页/空响应返回 null（不抛异常）', async () => {
  global.my.request = ({ url, success }) => success({ statusCode: 200, data: '<html>blocked</html>' });
  const res = await api.fetchFundPage(1, 200, 1);
  assert.equal(res, null);
});

console.log('\n=== extractJsonArray 解析器验证 ===\n');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  -> ' + r.msg}`);
const fail = results.filter(r => !r.ok).length;
console.log(`\n共 ${results.length} 项，通过 ${results.length - fail}，失败 ${fail}`);
if (fail) process.exitCode = 1;
