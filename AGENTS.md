# AGENTS.md — 基金小助理（支付宝小程序）

## 形态与入口
- 支付宝小程序，代码直接在仓库根目录（`mini.project.json` 的 `miniprogramRoot: "./"`）。**没有 package.json / node_modules / npm scripts**，别找 `npm run build`。
- 扩展名为 `.axml` / `.acss`（不是微信的 `.wxml` / `.wxss`），API 一律 `my.*`。每页 4 个同名文件：`index.js/.json/.axml/.acss`。
- 入口：`app.js` 的 `App({onLaunch})` → `initDb()` + `seedDemoData()`（演示数据在 `app.js`，不在 `utils/app.js`）。页面注册在 `app.json`，共 5 个：index / watch / holdings / settings / detail。
- 零后端：持仓等存本地 `my.setStorageSync`，行情直连东方财富（fund / push2 / fundsuggest.eastmoney.com）。

## 验证命令（Node，不需要开发者工具）
- 全量回归：`node test/auto-regression.mjs`（12 关：静态校验 + 官方编译器构建 + Storage 重放 + 单测/e2e/解析器）。改完先跑这个。
- 单跑：`node test/core.test.mjs`、`test/e2e.test.mjs`、`test/etf-quote.test.mjs`、`test/api-parse.test.mjs`、`test/db-replay.test.mjs`、`test/extract-parse.test.mjs`。
- 静态检查：`node tools/check-imports.js`、`tools/check-schema.js`、`tools/check-alipay-only.js`、`tools/check-text-nesting.js`。
- `test/network-check.mjs` / `demo-data-check.mjs` / `library-check.mjs` 发真实请求到东财，网络失败不等于代码回归。
- db-replay 的自愈测试会**故意**向 stderr 打印「读盘自检失败 / 分片数据全部丢失」——那是预期输出，判定成败只看 exit code，别被 PowerShell 的红色报错误导。

## ⚠ Storage API 必须用支付宝对象签名（踩过的大坑）
- 正确写法：`my.getStorageSync({ key })` 返回 `{ data, success }`；`my.setStorageSync({ key, data })`；`my.removeStorageSync({ key })`。
- 微信式位置参数 `getStorageSync(key)` / `setStorageSync(key, value)` **在模拟器不生效**：读回 `{data: undefined, success: true}`，写盘不落盘，控制台刷 `[db] 写后读为空，重试`。
- 读写统一走 `utils/db.js` 的 `storageGet/storageSet/storageRemove` 与 `utils/store.js` 的 `read/readRaw/write`（已拆 `{data}` 包）；新增存储代码不要直接调 `my.*`。
- 单 key 上限 **200KB**（官方，不是旧注释里的 1MB）。`ft.db.*` 为分键 + 分片布局：fund_base 每片 400 条、fund_nav 每片 500 条，分片索引在 `ft.db.index`（`baseShards`/`navShards` 是**数字**，读写两侧都要用 `shardCountOf()` 兼容数字与数组，不能用 `Array.isArray` 判断）。别把大表塞回单键。
- 分片索引与分片数据是两个键组，**可能不同步丢**（模拟器可能不把大键落盘）。`load()` 读盘自检发现「索引有条数、盘上 0 条」时会作废索引并解除 20h 同步节流（自愈），让用户能立即重新同步。
- 测试 mock 必须同样用对象签名（见 `test/core.test.mjs`、`test/db-replay.test.mjs`），否则测试全绿仍漏掉该 bug——已实际发生过两次：微信式签名 mock 漏掉 Storage API 误用；「模拟重启」只是同进程再调 `libInfo()`（模块缓存未清，根本没走磁盘 load）漏掉分片读盘 bug。真冷启动要用 `import('../utils/db.js?cold=1')`（ESM query 让 Node 视为全新模块实例）。

