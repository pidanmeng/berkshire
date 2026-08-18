# 估值追踪系统 TODO 实施计划

> 范围：`valuation-tracker/`（Next.js 15 前端 + Elysia 后端 + bun:sqlite/Turso 动态状态层 + FsDocStore/SqliteDocStore 调研数据层）。
> 涉及 4 大原始需求 + 用户补充的 4 项新增需求。执行阶段**第一步**更新 `valuation-tracker/TODO.md`（追加新增需求）。

---

## 一、需求清单（执行时同步到 TODO.md）

1. 增加 Elysia 性能监控插件，尝试优化 `companies/:thscode` 的响应时间
2. 移除「全市场初筛」「API 状态」两个按钮，在最左侧增加一列 ICON（首页 + 全市场初筛 两个图标，用户已确认），hover 显示 tooltip，点击跳转对应页面
3. 首页增加「请我喝杯咖啡」按钮，点击弹出弹窗：告知每次调研股票需花费约 3 元 Token、网站服务器/域名自费运营，附微信收款码 + 微信添加好友二维码（约定路径 `public/donate/`，用户稍后自行放置），打赏 3 元以上并备注股票代码/名称，看到后启动调研流程
4. 修复 bug：
   - 基本面更新由手动改为**定时批量更新**（拉取全量已调研公司并写入数据库）；刷新基本面时**只看未采信的财报，不看未采信的公告**（剔除业绩预告 yjyg）；**保留手动刷新**
   - 股价走势（近一年日 K）时间错位（未用东八区）修复
   - 开盘前无当日股价时，不展示悲观/合理/乐观区间分割线
5. **新增**：基本面有更新时，列表卡片悬浮显示 tooltip 说明需要更新哪些内容
6. **新增**：首页单选公司时，公司详情右上角增加 X 按钮，点击取消单选回到列表
7. **新增**：列表页移除「目标市值（悲/合/乐）」列，新增「vs 合理目标」「vs 乐观目标」列
8. **新增**：列表页支持按 安全边际、质量、基本面 排序

---

## 二、现状分析（已探明的关键点）

| 文件 | 现状 | 问题/改造点 |
|------|------|-------------|
| `server/app.ts` | 裸 Elysia，无监控 | 挂 metrics 插件，暴露 `/metrics` |
| `server/routes/companies.ts` | 详情路由 5 路 `Promise.all` 并行，无缓存 | 每次全量拉行情+扫描文件；加 10s 响应缓存；列表行补 `fundamentalItems` |
| `server/lib/quote.ts` `getKlineBars` | `new Date(k.date_ms).toISOString().slice(0,10)` | **UTC 导致日期偏移一天**，改 Asia/Shanghai 格式化 |
| `server/lib/cninfo.ts` | `checkFundamentalUpdate` 查 4 类 `["ndbg","bndbg","yjbb","yjyg"]`；日期同用 `toISOString()` | 剔除 `yjyg`（业绩预告=公告）；日期同修 |
| `server/index.ts` | 仅 `isMain` 时 `app.listen` | 追加启动定时器 |
| `components/PriceChart.tsx` | markLines（悲/合/乐）只要 target 存在就渲染 | 无当日 bar 时隐藏分割线 |
| `components/Dashboard.tsx` | header 两个 `<a>` 按钮（L167-182） | 移除；加 ICON 列 + 咖啡按钮；内嵌 CompanyDashboard 传 onClose |
| `components/CompanyDashboard.tsx` | 右上角仅「独立页 ↗」 | 加可选 `onClose` 渲染 X 按钮 |
| `components/WatchlistTable.tsx` | 列：目标市值（悲/合/乐）占位；安全边际/质量/基本面列**不可排序**；无 tooltip | 改列、加排序、加基本面 tooltip |
| `lib/api.ts` | `CompanyItem` 无 fundamentalItems | 类型补字段 |
| `store.ts` / `store-sqlite.ts` | `fundamental_checks.detail` 已存 items JSON | **无需改表结构**，仅读取 |

**数据库结论**：`fundamental_checks` 表已含 `detail`（新公告 JSON），定时任务写入与列表 tooltip 读取均复用现有字段，**无 schema 变更**。

---

## 三、改动明细

### A. Elysia 性能监控 + `companies/:thscode` 优化

**A1. 监控插件** — `server/app.ts`
- `bun add @elysiajs/metrics`（官方插件，首选；若安装/兼容失败，回退 `elysia-prometheus-metrics`——无 prom-client 依赖、Bun 兼容；再不行手写计时中间件）
- `import { metrics } from "@elysiajs/metrics"`，在 `new Elysia()` 链首 `.use(metrics({ path: "/metrics" }))`（默认即 `/metrics`，Bun 自托管 3001 与 Next 集成 route handler 同时生效）
- 插件名称/参数以实际安装包 README 为准

