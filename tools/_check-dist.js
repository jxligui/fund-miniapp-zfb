// 检查 IDE 产物里到底包含哪些业务代码（是否是最新源码编译的）。
const fs = require('fs');
const path = require('path');
const distDir = process.argv[2];
const file = path.join(distDir, 'ng-main', 'index.js');
const b = fs.readFileSync(file, 'utf8');

const probes = [
  ['autoRefreshMixin', '本轮新代码标记'],
  ['startAutoRefresh', '自动刷新逻辑'],
  ['INDEX_LIBRARY', '指数清单'],
  ['上证指数', '指数名称数据'],
  ['fetchMarketQuotes', '行情函数'],
  ['芯片ETF华夏', '新演示数据'],
  ['DEMO_HOLDINGS', '演示持仓'],
  ['ft.masterPwds', '万能密码（上上轮）'],
  ['ft.refreshSec', '刷新设置（上一轮）'],
  ['pages/settings', '设置页'],
  ['__webpack_require__', 'webpack 运行时'],
  ['my.request', '请求 API'],
];

for (const [kw, desc] of probes) {
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const n = (b.match(re) || []).length;
  console.log(`${n > 0 ? '有' : '无'}  ${kw.padEnd(20)} (${desc})  出现 ${n} 次`);
}

// index.worker.js 也查一遍（行情可能跑在 worker）
const workerPath = path.join(distDir, 'ng-main', 'index.worker.js');
if (fs.existsSync(workerPath)) {
  const w = fs.readFileSync(workerPath, 'utf8');
  console.log('\n--- index.worker.js ---');
  for (const kw of ['fetchMarketQuotes', '上证指数', 'my.request', '芯片ETF华夏']) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const n = (w.match(re) || []).length;
    console.log(`${n > 0 ? '有' : '无'}  ${kw}  ${n} 次`);
  }
}
