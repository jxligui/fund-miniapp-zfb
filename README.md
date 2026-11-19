# 基金小助理 · 支付宝小程序

基金行情浏览与个人持仓记录的**支付宝小程序**。

**纯本地运行，无需服务器**：所有数据（持仓、自选、分组、净值缓存）只存在用户手机里（`my.setStorageSync`），行情直接请求东方财富公开接口，不经过任何自建后端。

> 为什么不做账号登录：支付宝小程序的 `my.getAuthCode` 拿到的 auth_code 必须由**服务端**调用支付宝网关才能换取 openid，纯客户端拿不到。本项目为「零服务器」设计，持仓数据仅存本机。

## 功能

底部导航四个主页面：**行情 / 自选 / 持仓 / 设置**。

- **行情**
  - 大盘指数：28 个精选指数，分页展示（现价 / 涨跌幅 / 涨跌额），☆ 一键加自选
  - 全部基金：代码 / 名称 / 拼音搜索、类型筛选，列表内 ☆/☆ 直接加/取消自选
  - ETF 基金：24 个主题 ETF 实时行情，同样支持列表内直接加自选
- **自选**
  - 自选大盘指数（与行情页同款卡片，★ 取消自选）
  - 自选基金：已在持仓的显示「持仓」标记且**不能取消自选**；未持仓的可以取消
  - 卡片操作（加入持仓 / 取消自选）默认折叠，点右上角 ▼/▲ 展开收起
- **持仓**（数据仅存本机）
  - 资产总览：总资产大字独占一行，下方三格（今日盈亏 / 持有收益 / 收益率）
  - **自定义分组**：新建、改名、删除；「未分组」页可勾选批量分配
  - 紧凑卡片：名称、金额、今日盈亏、净值、成本、份额、收益率
  - **金额制加仓/减仓**：只填金额，按最新净值折算份额（`份额 = 金额 ÷ 净值`），买入移动加权成本；取不到净值时记为「待确认」
  - **批量导入**：每行 `基金代码 金额`，自动折算份额与成本
  - 卡片操作（加仓 / 减仓 / 分组 / 删除）默认折叠，点右上角 ▼/▲ 展开收起
- **基金详情**：最新净值、近半年走势图、六档区间涨幅
- **设置**
  - **行情刷新**：自动刷新间隔（关闭 / 15s / 30s / 1min / 5min），作用于行情/自选/持仓三页；切到后台即暂停，回前台自动恢复
  - **基金库**：基金库 / ETF / 指数 / 净值缓存条数统计、读盘对账
  - **同步全量基金**：从东财拉取约 2 万只在售基金与最新净值入库（约 103 页，1-2 分钟）。支持**断点续传**——取消或网络中断后，下次同步自动从断点页继续（24 小时内有效）；20 小时节流会先核对库内数据完整性，分片丢失或被清空时不再谎报「已是最新」，直接重建；另有「强制重新同步」入口
  - **危险操作**：清空基金库 / 清空全部本地数据（清空后演示数据下次启动重新播种）

### 设计系统

深色金融主题，Minimalism & Swiss Style × Fintech Dark：

| Token | 值 | 用途 |
|---|---|---|
| 背景 | `#0f172a` | 页面底色、导航栏 |
| 卡片 | `#222735` | 内容卡片、弹层 |
| 边框 | `#334155` | 卡片描边、分隔线 |
| 主色 | `#f59e0b` 金 | 选中态、主按钮、logo 色调 |
| 涨 | `#ef4444` 红 | 上涨数值（A股习惯） |
| 跌 | `#22c55e` 绿 | 下跌数值 |
| 文字 | `#f8fafc` / `#94a3b8` | 主文字 / 次要文字 |

约束：支付宝 ACSS 只允许单 class 选择器，变体一律使用独立语义类（`.btn-primary`、`.idx-pct-up`）；8rpx 间距节奏；24rpx 圆角；tabular-nums 数字等宽防跳动。

### 支付宝模板两条硬性限制（踩过坑）

1. 非空文本必须放在 `<text>` 组件内 —— `<view>文本</view>` 会报
   `非空文本内容必须在 <text> 组件内`；且 `<text>` 不能嵌套 `<text>`。
2. ACSS 选择器只能有**一个 class** —— `.a.b`、`.a .b`、`view.a` 都会报
   `should only be one class selector`。变体样式要写成独立类（如 `.btn-primary`）。

## 本地数据库

支付宝小程序没有 SQLite，用 `my.setStorageSync` 模拟「表」：

| 表 | 内容 |
|---|---|
| `fund_base` | 基金基础库 `{ code, name, pinyin, type, kind, onSale }` |
| `index_base` | 指数基础库 `{ code, name, secid, category }` |
| `etf_base` | ETF 基础库 `{ code, name, secid, theme }` |
| `fund_nav` | 净值缓存 `{ code: { date, nav, prevNav, pct } }` |
| `user_settings` | 设置项 `{ key: value }` |
| `meta` | 元信息（库更新时间等） |

**分键 + 分片存储**：官方单 key 上限约 200KB，2 万只基金塞一个键必然失败。每张表一个键（`ft.db.*`），大表（`fund_base` 每片 400 条、`fund_nav` 每片 500 条）再分片，分片索引存在 `ft.db.index`。所有读写统一走 `utils/db.js` 的 `storageGet / storageSet / storageRemove`。

基金库的数据来源：搜索基金时自动入库、添加持仓时自动入库、设置页全量同步，首次启动播种演示持仓。**因此离线也能检索基金**。

### 默认测试数据

首次启动自动播种（根目录 `app.js` 的 `seedDemoData`）：

