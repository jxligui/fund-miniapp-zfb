import {
  hasPin, setPin, verifyAnyPassword, clearPin,
  addMasterPassword, removeMasterPassword, clearMasterPasswords,
  listMasterPasswords, isValidMasterPassword,
  MASTER_PWD_MAX, MASTER_PWD_LENGTH,
} from '../../utils/store.js';
import { toast } from '../../utils/util.js';

Page({
  data: {
    mode: 'setup',      // setup | unlock
    pin: '',
    pin2: '',
    error: '',
    busy: false,
    masterCount: 0,
    masterList: [],
    showMasterMgr: false,
    masterInput: '',
    masterMsg: '',
  },

  onLoad() {
    this.setData({
      mode: hasPin() ? 'unlock' : 'setup',
      masterCount: listMasterPasswords().length,
      masterList: this.buildMasterList(),
    });
  },

  /** 生成万能密码列表（只展示序号与状态，不暴露哈希） */
  buildMasterList() {
    const n = listMasterPasswords().length;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ index: i, no: i + 1 });
    return out;
  },

  /** 同步万能密码数量与列表 */
  syncMaster() {
    const count = listMasterPasswords().length;
    this.setData({ masterCount: count, masterList: this.buildMasterList() });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [key]: e.detail.value, error: '' });
  },

  async onSubmit() {
    const { mode, pin, pin2 } = this.data;
    if (this.data.busy) return;
    if (!/^\d{4,8}$/.test(pin)) {
      this.setData({ error: '请输入 4-8 位数字密码' });
      return;
    }
    if (mode === 'setup') {
      if (pin !== pin2) {
        this.setData({ error: '两次输入的密码不一致' });
        return;
      }
      setPin(pin);
      toast('密码已设置');
      this.setData({ pin: '', pin2: '', error: '' });
      my.switchTab({ url: '/pages/index/index' });
      return;
    }
    // 解锁：本机 PIN 或万能密码均可
    const kind = verifyAnyPassword(pin);
    if (kind === 'none') {
      this.setData({ error: '密码错误，请重试' });
      this.setData({ pin: '' });
      return;
    }
    this.setData({ pin: '', error: '' });
    my.switchTab({ url: '/pages/index/index' });
  },

  onReset() {
    my.showModal({
      title: '重置密码',
      content: '重置后需要重新设置密码，本地持仓数据不会丢失。',
      success: res => {
        if (res.confirm) {
          clearPin();
          this.setData({ mode: 'setup', error: '' });
        }
      },
    });
  },

  // --- 万能密码管理 ----------------------------------------------------------

  toggleMasterMgr() {
    this.syncMaster();
    this.setData({
      showMasterMgr: !this.data.showMasterMgr,
      masterInput: '',
      masterMsg: '',
    });
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
    this.setData({
      masterMsg: res.message,
      masterInput: res.ok ? '' : this.data.masterInput,
    });
    this.syncMaster();
    if (res.ok) toast('已添加万能密码');
  },

  removeMaster(e) {
    const index = e.currentTarget.dataset.index;
    my.showModal({
      title: '删除万能密码',
      content: '确定删除第 ' + (Number(index) + 1) + ' 个万能密码？',
      success: res => {
        if (!res.confirm) return;
        const r = removeMasterPassword(index);
        this.setData({ masterMsg: r.message });
        this.syncMaster();
      },
    });
  },

  clearMasters() {
    my.showModal({
      title: '清空万能密码',
      content: '确定删除全部 ' + this.data.masterCount + ' 个万能密码？',
      success: res => {
        if (!res.confirm) return;
        const r = clearMasterPasswords();
        this.setData({ masterMsg: r.message });
        this.syncMaster();
      },
    });
  },
});
