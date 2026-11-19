import { fetchFundQuotes } from '../utils/api.js';
import { searchFundList } from '../utils/data.js';
import {
  listHoldings, upsertHolding, removeHolding, moveToGroup, moveBatchToGroup,
  listGroups, addGroup, renameGroup, deleteGroup, buildPortfolio, putNav, navOf,
  hasPin, verifyPin,
} from '../utils/store.js';
import { money, pct, signedMoney, signColor, toast, confirm, parseBatch } from '../utils/util.js';

const PIN_KEY = 'ft.unlocked';

Page({
  data: {
    unlocked: false,
    rows: [],
    totals: {},
    groups: [],
    activeGroup: '__all__',
    groupTabs: [],
    // 弹层
    showAdd: false,
    showImport: false,
    showGroupMgr: false,
    showMove: false,
    showTrade: false,
    tradeMode: 'add',
    tradeCode: '',
    tradeName: '',
    amount: '',
    importText: '',
    newGroupName: '',
    renameTarget: '',
    renameValue: '',
    moveTarget: '',
    checked: [],
    query: '',
    suggest: [],
  },

  onLoad() {
    this.checkLock();
  },

  onShow() {
    if (this.data.unlocked) this.refresh();
  },

  onPullDownRefresh() {
    const p = this.data.unlocked ? this.refresh() : Promise.resolve();
    p.then(() => my.stopPullDownRefresh());
  },

  // --- PIN 锁 ---------------------------------------------------------------

  checkLock() {
    if (!hasPin()) { this.setData({ unlocked: true }); return; }
    this.setData({ unlocked: my.getStorageSync(PIN_KEY) === '1' });
    if (!this.data.unlocked) {
      my.navigateTo({ url: '/pages/login/login' });
    }
  },

  onUnlockInput(e) {
    this.setData({ pinInput: e.detail.value });
  },

  unlock() {
    const pin = this.data.pinInput || '';
    if (!verifyPin(pin)) { toast('密码错误'); return; }
    my.setStorageSync(PIN_KEY, '1');
    this.setData({ unlocked: true });
    my.navigateBack();
    this.refresh();
  },

  // --- 数据 -----------------------------------------------------------------

  async refresh() {
    const holdings = listHoldings();

    // 取行情 + 缓存净值
    const codes = holdings.map(h => h.code);
    const quotes = await fetchFundQuotes(codes);
    for (const code in quotes) {
      const q = quotes[code];
      putNav(code, { date: q.date, nav: q.nav, prevNav: q.prevNav, pct: q.pct });
    }
    const { rows, totals } = buildPortfolio(holdings, quotes);

    // 格式化展示字段
    const fmtRows = rows.map(r => ({
      ...r,
      amountText: r.amount != null ? money(r.amount) : '—',
      navText: r.nav != null ? money(r.nav) : '—',
      costText: r.cost != null ? money(r.cost) : '—',
      sharesText: r.shares != null ? money(r.shares) : '—',
      pctText: r.totalPct != null ? pct(r.totalPct) : '—',
      todayText: r.todayProfit != null ? `${signedMoney(r.todayProfit)} (${pct(r.changePct)})` : '—',
      todayColor: signColor(r.changePct),
      profitColor: signColor(r.totalProfit),
      pendingText: r.pending != null ? money(r.pending) : '',
    }));

    const groups = listGroups();
    const allRows = fmtRows;
    const countOf = name => allRows.filter(r =>
      r.shares != null && (name === '__none__' ? !r.groupName : r.groupName === name)).length;

    this.setData({
      rows: allRows,
      totals: {
        amountText: money(totals.amount),
        todayText: signedMoney(totals.today),
        todayColor: signColor(totals.today),
        profitText: signedMoney(totals.profit),
        profitColor: signColor(totals.profit),
        pctText: totals.pct != null ? pct(totals.pct) : '—',
      },
      groups,
      groupTabs: [
        { key: '__all__', name: '全部', count: allRows.filter(r => r.shares != null).length },
        ...groups.map(g => ({ key: g, name: g, count: countOf(g) })),
        { key: '__none__', name: '未分组', count: countOf('__none__') },
      ],
    });
    this.applyFilter();
  },

  applyFilter() {
    const { activeGroup, rows } = this.data;
    let visible = rows.filter(r => r.shares != null || r.pendingAmount != null);
    if (activeGroup === '__none__') visible = visible.filter(r => !r.groupName);
    else if (activeGroup !== '__all__') visible = visible.filter(r => r.groupName === activeGroup);
    this.setData({ visible });
  },

  switchGroup(e) {
    this.setData({ activeGroup: e.currentTarget.dataset.key });
    this.applyFilter();
  },

  // --- 添加 / 加仓 / 减仓 ---------------------------------------------------

  openAdd() {
    this.setData({ showAdd: true, query: '', suggest: [], amount: '', tradeMode: 'add', tradeCode: '', tradeName: '' });
  },

  closeAdd() {
    this.setData({ showAdd: false, query: '', suggest: [] });
  },

  onQuery(e) {
    const q = e.detail.value.trim();
    this.setData({ query: e.detail.value });
    if (!q) { this.setData({ suggest: [] }); return; }
    if (/^\d{6}$/.test(q)) { this.setData({ suggest: [] }); return; }
    searchFundList(q).then(list => this.setData({ suggest: list.slice(0, 10) }));
  },

  pickSuggest(e) {
    const { code, name } = e.currentTarget.dataset;
    this.setData({ query: code, suggest: [], tradeCode: code, tradeName: name });
  },

  onAmount(e) {
    this.setData({ amount: e.detail.value });
  },

  /** 金额制保存：金额 ÷ 净值 = 份额，成本 = 净值 */
  async saveAmount() {
    const amount = Number(this.data.amount);
    if (!isFinite(amount) || amount <= 0) { toast('请输入金额'); return; }
    const code = this.data.tradeCode;
    if (!code) { toast('请先选择基金'); return; }
    const nav = navOf(code);
    if (!nav || !nav.nav) { toast('暂未取到净值，请稍后再试'); return; }
    const shares = Number((amount / nav.nav).toFixed(2));
    const existing = listHoldings().find(h => h.code === code);
    if (existing && existing.shares != null) {
      // 已持仓 -> 加仓/减仓
      const delta = this.data.tradeMode === 'add' ? shares : -shares;
      const nextShares = Math.max(0, Number((existing.shares + delta).toFixed(2)));
      let cost = existing.cost;
      if (this.data.tradeMode === 'add' && cost != null && existing.shares > 0) {
        cost = (existing.shares * cost + amount) / nextShares;
      }
      upsertHolding({ code, name: existing.name, shares: nextShares, cost, watch: existing.watch, groupName: existing.groupName });
    } else {
      upsertHolding({
        code, name: this.data.tradeName || existing && existing.name || code,
        shares, cost: nav.nav, watch: true, groupName: existing && existing.groupName,
      });
    }
    toast('已保存');
    this.setData({ showAdd: false, amount: '' });
    this.refresh();
  },

  openTrade(e) {
    const { code, name, mode } = e.currentTarget.dataset;
    this.setData({
      showTrade: true, tradeMode: mode || 'add', tradeCode: code, tradeName: name, amount: '',
    });
  },

  closeTrade() { this.setData({ showTrade: false, amount: '' }); },

  async saveTrade() {
    const amount = Number(this.data.amount);
    if (!isFinite(amount) || amount <= 0) { toast('请输入金额'); return; }
    const code = this.data.tradeCode;
    const nav = navOf(code);
    if (!nav || !nav.nav) { toast('暂未取到净值，请稍后再试'); return; }
    const shares = Number((amount / nav.nav).toFixed(2));
    const hold = listHoldings().find(h => h.code === code);
    if (!hold) { toast('未找到持仓'); return; }
    const delta = this.data.tradeMode === 'add' ? shares : -shares;
    const nextShares = Math.max(0, Number((hold.shares + delta).toFixed(2)));
    let cost = hold.cost;
    if (this.data.tradeMode === 'add' && cost != null && hold.shares > 0) {
      cost = (hold.shares * cost + amount) / nextShares;
    }
    upsertHolding({ code, name: hold.name, shares: nextShares, cost, watch: hold.watch, groupName: hold.groupName });
    toast(this.data.tradeMode === 'add' ? '加仓成功' : '减仓成功');
    this.setData({ showTrade: false, amount: '' });
    this.refresh();
  },

  // --- 批量导入 -------------------------------------------------------------

  openImport() { this.setData({ showImport: true, importText: '' }); },
  closeImport() { this.setData({ showImport: false }); },

  onImportText(e) { this.setData({ importText: e.detail.value }); },

  async doImport() {
    const parsed = parseBatch(this.data.importText);
    if (parsed.length === 0) { toast('未解析到「代码 + 金额」行'); return; }
    const quotes = await fetchFundQuotes(parsed.map(p => p.code));
    let ok = 0, pending = 0;
    for (const p of parsed) {
      const q = quotes[p.code];
      if (q && q.nav) {
        putNav(p.code, { date: q.date, nav: q.nav, prevNav: q.prevNav, pct: q.pct });
        const existing = listHoldings().find(h => h.code === p.code);
        const shares = Number((p.amount / q.nav).toFixed(2));
        let cost = q.nav;
        if (existing && existing.shares != null && existing.cost != null) {
          const total = existing.shares + shares;
          cost = (existing.shares * existing.cost + p.amount) / total;
          upsertHolding({ code: p.code, name: existing.name || q.name, shares: Number(total.toFixed(2)), cost, watch: existing.watch, groupName: existing.groupName });
        } else {
          upsertHolding({ code: p.code, name: q.name, shares, cost, watch: true });
        }
        ok += 1;
      } else {
        upsertHolding({ code: p.code, name: p.code, shares: null, cost: null, pendingAmount: p.amount });
        pending += 1;
      }
    }
    toast(`已导入 ${ok} 只${pending ? `，${pending} 只待确认` : ''}`);
    this.setData({ showImport: false, importText: '' });
    this.refresh();
  },

  // --- 分组管理 -------------------------------------------------------------

  openGroupMgr() { this.setData({ showGroupMgr: true, newGroupName: '', renameTarget: '', renameValue: '' }); },
  closeGroupMgr() { this.setData({ showGroupMgr: false }); },

  onNewGroupName(e) { this.setData({ newGroupName: e.detail.value }); },

  createGroup() {
    const name = (this.data.newGroupName || '').trim();
    if (!name) { toast('请输入分组名称'); return; }
    if (listGroups().includes(name)) { toast('分组已存在'); return; }
    addGroup(name);
    this.setData({ newGroupName: '' });
    this.refresh();
  },

  onRenameValue(e) { this.setData({ renameValue: e.detail.value }); },

  startRename(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({ renameTarget: name, renameValue: name });
  },

  doRename() {
    const { renameTarget, renameValue } = this.data;
    const value = (renameValue || '').trim();
    if (!value || value === renameTarget) return;
    renameGroup(renameTarget, value);
    this.setData({ renameTarget: '', renameValue: '' });
    this.refresh();
  },

  async deleteGroup(e) {
    const name = e.currentTarget.dataset.name;
    const ok = await confirm(`删除分组「${name}」？其中的基金将变为未分组。`, '提示');
    if (!ok) return;
    deleteGroup(name);
    if (this.data.activeGroup === name) this.setData({ activeGroup: '__all__' });
    this.refresh();
  },

  // --- 移动到分组 -----------------------------------------------------------

  openMove(e) {
    const code = e.currentTarget.dataset.code;
    const hold = listHoldings().find(h => h.code === code);
    this.setData({
      showMove: true, tradeCode: code, tradeName: (hold && hold.name) || code,
      moveTarget: (hold && hold.groupName) || '__none__',
    });
  },

  closeMove() { this.setData({ showMove: false }); },

  onMoveTarget(e) { this.setData({ moveTarget: e.currentTarget.dataset.key }); },

  confirmMove() {
    const target = this.data.moveTarget === '__none__' ? null : this.data.moveTarget;
    moveToGroup(this.data.tradeCode, target);
    toast('已移动');
    this.setData({ showMove: false });
    this.refresh();
  },

  // --- 批量分配（未分组） ---------------------------------------------------

  toggleCheck(e) {
    const code = e.currentTarget.dataset.code;
    const checked = this.data.checked.includes(code)
      ? this.data.checked.filter(c => c !== code)
      : [...this.data.checked, code];
    this.setData({ checked });
  },

  selectAll() {
    const ungrouped = (this.data.visible || []).filter(r => !r.groupName).map(r => r.code);
    this.setData({ checked: this.data.checked.length === ungrouped.length ? [] : ungrouped });
  },

  async batchAssign() {
    if (this.data.checked.length === 0) { toast('请先勾选基金'); return; }
    const groups = listGroups();
    if (groups.length === 0) { toast('请先创建分组'); return; }
    const target = groups[0];
    const ok = await confirm(`将选中的 ${this.data.checked.length} 只基金分配到「${target}」？`, '批量分配');
    if (!ok) return;
    moveBatchToGroup(this.data.checked, target);
    toast('已分配');
    this.setData({ checked: [] });
    this.refresh();
  },

  // --- 其它 -----------------------------------------------------------------

  async removeHolding(e) {
    const { code, name } = e.currentTarget.dataset;
    const ok = await confirm(`删除持仓「${name}」？`, '提示');
    if (!ok) return;
    removeHolding(code);
    toast('已删除');
    this.refresh();
  },

  goDetail(e) {
    const code = e.currentTarget.dataset.code;
    const name = e.currentTarget.dataset.name || '';
    my.navigateTo({ url: `/pages/detail/detail?code=${code}&name=${encodeURIComponent(name)}` });
  },
});
