/**
 * 内置清单与本地数据源。
 *
 * 指数/ETF 清单内置在包里（离线可用），行情实时走 push2。
 * 基金检索：本地基金库（fund_base）+ 用户持仓，检索走东财搜索接口。
 *
 * 常量放在 constants.js，避免 data.js <-> db.js 的循环依赖。
 */

import { upsertFundBase, fundBasePage } from './db.js';
import { INDEX_LIBRARY, ETF_LIBRARY, DEFAULT_INDICES } from './constants.js';

export { INDEX_LIBRARY, ETF_LIBRARY, DEFAULT_INDICES };

/** 首次使用的演示持仓（成本贴近真实净值，盈亏混合） */
export const DEMO_HOLDINGS = [
  { code: '000001', name: '华夏成长混合', shares: 1200, cost: 0.8640, watch: true },
  { code: '110022', name: '易方达消费行业股票', shares: 800, cost: 3.2510, watch: true },
  { code: '161725', name: '招商中证白酒指数(LOF)A', shares: 2000, cost: 0.6370, watch: true },
  { code: '519674', name: '银河创新成长混合A', shares: 300, cost: 8.0950, watch: true },
  { code: '270002', name: '广发稳健增长混合A', shares: 1500, cost: 1.4010, watch: true },
  { code: '005827', name: '易方达蓝筹精选混合', shares: 1000, cost: 1.4800, watch: true },
  { code: '000021', name: '华夏优势增长混合', shares: null, cost: null, watch: true },
  { code: '512480', name: '半导体ETF', shares: null, cost: null, watch: true },
  { code: '159928', name: '消费ETF', shares: null, cost: null, watch: true },
];

/**
 * 基金检索（东财接口）。
 * 返回 [{ code, name, type }]
 */
export function searchFundList(query) {
  return new Promise(resolve => {
    my.request({
      url: `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx`
        + `?m=1&key=${encodeURIComponent(query)}`,
      header: { referer: 'https://fund.eastmoney.com/' },
      timeout: 12000,
      success: res => {
        const data = res && res.data;
        const datas = data && data.Datas ? data.Datas : (Array.isArray(data) ? data : []);
        const out = [];
        for (const d of datas) {
          const code = String((d && d.CODE) || '').trim();
          if (!/^\d{6}$/.test(code)) continue;
          const row = {
            code,
            name: String((d && d.NAME) || '').replace(/<[^>]*>/g, ''),
            type: String((d && (d.FundBaseInfo && d.FundBaseInfo.FTYPE)) || d.CATEGORYDESC || ''),
          };
          out.push(row);
          // 搜索结果顺带写入本地基金库，便于离线检索
          try { upsertFundBase(row); } catch (e) {}
          if (out.length >= 20) break;
        }
        resolve(out);
      },
      fail: () => resolve([]),
    });
  });
}

/**
 * 全量基金检索：优先读本地基金库（离线可用），再用网络结果补齐。
 * 与 DSH 插件的 fund_base 表行为一致。
 */
export function listAllFunds({ query = '', type = '', status = 'onsale', limit = 50 } = {}) {
  const res = fundBasePage({ page: 1, size: limit, query, type, status });
  return res.items;
}
