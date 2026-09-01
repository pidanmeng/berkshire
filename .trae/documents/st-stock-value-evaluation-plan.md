# ST 股票价值评价方法论 — 落地计划

> 目标：梳理 A 股戴帽/摘帽/退市规则，参考 deep-dive 命令的八步深研范式，整理一套「双轨结合」的 ST 股票价值评价方法论，并落地为**规则笔记 + 方法论文档 + 专用模板 + /st-dive 命令 + valuation-tracker ST 专题（含巨潮公告 + K 线 POI）** 五层交付。
> 用户已确认：完整落地 / 双轨结合（价值修复 + 事件博弈）/ 仅新增不改现有研究侧组件（screener、quality-screen、50 项清单不动）。

***

## 一、Summary

本计划交付五层产物：

| 层   | 产物                                                                                      | 位置                                               |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| L1  | A 股 ST 规则梳理知识笔记（戴帽/摘帽/四类退市/板块差异/交易限制/新规过渡期）                                             | `Research/10-Knowledge/99-宏观/A股ST戴帽摘帽退市规则.md`    |
| L2  | ST 价值评价方法论（双轨框架：价值修复轨 + 事件博弈轨 + 公告驱动权重 + ST 专用检查清单/No-Go/估值）                            | `Research/10-Knowledge/99-宏观/ST股价值评价方法论.md`      |
| L3a | ST 专用深度调研模板（基于 company-deep-dive-template 改造 + ST 诊断/摘帽路径/退市风险/公告时间线/事件博弈章节）            | `Research/99-Templates/st-deep-dive-template.md` |
| L3b | `/st-dive [公司名]` 命令（deep-dive 八步改造：公告权重提升）                                              | `.trae/commands/st-dive.md`                      |
| L4  | valuation-tracker ST 专题：`/st` 列表页 + ST 个股详情增强（ST 状态卡/公告时间线）+ 巨潮公告 API 代理 + K 线公告 POI 悬停 | `valuation-tracker/`（见 L4 章节）                    |

L1 与 L2 是方法论核心（知识与框架），L3 使方法论可操作化（命令+模板），L4 使方法论可监控（公告驱动可视化）。

***

## 二、现状分析（探索结论）

### 2.1 系统现有能力（可复用）

* **deep-dive 八步范式**（`.trae/commands/deep-dive.md`）：检查已有研究 → 深度采集（财报 3 年 + 研报 + evaluate.ts 快照）→ document-reader 原文精读（10 大目标 + 第十章多空论证）→ 质量筛查回填 frontmatter → 增量对比 → 写知识库 → 单公司报告（附录 5 项）→ 全局 Review。

* **巨潮封装已存在**：`valuation-tracker/server/lib/cninfo.ts`（searchCninfo 按名称→orgId、queryAnnouncements 按 code+orgId 拉公告列表，返回 `{title, date, pdfUrl}`），`server/routes/fundamentals.ts` 已用它做财报更新检测。

* **服务端代理外部 API 是成熟模式**：`server/lib/quote.ts`（同花顺+东财三源并发降级）、`server/lib/darktrade.ts`（GBK 解码脱敏代理范本）；`server/lib/cninfo.ts` 同理。浏览器不直连上游（CORS/UA/Cookie 风险）。

* **K 线组件已具标记基础**：`components/PriceChart.tsx`（原生 ECharts，`KlineBar={date,open,high,low,close,volume}`，date 为 YYYY-MM-DD，与巨潮公告 date 同格式可直接对齐），已用 markLine 佐证 ECharts 标记能力；**尚无 markPoint/POI**（全仓库零命中），需新增。

* **同花顺 tickers 全市场名单**：`.trae/scripts/hithink/hithink.ts` 的 `meta/tickers/list`（screener 计划实证，limit≤10000 一次拿全），可过滤 ST/\*ST/退；`server/lib/quote.ts` 已 import hithink，可复用。

* **模板/命令/笔记 frontmatter 规范**：company-deep-dive-template.md 的十二章节结构、四大师评分卡、估值模型与参数明细；50 项清单放行标准（CRITICAL ❌ ≤1 且无 No-Go）。

