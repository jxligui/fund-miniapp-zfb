/**
 * 行情数据请求（直连东方财富公开接口，无需自建服务器）。
 *
 * 小程序端注意：所有域名都必须在支付宝开放平台的
 * 「开发设置 → 接口域名（request 合法域名）」中配置：
 *   https://fund.eastmoney.com
 *   https://push2.eastmoney.com
 *   https://fundsuggest.eastmoney.com
 */

/** 统一的请求封装：失败返回 null，不抛异常。 */
function request(url, options = {}) {
  return new Promise(resolve => {
    my.request({
      url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        referer: 'https://fund.eastmoney.com/',
        ...(options.header || {}),
      },
      timeout: options.timeout || 15000,
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else resolve(null);
      },
      fail: () => resolve(null),
    });
  });
}

/** 文本请求（部分接口返回 JS/HTML 文本而非 JSON）。 */
function requestText(url, options = {}) {
  return new Promise(resolve => {
    my.request({
      url,
      method: options.method || 'GET',
      header: { referer: 'https://fund.eastmoney.com/', ...(options.header || {}) },
      timeout: options.timeout || 15000,
      success: res => resolve(res.statusCode >= 200 && res.statusCode < 300 ? res.data : null),
      fail: () => resolve(null),
    });
  });
}

/**
 * 解析东财 jdzf 页数据（JS 对象字面量，不是标准 JSON）。
 * text = 基金代码；返回 { code, name, nav, prevNav, pct, date }
 */
