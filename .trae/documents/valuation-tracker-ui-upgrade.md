# 估值追踪系统 UI 升级计划（金色调亮 + 直角 ICON 列 + 打赏弹窗动效 + 使用手册）

## Summary

对 `valuation-tracker`（Next.js 15 + Tailwind v4 + shadcn/radix 的暗黑金投资监控终端）做 6 项 UI 升级：

1. 主色调金色调亮：`#d4af37` → `#f2c14e`（hover `#e6c25c` → `#f8d173`），全站 token / rgba / 图表色同步（含 design.md）
2. 左侧 ICON 列图标与 ToolTip 禁止圆角（直角，更新 design.md）
3. 「请我喝杯咖啡」按钮更明显（金色渐变 + 光晕呼吸 + 图标动效）
4. 打开主页自动弹「请我喝咖啡」弹窗 + 「不再提醒」按钮（localStorage）
5. 咖啡弹窗动效：打开时从按钮位置放大，关闭时缩放回按钮位置（Web Animations API，不引入新依赖）
6. 新增「网站使用手册」按钮与弹窗（首页 header，咖啡按钮旁），内含报告生成全流程流程图；首次打开网站自动弹出，与咖啡弹窗排队（手册先，关后再弹咖啡）

用户已确认的决策：
- 金色亮度：**柔和亮金**（主色 `#f2c14e` / hover `#f8d173`）
- 首次访问弹窗顺序：**手册先，关闭后自动弹咖啡**
- 手册按钮位置：**主页顶部 header，咖啡按钮左侧并排**

## Current State Analysis

关键事实（来自探索）：

- **设计规范**：`c:\Code\berkshire\.trae\skills\research-report-generator\design.md` 定义黑金配色（Gold `#d4af37` / Gold Hover `#e6c25c`）、半径族（Controls 6px / Cards 12px / Large 16px / Pills 9999px）、Do/Don't（禁止渐变与光晕、禁止超出半径族圆角、禁止需圆滑）。
- **gold token 实际分布**（`grep` 已确认 19 处）：
  - `styles/globals.css`：`.dark` 块 `--ring` / `--chart-1` / `--sidebar-ring`（L101-115）；语义 token `--accent-primary` / `--accent-hover`（L153-154）；`rgba(212, 175, 55, …)` 五处（L241 浅金、L289 badge-primary、L433 doc-file-active、L462-463 row-selected）
  - 组件硬编码：`AppIconRail.tsx`（L42，active 底）、`CompanySidebar.tsx`（L146）、`ScreenerDashboard.tsx`（L185/364）、`TagSidebar.tsx`（L110）的 `bg-[rgba(212,175,55,…)]`；`FinancialCompareChart.tsx`（L50 柱状图色）、`PriceChart.tsx`（L114 标记）、`RadarChart.tsx`（L39 调色板 + L58 splitArea）
  - 其余按钮/边框多用 `var(--accent-primary)`，会随 token 自动变亮，无需改。
- **ICON 列**：`components/AppIconRail.tsx` 图标 `<Link>` 带 `rounded-md`；`components/ui/tooltip.tsx` 内容 `rounded-md`（L46）+ 箭头 `rounded-[2px]`（L52）。Tooltip 为全局组件，改后全站 tooltip 均为直角（符合"禁止圆角"要求）。
- **咖啡弹窗**：`components/DonateDialog.tsx` 使用 radix `Dialog` + shadcn `DialogContent`；按钮低调（灰底边框）。`Dashboard.tsx` L180 渲染 `<DonateDialog />`（仅主页 `/` 有）。`DialogContent` 自带 `zoom-in-95/zoom-out-95` 动画（ui/dialog.tsx L64）。
- **无 framer-motion**（package.json 依赖清单确认），动画用 Web Animations API 实现，React 19（`ref` 可作为 prop 直接传给组件）。
- **首页结构**：`Dashboard.tsx` header（L168-181）右侧目前仅 `<DonateDialog />`；已有 zustand store（dashboard-store）与 localStorage 持久化模式（如 `valuation-split-layout`）可参考。
- 站点仅暗黑模式（`layout.tsx` `html.dark`），`styles/globals.css` 中 shadcn 亮色 `:root` 块不参与实际渲染，不做改动。

