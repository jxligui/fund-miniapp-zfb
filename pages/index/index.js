import { fetchMarketQuotes, fetchFundQuotes } from '../utils/api.js';
import { INDEX_LIBRARY, ETF_LIBRARY } from '../utils/data.js';
import { listHoldings, listWatchedIndices, setWatch, upsertHolding, setWatchedIndices } from '../utils/store.js';
import { money, pct, signedMoney, signColor, compactAmt, debounce, toast } from '../utils/util.js';

const PAGE_SIZE = 10;

Page({
  data: {
    sub: 'index',        // index | fund | etf
    indexPage: 1,
    indexPages: 1,
    indices: [],
    etfs: [],
    fundPage: 1,
    fundPages: 1,
    funds: [],
    fundQuery: '',
    fundType: 'all',
    fundTypes: [],
    loading: false,
    watchedIndices: [],
  },

  onLoad() {
    this.setData({ watchedIndices: listWatchedIndices() });
    this._debouncedLoadFunds = debounce(() => this.loadFunds(), 300);
    this.loadIndex();
  },

  onShow() {
    this.setData({ watchedIndices: listWatchedIndices() });
    this.refreshCurrent();
  },

  onPullDownRefresh() {
    this.refreshCurrent().then(() => my.stopPullDownRefresh());
  },

  switchSub(e) {
    const sub = e.currentTarget.dataset.sub;
    this.setData({ sub });
    if (sub === 'index') this.loadIndex();
    else if (sub === 'etf') this.loadEtf();
    else this.loadFunds();
  },

  refreshCurrent() {
    if (this.data.sub === 'index') return this.loadIndex();
    if (this.data.sub === 'etf') return this.loadEtf();
    return this.loadFunds();
  },

  // --- 大盘指数 -------------------------------------------------------------

  async loadIndex() {
    this.setData({ loading: true });
    const watched = new Set(listWatchedIndices());
    const secids = INDEX_LIBRARY.map(x => x[0]);
    const quotes = await fetchMarketQuotes(secids);
    const byCode = {};
    for (const q of quotes) byCode[q.code] = q;
    const all = INDEX_LIBRARY.map(([secid, code, name, category]) => {
      const q = byCode[code] || {};
      return {
        code, name, category,
        price: q.price != null ? money(q.price) : '—',
        changePct: q.changePct != null ? pct(q.changePct) : '—',
        pctClass: q.changePct > 0 ? 'up' : (q.changePct < 0 ? 'down' : ''),
        color: signColor(q.changePct),
        changeAmt: q.changeAmt != null ? signedMoney(q.changeAmt) : '—',
        watched: watched.has(code),
      };
    });
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.min(this.data.indexPage, pages);
    this.setData({
      indices: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      indexPage: page, indexPages: pages,
      loading: false,
    });
  },

  prevIndexPage() { this.setData({ indexPage: Math.max(1, this.data.indexPage - 1) }, () => this.loadIndex()); },
  nextIndexPage() { this.setData({ indexPage: Math.min(this.data.indexPages, this.data.indexPage + 1) }, () => this.loadIndex()); },

  toggleIndexWatch(e) {
    const code = e.currentTarget.dataset.code;
    const name = e.currentTarget.dataset.name;
    const watched = new Set(listWatchedIndices());
    if (watched.has(code)) {
      watched.delete(code);
      setWatchedIndices([...watched]);
    } else {
      watched.add(code);
      setWatchedIndices([...watched]);
      // 同时加入本地自选记录，便于统一管理
      const exists = listHoldings().some(x => x.code === code);
      if (!exists) upsertHolding({ code, name, watch: true, shares: null, cost: null });
    }
    this.setData({ watchedIndices: listWatchedIndices() });
    toast(watched.has(code) ? '已加入自选' : '已取消自选');
  },

  // --- ETF ------------------------------------------------------------------

  async loadEtf() {
    this.setData({ loading: true });
    const quotes = await fetchMarketQuotes(ETF_LIBRARY.map(x => x[0]));
    const byCode = {};
    for (const q of quotes) byCode[q.code] = q;
    const watched = new Set(listHoldings().filter(x => x.watch).map(x => x.code));
    this.setData({
      etfs: ETF_LIBRARY.map(([secid, code, name, theme]) => {
        const q = byCode[code] || {};
        return {
          code, name, theme,
          price: q.price != null ? money(q.price) : '—',
          changePct: q.changePct != null ? pct(q.changePct) : '—',
          pctClass: q.changePct > 0 ? 'up' : (q.changePct < 0 ? 'down' : ''),
          color: signColor(q.changePct),
          changeAmt: q.changeAmt != null ? signedMoney(q.changeAmt) : '—',
          amount: compactAmt(q.amount),
          watched: watched.has(code),
        };
      }),
      loading: false,
    });
  },

  toggleEtfWatch(e) {
    const { code, name } = e.currentTarget.dataset;
    const exists = listHoldings().some(x => x.code === code);
    if (exists) {
      setWatch(code, !listHoldings().find(x => x.code === code).watch);
    } else {
      upsertHolding({ code, name, watch: true, shares: null, cost: null });
    }
    this.loadEtf();
  },

  // --- 全部基金 -------------------------------------------------------------

  onFundQuery(e) {
    this.setData({ fundQuery: e.detail.value, fundPage: 1 });
    this._debouncedLoadFunds();
  },

  async loadFunds() {
    this.setData({ loading: true });
    const { fundQuery, fundType, fundPage } = this.data;
    // 演示/自选/持仓的基金优先展示（本地数据），再补网络搜索结果
    let items = [];
    const local = listHoldings().filter(h => h.name && h.name.includes(fundQuery.trim()));
    items = local.map(h => ({ code: h.code, name: h.name, type: '已添加' }));

    if (fundQuery.trim()) {
      const { searchFundList } = require('../utils/data.js');
      const remote = await searchFundList(fundQuery.trim());
      const seen = new Set(items.map(x => x.code));
      for (const r of remote) if (!seen.has(r.code)) items.push(r);
    }

    // 按类型筛选
    if (fundType !== 'all') items = items.filter(x => (x.type || '').includes(fundType));

    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(fundPage, pages);
    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // 补充行情
    const quotes = await fetchFundQuotes(slice.map(x => x.code));
    const enriched = slice.map(x => {
      const q = quotes[x.code];
      return {
        ...x,
        nav: q ? money(q.nav) : '—',
        changePct: q ? pct(q.pct) : '—',
        pctClass: q && q.pct > 0 ? 'up' : (q && q.pct < 0 ? 'down' : ''),
        color: signColor(q ? q.pct : null),
      };
    });

    this.setData({
      funds: enriched,
      fundPage: page, fundPages: pages,
      fundTypes: Array.from(new Set(items.map(x => x.type).filter(Boolean))).slice(0, 12),
      loading: false,
    });
  },

  prevFundPage() { this.setData({ fundPage: Math.max(1, this.data.fundPage - 1) }, () => this.loadFunds()); },
  nextFundPage() { this.setData({ fundPage: Math.min(this.data.fundPages, this.data.fundPage + 1) }, () => this.loadFunds()); },

  onFundType(e) {
    this.setData({ fundType: e.currentTarget.dataset.type, fundPage: 1 });
    this.loadFunds();
  },

  toggleFundWatch(e) {
    const { code, name } = e.currentTarget.dataset;
    const existing = listHoldings().find(x => x.code === code);
    if (existing) {
      setWatch(code, !existing.watch);
    } else {
      upsertHolding({ code, name, watch: true, shares: null, cost: null });
    }
    toast('已更新自选');
    this.loadFunds();
  },
});
