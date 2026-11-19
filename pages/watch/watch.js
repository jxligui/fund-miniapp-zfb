import { fetchMarketQuotes, fetchFundQuotes } from '../../utils/api.js';
import { INDEX_LIBRARY } from '../../utils/data.js';
import {
  listHoldings, listWatchedIndices, setWatchedIndices, removeHolding, buildPortfolio, putNav,
} from '../../utils/store.js';
import { money, pct, signedMoney, signColor, toast, confirm } from '../../utils/util.js';

Page({
  data: {
    sub: 'index',
    indices: [],
    funds: [],
    totals: {},
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => my.stopPullDownRefresh());
  },

  switchSub(e) {
    this.setData({ sub: e.currentTarget.dataset.sub });
    this.load();
  },

  async load() {
    if (this.data.sub === 'index') await this.loadIndices();
    else await this.loadFunds();
  },

  async loadIndices() {
    const watched = listWatchedIndices();
    if (watched.length === 0) { this.setData({ indices: [] }); return; }
    const secids = INDEX_LIBRARY.filter(x => watched.includes(x[1])).map(x => x[0]);
    const quotes = await fetchMarketQuotes(secids);
    const byCode = {};
    for (const q of quotes) byCode[q.code] = q;
    this.setData({
      indices: watched.map(code => {
        const meta = INDEX_LIBRARY.find(x => x[1] === code) || [null, code, code, ''];
        const q = byCode[code] || {};
        return {
          code,
          name: meta[2],
          category: meta[3],
          price: q.price != null ? money(q.price) : '—',
          changePct: q.changePct != null ? pct(q.changePct) : '—',
          pctClass: q.changePct > 0 ? 'idx-pct-up' : (q.changePct < 0 ? 'idx-pct-down' : ''),
          color: signColor(q.changePct),
          changeAmt: q.changeAmt != null ? signedMoney(q.changeAmt) : '—',
        };
      }),
    });
  },

  async loadFunds() {
    const watchFunds = listHoldings().filter(h => h.watch);
    if (watchFunds.length === 0) { this.setData({ funds: [] }); return; }
    const quotes = await fetchFundQuotes(watchFunds.map(h => h.code));
    for (const code in quotes) {
      const q = quotes[code];
      // 缓存净值，便于持仓金额离线计算
      putNav(code, { date: q.date, nav: q.nav, prevNav: q.prevNav, pct: q.pct });
    }
    const { rows } = buildPortfolio(watchFunds, quotes);
    this.setData({
      funds: rows.map(r => ({
        code: r.code, name: r.name,
        isHeld: r.shares != null,
        shares: r.shares != null ? money(r.shares) : '—',
        nav: r.nav != null ? money(r.nav) : '—',
        changePct: r.changePct != null ? pct(r.changePct) : '—',
        pctClass: r.changePct > 0 ? 'idx-pct-up' : (r.changePct < 0 ? 'idx-pct-down' : ''),
        color: signColor(r.changePct),
        amount: r.amount != null ? money(r.amount) : '—',
        usingYesterday: r.usingYesterday,
      })),
    });
  },

  removeIndex(e) {
    const code = e.currentTarget.dataset.code;
    confirm('取消自选该指数？', '提示').then(ok => {
      if (!ok) return;
      setWatchedIndices(listWatchedIndices().filter(c => c !== code));
      toast('已取消自选');
      this.load();
    });
  },

  async removeFund(e) {
    const { code, name } = e.currentTarget.dataset;
    const hold = listHoldings().find(x => x.code === code);
    if (hold && hold.shares != null) {
      toast('已在持仓的基金不能取消自选');
      return;
    }
    const ok = await confirm(`取消自选「${name}」？`, '提示');
    if (!ok) return;
    removeHolding(code);
    toast('已取消自选');
    this.load();
  },

  goHoldings() {
    my.switchTab({ url: '/pages/holdings/holdings' });
  },

  goDetail(e) {
    const code = e.currentTarget.dataset.code;
    const name = e.currentTarget.dataset.name || '';
    my.navigateTo({ url: `/pages/detail/detail?code=${code}&name=${encodeURIComponent(name)}` });
  },
});
