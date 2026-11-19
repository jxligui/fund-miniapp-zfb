/**
 * 校验演示测试数据在东方财富接口上是否真实可取（数据可用性）。
 */
const H = { referer: 'https://fund.eastmoney.com/' };

const CODES = [
  ['000001', '华夏成长混合'],
  ['110022', '易方达消费行业股票'],
  ['161725', '招商中证白酒指数(LOF)A'],
  ['519674', '银河创新成长混合A'],
  ['270002', '广发稳健增长混合A'],
  ['005827', '易方达蓝筹精选混合'],
  ['000021', '华夏成长混合(后端)'],
  ['512480', '半导体ETF'],
  ['159928', '消费ETF'],
];

const get = url => fetch(url, { headers: H }).then(r => r.text()).catch(() => null);
const getJson = url => fetch(url, { headers: H }).then(r => r.json()).catch(() => null);

console.log('=== 演示基金净值可取性（场外基金走 jdzf 净值接口）===\n');
let ok = 0, bad = 0;
for (const [code, name] of CODES) {
  // ETF 在 jdzf 接口查不到数据（该接口只返回场外基金），改走 push2 实时行情
  const isEtf = /^5\d{5}$/.test(code) || /^15\d{4}$/.test(code);
  if (isEtf) continue;

  const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx`
    + `?t=1&lx=1&letter=&gsid=&text=${code}&sort=zdf,desc&page=1,5`
    + `&dt=${Date.now()}&atfc=&onlySale=0`;
  const text = await get(url);
  const s = text ? text.indexOf('datas:[[') : -1;
  const e = text ? text.indexOf(']],count') : -1;
  if (s < 0 || e < 0) {
    console.log(`  MISS  ${code}  ${name.padEnd(22)} —— 接口无数据`);
    bad++;
    continue;
  }
  let rows;
  try { rows = new Function(`return ${text.slice(s + 6, e + 2)}`)(); } catch (err) { rows = null; }
  if (!rows || !rows.length) {
    console.log(`  MISS  ${code}  ${name.padEnd(22)} —— 解析失败`);
    bad++;
    continue;
  }
  const row = rows[0];
  const realName = String(row[1] || '');
  const nav = Number(row[3]);
  const prevNav = Number(row[5]);
  const nameMatch = realName.indexOf(name.slice(0, 2)) >= 0 || name.indexOf(realName.slice(0, 2)) >= 0;
  console.log(`  ${nameMatch ? 'OK  ' : 'OK* '} ${code}  ${name.padEnd(22)} -> ${realName.padEnd(24)} 净值 ${nav}  昨收 ${prevNav}`);
  ok++;
}

console.log('\n=== 演示 ETF 实时行情（走 push2，与 utils/api.js 的处理一致）===\n');
for (const code of ['512480', '159928']) {
  const secid = code.startsWith('5') ? `1.${code}` : `0.${code}`;
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get`
    + `?fltt=2&secids=${encodeURIComponent(secid)}`
    + `&fields=f2,f3,f4,f12,f14&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  const data = await getJson(url);
  const diff = data && data.data && data.data.diff;
  if (!diff || !diff.length) {
    console.log(`  MISS  ${code} —— 无行情`);
    bad++;
    continue;
  }
  const d = diff[0];
  console.log(`  OK    ${code}  ${d.f14}  现价 ${d.f2}  涨跌 ${d.f3}%`);
  ok++;
}

console.log(`\n可取 ${ok} / ${ok + bad}`);
process.exitCode = bad > 0 ? 1 : 0;
