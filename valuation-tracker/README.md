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
后端读取统一经 `server/lib/doc-store.ts`：dev / 自托管直读仓库（改笔记即时生效）；Vercel 部署走构建期产物
`research-data/research.db`（`bun run build` 自动执行 sync-data 把调研文档 gzip 压缩入库，单文件、体积约为原始 28%；
Git 集成部署时构建环境有 `../Research`，云端现场重建，本地无需预生成）。
配置 `TURSO_URL` 时 build 同时同步同一批数据到 Turso（云上无打包库时自动降级读取）。
请求时解析 frontmatter（60s 缓存），数据库只存动态状态（价格快照、基本面检测缓存）。

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
bun run sync-data           # 仅生成 research-data/research.db（不联网）
bun run sync-data:remote    # 生成本地库 + 同步同一批数据到 Turso（复用 TURSO_URL，云上无打包库时兜底）
bun run build               # 生产构建：自动执行 sync-data:remote（含 Turso 同步，如配置 TURSO_URL）+ next build
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
