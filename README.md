# 基金小助理 · 支付宝小程序

把 DSH 插件 [dsh-plugin-fund-tracker](https://github.com/jxligui/dsh-plugin-fund-tracker) 的功能复刻到支付宝小程序。

**纯本地运行，无需服务器**：所有数据（持仓、自选、分组、净值缓存）只存在用户手机里（`my.setStorageSync`），
行情直接请求东方财富公开接口，不经过任何自建后端。

## 与 DSH 插件的差异

| 项目 | DSH 插件 | 本小程序 |
|---|---|---|
| 运行环境 | 桌面端浏览器 | 手机 |
| 登录 | DSH 账号（`deepseekAccount.getState()`） | **本地 PIN 码锁**（4-8 位数字，仅存本机哈希） |
| 数据存储 | 本机 SQLite | 手机本地 Storage（`my.setStorageSync`） |
| 后端 | 插件内置 Host 进程 | **无** |
| 数据同步 | 后台定时器同步全量净值 | 打开页面时按需拉取 + 本地净值缓存 |

> **为什么不用支付宝账号登录**：支付宝小程序的 `my.getAuthCode` 拿到的 auth_code
> 必须由**服务端**调用支付宝网关才能换取 openid，纯客户端拿不到。若必须做真实支付宝账号绑定，
> 需另加一个后端做 auth_code 换 openid + 会话签发。本项目为「零服务器」选择了本地 PIN 锁。

## 功能

- **今日行情**
  - 大盘指数：29 个精选指数，分页展示（现价 / 涨跌幅 / 涨跌额），☆ 一键加自选
  - 全部基金：代码或名称搜索、类型筛选、加自选
  - ETF 基金：24 个主题 ETF 实时行情
- **我的自选**
  - 自选大盘指数（与行情页同款卡片，★ 取消自选）
  - 自选基金：已在持仓的显示「持仓」标记且**不能取消自选**；未持仓的可以取消
- **持仓基金**
  - 资产总览：总资产 / 今日盈亏 / 持有收益 / 收益率
  - **自定义分组**：新建、改名、删除；「未分组」页可勾选批量分配
  - 紧凑卡片：名称、金额、今日盈亏、净值、成本、份额、收益率
  - **金额制加仓/减仓**：只填金额，按最新净值折算份额（`份额 = 金额 ÷ 净值`），买入移动加权成本
  - **批量导入**：每行 `基金代码 金额`，自动折算份额与成本
  - **PIN 锁**：进入持仓页需输入本地密码
  - **万能密码**：除本机 PIN 外，可另设最多 6 个 8 位数字万能密码用于解锁
- **基金详情**：最新净值、近半年走势图、六档区间涨幅
- **设置**（首页「设置」进入）
  - **数据库总览**：基金库 / ETF / 指数 / 净值缓存条目数统计
  - **基金基础库**：本地检索（代码 / 名称 / 类型），在售与全部切换，分页浏览
  - **万能密码管理**：增删最多 6 个 8 位万能密码
  - **数据备份**：导出为 JSON（自动复制到剪贴板）、粘贴 JSON 导入
  - **危险操作**：清空基金库 / 清空全部本地数据

### 本地数据库

表结构对齐 DSH 插件 `dsh-plugin-fund-tracker` 的 SQLite 版本，用
`my.setStorageSync` 模拟「表」（支付宝小程序无 SQLite）：

| 表 | 内容 |
|---|---|
| `fund_base` | 基金基础库 `{ code, name, pinyin, type, kind, onSale }` |
| `index_base` | 指数基础库 `{ code, name, secid, category }` |
| `etf_base` | ETF 基础库 `{ code, name, secid, theme }` |
| `fund_nav` | 净值缓存 `{ code: { date, nav, prevNav, pct } }` |
| `user_settings` | 设置项 `{ key: value }` |
| `meta` | 元信息（库更新时间等） |

基金库的数据来源：搜索基金时自动入库、添加持仓时自动入库，首次启动播种
演示持仓。**因此离线也能检索基金**。

### 默认测试数据

首次启动自动播种（`utils/app.js` 的 `seedDemoData`）：

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
node test/demo-data-check.mjs   # 演示基金与 ETF -> 可取 8 / 8
node test/library-check.mjs      # 指数 + ETF 清单 -> 可取 59 / 59
```

> **场外基金与 ETF 走不同接口**：场外基金用 `Fund_JJJZ_Data` 取净值；
> ETF 在该接口查不到数据，`utils/api.js#fetchFundQuotes` 会自动改走
> `push2` 实时行情接口，并把现价/昨收折算成统一的 `nav`/`prevNav`/`pct`。

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
│   ├── holdings/        持仓基金（分组 / 加减仓 / 批量导入）
│   ├── login/           PIN 码设置与解锁 + 万能密码管理
│   ├── detail/          基金详情（净值走势）
│   └── settings/        设置（数据库 / 万能密码 / 备份）
├── utils/
│   ├── api.js           行情请求（直连东方财富）
│   ├── db.js            本地数据库层（fund_base / index_base / nav 等表）
│   ├── constants.js     指数与 ETF 基础清单
│   ├── store.js         本地数据层（持仓/自选/分组/净值/PIN/万能密码）
│   ├── data.js          演示数据、搜索、清单引用
│   └── util.js          格式化、批量导入解析、提示
├── images/              tabBar 图标
├── test/
│   ├── core.test.mjs        核心逻辑自测（Node，模拟 my.* API）
│   ├── e2e.test.mjs         端到端功能验证（播种 / 自选 / 持仓 / 设置 / 数据流）
│   ├── etf-quote.test.mjs   ETF 行情接口路由验证
│   ├── api-parse.test.mjs   行情解析（真实响应样本）
│   ├── network-check.mjs    真实网络联调（各数据源可用性）
│   ├── demo-data-check.mjs  默认测试数据可取性
│   └── library-check.mjs    指数 + ETF 清单可取性
├── tools/make-icons.py      生成 tabBar 图标
├── tools/check-*.js         校验脚本（import 路径 / JSON schema / 微信残留 / text 嵌套）
├── tools/*-to-alipay.js     微信→支付宝 转换脚本
└── docs/                    接入与发布说明
```

> 每个页面由 4 个同名文件组成：`index.js` / `index.json` / `index.axml`（模板）/ `index.acss`（样式）。
> 这是**支付宝**小程序的扩展名（微信用的是 `.wxml` / `.wxss`）。
>
> **支付宝模板与样式的两条硬性限制**（与微信不同，踩过坑）：
> 1. 非空文本必须放在 `<text>` 组件内 —— `<view>文本</view>` 会报
>    `非空文本内容必须在 <text> 组件内`；且 `<text>` 不能嵌套 `<text>`。
> 2. ACSS 选择器只能有**一个 class** —— `.a.b`、`.a .b`、`view.a` 都会报
>    `should only be one class selector`。变体样式要写成独立类（如 `.btn-primary`）。

## 开发与调试

1. 用**支付宝开发者工具**打开本目录（`miniprogramRoot` 为 `./`）。
2. 在 `mini.project.json` 里填入自己的小程序 `appid`。
3. 运行自测与数据可用性校验（都不需要开发者工具）：

   ```powershell
   node test/core.test.mjs        # 核心逻辑（11 组）
   node test/e2e.test.mjs         # 端到端功能（23 项）
   node test/etf-quote.test.mjs   # ETF 行情路由（4 项）
   node test/demo-data-check.mjs  # 默认测试数据可取性
   node test/library-check.mjs    # 指数 + ETF 清单可取性
   ```

4. 模拟器里首次进入「持仓基金」会要求设置 PIN 码（4-8 位数字），设置后即可使用。
   首屏即可看到默认测试数据：持仓 9 条、自选指数 7 个、ETF 24 只。

## 发布上线

见 [docs/DEPLOY.md](docs/DEPLOY.md)：域名白名单配置、备案、版本提交等。

## 数据来源与声明

行情与净值来自**东方财富公开接口**（fund.eastmoney.com / push2.eastmoney.com），
仅用于个人查询与记录，**不构成投资建议**。所有个人数据只保存在本机，不上传任何服务器。
