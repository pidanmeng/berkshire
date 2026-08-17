# A 股全市场初筛系统（三级漏斗 · 脚本为主 · 接入估值追踪看板）

## 1. 背景与目标

A 股 5000+ 家公司，每家跑 deep-dive 成本不可接受。目标：设计一套**以脚本为主、token 消耗趋近于零**的初筛流程，一次性把「明显有价值的标的」（明星池）筛出来、把「明显垃圾的公司」（排除池）筛掉，并将结果接入 valuation-tracker 看板供人工翻阅与后续 `deep-dive` 接单。

**用户已确认的决策**
- 输出形态：**接入 valuation-tracker 看板**（新增「全市场初筛」页面）
- 漏斗强度：**保守（漏网少）**——Stage A 只排除 ST/退市 与 市值 < 10 亿 微盘；Stage B 覆盖 4000+ 家

## 2. 现状分析（已探索验证）

| 资产 | 现状 | 可复用点 |
|---|---|---|
| `.trae/scripts/hithink/hithink.ts` | 同花顺纯 API 库 | 已有 `getValuations()`（批量 PE/PB/PS/PCF）、`getMarketCapFromEastmoney()`（东财批量市值）、`getIndicators()`（单只/单报告期返回 成长/盈利/偿债/运营/现金流 五类指标）、`getSnapshot()`。**缺**：全市场代码表、指标原始值、东财行业字段 |
| `.trae/scripts/quality-gate/quality-screen.ts` | 质量筛查 | `screenCompany()` 为**纯函数**，可直接 import 复用（8 基础指标 + 扩展排雷 → 综合分 0-10 + GREEN/YELLOW/RED） |
| API 端点（skill 文档实证） | 批量能力 | `meta/tickers/list`（limit≤10000，一次拿全 A 代码表）；`prices/snapshot` 与 `valuations/snapshot` 支持批量；**财务端点逐只**（保守漏斗下 Stage B 需 ~6000 次逐只调用，是唯一瓶颈，用高并发+断点缓存解决） |
| `valuation-tracker/` | Next.js 15 + Elysia | `server/routes/quotes.ts` 的 `/api/quotes?codes=` 可复用于「刷新实时行情」；`server/lib/research.ts` 的 `loadCompanies()` 可标记「已研究」；`lib/api.ts` 前端类型层；`components/Dashboard.tsx` header 加导航链接；样式须用 Tailwind 工具类 + 现有 CSS var（禁改 globals.css） |
| 工作区约定 | `Research/00-Workspace/` | 初筛产物输出到新目录 `07-Screener/`（脚本运行时创建） |

**关键数据路径（Stage A 复用 quote.ts 三源模式，不新增外部依赖）**
- 代码表 + 名称：`meta/tickers/list`（SH,SZ,BJ / a-share）
- 市值 + 行业：东财 `push2 ulist.np/get`（f20 总市值 + f100 所属行业，chunk≈800）
- PE(TTM)/PB：同花顺 `valuations/snapshot`（chunk≈800）
- 财务指标：同花顺 `financials/indicators`（逐只，`report=YYYY-4` 年报；次年 `YYYY-4-1` 年用于连续两年复核）

**指标口径（从 `getIndicators` index_id 映射，单位已在 hithink.ts 处理）**
- `roe`（index_weighted_avg_roe，÷100）、`grossMargin`（sale_gross_margin，÷100）、`netMargin`（sale_net_interest_ratio，÷100）、`debtRatio`（assets_debt_ratio，÷100）、`ocfToNi`（net_profit_cash_content=净利润现金含量，值为百分数需 ÷100）、`revenueYoy`/`netProfitYoy`（operating_income_yoy_growth_ratio / net_profit_yoy_growth_ratio，值为百分数需 ÷100）、`peTtm`（估值快照）
- ⚠️ 单位转换需在真实数据上标定：用 ~20 家已知公司跑通后与 `backfill` 的 financials 块比对，确认 ÷100 规则（见验证步骤 3）

