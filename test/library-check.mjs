/**
 * 校验默认自选指数与 ETF 清单在东方财富行情接口上是否真实可取。
 */
const H = { referer: 'https://fund.eastmoney.com/' };

const DEFAULT_INDICES = ['000001', '399001', '399006', '000300', '000905', '000016', 'HSI'];

const INDEX_LIBRARY = [
  ['1.000001', '000001', '上证指数', '大盘'],
  ['0.399001', '399001', '深证成指', '大盘'],
  ['0.399006', '399006', '创业板指', '大盘'],
  ['1.000300', '000300', '沪深300', '规模'],
  ['1.000905', '000905', '中证500', '规模'],
  ['1.000016', '000016', '上证50', '规模'],
  ['0.399673', '399673', '创业板50', '规模'],
  ['1.000688', '000688', '科创50', '规模'],
  ['0.399102', '399102', '创业板综', '规模'],
  ['100.HSI', 'HSI', '恒生指数', '海外'],
  ['100.DJIA', 'DJIA', '道琼斯', '海外'],
  ['100.NDX', 'NDX', '纳斯达克', '海外'],
  ['100.SPX', 'SPX', '标普500', '海外'],
  ['1.000852', '000852', '中证1000', '规模'],
  ['0.399005', '399005', '中小100', '规模'],
  ['1.000009', '000009', '上证380', '规模'],
  ['0.399330', '399330', '深证100', '规模'],
  ['1.000010', '000010', '上证180', '规模'],
  ['1.000040', '000040', '上证电信', '行业'],
  ['0.399606', '399606', '创业板R', '行业'],
  ['1.000922', '000922', '中证红利', '红利'],
  ['1.000015', '000015', '红利指数', '红利'],
  ['1.000132', '000132', '上证100', '规模'],
  ['0.399903', '399903', '中证100', '规模'],
  ['0.399303', '399303', '国证2000', '规模'],
  ['1.000998', '000998', '中证TMT', '行业'],
  ['0.399393', '399393', '国证地产', '行业'],
  ['0.399395', '399395', '国证有色', '行业'],
];

const ETF_LIBRARY = [
  ['1.510300', '510300', '沪深300ETF', '宽基'],
  ['1.510500', '510500', '中证500ETF', '宽基'],
  ['1.510050', '510050', '上证50ETF', '宽基'],
  ['1.588000', '588000', '科创50ETF', '科技'],
  ['0.159915', '159915', '创业板ETF', '宽基'],
  ['1.512480', '512480', '半导体ETF', '科技'],
  ['0.159928', '159928', '消费ETF', '消费'],
  ['1.512690', '512690', '酒ETF', '消费'],
  ['1.515790', '515790', '光伏ETF', '新能源'],
  ['1.515030', '515030', '新能源车ETF', '新能源'],
  ['0.159875', '159875', '新能源ETF', '新能源'],
  ['1.512010', '512010', '医药ETF', '医药'],
  ['0.159929', '159929', '医药ETF', '医药'],
  ['1.512660', '512660', '军工ETF', '军工'],
  ['1.512000', '512000', '券商ETF', '金融'],
  ['1.512800', '512800', '银行ETF', '金融'],
  ['1.512400', '512400', '有色金属ETF', '周期'],
  ['1.512980', '512980', '传媒ETF', '传媒'],
  ['0.159611', '159611', '电力ETF', '公用'],
  ['1.515050', '515050', '通信ETF', '科技'],
  ['1.510880', '510880', '红利ETF', '红利'],
  ['0.159949', '159949', '创业板50ETF', '宽基'],
  ['1.513180', '513180', '恒生科技ETF', '海外'],
  ['0.159941', '159941', '纳指ETF', '海外'],
];

async function quotes(secids) {
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
    + `?fltt=2&secids=${encodeURIComponent(secids.join(','))}`
    + '&fields=f2,f3,f4,f12,f14,f18';
  const data = await fetch(url, { headers: H }).then(r => r.json()).catch(() => null);
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  return diff.map(d => ({ code: String(d.f12 || ''), name: String(d.f14 || ''), price: d.f2, pct: d.f3 }));
}

let total = 0, ok = 0;

console.log('=== 默认自选指数（7 个）行情可取性 ===\n');
{
  const picked = INDEX_LIBRARY.filter(x => DEFAULT_INDICES.includes(x[1]));
  const rows = await quotes(picked.map(x => x[0]));
  const map = {};
  for (const r of rows) map[r.code] = r;
  for (const [secid, code, name] of picked) {
    total++;
    const q = map[code];
    if (q && q.price != null && q.price > 0) {
      console.log(`  OK    ${code}  ${name.padEnd(10)} ${String(q.price).padStart(10)}  ${q.pct}%`);
      ok++;
    } else {
      console.log(`  MISS  ${code}  ${name}`);
    }
  }
}

console.log('\n=== 全部指数清单行情可取性 ===\n');
{
  const rows = await quotes(INDEX_LIBRARY.map(x => x[0]));
  const map = {};
  for (const r of rows) map[r.code] = r;
  for (const [secid, code, name] of INDEX_LIBRARY) {
    total++;
    const q = map[code];
    if (q && q.price != null && q.price > 0) { ok++; }
    else { console.log(`  MISS  ${code}  ${name}  (secid ${secid})`); }
  }
  console.log(`  ${ok} / ${INDEX_LIBRARY.length} 个指数可取`);
}

console.log('\n=== 全部 ETF 清单行情可取性 ===\n');
{
  const before = ok;
  const rows = await quotes(ETF_LIBRARY.map(x => x[0]));
  const map = {};
  for (const r of rows) map[r.code] = r;
  let etfOk = 0;
  for (const [secid, code, name] of ETF_LIBRARY) {
    total++;
    const q = map[code];
    if (q && q.price != null && q.price > 0) { ok++; etfOk++; }
    else { console.log(`  MISS  ${code}  ${name}  (secid ${secid})`); }
  }
  console.log(`  ${etfOk} / ${ETF_LIBRARY.length} 个 ETF 可取`);
}

console.log(`\n总计 ${ok} / ${total} 可取`);
process.exitCode = ok === total ? 0 : 1;
