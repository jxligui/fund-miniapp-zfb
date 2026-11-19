/** 验证 utils/api.js 的解析逻辑（用真实响应样本）。 */
const realResponse = `var db={chars:["0","1"],datas:[["000001","华夏成长混合","HXCZHH","0.96","3.533","0.951","3.524","0.009","0.95","开放申购","开放赎回","","1","0","1","","1","0.15%","0.15%","1","1.50%"]],count:["1","1","0","0"],record:"1",pages:"1",curpage:"1",indexsy:[0.09],showday:["2026-11-18","2026-11-17"]}`;

global.my = {
  request: ({ url, success, fail }) => {
    if (url.includes('Fund_JJJZ_Data')) {
      success({ statusCode: 200, data: realResponse });
    } else if (url.includes('ulist.np')) {
      success({ statusCode: 200, data: { data: { diff: [
        { f12: '000001', f14: '上证指数', f2: 3550.81, f3: -0.75, f4: -27.02, f6: 60132016153.5, f15: 3583.12, f16: 3559.78, f17: 3583.12, f18: 3587.83 },
      ] } } });
    } else if (url.includes('pingzhongdata')) {
      success({ statusCode: 200, data: 'var Data_netWorthTrend = [{"x":1700000000000,"y":1.0},{"x":1702592000000,"y":1.2}];' });
    } else {
      fail();
    }
  },
};

const api = await import('../miniprogram/utils/api.js');

const q = await api.fetchFundQuote('000001');
console.log('基金净值解析:', q && q.code === '000001' && q.nav === 0.96 && q.prevNav === 0.951 && q.pct === 0.95 && q.date === '2026-11-18' ? 'OK' : 'FAIL ' + JSON.stringify(q));

const quotes = await api.fetchFundQuotes(['000001']);
console.log('批量基金行情:', quotes['000001'] ? 'OK' : 'FAIL');

const mq = await api.fetchMarketQuotes(['1.000001']);
console.log('指数行情解析:', mq.length === 1 && mq[0].price === 3550.81 && mq[0].changePct === -0.75 ? 'OK' : 'FAIL ' + JSON.stringify(mq));

const d = await api.fetchFundDetail('000001');
console.log('详情解析:', d && d.latestNav === 1.2 && d.trend.length >= 1 ? 'OK' : 'FAIL ' + JSON.stringify(d));