## 3. 总体设计：三级漏斗

```
Stage A  全市场种子（~9 次请求）     Stage B  逐只财务漏斗（~6000 次，一次性）    Stage C  分池评分（0 LLM）
tickers/list(1)              ┌─────────────────────────────┐   screenCompany() 复用
东财 mcap+行业(≈7)            │ indicators(最新年报) 逐只×N   │ → 明星池 / 观察池 / 排除池 / 亏损池
valuations(≈7)               │ 高并发20 + JSONL断点续跑+重试  │ → latest-screener.json (事实源)
─────────────                │ 非RED 再取上一年报做连续复核     │   + CSV + digest.md
硬过滤：ST/退 / 市值<10亿      │ 单位标定（见验证3）            │
亏损(PE<0) 单列亏损池          └─────────────────────────────┘
```

- **Stage A**：硬过滤（保守）：剔除名称含 `ST`/`*ST`/`退` 与 市值 < 10 亿 微盘；`PE<0` 单独进「亏损观察池」（不参与主评分漏斗）。其余全进 Stage B。
- **Stage B**：主池每只 1 次 `indicators`（最新年报 `2025-4`）；初判非 RED 的再取上一年报（`2024-4`）做「连续两年」复核（两年 ROE/双降等连续性检查）。JSONL 缓存 `cache/indicators-<report>.jsonl`，断点续跑 + 2 次重试。失败行记 `data_failed`，进排除池（附原因）。
- **Stage C**：每行组装 `CompanyMetrics` → `screenCompany()` 评分分池：
  - 明星池 = verdict GREEN（score≥7.5 且红牌=0 且绿牌≥2）
  - 观察池 = YELLOW 且 score≥5.5（含数据不足 YELLOW）
  - 排除池 = RED + Stage A 排除（ST/微盘，附 reason）+ data_failed
  - 亏损池 = PE<0（Stage A 分流，附带其余指标以便日后转正观察）
  - 金融/高杠杆行业（银行/保险/证券/房地产，来自东财行业字段）负债率>70% 时打 `highLeverageNote` 提示人工复核，**不自动排除**

**输出（脚本自动写盘，0 LLM token）**
- `Research/00-Workspace/07-Screener/latest-screener.json`（看板唯一事实源，含 meta/pools/rows）
- `Research/00-Workspace/07-Screener/YYYY-MM-DD-screener.csv`（人工 Excel 用）
- `Research/00-Workspace/07-Screener/YYYY-MM-DD-digest.md`（池统计 + 明星池 top 30 摘要，供人工/后续 deep-dive 接单）

**API 成本预算**：Stage A ~9 次 + Stage B ~6000 次（一次性，约 10-20 分钟 @ 并发 20）。**日常刷新只重跑 Stage A（~9 次）**刷新价格/PE/市值；财务指标缓存至财报季再重跑。

## 4. 详细改动清单（文件级）

### 4.1 脚本层（仓库根 `.trae/`）

**A. `.trae/scripts/hithink/hithink.ts`（修改，向后兼容）**
1. 新增 `getTickerList(exchange?, assetType?, limit?, offset?)` → 全市场代码表分页拉取（返回 `TickerItem[]` + `total`）
2. 新增 `getIndicatorsRaw(thscode, report)` → 返回 `Record<ability, Record<index_id, string|null>>` 原始指标块（避免现有 `getIndicators` 的 `net_profit_cash_content → operating_cash_flow_per_share` 语义歧义，供 screener 精确换算）
3. `getMarketCapFromEastmoney()`：`MarketCapItem` 增加 `industry: string | null`（东财字段 f100，随现有请求返回，不加请求数）
4. 同步更新 `__tests__/hithink.test.ts`（mock fetch 断言新函数形态与字段）

