/**
 * 校验演示数据（DEMO_HOLDINGS）的每只基金在东财真实存在且名称一致。
 */
const H = { referer: 'https://fund.eastmoney.com/' };

const DEMO = [
  ['159995', '芯片ETF华夏'],
  ['513180', '恒生科技ETF华夏'],
  ['000001', '华夏成长混合'],
  ['519674', '银河创新成长混合A'],
  ['005827', '易方达蓝筹精选混合'],
  ['270002', '广发稳健增长混合A'],
  ['161725', '招商中证白酒指数(LOF)A'],
  ['110022', '易方达消费行业股票'],
  ['000021', '华夏优势增长混合'],
  ['000081', '天治可转债增强债券C'],
  ['000080', '天治可转债增强债券A'],
  ['000116', '嘉实丰益纯债定期债券A'],
  ['512480', '半导体ETF'],
  ['159928', '消费ETF'],
];

const isEtf = c => /^5\d{5}$/.test(c) || /^15\d{4}$/.test(c);

console.log('=== 演示数据真实性校验 ===\n');
let ok = 0, mismatch = 0, miss = 0;

for (const [code, name] of DEMO) {
  if (isEtf(code)) {
    const secid = code.startsWith('5') ? `1.${code}` : `0.${code}`;
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secid}&fields=f2,f3,f12,f14&ut=fa5fd1943c7b386f172d6893dbfba10b`;
    const data = await fetch(url, { headers: H }).then(r => r.json()).catch(() => null);
    const d = data && data.data && data.data.diff && data.data.diff[0];
    if (d && d.f12 === code) {
      console.log(`  OK    ${code}  ${name.padEnd(20)} -> ${d.f14}  现价 ${d.f2}`);
      ok++;
    } else {
      console.log(`  MISS  ${code}  ${name} —— push2 无数据`);
      miss++;
    }
    continue;
  }
  const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&text=${code}&sort=zdf,desc&page=1,5&dt=${Date.now()}&atfc=&onlySale=0`;
  const text = await fetch(url, { headers: H }).then(r => r.text()).catch(() => null);
  const s = text ? text.indexOf('datas:[[') : -1;
  const e = text ? text.indexOf(']],count') : -1;
  if (s < 0 || e < 0) {
    console.log(`  MISS  ${code}  ${name} —— 接口无数据`);
    miss++;
    continue;
  }
  let rows;
  try { rows = new Function(`return ${text.slice(s + 6, e + 2)}`)(); } catch { rows = null; }
  if (!rows || !rows.length || String(rows[0][0]) !== code) {
    console.log(`  MISS  ${code}  ${name} —— 无此代码`);
    miss++;
    continue;
  }
  const realName = String(rows[0][1] || '');
  const nav = Number(rows[0][3]);
  const match = realName === name;
  console.log(`  ${match ? 'OK   ' : 'DIFF '} ${code}  ${name.padEnd(20)} -> ${realName.padEnd(24)} 净值 ${nav}`);
  if (match) ok++; else mismatch++;
}

console.log(`\n一致 ${ok}，名称需修正 ${mismatch}，不存在 ${miss}`);
