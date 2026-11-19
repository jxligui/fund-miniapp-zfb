import { fetchMarketQuotes, fetchFundQuotes, getLastRequestError } from '../../utils/api.js';
import { INDEX_LIBRARY, ETF_LIBRARY, searchFundList, listAllFunds } from '../../utils/data.js';
import { listHoldings, listWatchedIndices, setWatch, upsertHolding, setWatchedIndices, autoRefreshMixin, markUpdated } from '../../utils/store.js';
import { money, pct, signedMoney, signColor, compactAmt, debounce, toast } from '../../utils/util.js';

const PAGE_SIZE = 10;

Page({
  ...autoRefreshMixin(),

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
    loadFailed: false,
    failReason: '',
    watchedIndices: [],
  },

  onLoad() {
    this.setData({ watchedIndices: listWatchedIndices() });
    this._debouncedLoadFunds = debounce(() => this.loadFunds(), 300);
    this.loadIndex();
  },

  onShow() {
    this.setData({ watchedIndices: listWatchedIndices() });
    this.resumeAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  /** 定时刷新入口：刷新当前子页行情 */
  refreshNow() {
    markUpdated();
    return this.refreshCurrent();
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
    this.setData({ loading: true, loadFailed: false, failReason: '' });
    const watched = new Set(listWatchedIndices());
    const secids = INDEX_LIBRARY.map(x => x[0]);
    try {
      const quotes = await fetchMarketQuotes(secids);
      // 请求全空 = 网络不通 / 域名白名单未配置
      if (!quotes || quotes.length === 0) {
        const err = getLastRequestError();
        this.setData({
          loading: false,
          loadFailed: true,
          failReason: err ? `error=${err.error} ${err.message} ${err.url}` : 'my.request 无响应（无错误码）',
        });
        return;
      }
      const byCode = {};
      for (const q of quotes) byCode[q.code] = q;
      const all = INDEX_LIBRARY.map(([secid, code, name, category]) => {
        const q = byCode[code] || {};
        return {
          code, name, category,
          price: q.price != null ? money(q.price) : '—',
          changePct: q.changePct != null ? pct(q.changePct) : '—',
          pctClass: q.changePct > 0 ? 'idx-pct-up' : (q.changePct < 0 ? 'idx-pct-down' : ''),
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
    } catch (e) {
      // 任何同步/异步异常都不允许卡死页面
      this.setData({
        loading: false,
        loadFailed: true,
        failReason: `页面异常: ${e && e.message ? e.message : e}`,
      });
    }
  },

  retryLoad() {
    this.refreshCurrent();
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
    if (!quotes || quotes.length === 0) {
      this.setData({ loading: false, loadFailed: true });
      return;
    }
    this.setData({ loadFailed: false });
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
          pctClass: q.changePct > 0 ? 'idx-pct-up' : (q.changePct < 0 ? 'idx-pct-down' : ''),
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
    const q = fundQuery.trim();

    // 1) 本地基金库（离线可用）
    let items = listAllFunds({ query: q, type: fundType === 'all' ? '' : fundType, status: 'all' })
      .map(r => ({ code: r.code, name: r.name, type: r.type || '其他' }));

    // 2) 持仓/自选（即使不在基金库也要显示）
    const seen = new Set(items.map(x => x.code));
    for (const h of listHoldings()) {
      if (!h.name) continue;
      if (q && h.name.indexOf(q) < 0 && String(h.code).indexOf(q) < 0) continue;
      if (seen.has(h.code)) continue;
      items.push({ code: h.code, name: h.name, type: '已添加' });
      seen.add(h.code);
    }

    // 3) 网络搜索补齐
    if (q) {
      const remote = await searchFundList(q);
      for (const r of remote) {
        if (seen.has(r.code)) continue;
        items.push(r);
        seen.add(r.code);
      }
    }

    // 按类型筛选
    if (fundType !== 'all') items = items.filter(x => (x.type || '').indexOf(fundType) >= 0);

    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(fundPage, pages);
    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // 补充行情
    const quotes = await fetchFundQuotes(slice.map(x => x.code));
    const watchedSet = new Set(listHoldings().filter(x => x.watch).map(x => x.code));
    const enriched = slice.map(x => {
      const q2 = quotes[x.code];
      return {
        ...x,
        nav: q2 ? money(q2.nav) : '—',
        changePct: q2 ? pct(q2.pct) : '—',
        pctClass: q2 && q2.pct > 0 ? 'idx-pct-up' : (q2 && q2.pct < 0 ? 'idx-pct-down' : ''),
        color: signColor(q2 ? q2.pct : null),
        watched: watchedSet.has(x.code),
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