### 2.2 现状缺口

1. **无 ST 规则专题笔记**：仅 `screen.ts` 的 `ST_RE=/ST|退/` 硬排除 + 两个个案（盛科通信 \*ST 临近条款、中石科技的碳元科技退市类比）。ST 规则知识为空白。
2. **无 ST 价值评价框架**：现有四大师框架假定"正常经营公司"，未覆盖戴帽诊断、摘帽路径、退市风险分级、保壳/重整/壳价值、公告驱动博弈。
3. **无 ST 专用模板/命令**：deep-dive 不适用 ST（财报权重过高、公告权重不足、无退市风险评估环节）。
4. **前端无 ST 专题页、无公告可视化**：valuation-tracker 无 ST 入口；K 线无公告 POI；无公告列表 API 路由。

### 2.3 规则要点已核实（2024 退市新规，截至 2026-09 有效，L1 落地时须以交易所规则原文为准）

* **ST（其他风险警示）**：分红不达标（3 年累计分红 < 年均净利 30% 且 <5000 万）、财务造假未达退市标准的梯度 ST（行政处罚认定造假即 ST）、资金占用等非财务类风险。

* \***ST（退市风险警示）**：财务类组合（利润总额/净利润/扣非净利孰低为负 **且** 营收 <3 亿（主板）/ <1 亿（创业板）/ <5000 万（科创板））、期末净资产为负、年报非标（无法表示/否定意见）；\*ST 摘帽须内控审计无保留意见，否则退市。

* **四类强制退市**：交易类（股价 <1 元/连续 20 日、市值 <5 亿/连续 20 日）；财务类（组合指标、净资产为负、审计非标）；规范类（资金占用 ≥2 亿或净资产 30% 且不整改、连续内控非标、控制权无序争夺）；重大违法类（造假 1 年 2 亿/30%、2 年 3 亿/20%、3 年连续；欺诈发行）。

* **板块差异**：创业板/科创板财务类营收门槛更低（1 亿/5000 万）；北交所仅设 \*ST 无 ST，市值退市 <3 亿。

* **交易限制**：主板 ST 涨跌幅 5%（创业/科创 20%）；个人投资者单日买入单只 ST 上限 50 万股。

* **退市流程**：\*ST 次年未达标 → 退市整理期（15 个交易日）→ 三板；重大违法退市不得重新上市。

* **过渡期**：财务类组合指标自 2024 年报起算，市值类设 6 个月过渡期。

***

## 三、总体设计

### L1 规则梳理笔记

**文件**：`Research/10-Knowledge/99-宏观/A股ST戴帽摘帽退市规则.md`

**内容结构**（frontmatter：`type: macro-rule / topic: A股ST与退市规则 / created / sources[] / confidence / updated`）：

1. 概念界定：ST vs \*ST 的区别与监管意图
2. ST（其他风险警示）触发条件（含 2024/2025 新增：分红不达标、造假梯度 ST）
3. \*ST（退市风险警示）触发条件（财务类组合、规范类）
4. 板块差异对照表（主板/创业板/科创板/北交所 × ST/\*ST/财务门槛/交易限制）
5. 摘帽规则：ST 撤销条件、\*ST 撤销条件（含内控无保留硬要求）、申请时点与流程、撤销后观察期
6. 四类强制退市标准明细表（交易/财务/规范/重大违法，逐条触发标准 + 最新修订值）
7. 退市流程全图：\*ST → 退市整理期（15 交易日）→ 三板 → 重新上市条件
8. 交易限制汇总（涨跌幅、50 万股买入上限）
9. 2024 退市新规要点与过渡期安排（财务类自 2024 年报、市值类 6 个月过渡）
10. 官方信源锚点：上交所/深交所/北交所《股票上市规则》原文链接 + 证监会《关于严格执行退市制度的意见》