## Proposed Changes

### 1. 金色调亮（全站 + design.md）

**`styles/globals.css`**
- `.dark` 块：`--ring: #d4af37` → `#f2c14e`；`--chart-1: #d4af37` → `#f2c14e`；`--sidebar-ring: #d4af37` → `#f2c14e`
- 语义 token：`--accent-primary: #d4af37` → `#f2c14e`；`--accent-hover: #e6c25c` → `#f8d173`
- 五处 rgba 由 `rgba(212, 175, 55, …)` → `rgba(242, 193, 78, …)`（L241 tag-chip.active、L289 badge-primary bg+color、L433 doc-file-active、L462-463 row-selected）
- 追加动画工具类（见 §3）与手册流程图样式（见 §6）

**组件硬编码金改色**（`rgb(242,193,78)`）：
- `AppIconRail.tsx` L42：`bg-[rgba(212,175,55,0.12)]` → `bg-[rgba(242,193,78,0.12)]`
- `CompanySidebar.tsx` L146、`TagSidebar.tsx` L110、`ScreenerDashboard.tsx` L185/L364：同上替换（保持原 alpha）
- `FinancialCompareChart.tsx` L50：`"#d4af37"` → `"#f2c14e"`
- `PriceChart.tsx` L114：`rgba(212,175,55,0.5)` → `rgba(242,193,78,0.5)`
- `RadarChart.tsx` L39：`"#d4af37"` → `"#f2c14e"`；L58 splitArea `rgba(212,175,55,…)` → `rgba(242,193,78,…)`

**`.trae/skills/research-report-generator/design.md`**
- Colors 表：Gold `#d4af37` → `#f2c14e`、Gold Hover `#e6c25c` → `#f8d173`（Role 文案不变）
- Do's 追加：ICON 列图标与 ToolTip 一律直角（radius 0），不在该区域使用任何圆角
- Don't 追加/修订：Don't 在 ICON 列、ToolTip 上使用圆角；原"禁止渐变/光晕"条增加唯一例外注记：「请我喝咖啡」按钮为本产品唯一 campaign 元素，允许金色渐变与光晕呼吸动效
- Agent Prompt Guide 末尾追加两句：使用明亮金 `#f2c14e`；ICON 列/ToolTip 直角

### 2. ICON 列与 ToolTip 直角

- **`components/AppIconRail.tsx`**：`<Link>` className 删除 `rounded-md`（L40），保留 hover/active 样式（active 底色随 §1 更新）
- **`components/ui/tooltip.tsx`**：内容删除 `rounded-md`（L46）；箭头删除 `rounded-[2px]`（L52）

### 3. 「请我喝杯咖啡」按钮突出 + 动效

**`styles/globals.css`** 追加：
- `@keyframes donate-glow`：盒光晕 `box-shadow` 呼吸（金 `rgba(242,193,78,0.45)` ↔ 0.15）
- `@keyframes coffee-sway`：图标 6° 内轻微摇摆
- `.donate-btn`：金色渐变底 `linear-gradient(135deg, var(--accent-hover), var(--accent-primary))`、黑色文字、`border` 金、`animation: donate-glow 2.2s ease-in-out infinite`；hover 提亮 + 轻微 `scale(1.03)`（transform transition）
- `.donate-btn .donate-icon`：`animation: coffee-sway 1.6s ease-in-out infinite`

**`components/DonateDialog.tsx`** 按钮部分改用 `.donate-btn`，文案加粗，大小略增（`px-4 py-2 text-sm`）。

> 说明：design.md「Don't use gradients/glows」对黄金渐变仅限 campaign 场景，本按钮为全站唯一 campaign 元素，符合 design.md 中原有 "reserve any campaign treatment for a single hero-scale moment" 精神，且已在 §1 同步更新 design.md 注记。

### 4. 主页自动弹咖啡 + 「不再提醒」