- **持仓基金**（9 条，`utils/data.js#DEMO_HOLDINGS`）
  - 6 只真实持仓：`000001` 华夏成长混合、`110022` 易方达消费行业股票、
    `161725` 招商中证白酒指数(LOF)A、`519674` 银河创新成长混合A、
    `270002` 广发稳健增长混合A、`005827` 易方达蓝筹精选混合
  - 3 只纯自选（无份额）：`000021` 华夏优势增长混合、`512480` 半导体ETF、
    `159928` 消费ETF
  - 每条都带 `watch: true`，因此「我的自选 → 自选基金」首屏即有内容
- **我的自选 → 大盘指数**（7 个，`utils/constants.js#DEFAULT_INDICES`）：
  `000001` 上证指数、`399001` 深证成指、`399006` 创业板指、`000300` 沪深300、
  `000905` 中证500、`000016` 上证50、`HSI` 恒生指数
- **ETF 行情**：24 个主题 ETF（`ETF_LIBRARY`）

所有默认数据的代码与名称都在东方财富接口上验证可取：

```
node test/demo-data-check.mjs   # 演示基金与 ETF 可取性
node test/library-check.mjs     # 指数 + ETF 清单可取性
```

> **场外基金与 ETF 走不同接口**：场外基金用 `Fund_JJJZ_Data` 取净值；
> ETF 在该接口查不到数据，`utils/api.js#fetchFundQuotes` 会自动改走
> `push2` 实时行情接口，并把现价/昨收折算成统一的 `nav`/`prevNav`/`pct`。
>
> **push2 容灾**：实时行情会偶发被 WAF 拦截或限流（`my.request` fail error=19），
> `fetchMarketQuotes` 依次尝试主域 → `1.push2` / `18.push2` 镜像 →
> `push2delay` 延迟源，任一成功即返回；GET 请求一律不携带自定义头。
> 以上域名均需加入支付宝 request 白名单（见 docs/DEPLOY.md）。

## 目录结构

小程序代码直接放在项目根目录（`miniprogramRoot` 为 `./`）：

```
fund-miniapp-zfb/
├── mini.project.json       支付宝开发者工具项目配置
├── app.js / app.json / app.acss
├── sitemap.json
├── pages/
│   ├── index/           今日行情（大盘指数 / 全部基金 / ETF）
│   ├── watch/           我的自选（自选指数 / 自选基金）
│   ├── holdings/        持仓基金（分组 / 金额制加减仓 / 批量导入）
│   ├── settings/        设置（行情刷新 / 基金库 / 危险操作）
│   └── detail/          基金详情（净值走势）
├── utils/
│   ├── api.js           行情请求（直连东方财富）
│   ├── db.js            本地数据库层（分键 + 分片存储）
│   ├── constants.js     指数与 ETF 基础清单
│   ├── store.js         本地数据层（持仓/自选/分组/净值）
│   ├── data.js          演示数据、搜索、清单引用
│   └── util.js          格式化、批量导入解析、提示
├── images/              tabBar 图标
├── test/
│   ├── auto-regression.mjs   一键全量回归（12 关）
│   ├── core.test.mjs         核心逻辑自测（Node，模拟 my.* API）
│   ├── e2e.test.mjs          端到端功能验证
│   ├── etf-quote.test.mjs    ETF 行情接口路由验证
│   ├── api-parse.test.mjs    行情解析（真实响应样本）
│   ├── extract-parse.test.mjs extractJsonArray 解析器验证
│   ├── db-replay.test.mjs    Storage 200KB 限制 + 2 万条分片重放
│   ├── network-check.mjs     真实网络联调（各数据源可用性）
│   ├── demo-data-check.mjs   默认测试数据可取性
│   └── library-check.mjs     指数 + ETF 清单可取性
├── tools/make-icons.py      生成 tabBar 图标
├── tools/check-*.js         校验脚本（import 路径 / JSON schema / 微信残留 / text 嵌套）
├── tools/*-to-alipay.js     微信→支付宝 转换脚本
└── docs/                    接入与发布说明
```

> 每个页面由 4 个同名文件组成：`index.js` / `index.json` / `index.axml`（模板）/ `index.acss`（样式）。
> 这是**支付宝**小程序的扩展名（微信用的是 `.wxml` / `.wxss`）。

## 开发与调试

1. 用**支付宝开发者工具**打开本目录（`miniprogramRoot` 为 `./`）。
2. 在 `mini.project.json` 里填入自己的小程序 `appid`。
3. 运行自测与数据可用性校验（都不需要开发者工具）：

   ```powershell
   node test/auto-regression.mjs  # 一键全量回归（静态校验+官方编译器构建+Storage重放+单测/e2e）
   node test/core.test.mjs        # 核心逻辑
   node test/e2e.test.mjs         # 端到端功能
   node test/etf-quote.test.mjs   # ETF 行情路由
   node test/api-parse.test.mjs   # 行情解析
   node test/demo-data-check.mjs  # 默认测试数据可取性（真实网络）
   node test/library-check.mjs    # 指数 + ETF 清单可取性（真实网络）
   ```

4. 模拟器里首次启动自动播种演示数据：持仓 9 条、自选指数 7 个、ETF 24 只。

## 发布上线

见 [docs/DEPLOY.md](docs/DEPLOY.md)：域名白名单配置、备案、版本提交等。

## 数据来源与声明

行情与净值来自**东方财富公开接口**（fund.eastmoney.com / push2.eastmoney.com），
仅用于个人查询与记录，**不构成投资建议**。所有个人数据只保存在本机，不上传任何服务器。