**方法**：以交易所规则原文与官方新闻稿为事实源（≥2 独立来源交叉验证），逐条标注置信度与出处；执行期用 WebSearch/WebFetch 抓取 `sse.com.cn`、`szse.cn`、`bse.cn`、`csrc.gov.cn` 官方页面与规则 PDF 确认最新数值（L1 落地第一步）。

**注意**：规则会随监管更新，笔记首部固定标注「截至 2026-09 有效，重大修订需更新」，并将规则要点转成可与 ST 公司 frontmatter 关联的「条款 ID」供 L2 方法论引用（如 F1=财务组合、T1=面值退市、N1=资金占用）。

### L2 价值评价方法论（双轨框架）

**文件**：`Research/10-Knowledge/99-宏观/ST股价值评价方法论.md`

**核心理念**：ST 股票本质是「**规则驱动 + 事件驱动**」的标的——涨跌主要不靠财报季报，而靠公告（戴帽/摘帽/重整/立案/问询/停复牌/回购/易主）。因此方法论与 deep-dive 的本质差异在于**信息权重**：

> 财报精读 40% + 公告解读 40% + 行业/外围 20%（deep-dive 为财报主导）。公告是 ST 研究的一级信源。

**双轨框架**（两条评估轨，最终合并裁决）：

**轨一 · 价值修复轨**（基本面驱动，对应四大师框架）：

1. 戴帽原因诊断：属于哪条规则条款（引用 L1 条款 ID）、触发时点、是否同时触及退市标准
2. 保壳/摘帽三路径评估（每条给可行性/时间表/关键节点/成功概率）：

   * 财务路径（营收做大/扭亏/净资产转正/消除非标——验证真实性，防突击交易）

   * 重整路径（法院受理、管理人、重整计划、投资人、债务清偿/转增股本）

   * 重组路径（重大资产重组/借壳/易主/资产注入）
3. 财务排雷 ST 专用红旗：非经常性损益依赖、突击交易（年末大单）、关联交易输送、会计估计调整、审计意见变化、持续经营不确定性（持续经营段被强调）
4. 修复质量判断：主业营收真实性（扣非口径）、毛利率/现金流、摘帽后盈利能否持续（非"保壳式"盈利）
5. 估值（修复情景）：摘帽后 PE/PB 修复目标、对标同行业正常公司

**轨二 · 事件博弈轨**（公告驱动）：

1. 公告时间线重建：近 2 年全部重大公告按时间排序（戴帽/摘帽/重整/立案/问询函/回复/减持/回购/停复牌/股东大会）
2. 事件日历：年报披露窗口、ST 生效日、摘帽申请与审批窗口、退市整理期窗口
3. 博弈要素：市值与流通盘、股东结构（是否易主/控股权争夺）、筹码集中度、历史摘帽/退市案例映射（同板块/同类型）
4. 股价反应验证：关键公告前后相对大盘/板块的超额收益（公告是否已被定价）
5. 估值（博弈情景）：重整价值（资产重估）、壳价值（已按新规大幅压缩，须谨慎）、事件兑现价

**合并裁决**：双轨结果汇总为一张决策表——「修复概率 × 空间」与「博弈胜率 × 赔率」取交集；任一轨触发 No-Go 则整体否决。

**ST 专用检查清单**（区别于 50 项清单，作为 st-dive 报告附录）：

* CRITICAL No-Go：财务造假被坐实（行政处罚/立案）、年报无法表示/否定意见、资金占用不整改、主营持续失血且无可行重整/重组方案

* IMPORTANT：内控非标、持续经营存疑被审计强调、保壳依赖单一非经常性损益、控制权争夺/诉讼缠身

* NORMAL：退市整理期临近、市值逼近面值/5 亿退市线

**四大师适配**：

* 能力圈：ST 需更高门槛（能看懂"为什么戴帽、怎么摘帽"才算懂）

* 护城河：区分「主业护城河（是否有救）」与「壳/筹码价值（已大幅贬值）」

* 管理层诚信：ST 里是命门——造假/占用史 → 一票否决

* 安全边际：以退市情景为底线，明确"归零风险"下的仓位纪律

