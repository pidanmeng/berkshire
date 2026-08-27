---
description: 对已有研究笔记的公司进行基本面增量更新（重大公告/新财报触发）。用法：/deep-dive-update [公司名]
---

用户发起单公司基本面更新调研，目标公司为：**$ARGUMENTS**

> **Deep Dive Update 原则**：仅适用于**已有研究笔记**的公司，且仅在出现**重大变动**（重要公告 / 更新财报）时触发。目标不是全量重做，而是**聚焦基本面的增量更新**：带着「本次变动改变了什么」的问题清单去精读新材料，验证或证伪上次研究的关键假设与跟踪指标。产出的元数据（frontmatter）与 `deep-dive` 产物同构，内容聚焦基本面变化。

## 触发条件（前置校验，任一不满足即中止）

1. **必须已有研究笔记**：搜索 `Research/10-Knowledge/**/02-公司研究/<公司名>-公司研究.md`
   - 不存在 → 提示「该命令仅适用于已有研究笔记的公司，请改用 /deep-dive 进行首次深度调研」，**中止且不产出任何文件**
2. **必须检测到重大变动**：用共享脚本 `stock.ts` 检测（`--announcements` 公告 + `--financial` 定期报告）：
   - 新发布定期报告（年报 / 半年报 / 季报 / 业绩预告 / 业绩快报）晚于已有笔记的 `research_cutoff.announcement_date`（或 `data_as_of`）
   - 重要公告：重大合同、重大投资/扩产、回购/减持、诉讼/处罚、股权变动、业绩说明会纪要等
   - 无重大变动 → 输出「无重大变动，本次不产出更新产物」，**中止且不写入任何文件**

## 流程（串行执行）

### 1. 读取已有研究基线

- 读取 `<公司名>-公司研究.md`：提取上次结论、四大师评分、估值快照、`research_cutoff`、`update_history`
- 读取最近一次 deep-read / processed 文件（如有）：作为精读基线
- 若已存在 `<公司名>-基本面更新.md`：读取最近一次更新，作为增量基线（避免重复覆盖）

**提取 Forward PE 核心影响因素与跟踪指标（强制，读财报前的必要步骤）**：

1. 从公司笔记 frontmatter 读取 `forward_pe.factors`（Forward PE 核心影响因素）与 `forward_pe.directions`（上下行情形）
2. 从公司笔记正文「跟踪指标」章节读取每一条跟踪指标（含阈值/方向）
3. 将两者合并整理为**待验证问题清单**：`<问题> → <验证口径/阈值> → <预计数据来源章节>`，写入当前任务上下文，作为精读新财报的起点
4. 每条问题必须在后续更新产物中显式回答：**验证 / 证伪 / 需调整**（含证据与置信度）；若公司笔记缺 `forward_pe` 或「跟踪指标」章节，则从最近一次 deep-read/基本面更新中提取，并标注「基线缺失」

### 2. 定向采集（聚焦触发事件）

1. 用共享脚本 `stock.ts` 定位本次触发的财报 PDF（新发布的定期报告，优先原文）+ 触发公告 + 1-2 篇相关研报
2. 用共享脚本 `fetch-file.ts` 提取 Markdown 到 `Research/00-Workspace/02-Processing/pdf-texts/<公司名>/`（与 deep-dive 共用目录，远程 PDF 成功转换后清理）。**命名规范（强制）**：按 stock.ts 返回的标题传 `--name`（如 `--name "2026年半年度报告"`），以可读标题落盘，禁止使用源文件名
3. 用共享脚本 `evaluate.ts` 获取最新估值快照 + 10 项财报精读检查表（作为对照基准）

### 3. 增量原文精读（调用 document-reader 子 Agent）

启动子任务 `document-reader`，传递：公司名称与代码、触发事件清单、新增财报/公告原文路径、上次 deep-read 与公司笔记（基线）、**步骤 1 整理的「待验证问题清单」（Forward PE 核心影响因素 + 跟踪指标逐条）**、`evaluate.ts` 估值快照。

**精读目标（聚焦「本次变动」）**：

1. **本次财报/公告的核心数据变化**：量价、利润率、现金流、负债、分红/回购、产能与在建工程
2. **管理层对本次变动的表述 vs 数据一致性**：有无夸大、含糊或前后矛盾
3. **基本面趋势是否被本次变动扭转**：变好 / 变坏 / 中性，给出证据
4. **按「待验证问题清单」逐条核对（强制）**：每一条 Forward PE 核心影响因素与跟踪指标，用本次财报数据回答「验证 / 证伪 / 需调整」，注明依据原文章节；回答完毕后，基于新数据**重估 Forward PE 核心影响因素的权重**并列出**新出现的跟踪指标**（新增/移除），同步修订 `forward_pe.factors/directions` 与「跟踪指标」章节
5. **财务红旗复核**：质量筛查 8 项红牌 + 现金流、减值、营运资本、预计负债
6. **三年年报连贯性与管理层诚实红线（强制项）**：若触发事件为年报/半年报，须复核最新报告与此前至少 3 个财年的口径/会计政策/数字衔接，判断基本面是否逐年变好、三年是否连贯、管理层是否诚实——**三年连贯性断裂或管理层不诚实 → No-Go 红线，显式标注**
7. **数据归因与逻辑一致性核查（强制项）**：对本次变动的核心指标（毛利率/净利/现金流等）切实归因（量价/成本/结构/竞争/周期，判定良性/恶性），**必须用搜索工具找外部证据，凡有结论必有证据**；核对数据逻辑勾稽，挖「不合逻辑」处并追因（详见 document-reader 第 9 大精读目标）

