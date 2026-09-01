---
description: 对 ST/*ST 公司进行双轨价值评价深度调研（规则驱动 + 公告驱动），支持追加到已有研究。用法：/st-dive [公司名]
---

用户发起了 ST 标的价值评价深度调研，目标公司为：**$ARGUMENTS**

> **ST Deep Dive 原则**：ST 股票是**规则驱动 + 事件驱动**的标的——涨跌主要由公告（戴帽/摘帽/重整/立案/问询/停复牌/回购/易主）与规则时间表驱动。因此本命令在 deep-dive 基础上**提升公告权重**：财报精读 40% + 公告解读 40% + 行业/外围 20%。必须带着**问题清单**精读每份财报与重大公告原文，禁止仅看标题和结构化数据下结论。
>
> **方法论**：执行前先读 `Research/10-Knowledge/99-宏观/ST股价值评价方法论.md`（双轨框架）；规则条款引用 `Research/10-Knowledge/99-宏观/A股ST戴帽摘帽退市规则.md`（条款 ID：F/N/S/T/M 系列）。

## 流程（串行执行）

> **taskId**：命令启动时生成 `st-dive-<公司名>-YYYYMMDD-<4位随机>`，贯穿本命令的输入、产物、日志与终态 Review；重试沿用原 taskId 并增加 attempt，不得用主题名或时间戳替代。

### 1. 检查已有研究
- 搜索 `Research/10-Knowledge/**/02-公司研究/<公司名>-*.md`
  - 若存在：读取现有笔记，提取 ST 状态（`st_status`）、风险等级（`delist_risk`）、摘帽路径（`removal_path`）、四大师评分、估值快照
  - 若不存在：作为全新 ST 研究

### 2. 深度数据采集（公告权重提升）

**中间产物目录**（所有 PDF 提取后的 Markdown 文件统一存放）：
```
Research/00-Workspace/02-Processing/pdf-texts/<公司名>/
```

#### 2.1 定位代码
用共享脚本 `stock.ts` 定位代码（`bun run .trae/scripts/stock-data/stock.ts --name <公司名>`）

#### 2.2 下载财报原文
1. 用共享脚本 `stock.ts --financial` 获取**最近 3 个完整财年年报**（上市不足 3 年则覆盖全部历史年报；缺失则说明替代方案）+ 最近 1 期中报/季报 PDF
2. 对每份 PDF 用共享脚本 `fetch-file.ts` 提取完整 Markdown 并保留表格结构（**必须传 `--name` 可读标题**，如 `--name "2025年年度报告"`，禁止用源文件名）
3. 用共享脚本 `evaluate.ts` 获取估值快照 + 10 项财报精读检查表（ST 品种路由输出 PB/PS/亏损模型，作为对照基准）

#### 2.3 公告采集（ST 一级信源，本命令重点环节）
1. 用共享脚本 `stock.ts --announcements --days 730` 拉近 2 年全部公告清单
2. **定向抓取重大公告原文 PDF**（用巨潮 hisAnnouncement 接口，同 valuation-tracker `server/lib/cninfo.ts` 的调用方式），至少覆盖：
   - 戴帽/实施风险警示公告、摘帽/撤销风险警示申请与结果公告
   - 业绩预告/快报、审计意见（含内控审计意见）相关公告
   - 重整（受理、计划、裁定、投资人）、重组（停牌、预案、审核）公告
   - 立案调查、行政处罚、交易所问询函及回复
   - 资金占用、违规担保、控制权变动、回购/增持、减持
3. 对关键公告 PDF 用 `fetch-file.ts` 提取 Markdown 到 `pdf-texts/<公司名>/`（命名如 `--name "2026-05-10摘帽申请公告"`）

> **公告数量要求**：戴帽/摘帽/重整/立案/问询五类公告**全部精读**；其余公告至少提取标题+日期+信息含量分级，纳入公告时间线。

#### 2.4 研报
用共享脚本 `stock.ts --reports` 获取最近若干份研报（覆盖多空分歧，至少 1 篇看多 + 1 篇看空/谨慎，如有）

### 3. 原文精读（调用 document-reader 子 Agent）

将第 2 步采集的所有原始材料（财报 + 重大公告原文 + 研报 + evaluate.ts 快照）交给 **📖 文档精读官 (DocumentReader)** 子 Agent 执行 ST 精读。

**触发方式**：启动子任务 `document-reader`，传递以下上下文：
- 公司名称与代码
- `Research/00-Workspace/02-Processing/pdf-texts/<公司名>/` 目录路径（含财报与公告 `.md`）
- 公告 URL/文件清单（近 2 年重大公告时间线）
- 共享脚本 `evaluate.ts` 输出的估值快照（对照基准）
- **方法论文档路径**：`Research/10-Knowledge/99-宏观/ST股价值评价方法论.md`、`Research/10-Knowledge/99-宏观/A股ST戴帽摘帽退市规则.md`（精读须引用其条款 ID）
- 已有研究笔记（如有）

> **子 Agent 启动方式（统一契约，见 AGENTS.md「子 Agent 触发契约」）**：以 `general_purpose_task` 启动，并在上下文显式传递：`taskId`、角色定义路径（`.trae/agents/document-reader.md`）、该角色的质量标准与自检要求；子 Agent 先 Read 自己的 `.trae/agents/*.md` 定义再执行。本命令步骤 3（document-reader）、4（info-alchemist）、6（knowledge-architect）、7（report-writer）全部遵循该契约。

**ST 精读目标**（deep-dive 10 大目标 + ST 专用改造，必须逐条回答）：
1. **增长飞轮（ST 版）**：主业是否还有真实增长/恢复空间？「保壳式」动作 vs 真实经营改善的区分
2. **业务模型**：怎么赚钱、谁付钱、为什么选它？持续经营能力是否存疑（审计持续经营段）
3. **财务状况**：净资产/营收/审计意见三大 *ST 财务线现状；扣非净利持续性（保壳式盈利识别）
4. **竞争格局与护城河**：主业护城河是否还在（有救）vs 仅剩壳/筹码价值（新规下趋零）
5. **管理层与治理**：诚信是命门——造假/占用/信披违规史一票否决；戴帽后整改诚意（承诺 vs 兑现）
6. **风险与逆向检查**：这家公司「怎么死」——四类退市路径（T/F/N/M）逐一推演
7. **历史类比与文明趋势**：同板块同类型 ST 的摘帽率/退市率/重整成功率统计（警惕幸存者偏差）
8. **三年年报趋势与连贯性（强制项，红线）**：最近 3 个完整财年年报，基本面是否逐年变差、口径/数字衔接是否连贯、管理层是否诚实——ST 语境下重点盯：审计意见变化、非经常性损益依赖、突击交易
9. **数据归因与逻辑一致性核查（强制项）**：归母 vs 扣非差额拆解；营收/净利/净资产变动归因（含保壳动作：卖资产/债务豁免/政府补贴/债转股）；8 项逻辑勾稽；用 Trae 搜索外部证据，凡有结论必有证据
10. **公告精读（ST 新增强制项）**：近 2 年重大公告逐一解读——戴帽原因与规则条款对应、摘帽/重整/重组进展、公告间逻辑一致性（公告承诺 vs 财报兑现）
11. **退市/摘帽规则对照（ST 新增强制项）**：逐条对照《A股ST戴帽摘帽退市规则》条款 ID，判定当前触及条款、距离退市的触发路径与时间窗口
12. **多空论证（强制项）**：基于同一套原文证据完成 Bull/Bear——多方论证戴帽原因消除、保壳真实、摘帽在望、修复空间；空方论证退市风险、保壳造假、二次戴帽、壳价值崩塌；双方均须原文引用、区分事实与观点、预判对方并回应、诚实记录脆弱点

**DocumentReader 产出**：
- `Research/00-Workspace/02-Processing/YYYY-MM-DD-<公司名>-deep-read.md`（**含第十章多空论证**：10.1 多方 Top3-5 + 10.2 空方 Top3-5 + 10.3 五维度对照 + 10.4 预判回应 + 10.5 双方脆弱点）
- 包含公告时间线（信息含量分级）、原文关键引用（Evidence Log）与待核实事项

### 4. 结构化提取与质量筛查（调用 info-alchemist + quality-screen）
基于 document-reader 的精读笔记：
- 由 info-alchemist 提取结构化数据 → processed 文件
- 生成临时草稿 → 用共享脚本 `quality-screen.ts` 生成质量筛查结论
- **回填 frontmatter（必填）**：
  - `quality_verdict`（GREEN/YELLOW/RED）+ `quality_score`（0-10 一位小数）
  - **ST 专用字段**：`st_status`（ST/*ST/摘帽/退市整理）、`st_reason`（戴帽条款简述）、`delist_risk`（高/中/低）、`removal_path`（财务/重整/重组）、`st_removal_timeline`（关键时间节点数组）、`announcement_driven: true`
  - 字段定义见 `Research/99-Templates/st-deep-dive-template.md`
- **ST 语境解读（强制写入结论）**：ST 公司 quality-screen 大概率 RED，其意义是「排雷确认」而非「否决跟踪」；是否跟踪由双轨裁决决定，需在笔记/报告中显式说明

### 5. 增量对比（若已有笔记）
在笔记中新增「本次更新 vs 上次研究的变化」段落，记录：
- 风险等级迁移（delist_risk 变化）
- 摘帽进度（申请/审核/生效节点）
- 公告新增（重大公告数量与性质）
- 财务变化（扣非/净资产/审计意见）

### 6. 写入知识库
- **若已有笔记**：追加到新段落，更新 frontmatter 的 `updated` + ST 字段
- **若新笔记**：按 `Research/99-Templates/st-deep-dive-template.md` 全新创建
- 路径：`Research/10-Knowledge/XX-行业/02-公司研究/<公司名>-公司研究.md`（ST 公司默认归入所属行业；若跨行业 ST 主题累积，再建 ST 专类目录）
- **估值模型与参数明细（强制）**：按 ST 三情景（修复/重整/退市）填写，与 frontmatter `target_market_cap_yi` / `valuation_model` 严格一致；退市情景作为安全边际底线（单只 ST 仓位上限建议 ≤5%）

### 7. 生成 ST 单公司报告
- 路径：`Research/20-Reports/YYYY-MM-DD-<公司名>-st-report.md`
- 模板：`Research/99-Templates/st-deep-dive-template.md`
- **报告撰写必须**：
  - 读取 deep-read 第十章多空论证，核心结论/退市风险评估/估值章节呈现多空双方论点及证据强度，结合规则条款/行业周期/外围因素综合裁决，多空分歧点显式标注并给出裁决理由
  - 完成双轨合并裁决（价值修复轨 + 事件博弈轨决策表）
  - 完成公告时间线章节（公告驱动核心）与事件日历
  - 明确退市风险等级与 No-Go 判定
- 报告附录必须包含：
  1. document-reader 精读笔记摘要（含多空论证摘要）
  2. **ST 专用检查清单**（模板第十节）
  3. **公告时间线**
  4. 质量筛查结论（含 ST 语境解读）
  5. 财报精读 10 项检查清单
  6. 50 项投资决策清单 AUTO 扫描结果（标注 ST 语境适用性说明）

### 8. 全局 Review（强制，终态后触发）

> 遵循 `AGENTS.md`「全局 Review 契约」，调用 `research-process-optimization` Skill 执行。本命令**必须先进入 `succeeded` / `failed` / `partial` 终态**，再触发 Review，不得在执行中间态触发。

1. **Review 输入**：`taskId`、命令名（st-dive）、参数（公司名）、输入文件清单、终态、各阶段（步骤 1-7）验收结果、错误摘要；不得读取未声明的工作区文件扩张审阅范围。
2. **Review 产出**：写入 `Research/00-Workspace/06-Process-Improvement/reviews/<taskId>.json` 及同名 `.md` 投影；候选汇总仅通过 backlog 状态脚本更新：`bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts upsert-review --review <review-json>`
3. **防递归**：Review 设置 `origin=process-improvement`，其 Review 写入、批次生成、应用和验证均不得再次触发全局 Review。
4. **失败隔离**：Review 失败只记录 `review_status=failed` 与错误摘要，不得改变本命令终态、删除本命令产物或阻塞其交付；本命令失败时 Review 仍可独立运行。
5. **边界**：常规 Review 只写 `06-Process-Improvement/`；只有用户明确批准可识别批次后，才能修改正式 Agent、Command、Skill、脚本、模板或 `AGENTS.md`。

## 输出要求
- 向用户汇报：ST 状态与退市风险等级、戴帽原因（规则条款）、摘帽/保壳路径与概率、事件日历与关键催化、双轨裁决结论、目标价区间、质量筛查结论（ST 语境）、知识节点与报告路径
- **特别说明**：必须明确告知用户"document-reader 是否完成了公告精读"，以及"从公告中发现了哪些财报无法提供的细节（如整改进度、重整方案、立案进展）"
- **多空论证说明**：必须明确告知用户"document-reader 的多空论证是否完成"，以及"多空双方各自最强的论点是什么、最终裁决如何综合规则/产业/周期/外围因素"
- **Review 说明**：必须告知用户命令终态，以及终态 Review 是否完成（含改进候选问题数量与去向）