* 历史类比：同板块同类型 ST 的摘帽/退市结局统计

**跟踪指标**：公告频率与性质变化、风险等级迁移、摘帽进度、股价与面值/市值退市线的距离。

### L3a ST 专用深度调研模板

**文件**：`Research/99-Templates/st-deep-dive-template.md`

基于 `company-deep-dive-template.md` 改造，保留：核心结论、四大师评分卡、估值与股价快照、估值模型与参数明细、多空论证摘要、质量筛查结论、相关研究。**新增/改造章节**：

1. **ST 诊断卡**（新增，置顶）：当前状态（ST/\*ST/摘帽/退市整理）、戴帽规则条款（L1 条款 ID）、触发时点、摘帽状态、退市风险等级（高/中/低）
2. **摘帽/保壳路径评估**（新增）：三路径表格（财务/重整/重组 × 可行性 × 时间表 × 关键节点 × 概率）
3. **退市风险评估**（新增）：四类退市标准逐条对照表 + 距离触发的安全垫（市值/股价/营收/净资产/审计意见/资金占用）
4. **公告时间线**（新增，公告驱动核心）：重大公告年表（日期/标题/PDF 链接/信息含量分级/股价反应）
5. **财务排雷检查**（新增）：ST 专用红旗清单逐项打勾
6. **事件博弈检查表**（新增）：事件日历 + 博弈要素 + 案例映射
7. **四大师评估**（改造）：按 L2 适配规则
8. **估值三情景**（改造）：修复情景 / 重整情景 / 退市情景（对应 target\_market\_cap\_yi 三档）
9. **多空论证**（改造）：五维度 ST 版（戴帽原因消除 / 保壳真实性 / 退市风险 / 估值 / 公告催化）
10. **质量筛查结论**（保留并注明）：ST 公司 quality-screen 大概率 RED，其意义是「排雷确认」而非「否决跟踪」；结论栏给出 ST 语境解读

**frontmatter 新增字段**（供 valuation-tracker L4 消费）：

* `st_status`: `ST / *ST / 摘帽 / 退市整理`

* `st_reason`: 戴帽规则条款简述

* `delist_risk`: `高 / 中 / 低`

* `removal_path`: `财务 / 重整 / 重组`

* `st_removal_timeline`: 关键时间节点数组（日期+事件+状态）

* `announcement_driven`: true（ST 公司默认）

### L3b /st-dive 命令

**文件**：`.trae/commands/st-dive.md`

**流程**（deep-dive 八步改造，逐条标注差异）：

1. 检查已有研究：搜索 `<公司名>-*.md`，区分新增/追加；读取 st\_status/风险等级
2. **深度采集（公告权重提升）**：

   * 2.1 `stock.ts` 定位代码

   * 2.2 财报：最近 3 个完整财年年报 + 最近中报/季报（同 deep-dive，`fetch-file.ts --name` 命名规范）

   * 2.3 **公告（新增重点环节）**：`stock.ts --announcements` 拉近 2 年公告 + 用巨潮（cninfo.ts 同款接口）定向抓「戴帽/摘帽/重整/立案/问询/停复牌/业绩预告/审计意见」类重大公告，下载关键公告原文 PDF（如戴帽公告、重整计划、交易所问询函）到 `pdf-texts/<公司名>/` 并提取 Markdown

   * 2.4 研报（≥1 多 1 空）+ `evaluate.ts` 快照（作为对照基准，注意 ST 品种路由输出 PB/PS/亏损模型）
