import { getSettings, setSetting } from './utils/store.js';

App({
  globalData: {
    // 全局共享的行情缓存，页面间切换时避免重复请求
    quotes: {},        // { code: {nav, prevNav, pct, date, name} }
    marketQuotes: {},  // { code: {price, changePct, ...} }
    loggedIn: false,
    refreshInterval: 60,
  },

  onLaunch() {
    const s = getSettings();
    this.globalData.refreshInterval = s.refreshInterval || 60;
    // 首次启动：播种演示数据（仅本地）
    this.seedDemoData();
  },

  onShow() {
    const s = getSettings();
    this.globalData.refreshInterval = s.refreshInterval || 60;
  },

  /** 首次使用时播种演示持仓 + 默认自选指数。 */
  seedDemoData() {
    const store = require('./utils/store.js');
    const data = require('./utils/data.js');
    try {
      const existing = store.listHoldings();
      if (existing.length === 0 && !my.getStorageSync('ft.seeded')) {
        store.saveHoldings(data.DEMO_HOLDINGS.map(h => ({
          code: h.code, name: h.name, shares: h.shares, cost: h.cost,
          watch: h.watch, groupName: null, pendingAmount: null, updatedAt: Date.now(),
        })));
        my.setStorageSync('ft.seeded', '1');
      }
      if (store.listWatchedIndices().length === 0) {
        store.setWatchedIndices(data.DEFAULT_INDICES.slice());
      }
    } catch (e) {
      console.error('[app] seed failed', e);
    }
  },

  setRefreshInterval(v) {
    this.globalData.refreshInterval = v;
    setSetting('refreshInterval', v);
  },
});
