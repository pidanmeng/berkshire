# 估值追踪系统 8 项修复实施计划

> 项目：`c:\Code\berkshire\valuation-tracker`（Next.js 15 + Elysia + bun）
> 依据代码现状（2026-08-19 阅读）制定，所有路径均已核实。

## 摘要

处理 8 个问题：① 移除「请我喝咖啡」弹窗动画；② 移除全市场初筛的股价/涨跌幅快照；③ 定位并修复 Elysia 偶发 ECONNRESET（根因 = 本地误走 Turso 远程库，用户已确认采用「本地优先 SQLite」方案）；④ 首页行业/公司列表取消多选置顶 + 行业列表顶部新增「自选股」；⑤ 安全边际模块显示悲观/合理/乐观股价 + 修复开盘前 K 线不画水平线；⑥ 暗盘追踪与文档页左侧加 ICON 列 + 暗盘详情页跳过周末；⑦ 文档页样式对齐主站（直角）+ 搜索处理（已禁用则隐藏）；⑧ 留言板去圆角 + 管理员删除留言。

---

## 现状分析（关键结论）

- **① 弹窗动画**：`DonateDialog.tsx` 用 Web Animations API 做打开/关闭缩放动画（`OPEN_ANIM_MS/CLOSE_ANIM_MS`、`content.animate`）；`globals.css` 的 `.donate-btn` 有 `donate-glow` 呼吸光晕、`.donate-icon` 有 `coffee-sway` 摆动。
- **② 初筛快照**：`ScreenerDashboard.tsx` 有「刷新实时行情」按钮 + `getQuotes` 轮询（`quoteMap/quoteAt`），表格名称列内联展示现价/涨跌幅，行 Sheet 有「实时行情」区块。
- **③ ECONNRESET**：`.env` 配置了 `TURSO_URL` → `server/lib/db.ts` 中 `if (tursoUrl) return createTursoStore(...)` 优先走 Turso 远程 HTTP。`buildList`（`routes/companies.ts`）对每家公司逐个 `getCheck`（N 次 HTTP，Turso 免费额度并发/连接被重置 → `[Elysia] ECONNRESET` + 500）；`/api/messages` 同样走 Turso → 11s+ 500；`GET /` 21s 是 SSR 同链拖慢；`Stream is already ended` 为慢响应下游症状。外部源（同花顺/东财/巨潮）的 fetch 失败已被 `quote.ts` 的 `allSettled` 与调度器 try/catch 吸收，非本类 500 主因。
- **④ 多选置顶**：`TagSidebar.tsx` 选中标签置顶（`pinned + rest`）；`CompanySidebar.tsx` 多选时选中公司置顶。自选股已有 `useFavorites`（localStorage，公司侧边栏星标），但仅限 CompanySidebar 内部使用，Dashboard 拿不到。
- **⑤ 安全边际/K 线**：`CompanyDashboard.tsx` 安全边际卡片只显示目标市值（亿），无每股价格；`PriceChart.tsx` 用 `hasTodayBar`（最后一根 bar 是否今日）门槛控制水平线 → 开盘前（无当日 bar）不画悲/合/乐线，正是用户报的问题。
- **⑥ ICON 列/去重**：`DarkTradeDashboard.tsx`、`app/darktrade/[code]/page.tsx`、`app/docs/layout.tsx` 均未挂 `AppIconRail`（首页/初筛/留言板已有）；`server/lib/darktrade.ts fetchStockHistory` 逐自然日（含周末）拉取上游，产生无效请求。
- **⑦ 文档页**：`app/docs/layout.tsx` 已 `searchToggle={{ enabled: false }}`（无搜索索引，注释写明），fumadocs 组件大量 `rounded-lg/xl/md` 与主站直角风格不符。
- **⑧ 留言板**：`MessagesBoard.tsx` 多处 `rounded-lg/rounded`；无删除留言能力（Store 接口、路由、前端均无）。

---

## 变更明细

### ① 移除「请我喝咖啡」弹窗动画

- `valuation-tracker/components/DonateDialog.tsx`
  - 删除 `OPEN_ANIM_MS/CLOSE_ANIM_MS`、`buttonRef/contentRef/closingRef`、`closeWithAnimation`、`handleOpenChange`（改为直接透传 `onOpenChange`）、打开动画 `useEffect`、`anim.onfinish/oncancel`。
  - `handleDontRemind` 直接调 `onOpenChange(false)`。
  - 保留按钮、Dialog 结构、二维码、文案、「不再提醒」。
- `valuation-tracker/styles/globals.css`
  - 删除 `@keyframes donate-glow`、`@keyframes coffee-sway`，及 `.donate-btn` 上的 `animation` 与 `.donate-icon` 上的 `animation`（保留静态金色渐变按钮与 hover）。

### ② 移除全市场初筛的股价/涨跌幅快照