- localStorage key：`donate-dont-remind`，值为 `'1'` 时不再自动弹（仅影响自动弹出；手动点按钮始终可开）。
- **`components/DonateDialog.tsx`** 重构为受控组件：
  - Props：`open: boolean`、`onOpenChange: (v: boolean) => void`
  - 移除内部 `DialogTrigger` 独立开关逻辑，`Dialog` 改为受控 `open={open} onOpenChange={onOpenChange}`；触发按钮 `onClick={() => onOpenChange(true)}`
  - 弹窗底部在二维码图下方加入「不再提醒」次要按钮：点击后 `localStorage.setItem('donate-dont-remind', '1')` 并关闭弹窗（走缩到按钮动效）
  - 保留现有二维码内容不变
- **`components/Dashboard.tsx`**：负责排队逻辑（见 §7）

### 5. 咖啡弹窗动效（打开放大 / 关闭缩回按钮）

**`components/DonateDialog.tsx`** 内实现（无新依赖，用 Web Animations API）：
- 触发按钮元素挂 `ref`（`buttonRef`）
- `DialogContent` 挂 `ref`（React 19：`<DialogContent ref={contentRef}>` 直接透传有效；若透传异常则退回用 `asChild` 自包 div 承接 ref）——实现时以 DOM 实测为准，两方案都准备好
- 打开动画：`open` 变 true 且 content 挂载后（`useEffect`），用 `button.animate` 预留；取按钮与弹窗 `getBoundingClientRect()`，对 content 执行 WAAPI keyframes：从按钮中心缩放（scale≈0.15）水平/垂直移动到居中（`translate` + `scale` + `opacity` 0.3→1，约 240ms），`onfinish` 后清 style 由 CSS 接管
- 关闭动效：`onOpenChange(false)` 请求时 **不立即置 false**——先取按钮 rect 与 content rect，计算相对位移与缩放比（`scale = button.width / content.width`），对 content 执行反向 keyframes（约 280ms），`onfinish` 时再 `setOpen(false)`；用 `closingRef` 防重入（动画期间忽略再次点击）
- 覆盖 radix 自带收尾动画：对该 `DialogContent` 传 `className` 追加 `data-[state=open]:animate-none data-[state=closed]:animate-none`（或在本弹窗内自定义 `animation: none`），overlay 淡入淡出保留（overlay 关闭时同步淡出即可，不做缩放到按钮）
- 关闭触发来源全覆盖：右上 X、点击遮罩、ESC、`不再提醒` 均经 `onOpenChange(false)` 统一走缩回动画

### 6. 新增「网站使用手册」弹窗（新组件 `components/ManualDialog.tsx`）

**Props**：`open: boolean`、`onOpenChange: (v: boolean) => void`（受控）

**内容**（按用户提供的流程原样呈现，配流程图）：
- 标题「网站使用手册」，副标题「一份投研报告是怎么生成的？」
- **流程图（纯 HTML/CSS 构建，直角风格，竖向流程 + 分支节点 + 连接线 + 步骤编号金色圆框/方框）**，步骤：
  1. **发现公司** — 我找到感兴趣的公司，把公司名告诉 AI，AI 自动开工
  2. **下载财报** — 脚本自动下载该公司最近 3 个完整财年年报（如 2023–2025）+ 最近一期财报（如 2026 年中报）
  3. **格式转换** — PDF → Markdown 脚本转换，变成 AI 易读的自然语言
  4. **AI 多方研读（三线并行）** — 三个 AI 同时读 4 份财报：多方辩手 →「多方论据」；空方辩手 →「空方论据」；归纳总结 AI →「财报精读」。此后第四个 AI 读这 3 份文档，按四大师四维度打分：
     - 段永平：业务模式是否轻资产、低负债（好生意）
     - 巴菲特：是否足够便宜、估值安全边际、护城河
     - 芒格（反指）：是否有高负债、高囤货等坏迹象
     - 李璐：管理层是否诚信
  5. **数据脚本 + 50 项反向检查** — 脚本提取年报关键数据（如扣非净利润增长率），跑 50 项检查指标（十几项为数据驱动，如高负债/连续亏损），任一项不达标即标红，不能作为重点追踪对象
  6. **产出闭环** — 一句话（赚谁的钱/赚什么钱、为什么投/为什么不投）+ 三个估值（乐观/客观/悲观）
  7. **好公司标准（四条件）** — 评分高（四维度高分）+ 无瑕疵（反向检查全过）+ 信用好（管理层诚信）+ 估值低（股价处于悲观估值低位）；向下有安全边际、向上弹性高。附注：目前唯一样本「宁德时代」处于低估区间且打分较高
