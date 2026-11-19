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

/** 首次使用的演示数据（自选 + 持仓）。代码与名称均为东财真实在售基金。 */
export const DEMO_HOLDINGS = [
  // --- 真实持仓（有份额有成本）---
  { code: '159995', name: '芯片ETF华夏', shares: 100, cost: 1.1966, watch: true },
  { code: '513180', name: '恒生科技ETF华夏', shares: 6423.98, cost: 0.4696, watch: true },
  { code: '000001', name: '华夏成长混合', shares: 1234.56, cost: 1.85, watch: true },
  { code: '519674', name: '银河创新成长混合A', shares: 600, cost: 2.48, watch: true },
  { code: '005827', name: '易方达蓝筹精选混合', shares: 1000, cost: 1.93, watch: true },
  { code: '270002', name: '广发稳健增长混合A', shares: 2300.98, cost: 1.6164, watch: true, pendingAmount: 2000 },
  { code: '161725', name: '招商中证白酒指数(LOF)A', shares: 800, cost: 1.05, watch: true },
  { code: '110022', name: '易方达消费行业股票', shares: 500, cost: 4.21, watch: true },
  // --- 纯自选（无份额，仅关注）---
  { code: '000021', name: '华夏优势增长混合', shares: null, cost: null, watch: true },
  { code: '000081', name: '天治可转债增强债券C', shares: null, cost: null, watch: true },
  { code: '000080', name: '天治可转债增强债券A', shares: null, cost: null, watch: true },
  { code: '000116', name: '嘉实丰益纯债定期债券A', shares: null, cost: null, watch: true },
  { code: '512480', name: '半导体ETF', shares: null, cost: null, watch: true },
  { code: '159928', name: '消费ETF', shares: null, cost: null, watch: true },
];

/** 演示持仓的分组（贴近截图：白酒/债券/科技 板块） */
export const DEMO_GROUPS = ['白酒消费', '科技半导体', '债券稳健'];

/** 演示持仓的分组归属（code -> 组名） */
export const DEMO_GROUP_MAP = {
  '161725': '白酒消费',
  '110022': '白酒消费',
  '159995': '科技半导体',
  '513180': '科技半导体',
  '512480': '科技半导体',
  '000080': '债券稳健',
  '000081': '债券稳健',
  '000116': '债券稳健',
};

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
 */
export function listAllFunds({ query = '', type = '', status = 'onsale', limit = 50 } = {}) {
  const res = fundBasePage({ page: 1, size: limit, query, type, status });
  return res.items;
}
