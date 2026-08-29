# valuation-tracker 架构改造：FumaDocs 驱动 + SSG + 客户端实时数据

> 目标：解决三大痛点（访问慢 / 服务端被风控限流 / Turso 同步繁琐）。**基于现有项目改造**（已确认），**保留精简后端**（暗盘/留言/基本面检测），**一期把同花顺 key 直传前端跑通流程、二期用户自配 key**（已确认）。

## 一、可行性结论（含实测验证）

架构方向**成立**，但"所有外部请求客户端直连"存在已验证的边界：

| 数据源                       | 用途       | 浏览器直连 | 实测证据                                                                    |
| ------------------------- | -------- | ----- | ----------------------------------------------------------------------- |
| `push2.eastmoney.com`     | 实时行情/市值  | ✅     | HEAD 回显 `Access-Control-Allow-Origin: <origin>`                         |
| `push2his.eastmoney.com`  | 历史 K 线   | ✅     | 同上                                                                      |
| `fuyao.aicubes.cn`（同花顺代理） | 估值/快照/财务 | ✅     | CORS 全开 + 预检放行 `x-api-key` 头；带 key 的 GET 返回真实数据；`X-RateLimit-Limit: 20` |
| `www.cninfo.com.cn`       | 基本面检测    | ❌     | 无 ACAO 回显；本机访问 403/504                                                  |

**额外实锤**：从当前服务器 IP 向东财发起 GET 被重置（exit 56，HEAD 通 GET 断）——正是痛点 #2 的现场证据，反证客户端直连（用户 IP 分散）方向正确。

### 隐藏的坑（务必在实现中处理）

