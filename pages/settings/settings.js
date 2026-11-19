import {
  libInfo, fundBaseTypes, fundBasePage, clearFundBase, clearAll,
  exportDb, importDb, markLibRefreshed, initDb,
} from '../../utils/db.js';
import { listMasterPasswords, addMasterPassword, removeMasterPassword, clearMasterPasswords, isValidMasterPassword, MASTER_PWD_MAX, MASTER_PWD_LENGTH } from '../../utils/store.js';
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

    fundStatus: 'onsale',      // onsale | all
    showMasterMgr: false,
    masterCount: 0,
    masterList: [],
    masterInput: '',
    masterMsg: '',

    showImport: false,
    importText: '',
    importMsg: '',
  },

  onShow() {
    this.loadAll();
  },

  loadAll() {
    initDb();
    const info = libInfo();
    const count = listMasterPasswords().length;
    this.setData({
      info,
      types: fundBaseTypes(),
      masterCount: count,
      masterList: this.buildMasterList(),
      fundStatus: this.data.fundStatus || 'onsale',
    });
    this.loadFunds();
  },

  buildMasterList() {
    const n = listMasterPasswords().length;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ index: i, no: i + 1 });
    return out;
  },

  syncMaster() {
    const count = listMasterPasswords().length;
    this.setData({ masterCount: count, masterList: this.buildMasterList() });
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

  // --- 导入导出 -------------------------------------------------------------

  toggleImport() {
    this.setData({ showImport: !this.data.showImport, importText: '', importMsg: '' });
  },

  onImportText(e) {
    this.setData({ importText: e.detail.value, importMsg: '' });
  },

  doExport() {
    const json = exportDb();
    this.setData({ showImport: true, importText: json, importMsg: '已导出到下方文本框，可复制保存' });
    my.setClipboard({ data: json });
    toast('已复制到剪贴板');
  },

  doImport() {
    const res = importDb(this.data.importText);
    this.setData({ importMsg: res.message });
    if (res.ok) {
      toast('导入成功');
      this.loadAll();
    }
  },

  // --- 万能密码 -------------------------------------------------------------

  toggleMasterMgr() {
    this.syncMaster();
    this.setData({ showMasterMgr: !this.data.showMasterMgr, masterInput: '', masterMsg: '' });
  },

  onMasterInput(e) {
    this.setData({ masterInput: e.detail.value, masterMsg: '' });
  },

  addMaster() {
    const pwd = String(this.data.masterInput || '').trim();
    if (!isValidMasterPassword(pwd)) {
      this.setData({ masterMsg: `万能密码必须是 ${MASTER_PWD_LENGTH} 位数字` });
      return;
    }
    const res = addMasterPassword(pwd);
    this.setData({ masterMsg: res.message, masterInput: res.ok ? '' : this.data.masterInput });
    this.syncMaster();
    if (res.ok) toast('已添加万能密码');
  },

  removeMaster(e) {
    const index = e.currentTarget.dataset.index;
    confirm(`确定删除第 ${Number(index) + 1} 个万能密码？`, '删除万能密码').then(ok => {
      if (!ok) return;
      const r = removeMasterPassword(index);
      this.setData({ masterMsg: r.message });
      this.syncMaster();
    });
  },

  clearMasters() {
    confirm(`确定删除全部 ${this.data.masterCount} 个万能密码？`, '清空万能密码').then(ok => {
      if (!ok) return;
      const r = clearMasterPasswords();
      this.setData({ masterMsg: r.message });
      this.syncMaster();
    });
  },
});
