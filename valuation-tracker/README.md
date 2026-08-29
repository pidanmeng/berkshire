# 估值追踪系统（Valuation Tracker）

投研 Agent 体系的 Web 监控终端：监控已调研公司的实时市值 vs 目标市值（安全边际），并按标签归类展示财务状况、股价走势与基本面更新状态。

## 架构

```
Next.js 15（纯 UI/SSR，端口 3000）   ←→   Elysia 后端（Bun，端口 3001）
      │                                      │
      │ lib/api.ts                           ├─ server/routes/   companies / quotes / kline / fundamentals
      └─ app / components                    ├─ server/lib/      research / quote / safety / cninfo / store / weights
                                             └─ 存储：Turso → bun:sqlite → 内存（自动降级）
```

**数据流**：Markdown 公司笔记（`../Research/10-Knowledge/**/02-公司研究/`）是唯一事实源。
构建期由 `scripts/generate-static-data.ts` 编译为 SSG 静态产物 `public/data/companies.json` +
`public/data/docs/<code>/`（`bun run build` / `bun run dev` 启动时自动执行；改笔记后需重跑
`bun run generate-data`）。页面 SSG 渲染；实时行情/市值/K线由前端浏览器直连东财
（push2/push2his）+ 同花顺代理（可选 key），不再依赖服务端聚合。后端保留精简路由：
暗盘、留言板、基本面检测、quotes 快照采集（`companies/kline` 为维护态兼容）。

**综合评分**：不人工给定，由六维评分（能力圈/护城河/生意模式/管理层/反向清单/历史类比）按
`../.trae/scripts/valuation/composite.ts` 的 `COMPOSITE_WEIGHTS` 加权现算。
修改权重一处全局生效（前端展示、evaluate.ts、backfill.ts 共用同一文件）。

## 快速开始

```bash
bun install
bun run dev        # 并行启动 Elysia(3001) + Next(3000)
```

打开 http://localhost:3000 。

## 环境变量（.env）

| 变量 | 说明 | 默认 |
|------|------|------|
| `API_BASE_URL` | 服务端组件访问后端地址 | `http://localhost:3001` |
| `NEXT_PUBLIC_API_BASE_URL` | 客户端组件访问后端地址 | `http://localhost:3001` |
| `HITHINK_FINANCE_API_KEY` | 同花顺行情/估值 API Key | 脚本内置 key |
| `RESEARCH_ROOT` | 知识库根目录（含 `Research/10-Knowledge`） | `..`（仓库根） |
| `PORT` | Elysia 监听端口 | `3001` |
| `TURSO_URL` / `TURSO_AUTH_TOKEN` | Vercel Serverless 持久化（可选） | — |

## API

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/companies` | 全部公司 + 实时行情 + 安全边际分档 + 基本面检测缓存（60s TTL） |
| `GET /api/companies/:thscode` | 单公司详情（含笔记全文、六维评分、Forward PE、调研截止） |
| `GET /api/kline/:thscode?days=` | 近 N 日 K 线（60s TTL） |
| `GET /api/quotes` | 行情轮询（60s TTL，快照入库） |
| `GET /api/fundamentals/:thscode?refresh=1` | 巨潮公告检测：调研截止日之后是否出现新定期报告（6h TTL） |

## 安全边际分档

当前市值 vs 目标市值（frontmatter `target_market_cap_yi`，亿元）：

| 区间 | 条件 |
|------|------|
| 深度低估 | 当前市值 ≤ 悲观目标 |
| 低估区间 | 当前市值 ≤ 合理目标 |
| 合理区间 | 当前市值 ≤ 乐观目标 |
| 高估区间 | 当前市值 > 乐观目标 |
| 无估值锚点 | 无目标市值数据 |

## 维护

```bash
bun run sync-data           # 仅生成 research-data/research.db（维护用，不联网）
bun run sync-data:remote    # 生成本地库 + 同步同一批数据到 Turso（维护用）
bun run generate-data       # 生成 SSG 静态数据 public/data/（build/dev 启动自动执行；改笔记后重跑）
bun run build               # 生产构建：generate-data + next build（构建期零外部请求，不再同步 Turso）
bun run snapshot            # 批量拉取行情写入快照（可配置收盘后定时执行）
bun run server              # 仅启动 Elysia 后端
```

## 部署

- **前端**：Vercel 一键部署（`output: "standalone"`），设置 `API_BASE_URL` 指向自托管后端。
- **后端**：
  - 自托管：`bun run server`（bun:sqlite，本地持久化）
  - Serverless：Elysia 部署 + Turso（配置 `TURSO_URL`/`TURSO_AUTH_TOKEN`）

## 目录结构

```
app/                       Next.js 页面（纯 UI，无 route handler）
components/                表格 / K线图 / 徽标 / 标签筛选 / Markdown 渲染
lib/api.ts                 前端 API 客户端（类型与后端对应）
server/
  index.ts                 Elysia 入口（export fetch，Serverless 兼容）
  routes/                  companies / quotes / kline / fundamentals
  lib/                     research / quote / safety / cninfo / weights / store* / db / cache
scripts/
  dev.ts                   并行启动前后端
  snapshot.ts              行情快照
```

> 数据仅供研究参考，不构成投资建议。