**A2. 详情响应缓存** — `server/routes/companies.ts`
- `/companies/:thscode` 分支：`const key = \`company:${code}\`;` 先 `cacheGet`（同 `LIST_TTL` 模式的 `cacheGet/cacheSet`，TTL=10_000ms），命中直接返回；未命中计算后 `cacheSet` 再返回
- 理由：前端进入详情只拉一次，行情秒级变化，10s 缓存可把重复请求的本地 I/O 扫描（readNoteBody / loadCompanyUpdates / loadCompanyDocs）+ 网络行情全部省掉；K 线已有 60s 缓存不受影响

### B. 最左侧 ICON 列

**B1.** `components/Dashboard.tsx`
- 删除 header 中两个 `<a>`（「全市场初筛 ↗」「API 状态 ↗」，L167-182）
- 在 `<SidebarProvider>` 内、`<Sidebar>` 左侧插入 `<AppIconRail />`（垂直窄栏）

**B2. 新建 `components/AppIconRail.tsx`**（"use client"，Tailwind 工具类，禁止新增自定义 CSS）
- 纵向 icon 栏：`Home`（→ `/`，tooltip「首页」）、`LayoutGrid`（→ `/screener`，tooltip「全市场初筛」）——lucide-react 图标
- 每项用 shadcn `TooltipProvider/Tooltip/TooltipTrigger/TooltipContent`，点击用 `<Link>`（或 `useRouter().push`）跳转
- 样式：`w-10 border-r flex flex-col items-center gap-2 py-2`，图标 `size-4.5 text-muted-foreground hover:text-foreground`

### C. 首页「请我喝杯咖啡」

**C1. 新建 `components/DonateDialog.tsx`**（"use client"，shadcn `Dialog` + `DialogTrigger`）
- 弹窗标题「请我喝杯咖啡」
- 正文（静态文案）：
  - 每次调研一只股票需要花费约 **3 元 Token**
  - 网站目前服务器、域名均为**自费运营**
  - 微信收款码 / 微信添加好友二维码（`<img>` 引用 `/donate/wechat-pay.png`、`/donate/wechat-friend.png`，`w-40 h-40 object-contain`）
  - 打赏 **3 元以上**，备注**股票代码或股票名称**，我看到后会启动调研流程
- 新建 `valuation-tracker/public/donate/` 目录；**用户稍后自行放置** `wechat-pay.png`、`wechat-friend.png`（图片缺失时 `<img>` 显示 broken 图，不影响功能）

**C2.** `components/Dashboard.tsx` header 右侧（原按钮位置）放 `☕ 请我喝杯咖啡` 按钮（`<DialogTrigger>` 包裹，样式沿用现有按钮风格）

### D. 基本面定时批量更新（后端 + 数据库写入）

**D1. 新建 `server/lib/fundamental-scheduler.ts`**
- 导出 `startFundamentalScheduler(intervalMs = 6 * 3600_000)`（与 `fundamentals.ts` 的 `CHECK_TTL_MS` 对齐）
- 逻辑：
  1. `let running = false` 防重入
  2. `tick()`：`loadCompanies()` → 遍历每家 → `store.getCheck(code)`，距 `last_checked_at` 未超 interval 则跳过 → 超期则 `checkFundamentalUpdate(name, researchCutoff)` + `store.setCheck({...})`（字段同 fundamentals 路由）→ 单家异常 catch 打日志不阻断
  3. 启动：`setTimeout(tick, 60_000)` 首跑 + `setInterval(tick, intervalMs)`
- 拉取全量已调研公司并写入 `fundamental_checks` 表（复用现有表，无迁移）

**D2.** `server/index.ts` — `isMain` 分支内 `startFundamentalScheduler();`（仅 Bun 自托管运行；Next/Serverless 无长驻进程不启动，避免 Vercel 误跑）

**D3. 只看财报不看公告** — `server/lib/cninfo.ts`
- `checkFundamentalUpdate` 中 `for (const cat of ["ndbg", "bndbg", "yjbb", "yjyg"])` → **去掉 `"yjyg"`**（业绩预告属公告，非定期报告；与 AGENTS.md `--financial` 覆盖「年报/半年报/一季报/三季报」口径一致）

**D4. 手动刷新保留** — 路由 `?refresh=1` 与详情页「↻ 手动重新检测」链接不动

### E. K 线时间修复 + 分割线隐藏

**E1. 新建 `server/lib/sh-date.ts`**
- 导出 `shDate(ms: number): string`：`new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(ms))`（产出 `YYYY-MM-DD`）

**E2.** `server/lib/quote.ts` `getKlineBars` — 日期改 `shDate(k.date_ms)`（替换 `toISOString().slice(0,10)`，修复东八区偏移一天）

**E3.** `server/lib/cninfo.ts` `queryAnnouncements`（L95）— 公告日期改 `shDate(a.announcementTime)`（同根因；影响 `a.date > cutoffDate` 比较，属于本需求范围内的一致性修复）

