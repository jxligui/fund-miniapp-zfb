import {
  libInfo, fundBaseTypes, fundBasePage, clearFundBase, clearAll,
  initDb, syncFundLibrary,
} from '../../utils/db.js';
import { fetchFundPage } from '../../utils/api.js';
import {
  getRefreshSec, setRefreshSec, getLastUpdated, markUpdated,
  REFRESH_OPTIONS,
} from '../../utils/store.js';
import { toast, confirm } from '../../utils/util.js';

Page({
  data: {
    info: null,
    types: [],
    fundPage: 1,
    fundPages: 1,
    fundQuery: '',
    fundType: '',
    funds: [],
    total: 0,

    fundStatus: 'onsale',

    // 行情刷新
    refreshSec: 30,
    refreshOptions: [],
    lastUpdatedText: '尚未刷新',
    syncing: false,
    syncProgress: '',
  },

  onShow() {
    this.loadAll();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  loadAll() {
    initDb();
    const sec = getRefreshSec();
    this.setData({
      info: libInfo(),
      types: fundBaseTypes(),
      refreshSec: sec,
      refreshOptions: REFRESH_OPTIONS.map(v => ({ value: v, label: v === 0 ? '关闭' : (v >= 60 ? `${v / 60} 分钟` : `${v} 秒`) })),
      lastUpdatedText: this.formatLastUpdated(getLastUpdated()),
    });
    this.loadFunds();
    this.setupTimer();
  },

  formatLastUpdated(ts) {
    if (!ts) return '尚未刷新';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return `今天 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  },

  // --- 自动刷新定时器 ---------------------------------------------------------

  setupTimer() {
    this.stopTimer();
    const sec = this.data.refreshSec;
    if (!sec) return;
    this._timer = setInterval(() => this.refreshQuotes(), sec * 1000);
  },

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  /** 手动/定时刷新：通知其它页面重新拉行情 */
  refreshQuotes() {
    markUpdated();
    this.setData({ lastUpdatedText: this.formatLastUpdated(getLastUpdated()) });
    // 行情页在 onShow 时会重拉；这里触发全局事件广播
    if (my.triggerEvent) {
      try { my.triggerEvent('ft-refresh'); } catch (e) {}
    }
  },

  async manualUpdate() {
    if (this.data.syncing) return;
    this.setData({ syncing: true, syncProgress: '' });
    try {
      this.refreshQuotes();
      toast('行情已刷新');
    } finally {
      this.setData({ syncing: false });
    }
  },

  onRefreshPick(e) {
    const value = Number(e.currentTarget.dataset.value);
    const next = setRefreshSec(value);
    this.setData({ refreshSec: next });
    this.setupTimer();
    toast(value === 0 ? '已关闭自动刷新' : `自动刷新：${value >= 60 ? `${value / 60} 分钟` : `${value} 秒`}`);
  },

  // --- 基金库同步（外部数据源：东财全量在售基金） ----------------------------

  async syncLibrary() {
    if (this.data.syncing) return;
    this.setData({ syncing: true, syncProgress: '开始同步…' });
    try {
      const res = await syncFundLibrary(fetchFundPage, {
        onProgress: (page, pages, count) => {
          this.setData({ syncProgress: `同步中 第 ${page}/${pages || '?'} 页 · 已入库 ${count} 只` });
        },
      });
      if (res.onSale > 0) {
        this.setData({ syncProgress: `同步完成：${res.onSale} 只在售基金，净值 ${res.navRows} 条（${res.date}）` });
        toast(`已同步 ${res.onSale} 只基金`);
      } else {
        this.setData({ syncProgress: '20 小时内已同步过，或无数据返回' });
        toast('无需重复同步');
      }
      this.loadAll();
    } catch (e) {
      this.setData({ syncProgress: '同步出错：' + (e && e.message ? e.message : '未知错误') });
      toast('同步出错');
    } finally {
      this.setData({ syncing: false });
    }
  },

  // --- 基金库 ---------------------------------------------------------------

  loadFunds() {
    const { fundPage, fundQuery, fundType, fundStatus } = this.data;
    const res = fundBasePage({
      page: fundPage,
      size: 10,
      query: fundQuery,
      type: fundType,
      status: fundStatus,
    });
    this.setData({
      funds: res.items,
      total: res.total,
      fundPages: res.pages,
      fundPage: res.page,
    });
  },

  onQuery(e) {
    this.setData({ fundQuery: e.detail.value, fundPage: 1 });
    this.loadFunds();
  },

  onType(e) {
    this.setData({ fundType: e.currentTarget.dataset.type, fundPage: 1 });
    this.loadFunds();
  },

  prevPage() {
    if (this.data.fundPage <= 1) return;
    this.setData({ fundPage: this.data.fundPage - 1 }, () => this.loadFunds());
  },

  nextPage() {
    if (this.data.fundPage >= this.data.fundPages) return;
    this.setData({ fundPage: this.data.fundPage + 1 }, () => this.loadFunds());
  },

  toggleFundStatus() {
    const next = this.data.fundStatus === 'onsale' ? 'all' : 'onsale';
    this.setData({ fundStatus: next, fundPage: 1 }, () => this.loadFunds());
  },

  clearFundLib() {
    confirm('清空本地基金基础库？持仓与自选数据不受影响。', '清空基金库').then(ok => {
      if (!ok) return;
      clearFundBase();
      toast('已清空基金库');
      this.loadAll();
    });
  },

  clearEverything() {
    confirm('清空全部本地数据（持仓、自选、基金库、设置）？此操作不可撤销。', '清空全部数据').then(ok => {
      if (!ok) return;
      clearAll();
      toast('已清空全部数据');
      this.loadAll();
    });
  },
});