3. 原文精读（document-reader）：10 大目标改造——新增「**公告精读**」目标（公告是 ST 一级信源）、「**退市/摘帽规则对照**」目标（逐条对照 L1 条款）；三年年报连贯性红线保留（ST 语境下审计意见与持续经营段是重点）；多空论证强制
4. 结构化提取与质量筛查：quality-screen 跑（RED 预期），**ST 语境解读写入结论**；回填 `quality_verdict/quality_score` + ST 新字段（st\_status/st\_reason/delist\_risk/removal\_path）
5. 增量对比：风险等级迁移、摘帽进度、公告新增
6. 写入知识库：按 `st-deep-dive-template.md`，路径 `Research/10-Knowledge/XX-行业/02-公司研究/<公司名>-公司研究.md`（ST 公司可归入其所属行业，或 ST 专类目录——**默认归入所属行业公司研究目录，若跨行业 ST 主题累积再建 ST 专类**）
7. 生成报告：`20-Reports/YYYY-MM-DD-<公司名>-st-report.md`，模板 st-deep-dive-template.md；附录含 ST 专用检查清单 + 公告时间线 + 质量筛查 + 10 项精读 + 50 项清单（标注 ST 语境下 50 项清单的适用性说明）
8. 全局 Review（契约不变）

**taskId**：`st-dive-<公司名>-YYYYMMDD-<4位随机>`。

**输出要求**：向用户汇报退市风险等级、摘帽/保壳路径概率、事件日历、目标价区间、多空论证裁决、公告驱动的关键发现。

### L4 valuation-tracker ST 专题

> 原则：全部新增路由/组件/页面；仅对 `PriceChart.tsx` 与 `CompanyDashboard.tsx` 做**增量增强**（用户明确要求）。样式遵循「Tailwind 工具类 + 现有 CSS 变量，禁改 globals.css 与自定义类」。巨潮经服务端代理（CORS/UA/Cookie 原因，复用 cninfo.ts 现有封装），浏览器不直连 cninfo。

**L4-1 新增公告 API 路由**：`valuation-tracker/server/routes/announcements.ts`

* `GET /api/announcements/:thscode?days=365&category=all`

* 实现：thscode → 公司名（优先本地 research.ts loadCompanies 匹配，缺则东财 suggest）→ `cninfo.searchCninfo(name)` 取 orgId → `cninfo.queryAnnouncements({category:'ndbg,bndbg,yjyg,yjbb', days})`；`category=all` 时不过滤类别，用标题关键词过滤「重要公告」（ST/摘帽/重整/立案/问询/业绩/审计/停牌/回购/减持/易主）

* 返回：`{ thscode, items: [{ title, date(YYYY-MM-DD), pdfUrl, category }] }`；60s 缓存（复用 cache.ts）

* 若 `server/lib/cninfo.ts` 缺「代码→名称」解析或全量类别查询，做最小增量补充（新增函数，不改现有函数签名）

**L4-2 新增 ST 名单路由**：`valuation-tracker/server/routes/st-list.ts`

* `GET /api/st-list`

* 实现：hithink `getTickers()`（或东财）全市场名单 → 名称过滤 `ST|*ST|退` → 批量行情/市值（复用 `server/lib/quote.ts` 快照能力）→ 与 research.ts `loadCompanies()` 合并，标记已研究 ST 公司（frontmatter `st_status` 非空）与其风险等级

* 返回：`{ updatedAt, items: [{ thscode, name, stType(ST/*ST/退), market, price, pct, mcap, researched, delistRisk?, stReason?, removalPath? }] }`；60s 缓存

**L4-3 新增 ST 专题页**：`app/st/page.tsx` + `components/StDashboard.tsx`

* 路由 `/st`（force-dynamic，服务端拉 `/api/st-list`）

* 功能：状态筛选（全部/ST/\*ST/退/已研究）、表格（代码/名称/状态标签/板块/现价/涨跌幅/市值/研究标记/风险等级）、已研究公司跳转 `/companies/[thscode]`

* 样式：现有黑金主题 + Tailwind 工具类；状态标签用 `--accent-danger`（ST 红）/`--accent-warning`（\*ST 橙）/`--text-secondary`（退）色系

**L4-4 个股详情增强**：`components/CompanyDashboard.tsx`

* ST 状态卡（frontmatter 有 st\_status 时显示）：ST 状态、戴帽原因、退市风险等级、摘帽路径、公告时间线列表（调 `/api/announcements/:thscode`，默认近 180 天，可展开 PDF 链接）

