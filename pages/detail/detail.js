import { fetchFundDetail } from '../utils/api.js';
import { money, pct, signColor } from '../utils/util.js';

Page({
  data: {
    code: '',
    name: '',
    detail: null,
    spans: [],
    loading: true,
  },

  onLoad(query) {
    this.setData({
      code: decodeURIComponent(query.code || ''),
      name: decodeURIComponent(query.name || ''),
    });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    const detail = await fetchFundDetail(this.data.code);
    const SPAN_LABELS = { w1: '近一周', m1: '近一月', m3: '近三月', m6: '近半年', y1: '近一年', y3: '近三年' };
    let formatted = null;
    if (detail) {
      // 计算柱状图高度（归一化到 8%~100%）
      const values = detail.trend.map(p => p.v);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const trend = detail.trend.map(p => ({
        d: p.d,
        h: Math.round(10 + (p.v - min) / range * 90),
        c: (detail.totalPct != null && detail.totalPct >= 0) ? '#f5222d' : '#52c41a',
      }));
      formatted = Object.assign({}, detail, {
        latestNavText: money(detail.latestNav),
        trend,
      });
    }
    this.setData({
      detail: formatted,
      spans: detail ? Object.keys(detail.spans).map(key => ({
        key,
        label: SPAN_LABELS[key] || key,
        value: detail.spans[key] != null ? pct(detail.spans[key]) : '—',
        color: signColor(detail.spans[key]),
      })) : [],
      loading: false,
    });
  },

  onPullDownRefresh() {
    this.load().then(() => my.stopPullDownRefresh());
  },
});