## 行情接口（东方财富）容灾约定
- push2 实时行情会间歇性返回 HTTP 错误（`my.request` fail `error=19`）：诱因是 GET 带自定义头（尤其 `content-type`）被 WAF 拦 + 单点限流。规则：**GET 请求一律不带自定义头**；push2 走 `utils/api.js#PUSH2_HOSTS` 多宿主依次重试（主域 → 1/18 镜像 → push2delay 延迟源），任一成功即返回，全部失败才打一条日志。
- 新增行情宿主必须在支付宝开放平台逐个加白名单（`docs/DEPLOY.md` 有清单），真机按完整域名校验，主域白名单不覆盖子域。

## 基金库同步约定（`utils/db.js#syncFundLibrary`）
- **断点续传**：取消 / 网络中断 / 进程被杀时，断点 `meta.syncResumePage/syncResumePages/syncResumeAt` 随每页数据一起落盘，24h 内再次同步从上次页码继续；完整结束（`done`）才清断点并记录 `syncedFundCount/syncedNavCount`。
- **节流必须核对数据完整性**：20h 节流的前提是 `当前库内条数 >= 上次同步规模`，否则（分片丢失/被清空）立即重建。只看时间戳会谎报「数据已是最新」而库里只有 14 只演示数据——已实际发生过。
- 返回值必须区分 `done`（完整）/ `cancelled`（取消）/ 中断（`done=false && !cancelled`），设置页据此展示续传提示。增量更新为预留设计：每行净值带 date、完成时记录页数与规模，后续按净值日期跳过未变化页即可。

## 开发者工具 / 模拟器
- `test/auto-regression.mjs:18` 把官方编译器路径写死为 `C:\Users\ligui\...\mini-pkg-builder.exe`；换机器需改该常量，否则 B1 关卡必挂。
- HMR 连上 ≠ 编译产物更新：若报错文案与源码对不上（日志里出现源码中不存在的字符串），说明跑的是旧构建。需在开发者工具里**完整重新编译 / 关掉预览重开 / 重启工具**，不要只看 HMR。
- 白名单域名与发布流程见 `docs/DEPLOY.md`；开发期可在「详情 → 本地设置 → 不校验合法域名」临时关闭校验。

## 模板 / 样式硬限制（支付宝特有）
- 非空文本必须放在 `<text>` 内（`<view>文本</view>` 会报错），且 `<text>` 不能嵌套 `<text>`。
- ACSS 选择器只能有**一个 class**：`.a.b`、`.a .b`、`view.a` 都编译失败；变体写成独立语义类（如 `.btn-primary`）。
- ACSS 会**构建失败**（error，不只是 warning）的写法：`transition` 简写（如 `transition: width 0.2s ease`）。样式报错分两级：error 直接构建失败；warning（如 `font-variant-numeric`、`gap`、`inset`、`display: inline-block`）只剔除该属性但能构建。改样式后必须跑 B1 关卡确认。
- 修复脚本：`tools/axml-text-fix.js`、`tools/acss-split-class.js`、`tools/acss-split-descendant.js`。

## 界面约定
- 自选基金 / 持仓基金卡片的操作按钮**默认折叠**：卡片右上角三角形开关「▼ 展开 / ▲ 收起」（`toggleActions` + `expandedCode`，手风琴式同时只展开一张，操作后自动收起）。新增卡片操作沿用该模式，不要把按钮平铺回卡片。
- 深色金融主题：背景 `#0f172a`、卡片 `#222735`、主色 `#f59e0b`、涨红 `#ef4444` / 跌绿 `#22c55e`；8rpx 间距、24rpx 圆角、tabular-nums。

## 未接线 / 已删除的功能
- `pages/login/` 已删除、`utils/app.js` 从未存在（`seedDemoData` 在根目录 `app.js`），README 已清理过相关描述，别再按旧文档找。
- PIN 码锁 / 万能密码函数在 `utils/store.js`，但**没有任何页面接入**（settings.js 无相关 UI）——不要假设已上线，也不要重复实现。