* K 线区域传入 announcements prop

**L4-5 K 线公告 POI**：`components/PriceChart.tsx`（增量）

* 新增 `announcements?: { date, title, pdfUrl }[]` prop

* 在 candlestick series 加 `markPoint.data`：每个公告日期在当日 K 线下方（`coord: [date, low*0.97]`）打标记（symbol 用 pin/菱形，金色 `--accent-primary` 或红色区分重大公告）

* tooltip：悬停标记显示公告标题 + 日期；点击打开 pdfUrl（新标签）

* 公告过滤规则：近 N 天 + 重要公告关键词（避免普通公告过密）；ST 公司（st\_status 非空）放宽全部显示

* 数据流：CompanyDashboard 已加载 announcements → 传给 PriceChart；K 线与公告按 date 对齐（同 YYYY-MM-DD 格式）

**L4-6 类型与 API 层**：`valuation-tracker/lib/api.ts`

* 新增类型：`Announcement`、`AnnouncementsResponse`、`StListItem`、`StListResponse`

* 新增函数：`getAnnouncements(thscode, days)`、`getStList()`（封装 fetch + 错误透出）

**导航**：`components/Dashboard.tsx` header 增加「ST 专题」链接（Tailwind 工具类，同现有导航样式）。

***

## 四、文件级改动清单

### 新增文件

| # | 文件                                                                         | 说明           |
| - | -------------------------------------------------------------------------- | ------------ |
| 1 | `Research/10-Knowledge/99-宏观/A股ST戴帽摘帽退市规则.md`                              | L1 规则笔记      |
| 2 | `Research/10-Knowledge/99-宏观/ST股价值评价方法论.md`                                | L2 双轨方法论文档   |
| 3 | `Research/99-Templates/st-deep-dive-template.md`                           | L3a 模板       |
| 4 | `.trae/commands/st-dive.md`                                                | L3b 命令       |
| 5 | `valuation-tracker/server/routes/announcements.ts`                         | L4 公告 API    |
| 6 | `valuation-tracker/server/routes/st-list.ts`                               | L4 ST 名单 API |
| 7 | `valuation-tracker/app/st/page.tsx`                                        | L4 ST 专题页    |
| 8 | `valuation-tracker/components/StDashboard.tsx`                             | L4 ST 专题组件   |
| 9 | `valuation-tracker/server/routes/announcements.test.ts`（如项目已有测试惯例则补充，否则跳过） | 路由测试（可选）     |

### 修改文件（均为增量）

| # | 文件                                                  | 改动                                                |
| - | --------------------------------------------------- | ------------------------------------------------- |
| 1 | `valuation-tracker/server/lib/cninfo.ts`            | 若缺「代码→名称」或全量公告查询，最小增量补充（不改现有函数签名）                 |
| 2 | `valuation-tracker/server/app.ts`                   | 注册 announcements/st-list 路由（新增两行）                 |
| 3 | `valuation-tracker/components/PriceChart.tsx`       | markPoint POI + tooltip（增量）                       |
| 4 | `valuation-tracker/components/CompanyDashboard.tsx` | ST 状态卡 + 公告时间线 + 传 announcements 给 PriceChart（增量） |
| 5 | `valuation-tracker/components/Dashboard.tsx`        | header 加「ST 专题」导航链接（增量）                           |
| 6 | `valuation-tracker/lib/api.ts`                      | 新增 ST/公告类型与 API 函数（增量）                            |

### 明确不动

* `.trae/scripts/screener/screen.ts`、`.trae/scripts/quality-gate/quality-screen.ts`、`Research/99-Templates/50-item-investment-checklist.md`、research.md 等现有研究侧组件

* `styles/globals.css`、`app/layout.tsx` 主题层

### 可选（需用户确认的最小增量）

* `AGENTS.md` 常用指令表加一行 `/st-dive [公司名]`，使命令可发现（纯增量文档行，不改任何流程逻辑）。计划默认包含，如用户反对则撤销。

***

## 五、假设与决策