- `valuation-tracker/components/ScreenerDashboard.tsx`
  - 移除 `getQuotes` 导入、`QuoteItem` 类型引用（Sheet 中不再用）、`quoteMap/quoteAt` state、`refreshQuotes` 回调、「刷新实时行情」按钮、表头右侧「行情已刷新」文案。
  - 表格名称列：删除 `price`/`chg` 内联 span（保留名称 + thscode）。
  - `ScreenerRowSheet`：删除「实时行情」区块（现价/涨跌幅/市值）；市值/PE/PB 等改从 `row` 直接取值（`row.marketCapYi` 等，均已存在）。
  - 保留 `meta.quoteAsOf` 作为「数据时点」展示（属初筛数据说明，非实时快照）。
  - 说明：`ScreenerRow.price/changePct` 字段与后端返回保持不动，仅前端不再展示。

### ③ Elysia ECONNRESET 定位与修复（本地优先 SQLite）

**根因（写入代码注释与诊断结论）**：`db.ts` 的 Turso 优先逻辑使本地 dev 全量 DB 走远程 HTTP，Turso 连接被重置 → 路由抛 `ECONNRESET` → 500；N+1 `getCheck` 放大耗时。

- `valuation-tracker/server/lib/db.ts`
  - 数据源选择改为：**存在可写本地文件系统（Bun 本地/自托管）→ 优先 bun:sqlite**；Turso 仅在 `process.env.FORCE_TURSO === "1"` 或 `process.env.VERCEL` 或本地 fs 不可用时启用。
  - `.env.example` 增加 `# FORCE_TURSO=1  # 显式强制使用 Turso（默认本地 SQLite 优先）` 注释。
- `valuation-tracker/server/lib/store.ts` + `store-sqlite.ts` + `store-turso.ts` + memory 实现
  - 新增 `listChecks(): Promise<FundamentalCheck[]>`（一次批量读全部 `fundamental_checks`）。
- `valuation-tracker/server/routes/companies.ts`
  - `buildList`：用一次 `listChecks()` 构建 `Map<thscode, check>` 替代每公司 `getCheck`（N+1 → 1）。
  - `buildList` 中 check 读取包 try/catch → 失败置 null（单点失败不拖垮整个列表）。
- `valuation-tracker/server/lib/fundamental-scheduler.ts`
  - 每家公司检测间加约 150ms 错峰，降低对巨潮/cninfo 的并发冲击（保留原有 try/catch）。

### ④ 首页：取消多选置顶 + 行业列表顶部「自选股」

- `valuation-tracker/lib/dashboard-store.ts`
  - 新增 `watchlistOnly: boolean`（默认 false）与 `toggleWatchlistOnly()`。
- `valuation-tracker/components/Dashboard.tsx`
  - 把 `useFavorites()` 提升到 Dashboard（保证 TagSidebar/CompanySidebar/Dashboard 共享同一份收藏状态）。
  - `tagFiltered`：先按 `watchlistOnly`（`favoriteSet.has`）过滤，再叠加 `selectedTags` AND 过滤。
  - 向 `TagSidebar` 传 `favorites`/`favoriteSet`；向 `CompanySidebar` 传 `favoriteSet`/`toggleFavorite`。
- `valuation-tracker/components/TagSidebar.tsx`
  - 删除「选中标签置顶」逻辑（`visible` 直接用 `base`）。
  - 列表最顶部固定渲染「自选股」行（Star 图标、`watchlistOnly` 激活态、计数 = 收藏数，永远置顶，搜索时也保留在最上）。
- `valuation-tracker/components/CompanySidebar.tsx`
  - 删除多选置顶分支（`if (multiSelect)` 的 pinned/rest）。
  - 单选模式下收藏置顶保留。
  - 收藏状态改由 props 注入（移除内部 `useFavorites` 调用）。

### ⑤ 安全边际显示股价 + 修复开盘前 K 线水平线

- `valuation-tracker/components/CompanyDashboard.tsx`
  - 安全边际卡片：悲观/合理/乐观目标市值旁各显示每股价格（`(cap.x / totalSharesYi).toFixed(2) 元`，`totalSharesYi` 为 null 时显示 `—`）。
- `valuation-tracker/components/PriceChart.tsx`
  - **根因**：`markLines = hasTodayBar ? [...] : []`，开盘前（最后一根 bar 非今日）不画线。
  - 修复：移除 `hasTodayBar` 门槛，只要 `target` 存在且 `totalSharesYi > 0` 就始终绘制悲观/合理/乐观虚线。

### ⑥ 暗盘追踪/文档加 ICON 列 + 暗盘详情页去重

- `valuation-tracker/components/DarkTradeDashboard.tsx`
  - 根节点改为 `flex` 行布局，最左插入 `<AppIconRail className="h-full" />`（现有内容包一层 flex-col）。
- `valuation-tracker/app/darktrade/[code]/page.tsx`
  - 改为 h-dvh flex 布局：左侧 `<AppIconRail className="h-full" />` + 右侧可滚动内容区。
- `valuation-tracker/app/docs/layout.tsx`
  - 外层包 `<div className="flex h-dvh overflow-hidden">`：左侧 `<AppIconRail className="h-full" />`，右侧 `<div className="fd-scope min-w-0 flex-1 overflow-y-auto">` 包裹 `DocsLayout`（`fd-scope` 供第⑦项样式覆盖作用域）。