export async function fetchFundQuote(code) {
  const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx`
    + `?t=1&lx=1&letter=&gsid=&text=${code}&sort=zdf,desc&page=1,5`
    + `&dt=${Date.now()}&atfc=&onlySale=0`;
  const text = await requestText(url);
  if (!text || typeof text !== 'string') return null;
  const s = text.indexOf('datas:[[');
  const e = text.indexOf(']],count');
  if (s < 0 || e < 0) return null;
  try {
    const rows = new Function(`return ${text.slice(s + 6, e + 2)}`)();
    const row = rows && rows[0];
    if (!row || String(row[0]) !== code) return null;
    const dm = /showday:\["(\d{4}-\d\d-\d\d)"/.exec(text);
    return {
      code,
      name: String(row[1] || ''),
      nav: Number(row[3]) > 0 ? Number(row[3]) : null,
      prevNav: Number(row[5]) > 0 ? Number(row[5]) : null,
      pct: row[8] != null && isFinite(Number(row[8])) ? Number(row[8]) : null,
      date: dm ? dm[1] : '',
    };
  } catch (e) {
    return null;
  }
}

/**
 * 批量取基金行情（并发受限，逐个请求）。
 *
 * ETF（场内基金）在东财净值接口查不到数据（接口只返回场外基金），
 * 因此 ETF 走 push2 实时行情接口，并按 ETF 的涨跌价（现价 - 昨收）折算成
 * 与场外基金一致的 { nav, prevNav, pct } 结构。
 */
export async function fetchFundQuotes(codes) {
  const out = {};
  const list = (codes || []).slice(0, 60);

  // 1) ETF 用实时行情接口（按 secid 批量查）
  const etfCodes = list.filter(isEtfCode);
  const otherCodes = list.filter(c => !isEtfCode(c));
  if (etfCodes.length) {
    const secids = etfCodes.map(c => etfSecid(c)).filter(Boolean);
    if (secids.length) {
      const quotes = await fetchMarketQuotes(secids);
      for (const q of quotes) {
        if (!q.code) continue;
        const nav = q.price;
        const prevNav = q.prevClose;
        out[q.code] = {
          code: q.code,
          name: q.name,
          nav: nav,
          prevNav: prevNav,
          pct: q.changePct,
          date: todayStr(),
          amount: q.amount,
        };
      }
    }
  }

  // 2) 场外基金走净值接口（并发受限，逐个请求）
  const CONCURRENCY = 5;
  for (let i = 0; i < otherCodes.length; i += CONCURRENCY) {
    const slice = otherCodes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(c => fetchFundQuote(c)));
    results.forEach((q, k) => { if (q) out[slice[k]] = q; });
  }
  return out;
}

/** 是否是 ETF（场内基金）—— 代码 5 开头（沪市）或 15 开头（深市） */
function isEtfCode(code) {
  const c = String(code || '');
  return /^5\d{5}$/.test(c) || /^15\d{4}$/.test(c);
}

/** ETF 的行情 secid：沪市 1.xxxxxx，深市 0.xxxxxx */
function etfSecid(code) {
  const c = String(code || '');
  if (/^5\d{5}$/.test(c)) return `1.${c}`;
  if (/^15\d{4}$/.test(c)) return `0.${c}`;
  return null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 分页拉取东财基金全量列表（对齐 DSH 插件 fund-tracker 的 syncOnSale）。
 * 单页 200 只，可指定页码；onlySale=1 只取在售基金。
 * 返回 { date, total, pages, rows: [{code,name,pinyin,nav,prevNav,pct,sg,sh}] }
 */
export async function fetchFundPage(page = 1, size = 200, onlySale = 1) {
  const url = `https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx`
    + `?t=1&lx=1&letter=&gsid=&text=&sort=zdf,desc&page=${page},${size}`
    + `&dt=${Date.now()}&atfc=&onlySale=${onlySale}`;
  const text = await requestText(url, { header: { referer: 'https://fund.eastmoney.com/data/jdzf.html' } });
  if (!text || typeof text !== 'string') return null;
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  let db;
  try {
    db = new Function(`return ${text.slice(s, e + 1)}`)();
  } catch (err) {
    return null;
  }
  const rows = [];
  for (const r of db.datas || []) {
    if (!r || !/^\d{6}$/.test(String(r[0] || ''))) continue;
    const nav = Number(r[3]);
    rows.push({
      code: String(r[0]),
      name: String(r[1] || ''),
      pinyin: String(r[2] || '').toUpperCase(),
      nav: nav > 0 ? nav : null,
      prevNav: Number(r[5]) > 0 ? Number(r[5]) : null,
      pct: r[8] != null && isFinite(Number(r[8])) ? Number(r[8]) : null,
      sg: String(r[9] || ''),
      sh: String(r[10] || ''),
    });
  }
  return {
    date: Array.isArray(db.showday) && db.showday[0] ? String(db.showday[0]) : null,
    total: Number(db.record) || 0,
    pages: Number(db.pages) || 0,
    rows,
  };
}

/**
 * 大盘指数 / ETF 实时行情（push2）。
 * secids 形如 '1.000001,0.159915'。
 */
export async function fetchMarketQuotes(secids) {
  if (!secids || secids.length === 0) return [];
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
    + `?fltt=2&secids=${encodeURIComponent(secids.join(','))}`
    + '&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18';
  const data = await request(url);
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  return diff.map(d => ({
    code: String(d.f12 || ''),
    name: String(d.f14 || ''),
    price: num(d.f2),
    changePct: num(d.f3),
    changeAmt: num(d.f4),
    amount: num(d.f6),
    high: num(d.f15),
    low: num(d.f16),
    open: num(d.f17),
    prevClose: num(d.f18),
  }));
}

function num(v) {
  return v != null && isFinite(v) ? Number(v) : null;
}

/** 基金详情：pingzhongdata 里的历史净值走势。 */
export async function fetchFundDetail(code) {
  const text = await requestText(`https://fund.eastmoney.com/pingzhongdata/${code}.js`);
  if (!text || typeof text !== 'string') return null;
  const m = /\bData_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/.exec(text);
  if (!m) return null;
  try {
    const trend = JSON.parse(m[1]).filter(p => p && p.y != null);
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1];
    const first = trend.find(p => p.y);
    const spans = {};
    for (const [key, days] of [['w1', 7], ['m1', 30], ['m3', 90], ['m6', 180], ['y1', 365], ['y3', 1095]]) {
      const t0 = last.x - days * 24 * 3600 * 1000;
      let base = null;
      for (const p of trend) { if (p.x >= t0 && p.y != null) { base = p; break; } }
      if (!base) base = first;
      spans[key] = base && base.y && last.y ? (last.y / base.y - 1) * 100 : null;
    }
    return {
      code,
      latestNav: last.y,
      latestDate: new Date(last.x).toISOString().slice(0, 10),
      totalPct: first && first.y ? (last.y / first.y - 1) * 100 : null,
      spans,
      trend: sampleTrend(trend, 180, 60),
    };
  } catch (e) {
    return null;
  }
}

function sampleTrend(trend, days, maxPoints) {
  const last = trend[trend.length - 1];
  const t0 = last.x - days * 24 * 3600 * 1000;
  const window = trend.filter(p => p.x >= t0 && p.y != null);
  if (window.length === 0) return [];
  const step = Math.max(1, Math.ceil(window.length / maxPoints));
  const out = [];
  for (let i = 0; i < window.length; i += step) {
    const d = new Date(window[i].x);
    out.push({ d: `${d.getMonth() + 1}/${d.getDate()}`, v: window[i].y });
  }
  const lastPoint = window[window.length - 1];
  const d = new Date(lastPoint.x);
  const entry = { d: `${d.getMonth() + 1}/${d.getDate()}`, v: lastPoint.y };
  if (out.length === 0 || out[out.length - 1].d !== entry.d) out.push(entry);
  return out;
}
