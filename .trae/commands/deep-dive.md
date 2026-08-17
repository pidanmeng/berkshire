---
description: 对单一公司进行深度调研，支持追加到已有研究。用法：/deep-dive [公司名]
---

用户发起了单公司深度调研，目标公司为：**$ARGUMENTS**

> **Deep Dive 原则**：既然是深度调研，就不能只做数据采集。必须带着**明确的问题清单**去阅读每一份财报、研报和公告原文，从原文中寻找证据、验证假设、发现矛盾。禁止仅看标题和结构化数据就下结论。

## 流程（串行执行）

> **taskId**：命令启动时生成 `deep-dive-<公司名>-YYYYMMDD-<4位随机>`，贯穿本命令的输入、产物、日志与终态 Review；重试沿用原 taskId 并增加 attempt，不得用主题名或时间戳替代。

### 1. 检查已有研究
- 搜索 `Research/10-Knowledge/**/02-公司研究/<公司名>-*.md`
  - 若存在：读取现有笔记，提取已有数据、结论、四大师评分、估值快照
  - 若不存在：作为全新公司研究

### 2. 深度数据采集

**中间产物目录**（所有 PDF 提取后的 Markdown 文件统一存放）：
```
Research/00-Workspace/02-Processing/pdf-texts/<公司名>/
```

#### 2.1 定位代码
用共享脚本 `stock.ts` 定位代码

#### 2.2 下载财报原文
1. 用共享脚本 `stock.ts` 获取**最近 3 个完整财年年报**（建议 `--days 1100` 覆盖近 3 个财年；上市不足 3 年则覆盖全部历史年报；缺失则说明替代方案）+ 最近 1 期中报/季报（如有）PDF 链接
2. 对每份 PDF 用共享脚本 `fetch-file.ts` 提取完整 Markdown 并保留表格结构（远程 PDF 成功转换后清理）。**命名规范（强制）**：下载时必须按 stock.ts 返回的标题传 `--name`（如 `--name "2025年年度报告"`、`--name "2026年半年度报告"`），将 Markdown 以可读标题落盘到 `pdf-texts/<公司名>/`，禁止使用源文件名（如 `1225002214.md`）
3. 用共享脚本 `stock.ts` 获取业绩预告/快报等公告
4. 用共享脚本 `stock.ts` 获取最近若干份研报（覆盖多空分歧，至少 1 篇看多 + 1 篇看空/谨慎，如有；下载或提取关键段落）
5. 用共享脚本 `evaluate.ts` 获取估值快照 + 10项财报精读检查表

### 3. 原文精读（调用 document-reader 子 Agent）

将第 2 步采集的所有原始材料交给 **📖 文档精读官 (DocumentReader)** 子 Agent 执行 Phase 1.5 原文精读。

**触发方式**：启动子任务 `document-reader`，传递以下上下文：
- 公司名称与代码
- `Research/00-Workspace/02-Processing/pdf-texts/<公司名>/` 目录路径（含已提取的财报 `.md` 及其 frontmatter）
- 公告与研报的 URL/文件路径
- 共享脚本 `evaluate.ts` 输出的估值快照（作为对照基准）
- 已有研究笔记（如有）

> **子 Agent 启动方式（统一契约，见 AGENTS.md「子 Agent 触发契约」）**：当前执行环境的 Task 工具 `subagent_type` 仅接受 `search`/`general_purpose_task`，`document-reader`/`info-alchemist`/`knowledge-architect`/`report-writer` 等专用类型无法直启。**以 `general_purpose_task` 启动**，并在上下文显式传递：`taskId`、角色定义路径（如 `.trae/agents/document-reader.md`）、该角色的质量标准与自检要求；子 Agent 先 Read 自己的 `.trae/agents/*.md` 定义再执行。本命令步骤 3（document-reader）、4（info-alchemist）、6（knowledge-architect）、7（report-writer）全部遵循该契约。

**DocumentReader 的精读目标**（9大问题，必须逐条回答）：
1. **增长飞轮**：核心增长驱动力是什么？是否具有复利效应？
2. **业务模型**：怎么赚钱、谁付钱、为什么选它？现金流特征？
3. **财务状况**：盈利能力、资产质量、负债与现金流、股东回报
4. **竞争格局与护城河**：行业集中度、护城河类型与宽度验证
5. **管理层与治理**：审计意见、MD&A坦诚度、关联交易、资本配置历史
6. **风险与逆向检查**：这家公司可能怎么死？财务红旗信号？
7. **历史类比与文明趋势**：结构性机会还是周期性繁荣？
8. **三年年报趋势与连贯性（强制项，红线）**：精读最近 3 个完整财年年报，判断基本面是否逐年变好、三年年报是否连贯（口径/会计政策/数字衔接）、管理层是否诚实——**三年连贯性断裂或管理层不诚实 → No-Go 红线，显式标注**（详见 document-reader 提示词第 9 章输出结构）
9. **数据归因与逻辑一致性核查（强制项）**：归母 vs 扣非净利润差距拆解归因（非经常性损益明细逐项 + 持续性判断）；毛利率/净利率/ROE 等大幅波动（≥2pp 或方向逆转）时按量价/成本/结构/竞争/周期四步归因并判定良性/恶性——**必须用 Trae 搜索工具找外部证据（原材料价格/价格战新闻/同行毛利率/调研纪要），凡有结论必有证据，证据不足标注置信度 ≤6**；8 项数据逻辑勾稽，挖「不合逻辑」处并追因（详见 document-reader 提示词第 9 大精读目标）
10. **多空论证（强制项）**：基于同一套原文证据完成 Bull Case / Bear Case 双视角论证——多方挖掘增长飞轮/护城河拓宽/财务质量/估值安全边际，空方挖掘增长见顶/护城河侵蚀/财务红旗/估值过高/产能过剩与地缘风险；双方均须原文引用、区分事实与观点、强度/置信度分级、**预判对方论点并回应**、诚实记录本方脆弱点（详见 document-reader 提示词「多空论证」框架与第十章输出结构）

