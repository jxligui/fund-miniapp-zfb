/** 真实网络联调：用 Node 模拟小程序 my.request，验证各数据源可用。 */
const H = { referer: 'https://fund.eastmoney.com/' };

function get(url) {
  return fetch(url, { headers: H }).then(r => r.text()).catch(() => null);
}

// 1. jdzf 基金净值（小程序主用）
const jdzf = await get(`https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?t=1&lx=1&text=000001&sort=zdf,desc&page=1,5&dt=${Date.now()}&atfc=&onlySale=0`);
console.log('jdzf 单只查询:', jdzf && jdzf.includes('000001') ? 'OK' : 'FAIL');

// 2. push2 指数行情
const push2 = await fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f2,f3,f4,f12,f14,f18').then(r => r.json()).catch(() => null);
const diff = push2 && push2.data && push2.data.diff ? push2.data.diff : [];
console.log('push2 指数行情:', diff.length === 2 ? `OK (${diff.map(d => d.f14 + ' ' + d.f2).join(', ')})` : 'FAIL');

// 3. 基金搜索
const sug = await fetch('https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=' + encodeURIComponent('华夏成长'), { headers: H }).then(r => r.json()).catch(() => null);
const datas = sug && sug.Datas ? sug.Datas : [];
console.log('基金搜索:', datas.length > 0 ? `OK (${datas.length} 条, 首个 ${datas[0].CODE})` : 'FAIL');

// 4. 基金详情（pingzhongdata）
const detail = await get('https://fund.eastmoney.com/pingzhongdata/000001.js');
const hasTrend = detail && /Data_netWorthTrend\s*=/.test(detail);
console.log('基金详情走势:', hasTrend ? 'OK' : 'FAIL');