- 弹窗内容区 `max-h-[70vh] overflow-y-auto`，底部「开始使用」按钮关闭
- 四大师维度用 4 个小卡（段永平/巴菲特/芒格/李璐）并排展示
- 流程图样式类集中在 globals.css 新增 `.manual-flow` 前缀的类（节点框、竖向连接线、分支横线、箭头），全部直角

### 7. `Dashboard.tsx` 弹窗编排

- 状态：`const [manualOpen, setManualOpen] = useState(false)`、`const [donateOpen, setDonateOpen] = useState(false)`
- `useEffect`（mount，空依赖）：读 `valuation-manual-seen` 与 `donate-dont-remind`
  - 若未看过手册 → `setManualOpen(true)`
  - 否则若未勾「不再提醒」→ `setTimeout(() => setDonateOpen(true), 700)`（`cleanup` 清 timer）
- `handleManualChange(open)`：置状态；**关闭时**写入 `localStorage.setItem('valuation-manual-seen','1')`，若 `donate-dont-remind !== '1'` 则延迟 ~500ms `setDonateOpen(true)`（实现"手册先，关后再弹咖啡"）
- `handleDonateChange(open)`：直接置状态
- header 右侧改为：
  ```tsx
  <div className="flex items-center gap-2">
    <ManualDialog open={manualOpen} onOpenChange={handleManualChange} />
    <DonateDialog open={donateOpen} onOpenChange={handleDonateChange} />
  </div>
  ```
  （ManualDialog 自身渲染「网站使用手册」触发按钮，DonateDialog 渲染咖啡按钮，二者并排）

**localStorage key 约定**：
- `valuation-manual-seen`：手册是否已看过（关闭即视为看过，之后仅手动按钮可再开）
- `donate-dont-remind`：`'1'` 表示咖啡弹窗不再自动弹出

## Assumptions & Decisions

- 金色取「柔和亮金」：`#f2c14e`（rgb 242,193,78）/ hover `#f8d173`（rgb 248,209,115）；所有 `rgba(212,175,55,…)` 同步换算为 `rgba(242,193,78,…)`
- ToolTip 改为全局直角（tooltip.tsx 是全局组件，改动即全站生效），符合"包括 ToolTips 禁止圆角"
- 「不再提醒」只影响**自动弹出**，手动点击按钮始终可打开
- 手册自动弹出：关闭即写入记忆，之后不再自动弹（用户未要求"不再提醒"，采用最小行为；手动按钮常驻可随时查看）
- 咖啡弹窗自动弹：每次打开主页 `/` 都弹，直到点了「不再提醒」；`/screener`、`/companies/*` 等页面不受影响（按钮、弹窗只在主页 header）
- 动效不引入新依赖（无 framer-motion），用 Web Animations API + CSS keyframes
- shadcn 亮色 `:root` 主题块（实际未使用）不改动
- 手册流程图四大师称呼按用户原文「李璐」；用户描述中的流程节点（含宁德时代为当前唯一"低估+高分"样本）原样呈现

## Verification

1. 类型检查：`cd valuation-tracker && bunx tsc --noEmit`（不应有新增错误）
2. 启动前端：`bun run dev:web`（或整体 `bun run dev`），浏览器手测：
   - 金色变亮：主页按钮/链接/图表/选中态均为新亮金（`#f2c14e` 系）
   - 左侧 ICON 列 hover/选中为直角，hover tooltip 为直角无圆角
   - 咖啡按钮有明显金色 + 呼吸光晕 + 图标动效
   - 首次访问（清 localStorage）→ 自动弹手册（流程图完整、可滚动）→ 关闭后自动弹咖啡（从按钮缩放放大）
   - 咖啡弹窗点 X / 遮罩 / 不再提醒 → 均缩回按钮位置后消失；点「不再提醒」后刷新不再自动弹，但手动按钮可开
   - 二次访问 → 只弹咖啡（若未勾不再提醒）；勾选后刷新 → 无自动弹窗
   - 手动点「网站使用手册」按钮随时可打开/关闭
3. 回归：二维码图片正常显示、公司列表/图表/初筛页样式无异常
4. 无新增依赖，`bun.lock` 不变