**B. `.trae/scripts/screener/screen.ts`（新增，主流水线）**
- 纯函数（可测）：`applyUniverseFilters` / `buildScreenRow`（指标→CompanyMetrics，含 ÷100 单位换算）/ `assignPool` / `generateOutputs`（JSON/CSV/MD）
- IO 函数：`fetchUniverse()`（tickers/list）、`fetchExtrasBatch()`（东财 mcap+行业、同花顺 valuations，chunk≈800 并发）、`fetchIndicatorsCached()`（JSONL 缓存 + 断点续跑 + 2 次重试 + 并发 20）、`mapWithConcurrency` 复用 backfill 已有模式
- CLI：`bun run .trae/scripts/screener/screen.ts [--report 2025-4] [--prev-report 2024-4] [--min-mcap 10] [--exclude-st] [--concurrency 20] [--only a|b|c] [--smoke 20]`
  - `--smoke N`：只取前 N 只跑通管道（数据标定用）；`--only b` 用缓存续跑
- 输出写 `Research/00-Workspace/07-Screener/`（目录运行时创建），退出码 0，末尾打印各池计数

**C. `.trae/scripts/screener/__tests__/screen.test.ts`（新增）**
- 覆盖：过滤逻辑（ST/微盘/亏损分流）、单位换算（÷100 边界）、`screenCompany` 集成（GREEN/YELLOW/RED 映射到池）、池分配边界、JSONL 缓存续跑（重复键跳过）、digest 生成
- 全部纯函数 + fixture，**不发网络请求**

### 4.2 后端（`valuation-tracker/server/`）

**D. `server/lib/screener.ts`（新增）**
- `loadScreener()`：读 `../Research/00-Workspace/07-Screener/latest-screener.json`（沿用 `researchRoot()` 解析逻辑），60s 缓存（同 `research.ts` 模式），并用 `loadCompanies()` 给每行补 `researched` 标记（已研究 → 前端可链接详情页）

**E. `server/routes/screener.ts`（新增）**
- `GET /api/screener?pool=&q=&industry=&sort=&order=&page=&pageSize=`：服务端过滤 + 排序 + 分页（默认 50/页），返回 `{ meta, stats, industries, rows, page }`
  - `sort` 白名单：`score | pe | marketCapYi | roe | revenueYoy | netProfitYoy`（其余拒绝）
- 复用 `cache.ts` 的 `cacheGet/cacheSet`（TTL 60s，key 含 query）

**F. `server/index.ts`（修改）**
- 注册 `screenerRoutes`

### 4.3 前端（`valuation-tracker/app` + `components` + `lib`）

**G. `lib/api.ts`（修改）**
- 新增 `ScreenerRow` / `ScreenerResponse` 类型 + `getScreener(params)`

**H. `app/screener/page.tsx`（新增）**
- SSR：`force-dynamic`，`getScreener()` 拉初始数据，失败显示 Elysia 不可达横幅（照抄 `app/page.tsx` 模式）

**I. `components/ScreenerDashboard.tsx`（新增，'use client'）**
- 头部：标题 + `generatedAt`/报告期/漏斗配置展示 + 「← 返回主看板」链接 + 「刷新实时行情」按钮（对当前页 rows 调 `/api/quotes?codes=`，60s 后端缓存）
- 汇总卡（复用 `summary-card` 样式，Tailwind 工具类）：全市场数 / 覆盖数 / 明星 / 观察 / 排除 / 亏损
- 池 Tab：明星池🟢 / 观察池🟡 / 排除池🔴 / 亏损池 / 全部
- 筛选：名称/代码搜索、行业下拉（`industries` 来自接口）、综合分阈值（可选）
- 表格（复用现有 `data-table` 类 + CSS var；**禁新增 globals.css 自定义类**）：
  列 = 名称/代码、行业、池、综合分、verdict 徽标、ROE、毛利率、净利率、OCF/NI、负债率、PE(TTM)、市值(亿)、营收/净利同比、红牌数、已研究（`/companies/:thscode` 链接）
