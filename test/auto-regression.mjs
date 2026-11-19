/**
 * 一键自动回归：全部关卡串行执行，最后输出 PASS/FAIL 汇总。
 * 用法：node test/auto-regression.mjs
 *
 * 关卡：
 *   A. 静态校验（import 路径 / JSON schema / 微信残留 / text 嵌套）
 *   B. 官方编译器构建（mini-pkg-builder）+ 产物关键字验证
 *   C. Storage 单键 200KB 限制下的 2 万条真实规模重放（分键持久化）
 *   D. 东财真实响应样本解析（extractJsonArray）
 *   E. 业务逻辑全量（单元 + e2e + ETF 路由 + api-parse）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const IDE_EXE = 'C:\\Users\\ligui\\AppData\\Local\\Programs\\小程序开发者工具\\resources\\app\\kits\\mini-pkg-builder.exe';

const results = [];
async function stage(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  PASS  ${name}  (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, msg: e.message });
    console.log(`  FAIL  ${name}  -> ${e.message}`);
  }
}

function runNode(script, args = []) {
  execFileSync('node', [path.join(ROOT, script), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- A. 静态校验 ----------
await stage('A1 import 路径', () => { runNode('tools/check-imports.js'); });
await stage('A2 JSON schema', () => { runNode('tools/check-schema.js'); });
await stage('A3 微信残留', () => { runNode('tools/check-alipay-only.js'); });
await stage('A4 text 嵌套', () => { runNode('tools/check-text-nesting.js'); });

// ---------- B. 官方编译器 ----------
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fund-build-'));
await stage('B1 官方编译器构建', () => {
  assert(fs.existsSync(IDE_EXE), 'IDE 编译器不存在: ' + IDE_EXE);
  execFileSync(IDE_EXE, [
    '--input', ROOT,
    '--project', ROOT,
    '--project-config-path', path.join(ROOT, 'mini.project.json'),
    '--output', buildDir,
    '--no-vuerender', '--zrender',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
});

await stage('B2 产物完整性（页面注册/关键代码）', () => {
  const bundle = path.join(buildDir, 'index.bundle.js');
  const appConfig = path.join(buildDir, 'appConfig.json');
  assert(fs.existsSync(bundle), '缺 index.bundle.js');
  assert(fs.existsSync(appConfig), '缺 appConfig.json');
  const cfg = JSON.parse(fs.readFileSync(appConfig, 'utf8'));
  for (const p of ['pages/index/index', 'pages/watch/watch', 'pages/holdings/holdings', 'pages/settings/settings', 'pages/detail/detail']) {
    assert(cfg.pages.includes(p), `页面未注册: ${p}`);
  }
  const c = fs.readFileSync(bundle, 'utf8');
  for (const kw of ['extractJsonArray', 'syncFundLibrary', 'autoRefreshMixin', 'writeFundBaseShards']) {
    assert(c.includes(kw), `产物缺关键代码: ${kw}`);
  }
  assert(!/new Function\(/.test(c.slice(0, 200000)) || c.includes('return this'), '业务代码残留 eval');
});

// ---------- C. Storage 重放（真实规模） ----------
await stage('C1 Storage 200KB 限制 + 2 万条重放', () => { runNode('test/db-replay.test.mjs'); });

// ---------- D. 解析器（真实样本） ----------
await stage('D1 extractJsonArray 解析', () => { runNode('test/extract-parse.test.mjs'); });

// ---------- E. 业务逻辑 ----------
await stage('E1 单元测试', () => { runNode('test/core.test.mjs'); });
await stage('E2 e2e 功能', () => { runNode('test/e2e.test.mjs'); });
await stage('E3 ETF 行情路由', () => { runNode('test/etf-quote.test.mjs'); });
await stage('E4 api-parse', () => { runNode('test/api-parse.test.mjs'); });

// 清理
try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch (e) {}

// ---------- 汇总 ----------
const fail = results.filter(r => !r.ok);
console.log('\n════════ 自动回归汇总 ════════');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.ok) console.log(`        ${r.msg}`);
}
console.log(`\n共 ${results.length} 关，通过 ${results.length - fail.length}，失败 ${fail.length}`);
if (fail.length) {
  console.log('\n失败关卡即当前阻塞点，按关卡名定位。');
  process.exitCode = 1;
} else {
  console.log('\n全部通过：代码侧无已知阻塞，可在模拟器/真机验证 UI。');
}