1. **同花顺 key 泄露**：fuyao 需 `X-api-key`，浏览器直连 = key 明文进 JS bundle。一期本地测试可接受；二期用户自配 key 后**必须移除内置 key**（见阶段 D）。
2. **同花顺限流**：实测 `X-RateLimit-Limit: 20`。客户端策略必须**东财优先（无 key）**，同花顺仅作估值补充且可被用户 key 开启；并发轮询要节流（≥60s）。
3. **构建期禁止外部请求**：东财从服务器 GET 已被重置 → SSG 构建脚本**绝不拉实时行情/财务**，只打包 Markdown 中已有的静态字段（frontmatter 的 target\_market\_cap / financials / scores 等）。实时数据全部客户端拉。这是本方案的生命线约束。
4. **zone 分档时效**：安全边际分档依赖"当前市值"，SSG 后变成构建时快照 → 客户端须用实时市值 + `classifyCapZone`（[safety.ts](file:///c:/Code/berkshire/valuation-tracker/server/lib/safety.ts) 为纯函数、无 node 依赖，可直接被前端 import）重算。
5. **公司笔记不适合进 FumaDocs MDX 内容源**：笔记含 `[[wiki links]]`、自定义 frontmatter、按公司动态扫描，MDX 编译会报错/成本高。务实方案：FumaDocs 继续管"说明/方法论文档"（content/docs 现状），公司研究笔记走独立 `generateStaticParams` SSG 路由，共用 FumaDocs 布局组件。
6. **构建体积**：年报原文 PDF 提取的 Markdown（每份数百 KB \~ MB 级）**不进 HTML 页面**，作为静态 `.md` 落 `public/data/docs/<code>/`，客户端按需 fetch（替代现有 `/api/companies/:thscode/doc`）。
7. **价格快照历史趋势**：现有 `/api/quotes` 轮询会写 SQLite 快照（历史趋势图数据源）。前端改直连后该数据流断 → 保留后端 `/api/quotes` + snapshot 采集（现状不动），前端展示层不依赖它；历史趋势缺数据属可接受降级，二期再议。
8. **类型拆分**：`CompanyItem.quote/zone` 是实时字段，静态 JSON 不含 → 前端类型需拆"静态字段（来自 JSON）"与"实时字段（客户端合并）"。遵守 AGENTS.md 三处同步契约。
9. **dev 体验**：dev 启动须先跑 `generate-static-data`（改 Markdown 后需重跑/热更新触发），保证"改笔记即生效"。
10. **fundamentals 数据源**：基本面检测路由读公司名/research\_cutoff 目前走 doc-store（FS→research.db→Turso 探测链）。前端切走后，为彻底退役 Turso，该路由改为读构建产物 `public/data/companies.json`。

## 二、现状分析（改造前数据流）

```
SSR 页面 → lib/api.ts → /api/* → Elysia (server/app.ts)
  ├─ /api/companies      : loadCompanies()(doc-store 读 Markdown+frontmatter 解析) + getQuotes()(东财+同花顺并发合并) + classifyCapZone
  ├─ /api/companies/:thscode : 详情 + 笔记正文 + updates + docs + fundamental 缓存
  ├─ /api/kline/:thscode : 同花顺→东财降级
  ├─ /api/quotes         : 轮询（60s 缓存 + 快照写库）
  └─ /api/fundamentals/:thscode : 巨潮检测（6h 缓存）
客户端轮询：Dashboard.tsx 每 N 秒 getCompanies()（整列表刷新）
SSG 现状：FumaDocs 已管 content/docs（5 个说明文档页，app/docs/[[...slug]] SSG）
同步：build 前置 sync-data:remote → research.db + Turso（痛点 #3）
```

## 三、分阶段改动

### 阶段 A：构建期数据生成（核心，替代后端解析 + Turso）

**新增** **`valuation-tracker/scripts/generate-static-data.ts`**（参照 [build-research-db.ts](file:///c:/Code/berkshire/valuation-tracker/scripts/build-research-db.ts) 的 walk/collect 模式）

* 扫描 `../Research/`，复用 [research.ts](file:///c:/Code/berkshire/valuation-tracker/server/lib/research.ts) 的 `parseNote` / `parseUpdate`（构建环境存在 `../Research`，doc-store 自动走 FS 模式，零改动复用）

* 产物：

  * `public/data/companies.json`：`{ list: CompanyNote[]（含结构化字段，无 quote/zone）, docsIndex: { [code]: { deepReads, annualReports, updates } } }`

  * `public/data/docs/<thscode>/<fileName>`：笔记正文 / update / deep-read / 年报原文 Markdown（按需 fetch）

* `package.json`：`build` 改为 `bun run scripts/generate-static-data.ts && bun ./node_modules/next/dist/bin/next build`；`sync-data:remote` 从 build 链移除（脚本与 `sync-data` 保留作维护用）；新增 `generate-data` 脚本；`scripts/dev.ts` 启动前同步跑一次生成

**配套测试**：`scripts/__tests__/generate-static-data.test.ts`（仿 [build-research-db.test.ts](file:///c:/Code/berkshire/valuation-tracker/scripts/__tests__/build-research-db.test.ts)）：用 fixture 结构（含 wiki link frontmatter、update 产物、deep-read）验证解析与产物结构。

### 阶段 B：客户端实时数据直连

**新增** **`valuation-tracker/lib/market-data.ts`**（纯函数库，无 `'use client'` 限制但只跑在浏览器）

* 东财直连：行情/市值（`ulist.np/get`）+ K 线（`push2his`）——复制 [hithink.ts](file:///c:/Code/berkshire/.trae/scripts/hithink/hithink.ts) 中 `toEastmoneySecid` / `getMarketCapFromEastmoney` / `getKlineFromEastmoney` 的 URL 构造与字段映射（该文件含 `process.exit` 等 node 依赖，不能直接 import 进客户端，需精简复制，并在注释标明与上游的同步关系）

* 同花顺估值（可选）：读 key 来源 = `localStorage['hithink-api-key']`（二期 UI 写入）→ 兜底 `process.env.NEXT_PUBLIC_HITHINK_API_KEY`（一期）→ 无 key 则跳过估值字段

* 合并逻辑对齐现有 [quote.ts](file:///c:/Code/berkshire/valuation-tracker/server/lib/quote.ts) 的 `getQuotes`（东财优先 + 同花顺补充 PE/PB/PS/PCF），任一失败降级不整体失败

* 轮询节流：≥60s 一次，页面失焦/隐藏时暂停

**改造** **`components/Dashboard.tsx`**（[现状](file:///c:/Code/berkshire/valuation-tracker/components/Dashboard.tsx)）

* 初始 `initial.list` 来自静态 JSON（SSG 注入）；轮询 `getCompanies()` → 改为 `market-data.ts` 拉实时行情合并静态列表 + 客户端 `classifyCapZone` 重算 zone

* 不依赖 `/api/companies`、`/api/quotes`

**改造** **`components/CompanyDashboard.tsx`**

* `getCompanyDetail` / `getKline` → 详情从静态 JSON + `public/data/docs/` 按需 fetch；K 线走 `market-data.ts`

**改造页面**

* `app/page.tsx`：移除 `force-dynamic`，构建期读 `public/data/companies.json`（`fs` 读取 + `revalidate` 策略）

* `app/companies/[thscode]/page.tsx`：改 `generateStaticParams`（由 companies.json 生成）+ 静态读详情；正文/文档改客户端 fetch

* 新增 `lib/static-data.ts`：服务端读静态 JSON/文档的 helper（含路径安全校验，沿用现有防目录穿越约定）

### 阶段 C：文档 SSG（FumaDocs 定位）

* 保持 FumaDocs 管 content/docs 说明文档（现状不变）

* 公司笔记/研报正文通过阶段 A/B 的静态路由 SSG 渲染，共用 FumaDocs 布局组件（`DocsPage`/侧边栏），不引入 MDX 编译公司笔记（见坑 #5）

### 阶段 D：后端精简与 key 治理

* **保留**：暗盘（darktrade）、留言板（messages）、基本面检测（fundamentals）、`/api/quotes` + snapshot 快照采集

* `server/routes/fundamentals.ts`：公司信息改读 `public/data/companies.json`（不再依赖 doc-store/research.db/Turso）

* `server/routes/companies.ts`、`kline.ts`：保留作兼容/降级（前端不再调用），标注维护态

* `package.json` `build` 移除 `sync-data:remote`（见阶段 A）→ **Turso 退役**，痛点 #3 消除

* 一期：`.env.example` 增加 `NEXT_PUBLIC_HITHINK_API_KEY` 说明（本地测试用）；二期：前端新增"数据源设置"入口（配置同花顺 key → `localStorage`），**内置 key 从代码/产物移除**，`market-data.ts` 优先读 localStorage

### 阶段 E：验证与部署

* 验证方式见下节（**优先静态验证，不启动 dev server**）

* 部署形态不变：Vercel（页面 SSG + `/api` route handler 保留给暗盘/留言/基本面检测）；`.vercelignore` 无需变更

* AGENTS.md「估值追踪系统」章节架构描述待用户确认后更新（本次不动）

## 四、决策与假设

| 决策                    | 依据                                 |
| --------------------- | ---------------------------------- |
| 基于现有项目改造              | 用户确认；Next15+FumaDocs+解析/评分/组件全部可复用 |
| 保留精简后端                | 用户确认；暗盘/留言/基本面检测必须服务端              |
| 一期 key 直传前端 / 二期用户自配  | 用户确认；一期仅本地跑通流程                     |
| 东财为首选实时源、同花顺仅估值补充     | 无 key 风险 + 实测 CORS 全开；同花顺限流 20/窗   |
| 构建期零外部请求              | 东财从服务器 GET 实测被重置，构建必须容错            |
| 年报原文不进 HTML、走静态文件按需加载 | 控制构建体积（坑 #6）                       |
| 后端 quotes/snapshot 保留 | 历史趋势数据流不中断（坑 #7）                   |

## 五、验证步骤（不启动 dev server）

1. `bun build --no-bundle`：对阶段 A/B 全部新增/改动 TS 文件做语法检查（含 `scripts/generate-static-data.ts`、`lib/market-data.ts`、`lib/static-data.ts`）
2. `bun test`：现有测试保持绿 + 新增 `generate-static-data.test.ts` 通过
3. 独立运行 `bun run scripts/generate-static-data.ts`：检查 `public/data/companies.json` 结构与 docs 文件产出（含 wiki link frontmatter 解析、update/deep-read 归类、路径安全）
4. 若确需浏览器核验（SSR 渲染/客户端直连）：先 `netstat -ano | findstr ":3000"` 检查是否已有服务；已启动则复用，不重启不 kill；验证仅用轻量 GET
5. 交付物最小化：无临时文件/调试代码残留

