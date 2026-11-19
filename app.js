import { listHoldings, listWatchedIndices, saveHoldings, setWatchedIndices, addGroup } from './utils/store.js';
import { DEMO_HOLDINGS, DEMO_GROUPS, DEMO_GROUP_MAP, DEFAULT_INDICES } from './utils/data.js';
import { initDb, upsertFundBaseBatch } from './utils/db.js';

App({
  onLaunch() {
    // 首次启动：初始化本地数据库 + 播种演示数据（仅本地）
    try {
      initDb();
      // 演示持仓同步进基金基础库
      upsertFundBaseBatch(DEMO_HOLDINGS.map(h => ({ code: h.code, name: h.name })));
    } catch (e) {
      console.error('[app] db init failed', e);
    }
    this.seedDemoData();
  },

  /** 首次使用时播种演示持仓 + 默认自选指数。 */
  seedDemoData() {
    try {
      // 演示持仓：无持仓即播种（ft.seeded 仅防止重复加演示分组）
      if (listHoldings().length === 0) {
        saveHoldings(DEMO_HOLDINGS.map(h => ({
          code: h.code,
          name: h.name,
          shares: h.shares,
          cost: h.cost,
          watch: h.watch,
          groupName: DEMO_GROUP_MAP[h.code] || null,
          pendingAmount: h.pendingAmount || null,
          updatedAt: Date.now(),
        })));
        const seeded = my.getStorageSync({ key: 'ft.seeded' });
        if (!seeded || !seeded.data) {
          for (const g of DEMO_GROUPS) addGroup(g);
          my.setStorageSync({ key: 'ft.seeded', data: '1' });
        }
      }
      if (listWatchedIndices().length === 0) {
        setWatchedIndices(DEFAULT_INDICES.slice());
      }
    } catch (e) {
      console.error('[app] seed failed', e);
    }
  },
});
