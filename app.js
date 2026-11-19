import { listHoldings, listWatchedIndices, saveHoldings, setWatchedIndices } from './utils/store.js';
import { DEMO_HOLDINGS, DEFAULT_INDICES } from './utils/data.js';

App({
  onLaunch() {
    // 首次启动：播种演示数据（仅本地）
    this.seedDemoData();
  },

  /** 首次使用时播种演示持仓 + 默认自选指数。 */
  seedDemoData() {
    try {
      if (listHoldings().length === 0 && !my.getStorageSync('ft.seeded')) {
        saveHoldings(DEMO_HOLDINGS.map(h => ({
          code: h.code, name: h.name, shares: h.shares, cost: h.cost,
          watch: h.watch, groupName: null, pendingAmount: null, updatedAt: Date.now(),
        })));
        my.setStorageSync('ft.seeded', '1');
      }
      if (listWatchedIndices().length === 0) {
        setWatchedIndices(DEFAULT_INDICES.slice());
      }
    } catch (e) {
      console.error('[app] seed failed', e);
    }
  },
});
