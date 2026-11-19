import {
  libInfo, clearFundBase, clearAll, initDb, syncFundLibrary,
} from '../../utils/db.js';
import { fetchFundPage } from '../../utils/api.js';
import { getRefreshSec, setRefreshSec, REFRESH_OPTIONS } from '../../utils/store.js';
import { toast, confirm } from '../../utils/util.js';

/** 时间戳 -> 「今天 HH:MM」或「M/D HH:MM」 */
function formatSyncedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay
    ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    info: null,
    syncedAtText: '',
    libShortHint: '',

    refreshSec: 30,
    refreshOptions: [],
    syncing: false,
    syncPage: 0,
    syncPages: 0,
    syncPct: 0,
    syncCount: 0,
    syncProgress: '',
    auditText: '',
  },

  onShow() {
    this.loadAll();
  },

  loadAll() {
    initDb();
    this.refreshStats();
    this.refreshAudit();
    this.setData({
      refreshSec: getRefreshSec(),
      refreshOptions: REFRESH_OPTIONS.map(v => ({ value: v, label: v === 0 ? '关闭' : (v >= 60 ? `${v / 60} 分钟` : `${v} 秒`) })),
    });
  },

  /** 统计数字 + 最近同步时间（读内存缓存，代价低，可随时调用） */
  refreshStats() {
    const info = libInfo();
    // 库内数据明显少于上次全量同步规模（分片丢失 / 被清空）时，明确提示重建
    let libShortHint = '';
    if (info.syncedFundCount > 0 && info.fundCount < info.syncedFundCount) {
      libShortHint = `基金库数据不完整：当前 ${info.fundCount} 只 < 上次同步 ${info.syncedFundCount} 只，点「同步全量基金」重建（支持断点续传）。`;
    }
    this.setData({ info, syncedAtText: formatSyncedAt(info.syncedAt), libShortHint });
  },

  /** Storage 读盘对账：绕过内存缓存，核对分片索引与盘上实际数据。
   *  仅在不一致 / 异常时展示，正常时静默（避免一行调试文案常驻）。 */
  refreshAudit() {
    let auditText = '';
    try {
      const idxRes = my.getStorageSync({ key: 'ft.db.index' });
      const idxRaw = idxRes && typeof idxRes === 'object' && 'data' in idxRes ? idxRes.data : idxRes;
      const idx = typeof idxRaw === 'string' ? JSON.parse(idxRaw) : idxRaw;
      const shardCount = idx && idx.baseShards ? (idx.baseShards.length || idx.baseShards) : 0;
      let diskCount = 0;
      const n = typeof shardCount === 'number' ? shardCount : 0;
      for (let g = 0; g < n; g++) {
        const res = my.getStorageSync({ key: 'ft.db.fund_base.p' + g });
        const raw = res && typeof res === 'object' && 'data' in res ? res.data : res;
        if (!raw) continue;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed) diskCount += Object.keys(parsed).length;
      }
      const expect = idx && idx.baseCount != null ? idx.baseCount : diskCount;
      if (!idx) {
        auditText = '读盘对账：无分片索引（尚未写盘）';
      } else if (diskCount !== expect) {
        auditText = `读盘对账不一致：索引记录 ${expect} 条 / ${n} 片，盘上实读 ${diskCount} 条`;
      }
    } catch (e) {
      auditText = '读盘对账异常: ' + (e && e.message ? e.message : e);
    }
    this.setData({ auditText });
  },

  onRefreshPick(e) {
    const value = Number(e.currentTarget.dataset.value);
    const next = setRefreshSec(value);
    this.setData({ refreshSec: next });
    toast(value === 0 ? '已关闭自动刷新' : `自动刷新：${value >= 60 ? `${value / 60} 分钟` : `${value} 秒`}`);
  },

  // --- 基金库同步（外部数据源：东财全量在售基金） ----------------------------

  cancelSync() {
    this._cancelSync = true;
  },

  async syncLibrary() {
    if (this.data.syncing) return;
    await this.runSync(false);
  },

  /** 忽略 20 小时节流，强制重新同步 */
  async forceSync() {
    if (this.data.syncing) return;
    const ok = await confirm('全量同步约需 1-2 分钟，确定现在重新拉取全部在售基金？', '强制重新同步');
    if (!ok) return;
    await this.runSync(true);
  },

  async runSync(force) {
    this._cancelSync = false;
    this.setData({
      syncing: true,
      syncPage: 0, syncPages: 0, syncPct: 0, syncCount: 0,
      syncProgress: '正在连接东方财富…',
    });
    try {
      const res = await syncFundLibrary(fetchFundPage, {
        force,
        onProgress: (page, pages, count) => {
          const pagesNum = pages || 0;
          this.setData({
            syncPage: page,
            syncPages: pagesNum,
            syncPct: pagesNum > 0 ? Math.round(page / pagesNum * 100) : 0,
            syncCount: count,
            syncProgress: `第 ${page}/${pagesNum || '?'} 页 · 已入库 ${count} 只`,
          });
        },
        isCancelled: () => this._cancelSync === true,
      });
      if (res.cancelled) {
        const stop = res.pages > 0 ? `，已完成 ${res.lastPage}/${res.pages} 页` : '';
        this.setData({ syncProgress: `已取消${stop}，已入库部分保留，下次同步自动续传。` });
        toast('已取消同步');
      } else if (res.throttled) {
        // 命中 20 小时节流：没有真正同步，如实展示当前库内规模
        this.setData({ syncProgress: `最近一次同步：${formatSyncedAt(res.syncedAt)}（库内 ${res.fundCount} 只 / 净值 ${res.navCount} 条），20 小时内无需重复同步。` });
        toast('数据已是最新');
      } else if (res.done) {
        const resumeNote = res.resumedFrom > 1 ? `（自第 ${res.resumedFrom} 页续传）` : '';
        const dateText = res.date ? `，净值日期 ${res.date}` : '';
        this.setData({ syncProgress: `同步完成${resumeNote}：${res.fundCount} 只在售基金 · 净值 ${res.navCount} 条${dateText}` });
        toast(`已同步 ${res.fundCount} 只基金`);
      } else {
        // 网络中断 / 无数据：断点已落盘，下次自动续传
        const stop = res.pages > 0 ? `已完成 ${res.lastPage}/${res.pages} 页` : '未拉到数据';
        this.setData({ syncProgress: `同步中断（${stop}），已入库部分保留，下次同步自动续传。` });
        toast('同步中断，可稍后继续');
      }
    } catch (e) {
      this.setData({ syncProgress: '同步出错：' + (e && e.message ? e.message : '未知错误') });
      toast('同步出错');
    } finally {
      this.setData({ syncing: false });
      // 同步后内存缓存已是最新，直接读统计；再读盘对账一次确认落盘
      this.refreshStats();
      this.refreshAudit();
    }
  },

  // --- 危险操作 ---------------------------------------------------------------

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