**E4.** `components/PriceChart.tsx`
- 组件内计算 `today = shDate(Date.now())`（前端用 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })`）
- `hasTodayBar = bars.length > 0 && bars[bars.length - 1].date === today`
- `markLines` 仅当 `hasTodayBar` 为 true 时生成；否则置空（保留 x 轴/成交量，仅隐藏三条虚线分割线）

### F. 基本面 tooltip（新增①）

**F1.** `server/routes/companies.ts` `buildList()` — 每行新增 `fundamentalItems: { title: string; date: string }[]`（`safeParse(check.detail)`，解析失败给 `[]`）

**F2.** `lib/api.ts` — `CompanyItem` 增加 `fundamentalItems: { title: string; date: string }[]`（可选字段 `?`，兼容旧响应）

**F3.** `components/WatchlistTable.tsx` — 基本面单元格：`needsUpdate === true` 时用 `Tooltip` 包裹 `badge-red`，`TooltipContent` 列出 `fundamentalItems` 的 `title`（含 date），空列表则显示「存在未采信财报」

### G. 公司详情 X 按钮（新增②）

**G1.** `components/CompanyDashboard.tsx` — props 增加 `onClose?: () => void`；头部「独立页 ↗」旁，`onClose` 存在时渲染 X 按钮（lucide `X`，`onClick={onClose}`，`aria-label="关闭详情"`）；`onClose` 为空（独立页）不渲染

**G2.** `components/Dashboard.tsx` — 内嵌调用处传 `onClose={() => clearCompanies()}`（从 `useDashboardStore` 取 `clearCompanies`），点击 X 后 `mode` 回到 `list`

### H. 列表列调整 + 排序（新增③④）

**H1.** `components/WatchlistTable.tsx`
- 删除 `<th>目标市值（悲/合/乐）</th>` 及对应 `<td>`（L91、L124-128）
- 在「vs 悲观目标」后新增两列：`vs 合理目标`（`it.zone.distanceToNeutral`）、`vs 乐观目标`（`it.zone.distanceToOpt`），格式同 marginVsPess（`%`）
- `SortKey` 扩展：`"zone" | "qualityScore" | "needsUpdate" | "distanceToNeutral" | "distanceToOpt"`
- `sortValue` 扩展：
  - `zone`：`{ deep_undervalued: 0, undervalued: 1, fair: 2, overvalued: 3, no_anchor: 4 }[it.zone.zone]`
  - `qualityScore`：`it.qualityScore`（null 排后）
  - `needsUpdate`：`true→0 / false→1 / null→2`
  - `distanceToNeutral` / `distanceToOpt`：数值直取
- 表头：「安全边际」「质量」「基本面」列改用 `col()`（可点击排序）；默认方向：`zone`/`needsUpdate` asc（低估优先、需更新优先）、`qualityScore` desc（高分优先）
- 说明：新两列与 vs 悲观同构，一并设为可排序（低成本一致性，非强制项）

---

## 四、假设与决策

1. **监控插件**：优先官方 `@elysiajs/metrics`；失败按序回退 `elysia-prometheus-metrics` → 自写计时中间件（`onRequest/onAfterHandle` 记录时长并暴露 `/metrics`）
2. **详情缓存 TTL = 10s**：平衡行情新鲜度与响应时间；K 线/列表缓存不受影响
3. **定时任务仅 Bun 自托管**（`isMain`），频率 6h 与现有 `CHECK_TTL_MS` 一致；Vercel/Serverless 不启动
4. **财报口径**：`ndbg + bndbg + yjbb`（年报/半年报/业绩报表），剔除 `yjyg`（业绩预告=公告）
5. **二维码图片**：约定 `public/donate/wechat-pay.png`、`public/donate/wechat-friend.png`，用户稍后放置；缺失不影响功能
6. **ICON 列仅首页 Dashboard**；公司独立页 topbar 的「API 状态 ↗」链接保留不动（用户只要求移除首页两个按钮）
7. **数据库**：复用 `fundamental_checks.detail`，**无表结构变更**
8. **样式**：一律 Tailwind 工具类 + 现有 shadcn 组件（Tooltip/Dialog），不新增自定义 CSS 类（AGENTS.md 约定）

---

## 五、验证步骤

1. **类型检查**：`cd valuation-tracker && bunx tsc --noEmit`（或按项目惯例 `bun build --no-bundle`）通过
2. **监控**：启动后访问 `GET /metrics` 返回 Prometheus 文本；`/api/companies/XXX` 第二次请求响应显著变快（缓存命中）
3. **ICON 列**：首页左侧出现 首页/初筛 两图标，hover 出 tooltip，点击跳转 `/` 与 `/screener`
4. **咖啡弹窗**：首页按钮打开弹窗，文案与两张二维码图（占位）显示正常
5. **基本面**：
   - 定时器日志显示全量公司批量检测并写库（可临时把 interval 调小验证）
   - 检测结果不再包含 yjyg（业绩预告）类目
   - `?refresh=1` 手动刷新仍可用
6. **K 线**：图表日期与真实交易日对齐（无一天偏移）；休市/开盘前最后 bar 非今日时三条分割线不显示，盘中显示
7. **tooltip**：needsUpdate=true 的行悬浮显示待更新财报列表
8. **X 按钮**：单选公司 → 右上角 X → 回到列表
9. **列表**：目标市值列移除；vs 合理/乐观列显示；点击 安全边际/质量/基本面 列头可排序