**DocumentReader 产出**：
- `Research/00-Workspace/02-Processing/YYYY-MM-DD-<公司名>-deep-read.md`（**含第十章多空论证**：10.1 多方 Top3-5 + 10.2 空方 Top3-5 + 10.3 五维度对照 + 10.4 对对方论点预判回应 + 10.5 双方脆弱点）
- 包含原文关键引用（Evidence Log）和待核实事项

### 4. 结构化提取与质量筛查（调用 info-alchemist + quality-screen）
基于 document-reader 的精读笔记（含多空论证章节）：
- 由 info-alchemist 提取结构化数据 → processed 文件
- 生成临时草稿 → 用共享脚本 `quality-screen.ts` 生成质量筛查结论

### 5. 增量对比（若已有笔记）
在笔记中新增「本次更新 vs 上次研究的变化」段落，记录：
- 估值变化（PE/PB 变动、股价变动）
- 业绩变化（营收/净利增速变化、毛利率变化）
- 护城河变化（竞争格局、市占率、技术迭代）
- 管理层变化（重大人事、承诺兑现、减持/回购）

### 6. 写入知识库
- **若已有笔记**：追加到新段落，更新 frontmatter 的 `updated` 字段，追加 `deep_dive_at: YYYY-MM-DD`
- **若新笔记**：按 `company-template.md` 或 `company-deep-dive-template.md` 全新创建
- 路径：`Research/10-Knowledge/XX-行业/02-公司研究/<公司名>-公司研究.md`

### 7. 生成单公司简版报告
- 路径：`Research/20-Reports/YYYY-MM-DD-<公司名>-deep-dive-report.md`
- 模板：`company-deep-dive-template.md`
- 特点：不含行业全景，聚焦单一公司；包含目标买入/卖出价区间
- **报告撰写必须读取 deep-read 多空论证并综合外围因素**：
  - 读取 `Research/00-Workspace/02-Processing/YYYY-MM-DD-<公司名>-deep-read.md`（**第十章多空论证**：多方/空方 Top 论点、五维度对照、预判回应与脆弱点）
  - 报告「核心结论」「护城河评估」「风险提示」章节必须呈现多空双方的核心论点及其证据强度，不得只呈现单边观点
  - 报告必须完成**增长驱动与核心优势可持续性分析**（见 report-writer 定义）：判断企业是否处于高增长阶段、当前增长促成原因、未来增长因素的内因/外因与企业主导性；识别企业相对同行的核心优势维度与量化差距、优势成因、维持/被侵蚀风险与独特壁垒
  - 在判断时必须结合**产业理解、行业周期、国际形势、政策形势**等外围因素做综合裁决（哪些多方论点在周期/政策下成立、哪些空方论点被外围因素放大或证伪）
  - 多空分歧点必须在报告中显式标注，并给出裁决理由
- 报告附录必须包含：
  1. document-reader 精读笔记摘要（含多空论证摘要）
  2. 多空论证摘要（Bull Case vs Bear Case 核心论点对照表，摘自 deep-read 第十章）
  3. 质量筛查结论
  4. 财报精读 10 项检查清单
  5. 50 项投资决策清单 AUTO 扫描结果

### 8. 全局 Review（强制，终态后触发）

> 遵循 `AGENTS.md`「全局 Review 契约」，调用 `research-process-optimization` Skill 执行。本命令**必须先进入 `succeeded` / `failed` / `partial` 终态**，再触发 Review，不得在执行中间态触发。

1. **Review 输入**：`taskId`、命令名（deep-dive）、参数（公司名）、输入文件清单、终态、各阶段（步骤 1-7）验收结果、错误摘要；不得读取未声明的工作区文件扩张审阅范围。
2. **Review 产出**：
   - 写入 `Research/00-Workspace/06-Process-Improvement/reviews/<taskId>.json`（问题按 A/B/C/D 证据分级，`critical`/`high` 有单次 A/B 级证据即可成为 candidate，`medium`/`low` 需跨任务复现）及同名 `.md` 投影
   - 候选汇总仅通过 backlog 状态脚本更新：`bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts upsert-review --review <review-json>`
3. **防递归**：Review 设置 `origin=process-improvement`，其 Review 写入、批次生成、应用和验证均不得再次触发全局 Review。
4. **失败隔离**：Review 失败只记录 `review_status=failed` 与错误摘要，不得改变本命令终态、删除本命令产物或阻塞其交付；本命令失败时 Review 仍可独立运行。
5. **边界**：常规 Review 只写 `06-Process-Improvement/`；只有用户明确批准可识别批次后，才能修改正式 Agent、Command、Skill、脚本、模板或 `AGENTS.md`。

## 输出要求
- 向用户汇报：知识节点路径、报告路径、四大师评分、质量筛查结论、目标价区间、关键变化（如有）
- **特别说明**：必须明确告知用户"document-reader 是否完成了原文精读"，以及"从原文中发现了哪些结构化数据无法提供的细节"。
- **多空论证说明**：必须明确告知用户"document-reader 的多空论证是否完成"，以及"多空双方各自最强的论点是什么、最终裁决如何综合产业/周期/国际/政策等外围因素"。
- **Review 说明**：必须告知用户命令终态，以及终态 Review 是否完成（含改进候选问题数量与去向）。