- 可排序列：综合分 / PE / 市值 / ROE / 营收同比 / 净利同比（客户端请求带 sort 参数）；分页 50/页

**J. `components/Dashboard.tsx`（修改）**
- header 右侧加 `全市场初筛 ↗` 链接 → `/screener`（与现有 API 状态链接同风格）

### 4.4 文档

**K. `AGENTS.md`（修改，收尾步骤）**
- 「共享脚本用法」表加一行：`.trae/scripts/screener/screen.ts` 用途/用法
- 「常用指令」表加一行：`/screen [--report YYYY-N] [--only a|b|c]` 全市场初筛

## 5. 关键决策与假设

| 决策 | 依据 |
|---|---|
| 保守漏斗：只排 ST/退 + 市值<10亿 | 用户确认；亏损不排，单列亏损池跟踪 |
| 财务指标用 `indicators` 逐只而非三表 | 1 次调用返回全部 5 类指标，最省请求；三表仅在 deep-dive 阶段需要 |
| PE(TTM) 走同花顺 valuations，市值+行业走东财 | 与 `quote.ts` 现有三源模式一致；东财 f9 为动态 PE 非 TTM，不混用 |
| 看板事实源 = `latest-screener.json` | 沿用「文件为唯一事实源 + 60s 缓存」架构；脚本只写文件，后端只读文件 |
| 已研究标记在后端 enrich | 避免脚本依赖知识库路径，且 `loadCompanies()` 已有缓存 |
| 高杠杆金融/地产不打红牌自动排除 | 只打 `highLeverageNote` 提示人工复核，防止银行/地产被误杀 |
| 日常刷新只重跑 Stage A | 价格/PE/市值是动态的；财务指标到财报季再全量重跑 |
| 综合分直接复用 quality-screen `overallScore` | 不引入新权重，口径与现有公司笔记一致 |

**假设**：东财 `ulist.np/get` 字段 f100（行业）可用（与 f2/f20 同批次返回）；`valuations/snapshot` 批量 chunk 上限按 800 保守切分（实现时若报错调小）。

## 6. 验证步骤

1. **语法/单测**：`bun build --no-bundle .trae/scripts/screener/screen.ts`（exit 0）；`bun test .trae/scripts/hithink .trae/scripts/screener` 全绿
2. **数据标定**：`bun run .trae/scripts/screener/screen.ts --smoke 20` → 抽查 20 家（含茅台 600519、宁德时代 300750、中国巨石 600176、三环集团 300408 等知识库已有公司）的 ROE/毛利率/OCF-NI/负债率/增速，与 `backfill` financials 块比对，**确认 ÷100 单位规则**，不符则修正 `buildScreenRow` 后重跑
3. **全量跑**：`bun run .trae/scripts/screener/screen.ts` → 校验 `latest-screener.json` 结构（meta/pools/rows）、各池计数合理（明星池应数十~数百，排除池数千）
4. **断点续跑**：中断后重跑 `--only b`，确认只补缺失键、不重复请求（读日志 + cache 文件行数）
5. **看板联调**：`cd valuation-tracker && bun run dev` → 打开 http://localhost:3000/screener：
   - 数据渲染、池 Tab 切换、搜索/行业筛选、列排序、分页正常
   - 「刷新实时行情」按钮对当前页生效；已研究公司链接到 `/companies/:thscode` 详情页
   - 主看板 header「全市场初筛」链接可达
6. **回归**：主看板 `http://localhost:3000` 原有功能不回归（quote.ts 改动向后兼容）；`bun test` 后端相关无破坏

## 7. 执行顺序

1. 4.1 脚本层（A→B→C，含标定跑通）
2. 4.2 后端（D→E→F）
3. 4.3 前端（G→H→I→J）
4. 4.4 文档（K）
5. 全量跑 + 看板验收（第 6 节）