- `valuation-tracker/server/lib/darktrade.ts`
  - `fetchStockHistory` 日期循环跳过周六/周日（A 股休市，无需请求）；节假日由上游空响应自然跳过（保留 `consecutiveMiss` 终止逻辑）。
  - 新增导出纯函数 `isTradingDay(dateStr)`（供单元测试）。

### ⑦ 文档页样式对齐主站 + 搜索处理

- `valuation-tracker/styles/globals.css`
  - 追加 `.fd-scope * { border-radius: 0; }`（后置于 fumadocs css 之后、同特异性覆盖 rounded-*；主站其余元素不受影响）。
  - 追加隐藏搜索入口兜底：`.fd-scope [data-search-full], .fd-scope .nd-search { display: none; }`（若 dev 验证发现仍渲染搜索按钮时生效）。
- `valuation-tracker/app/docs/layout.tsx`
  - 保持 `searchToggle={{ enabled: false }}`（无搜索索引，搜索本就无法使用）；验证后若仍出现搜索入口，由上述 CSS 隐藏（即“移除该功能”）。
  - 验证方式：`bun run dev` 后打开 `/docs`，检查侧边栏/顶栏是否有搜索图标。

### ⑧ 留言板样式对齐 + 管理员删除留言

- 样式（`valuation-tracker/components/MessagesBoard.tsx`）
  - 移除全部 `rounded-lg` / `rounded` 圆角类（卡片、表单、徽标、空态、类型按钮等），与主站直角风格对齐。
- 后端删除能力
  - `server/lib/store.ts`：`Store` 接口新增 `deleteMessage(id: number): Promise<boolean>`（含 memory 实现）。
  - `server/lib/store-sqlite.ts`：`DELETE FROM messages WHERE id = ?`，`changes > 0`。
  - `server/lib/store-turso.ts`：`client.execute` 同 SQL，`rowsAffected > 0`。
  - `server/routes/messages.ts`：新增 `DELETE /api/messages/:id`（管理员 Bearer 校验，404 不存在，200 `{ ok: true }`）。
  - `server/app.ts`：CORS `methods` 增加 `"DELETE"`。
- 前端
  - `lib/api.ts`：新增 `deleteMessage(id: number, token: string)`（走 `DELETE`）。
  - `components/MessagesBoard.tsx`：管理员模式下每条留言加「删除」按钮（`window.confirm` 确认后调用并更新列表）；`MessageItem` 增加 `onDeleted` 回调。
- 测试
  - `server/lib/__tests__/store-messages.test.ts`：新增 deleteMessage 用例（删除后列表不再包含、不存在返回 false）。
  - `server/lib/__tests__/messages-api.test.ts`：新增 DELETE 用例（无 token 401 / 带 token 200 / 不存在 404 / 删除后公开列表不可见）。

---

## 假设与决策

- **③**：按用户选择「本地优先 SQLite」；Turso 保留给 Serverless（`VERCEL` 环境）或显式 `FORCE_TURSO=1`。dev 动态状态（快照/基本面缓存/留言）将读写 `data/tracker.db`（暗盘页码本就走本地 sqlite，两侧归一并降低认知负担）。
- **①**：一并移除按钮的 glow/sway 动画（保留静态金色按钮），与「移除弹窗动画」诉求一致；如仅想去弹窗动画可回退按钮动画。
- **④**：「自选股」为独立开关，可与标签筛选叠加（AND）；CompanySidebar 仅移除多选置顶，保留单选模式收藏置顶。
- **②**：后端 `ScreenerRow.price/changePct` 字段保留不删（初筛 JSON 快照仍含），只移除前端展示与实时行情刷新。
- **⑦**：搜索因未接入索引无法使用 → 保持禁用并隐藏（即“移除”）。

## 验证步骤

1. 后端测试：在 `valuation-tracker/` 执行 `bun test server/lib/__tests__/`（messages-api、store-messages、darktrade 等全绿）。
2. 类型检查：`valuation-tracker/` 执行 `bunx tsc --noEmit`（无新增错误）。
3. 启动 `bun run dev`（valuation-tracker）：
   - 首页 `/` 加载明显变快（<2s），连续刷新多次无 `500`；`/api/messages` 正常；日志无 `[Elysia] ECONNRESET`。
   - 公司详情页：安全边际模块显示悲观/合理/乐观**股价**；开盘前打开 K 线图可见三条水平虚线。
   - 首页：行业列表顶部有「自选股」且永远置顶；点它只显示收藏公司；多选公司不再置顶。
   - 全市场初筛：无「刷新实时行情」按钮、无现价/涨跌幅展示。
   - 暗盘列表/详情、文档页：最左侧出现 ICON 列；暗盘详情历史不含周末。
   - 文档页：直角风格；无可用搜索入口（若有则被隐藏）。
   - 留言板：无圆角；管理员登录后每条留言可删除。
