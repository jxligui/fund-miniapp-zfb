/**
 * 模拟支付宝 Storage（对象入参 + {data} 返回 + 单键 200KB 限制）跑 db.js 全链路，
 * 复现「设置页统计消失 / initDb 崩溃」。
 * mock 必须匹配支付宝真实签名，否则会掩盖 getStorageSync(key) 误用。
 */
const storage = new Map();
global.my = {
  getStorageSync: ({ key }) => ({ data: storage.has(key) ? storage.get(key) : '', success: true }),
  setStorageSync: ({ key, data }) => {
    // 官方：单 key 上限约 200KB
    if (typeof data === 'string' && data.length > 200 * 1024) {
      throw new Error(`setStorageSync:fail 数据大小超过限制 key=${key} size=${Math.round(data.length / 1024)}KB`);
    }
    storage.set(key, data);
  },
  removeStorageSync: ({ key }) => storage.delete(key),
  showToast: () => {}, showModal: () => {},
};

const db = await import('../utils/db.js');

console.log('=== 1. initDb（模拟冷启动） ===');
try {
  db.initDb();
  console.log('OK，统计:', JSON.stringify(db.libInfo()));
} catch (e) {
  console.log('!!! initDb 抛异常:', e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log('\n=== 2. 模拟全量同步（生成 2 万条真实规模的 fund_base） ===');
try {
  // 生成 20461 条基金（代码 000000-999999 均匀分布）
  const rows = [];
  for (let i = 0; i < 20461; i++) {
    const code = String(100000 + i).slice(0, 6).padEnd(6, '0');
    rows.push({
      code, name: `测试基金${i}`, pinyin: `CSJJ${i}`,
      nav: 1 + (i % 100) / 100, prevNav: 1, pct: (i % 10) / 10,
      sg: '开放申购', sh: '开放赎回',
    });
  }
  const res = await db.syncFundLibrary(
    async (page, size) => {
      const start = (page - 1) * size;
      const chunk = rows.slice(start, start + size);
      return chunk.length ? { date: '2026-11-18', total: 20461, pages: Math.ceil(rows.length / size), rows: chunk } : null;
    },
    { force: true, onProgress: (p, pages) => { if (p % 30 === 0) console.log(`  ... 第 ${p}/${pages} 页`); } }
  );
  console.log(`同步结果: onSale=${res.onSale} navRows=${res.navRows}`);
} catch (e) {
  console.log('!!! syncFundLibrary 抛异常:', e.message);
}

console.log('\n=== 3. 同会话 libInfo（内存缓存） ===');
const t0 = Date.now();
const info = db.libInfo();
console.log(`libInfo 耗时 ${Date.now() - t0}ms:`, JSON.stringify(info));

console.log('\n=== 4. 真冷启动 load（ESM query 重导入 = 全新模块实例，Storage 保留） ===');
const t1 = Date.now();
const assert = (await import('node:assert/strict')).default;
try {
  const baseDisk = [...storage.keys()].filter(k => k.startsWith('ft.db.fund_base.p')).length;
  console.log('盘上 fund_base 分片数:', baseDisk);
  // query string 使 Node 视为全新模块 -> cache=null -> load() 必须从磁盘反序列化
  const dbCold = await import('../utils/db.js?cold=1');
  dbCold.initDb();
  const info2 = dbCold.libInfo();
  console.log(`冷启动 libInfo 耗时 ${Date.now() - t1}ms:`, JSON.stringify(info2));
  assert.equal(info2.fundCount, info.fundCount, '冷启动后 fundCount 与同步结果不一致（分片读盘失败）');
  assert.equal(info2.navCount, info.navCount, '冷启动后 navCount 与同步结果不一致（分片读盘失败）');
} catch (e) {
  console.log('!!! 冷启动校验失败:', e.message);
  process.exitCode = 1;
}

console.log('\n=== 5. 自愈：分片全部丢失时应作废索引并解除同步节流 ===');
try {
  for (const k of [...storage.keys()]) {
    if (k.startsWith('ft.db.fund_base.p') || k.startsWith('ft.db.fund_nav.s')) storage.delete(k);
  }
  const dbHeal = await import('../utils/db.js?heal=1');
  const healed = dbHeal.libInfo();
  console.log('丢分片后 libInfo:', JSON.stringify(healed));
  assert.equal(healed.fundCount, 0, '分片已删，读盘应为 0 条');
  // meta 若幸存，onsaleSyncedAt 应已被自愈清零 -> 不带 force 同步不再被节流拦截
  const throttled = await dbHeal.syncFundLibrary(async () => null);
  assert.equal(throttled.throttled, false, '自愈后不应再处于 20h 节流状态');
} catch (e) {
  console.log('!!! 自愈校验失败:', e.message);
  process.exitCode = 1;
}

console.log('\n=== 6. 断点续传：中断后从上次页码继续 ===');
try {
  const dbRes = await import('../utils/db.js?resume=1');
  // 5 页 × 200 行的可控数据源；failAt 页起返回 null 模拟网络中断
  const mkFetcher = failAt => async (page) => {
    if (page >= failAt) return null;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      code: String(900000 + (page - 1) * 200 + i).padStart(6, '0'),
      name: `R${page}-${i}`, pinyin: '', nav: 1, prevNav: 1, pct: 0,
    }));
    return { date: '2026-11-19', total: 1000, pages: 5, rows };
  };
  const r1 = await dbRes.syncFundLibrary(mkFetcher(4));   // 第 4 页起中断
  assert.equal(r1.done, false, `第一次同步应中断（done=${r1.done}）`);
  assert.equal(r1.lastPage, 3, `最后成功页应为 3，实际 ${r1.lastPage}`);
  assert.equal(r1.resumePage, 4, `续传起始页应为 4，实际 ${r1.resumePage}`);
  const r2 = await dbRes.syncFundLibrary(mkFetcher(99));  // 第二次应续传
  assert.equal(r2.throttled, false, '库不完整时不应被节流');
  assert.equal(r2.resumedFrom, 4, `应自第 4 页续传，实际 ${r2.resumedFrom}`);
  assert.equal(r2.done, true, '续传后应完整结束');
  assert.equal(r2.resumePage, 0, '完整结束后应清除断点');
  const after = dbRes.libInfo();
  assert.equal(after.fundCount, 1000, `续传完成后应有 1000 只，实际 ${after.fundCount}`);
  assert.equal(after.syncedFundCount, 1000, '完成时应记录同步规模');
  // 再点一次：库完整 + 20h 内 -> 节流
  const r3 = await dbRes.syncFundLibrary(mkFetcher(99));
  assert.equal(r3.throttled, true, '完成后 20h 内应被节流');
  // 清空库后：条数不足 -> 不节流，重建
  dbRes.clearFundBase();
  const r4 = await dbRes.syncFundLibrary(mkFetcher(99));
  assert.equal(r4.throttled, false, '清空库后不应被节流');
  assert.equal(r4.done, true, '重建应完整结束');
} catch (e) {
  console.log('!!! 续传校验失败:', e.message);
  process.exitCode = 1;
}

console.log('\n=== 7. Storage 总用量与键数 ===');
let total = 0;
for (const [k, v] of storage) total += (typeof v === 'string' ? v.length : 0);
console.log(`键数: ${storage.size}, 总大小约 ${Math.round(total / 1024)}KB`);