**DocumentReader 产出**：
- `Research/00-Workspace/02-Processing/YYYY-MM-DD-<公司名>-deep-read-update.md`
- 包含原文关键引用（Evidence Log）、待核实事项、与上次 deep-read 的差异点

### 4. 结构化提取与质量筛查

基于增量精读笔记：
- 由 info-alchemist 提取本次变动相关结构化数据（复用 processed 命名：`YYYY-MM-DD-<公司名>-processed-update.md`）
- 生成临时草稿 → 用共享脚本 `quality-screen.ts` 生成质量筛查结论

### 5. 增量对比（核心章节，必须逐条回答）

在更新产物中对比「本次更新 vs 上次研究」：

- **业绩变化**：营收/净利增速、毛利率、ROE、经营现金流/净利润、负债率
- **估值变化**：PE/PB/市值、目标价区间是否调整、安全边际是否变化
- **护城河变化**：市占率、竞争格局、技术进展、产能利用率
- **管理层变化**：重大人事、承诺兑现、回购/减持
- **跟踪指标调整**：待验证问题清单逐条结论（验证 / 证伪 / 需调整，附证据）；本次新增或移除的跟踪指标
- **Forward PE 修订**：核心影响因素权重变化、`factors/directions` 修订点、验证后是否需要调整估值口径

### 6. 写入知识库

- 公司文件夹新增 `<公司名>-基本面更新.md`（**frontmatter 元数据与公司笔记同构**：`type: "deep-dive-update"`，含 `name/stock_code/industry/sub_industry/related_notes/tags/created/updated/deep_dive_at/data_as_of/valuation_as_of/valuation_status/quality_status/research_conclusion/update_history/scores/target_market_cap_yi/forward_pe/research_cutoff/quality_verdict/quality_score` 等字段，触发字段 `trigger`、基线字段 `based_on`）
- **`financials` 结构化字段（必填）**：与公司笔记的 `financials` 块同构（`report_period/revenue_yi/net_profit_yi/roe/gross_margin/net_margin/asset_liability_ratio/ocf_yi/ocf_to_ni/revenue_yoy/net_profit_yoy`），供看板「基本面对比（上次研究 vs 本次更新）」图表消费；口径与上次研究保持一致，无法可靠取数的指标置 `null`
- **命名规范（多份产物并存时）**：`<公司名>-基本面更新-<变更简写|报告时间>.md`
  - 变更简写：重大变更的简短描述，如 `2026中报`、`股东减持`、`回购进展`、`重大合同`、`定增获批`
  - 报告时间：生成报告的年月，如 `2026-08`
  - 首份更新可省略后缀（`<公司名>-基本面更新.md`）；后续多份必须带后缀以区分，前端按 `updated` 倒序展示
- 若已有 update 文件：在 `update_history` 追加新记录；内容差异较大时可新建带后缀的文件（前端支持多份）
- 更新原公司笔记 frontmatter：`updated`、`deep_dive_at`、`research_cutoff`、`update_history` 追加本次记录；若本次更新了 `financials`/评分/估值，同步更新公司笔记对应字段（并标注数据时点）；**`forward_pe.factors/directions` 与「跟踪指标」章节按精读结论同步修订**（保留修订依据，标注本轮验证/证伪结果）

### 7. 生成更新报告

- 路径：`Research/20-Reports/YYYY-MM-DD-<公司名>-deep-dive-update-report.md`
- **frontmatter 元数据与 deep-dive 报告同构**（`title/date/type: "deep-dive-update-report"/stock_code/classification/confidence/related_notes/validation_source/tags`）
- **报告撰写须读取 deep-read 多空论证章节**（本次更新精读产出的 `deep-read-update` 文件含多空论证时）：核心变化、四大师评分、估值判断章节呈现多空双方对本次变动的解读差异，并结合产业/周期/国际/政策等外围因素裁决
- 内容聚焦（不含全量行业/公司重述）：
  1. 触发事件
  2. 核心变化（增量对比表：本次 vs 上次）
  3. 四大师评分（如调整则标注变化）
  4. 估值与安全边际（目标价调整或维持的理由）
  5. 质量筛查结论
  6. 更新后的跟踪指标
  7. 附录：增量精读摘要、质量筛查结论、财报精读 10 项检查清单、50 项投资决策清单 AUTO 扫描结果

## 输出要求

- 向用户汇报：update 产物路径、更新报告路径、触发事件、四大师评分（如调整）、质量筛查结论、目标价变化、核心变化摘要
- **特别说明**：必须明确告知用户「本次是否检测到重大变动」「精读了哪些新材料」「从原文中发现了哪些结构化数据无法提供的细节」
