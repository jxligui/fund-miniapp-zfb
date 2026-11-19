import { hasPin, setPin, verifyPin, clearPin } from '../utils/store.js';
import { toast } from '../utils/util.js';

Page({
  data: {
    mode: 'setup',      // setup | unlock
    pin: '',
    pin2: '',
    confirm: '',
    error: '',
    busy: false,
  },

  onLoad() {
    this.setData({ mode: hasPin() ? 'unlock' : 'setup' });
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
    if (!verifyPin(pin)) {
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
});