| # | 决策点          | 结论                                             | 理由                                                                            |
| - | ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 | 方法论形态        | 知识笔记（非 Skill）                                  | 用户选「完整落地：规则笔记+模板+命令」，未要求 Skill；方法论文档供命令引用                                     |
| 2 | 评估视角         | 双轨结合（价值修复 + 事件博弈）                              | 用户确认                                                                          |
| 3 | 现有研究侧组件      | 仅新增不动现有                                        | 用户确认；quality-screen 对 ST 的红牌在命令/模板层做「ST 语境解读」，不修改脚本                           |
| 4 | ST 公司知识库归位   | 默认归入所属行业 `02-公司研究/`，跨行业 ST 累积后再建专类目录           | 与三段式目录约定一致，避免破坏现有结构                                                           |
| 5 | 巨潮调用方式       | 服务端代理（Elysia route），浏览器不直连                     | CORS/UA/Cookie 限制 + darktrade.ts 脱敏代理先例；用户所说「前端调用」理解为 valuation-tracker 界面内调用 |
| 6 | K 线 POI 过滤   | 普通公司显示近 N 天重要公告；ST 公司放宽                        | 普通公司公告量大需过滤防过密；ST 是公告驱动标的，全部显示                                                |
| 7 | ST 名单数据源     | 同花顺 tickers 过滤 + quotes 快照 + research notes 合并 | screener 计划实证 tickers/list 可用，quote.ts 已 import hithink                       |
| 8 | 规则时效         | 笔记标注「截至 2026-09 有效」+ 官方出处锚点                    | 规则动态更新，须可回溯                                                                   |
| 9 | AGENTS.md 增行 | 默认包含（纯增量），用户可撤销                                | 命令可发现性                                                                        |

***

## 六、验证步骤

1. **L1 规则笔记**：关键数值（营收门槛 3 亿/1 亿/5000 万、市值 5 亿/3 亿、造假 2 亿 30% 等）在交易所规则原文（sse/szse/bse 官网）≥2 处独立交叉验证；逐条标注置信度。
2. **L2 方法论**：与现有框架一致性自检——引用四大师、50 项清单放行标准、quality-screen 红牌逻辑无冲突；双轨决策表可操作（每格有明确判定依据）。
3. **L3b 命令**：语法/结构对齐 deep-dive.md 契约（taskId/子 Agent 触发契约/Review 契约引用 AGENTS.md）。
4. **L4 后端**：`cd valuation-tracker && bun run dev` 后：

   * `GET /api/st-list` 返回真实 ST 名单（含至少 1 家已研究/未研究样本）

   * `GET /api/announcements/000xxx.SZ?days=365` 返回真实公告（与巨潮官网核对 1-2 条标题/日期）

   * 缓存生效（二次请求走缓存）
5. **L4 前端**：

   * `/st` 页正常渲染、筛选可用、已研究项跳转详情

   * 个股详情 K 线出现公告 POI，悬停显示标题，点击打开 PDF（验证 static.cninfo.com.cn 匿名可访问；若被 UA/Referer 拦截，回退为「复制链接」而非内嵌）

   * 无 ST 研究字段的普通公司不显示 ST 状态卡
6. **回归**：`bun run build` 通过；现有页面（`/`、`/companies/[thscode]`、`/screener`、`/darktrade`）无回归；`bun run .trae/scripts/screener/screen.ts --smoke 5`（如改动涉及）不受影响（本次未动，仅确认）。
7. **产出核对**：L1/L2 笔记 frontmatter 完整（type/created/sources/confidence），L3a 模板与 L3b 命令互相引用无断链。

***

## 七、执行顺序建议

1. L1 规则笔记（先立规则事实源，L2/L3/L4 都引用其条款 ID）
2. L2 方法论文档（双轨框架，方法论核心）
3. L3a 模板 + L3b 命令（方法论的执行工具，互相引用）
4. L4 valuation-tracker（后端路由 → 类型/API 层 → 前端页面/组件 → POI）
5. 验证步骤全量执行 + AGENTS.md 增行（如确认）

