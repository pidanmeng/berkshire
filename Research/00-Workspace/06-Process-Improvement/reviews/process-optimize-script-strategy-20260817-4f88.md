# Review: process-optimize-script-strategy-20260817-4f88

## 1. 文档元信息与任务终态

| 字段 | 值 |
|---|---|
| taskId | `process-optimize-script-strategy-20260817-4f88` |
| attempt | 1（首次） |
| origin | `process-improvement` |
| command | `process-optimize`（用户问题：脚本总是出错，检讨一下，是不是不用脚本、直接用子 Agent 比较好？） |
| 终态 | `succeeded` |
| startedAt / endedAt | 2026-08-17T10:17:55Z / 2026-08-17T10:22:00Z |
| reviewStatus | `succeeded` |
| 审阅对象 | `Research/00-Workspace/06-Process-Improvement/improvement-backlog.json`（运行证据状态真源，35 个 items / 3 个 batches） |

本次为 **review 式二次复盘**：不产生新任务运行、不修改任何正式资产，仅基于 backlog 既有运行证据回答「脚本可靠性 vs 弃用脚本改用子 Agent」这一策略问题。

## 2. 执行摘要

对 backlog 全部 35 个 items 做分类统计：**脚本类问题码 23 个（复现 43 次）**，其中 **10 个（43.5% 问题码、62.8% 复现次数）已进入 verified（修复已验证）**，3 个为 candidate，10 个为 observing。脚本故障根因高度集中：正则/解析脆弱类占 20 次复现（46.5%）、底层 API 数据口径异常类占 11 次（25.6%），二者合计超七成，且**全部属于「可定位、可修复的确定性缺陷」而非系统性失败**——已修复项均有 acceptance 用例与回归记录，3 个修复批次（20260816-batch-001/002/003）全部 verified。

策略结论：**保留脚本并修复已知缺陷（混合策略）**。弃用脚本将使本系统失去可复现门禁、0-token 批量筛查与 KQI 追踪能力，而子 Agent 无法替代脚本的确定性层职责；真正需要语义理解的环节（一次性损益识别、研报看空观点挖掘、异常表格裁决）本系统已由 document-reader/编排器承担，属于「脚本检测+子 Agent 裁决」的既有混合模式。本次未生成新 issue（证据全部来自既有 backlog，统计揭示的改进方向均已落在既有 item 的 goal 中）。

## 3. 任务目标、范围与成功标准

**目标**：
1. 从 backlog 运行证据（非直觉）完成脚本类故障根因分类与状态统计；
2. 对「弃用脚本 → 直接用子 Agent」给出证据化结论（分级证据、利弊、适用边界）；
3. 达到候选门槛的新问题写入 backlog，未达门槛写为 observing。

**成功标准**：
- 分类统计覆盖全部 targetKind=script 或与脚本运行直接相关的 items，标注根因/状态/复现数；
- 策略结论有分级证据支撑，无证据不做断言；
- 不重复造 backlog 已有同指纹问题（evaluate-yoy-metric-misparse、checklist-auto-threshold-text-misread 等）；
- 通过 `improvement-backlog.ts upsert-review` 原子更新 backlog。

**范围**：仅审阅 `improvement-backlog.json` 一个输入；不读取其他工作区文件扩张范围。

## 4. 本次任务全部产物清单

| 路径 | 类型 | 状态 |
|---|---|---|
| `Research/00-Workspace/06-Process-Improvement/reviews/process-optimize-script-strategy-20260817-4f88.json` | Review JSON | 已创建 |
| `Research/00-Workspace/06-Process-Improvement/reviews/process-optimize-script-strategy-20260817-4f88.md` | Review Markdown | 已创建 |
| `Research/00-Workspace/06-Process-Improvement/improvement-backlog.json` | backlog（upsert 后 updatedAt 更新） | 脚本原子更新 |

## 5. 用户/系统影响

用户对脚本可靠性的不信任主要来自 2026-08-16/17 两日集中暴露的质量筛查（quality-screen report 模式）、投资清单 AUTO 扫描（investment-checklist-auto）与估值快照（evaluate）的误报/失真，每次深调均需人工逐项核验澄清。影响面：Phase 4 入库门禁、报告附录、估值数据链。但**这些故障均为「已识别、可修复、多数已修复验证」的确定性问题**，且系统已形成「脚本异常 → 人工/子 Agent 以年报原文核验 → 修正/记录」的兜底闭环（每次 deep-dive 均有 document-reader 以年报原文修正 API 同比的记录）。

## 6. 问题与证据：脚本故障分类统计

### 6.1 分类统计表（23 个脚本类 problemCode，43 次任务复现）

| 根因类别 | problemCode | 状态 | 复现 taskId 数 |
|---|---|---|---|
| 正则/解析脆弱（8 码 / 20 次） | qs-report-regex-range-misparse | verified | 6 |
| | checklist-auto-year-ambiguity | verified | 6 |
| | checklist-auto-false-positives | verified | 2 |
| | checklist-auto-threshold-text-misread | candidate | 2 |
| | quality-screen-annual-value-regex | observing | 1 |
| | checklist-auto-negative-value-regex | observing | 1 |
| | checklist-auto-negation-context | observing | 1 |
| | checklist-auto-pdf-file-absent-false-positive | observing | 1 |
| 底层 API 数据口径异常（7 码 / 11 次） | evaluate-yoy-data-anomaly | verified | 3 |
| | stock-category-filter-ineffective | verified | 2 |
| | evaluate-yoy-metric-misparse | candidate | 2 |
| | api-yoy-calculation-error | observing | 1 |
| | evaluate-ttm-yoy-anomaly | observing | 1 |
| | stock-category-filter-noop | observing | 1 |
| | quality-screen-interest-coverage-missing | observing | 1 |
| CLI 契约/文档缺失（1 码 / 2 次） | quality-screen-auto-unit-doc-missing | verified | 2 |
| 设计取舍（5 码 / 7 次） | fetch-file-ocr-fails-annual-report | verified | 2 |
| | fetch-file-ocr-first-pass-fail | candidate | 2 |
| | evaluate-oneshot-income-distortion | verified | 1 |
| | quality-screen-oneshot-greening | verified | 1 |
| | fetch-file-ocr-ratio-limit-too-strict | observing | 1 |
| 上游库/外部服务（2 码 / 3 次） | web-fetch-jina-anti-bot | verified | 2 |
| | pdf-inspector-parse-table-anomaly | observing | 1 |

### 6.2 状态汇总

| 状态 | 问题码数 | 占比（问题码） | 复现次数 | 占比（复现） |
|---|---|---|---|---|
| verified（修复已验证） | 10 | 43.5% | 27 | 62.8% |
| candidate（达门槛待批） | 3 | 13.0% | 6 | 14.0% |
| observing（未达门槛） | 10 | 43.5% | 10 | 23.3% |

### 6.3 根因解读

- **正则/解析脆弱（46.5% 复现）**：根因同构——从自由文本 Markdown 表格提取数值时「取首个匹配、未约束最新财年、未排除阈值/否定语境/负号丢失」。已 verified 的 4 个码证明该问题**可修复**（均有 acceptance 用例，如「对风华高科笔记输出 ROE=2.29%（2025FY）与 auto 模式一致」）；剩余 4 个 observing/candidate 属同根因未修变体，修复路径已在各自 goal 中明确（最新财年取值公共逻辑、否定词表、上下文消歧、结构化 frontmatter 优先）。
- **底层 API 口径异常（25.6% 复现）**：根因在数据源（hithink 同比字段放大百倍、巨潮 category 过滤失效）。**换成子 Agent 不能修复**——子 Agent 调同一 API 同样拿到异常值；脚本的价值在于批量、0-token 检测异常并显式标注存疑（evaluate-yoy-data-anomaly 已验证该修复：自带存疑警告并阻止 Forward PE 递推）。
- **设计取舍（16.3% 复现）**：OCR 硬失败/阈值过严、无一次性损益通道。已修复 2 项（--allow-ocr-pages、--nonrecurring-net-profit 通道），其余为参数化问题。
- **上游库/外部服务（7.0% 复现）**：pdf-inspector 表格解析、r.jina.ai 反爬——脚本无法根修，但可检测+降权+切换路径（web-fetch-jina-anti-bot 已验证：统一走 fetch-source.ts）。
- **CLI 契约/文档缺失（4.7% 复现）**：auto 模式单位约定——纯文档/帮助文本问题。

## 7. 优化需求清单：策略评估结论

### 7.1 问题：「弃用脚本 → 直接用子 Agent」？

**证据化结论：不应弃用脚本，推荐「保留脚本 + 修复已知缺陷」的混合策略（证据等级 B）**。

**证据链（全部来自 backlog）**：
1. **已 verified 修复占 62.8% 复现**（27/43），且 3 个修复批次（覆盖 14 个指纹）全部 verified——证明脚本故障是「可定位、可修复、可回归」的工程缺陷，不是系统性失败。
2. **剩余 candidate/observing 的归类**：
   - 可脚本修复的缺陷（11 码 / 16 次）：正则类 6 码 + OCR 阈值类 1 码 + 字段缺失 1 码——修复路径明确且已存在 goal；
   - 脚本本质不适合的（需语义理解，本就由子 Agent 承担）：一次性损益/BD 收入识别（evaluate-oneshot-income-distortion / quality-screen-oneshot-greening 的修复方式即为「脚本警告 + 人工通道」）、研报看空观点挖掘（research-report-lack-bear-coverage）、异常表格裁决（pdf-inspector-parse-table-anomaly）。**这些环节脚本只做检测与提示，最终判断已在 deep-dive 流程中由 document-reader/编排器完成**——即本系统当前已是混合模式。
3. **弃用脚本的代价（证据化）**：
   - 可复现性与门禁一致性：quality-screen RED/YELLOW、investment-checklist AUTO 是 Phase 4 入库门禁与报告附录，脚本保证「同一输入 → 同一结论」且可回归；子 Agent 判断不可复现、易漂移（AGENTS.md 门禁体系依赖脚本化评分）。
   - 0-token 批量能力：screen.ts 全市场初筛、stock.ts 批量公告/研报拉取、fetch-file.ts PDF 转换均为 IO/确定性任务，用子 Agent 执行将消耗不可承受的 token 且不保证一致性。
   - KQI 与自检体系依赖脚本：quality-scorecard、kqi-tracker、investment-checklist-auto、各 Agent self-check.ts。
   - API 口径类问题换成子 Agent 无改善（同一数据源），反而丢失批量异常检测能力。
4. **子 Agent 判断的代价**：每次人工 token 成本、不可复现、易漂移——仅在语义理解环节（精读、多空论证、异常裁决）是必要投入，不应扩大到确定性环节。

**推荐**：
- **保留全部脚本**，按既有 backlog goal 修复已知缺陷（优先正则类统一「最新财年取值」公共逻辑 + evaluate 同比合理性校验/存疑标注 + OCR 阈值参数化 + auto 模式单位文档）；
- **强化混合模式的交界契约**：脚本输出异常（|同比|>500%、正则命中阈值文本等）时显式标注「存疑，以年报为准」，由 document-reader 核验并回流修正（已修复项已含此机制，剩余项沿同一模式扩展）；
- **维护现有「脚本异常 → 人工核验 → 记录 backlog」闭环**：每次 deep-dive 的核验结果已自动进入 backlog（本次统计即来自该闭环积累），这是弃用脚本后无法替代的证据积累机制。

**适用边界**：
- 脚本适用于：确定性计算/IO/批量筛选/门禁评分/数值检测；
- 子 Agent 适用于：语义理解、上下文消歧裁决、信源甄别、多空论证；
- 禁止将「需要判断力」的任务硬塞给脚本（如一次性损益定性），也禁止将「确定性可复现」的任务外包给子 Agent（如全市场初筛）。

### 7.2 新问题判断

**本次不生成新 issue**：本 review 为二次复盘，全部证据来自既有 backlog（无新任务运行、无新证据）；统计揭示的改进方向（统一最新财年取值逻辑、结构化 frontmatter 优先、同比合理性校验、OCR 阈值参数化、单位契约文档）均已显式落在既有 items 的 goal 中（如 `checklist-auto-year-ambiguity`、`quality-screen-annual-value-regex`、`evaluate-yoy-data-anomaly`、`fetch-file-ocr-first-pass-fail`、`quality-screen-auto-unit-doc-missing`），按指纹合并约定不重复造码。策略评估结论不构成 issue，不改动任何既有 item 状态。

## 8. 非目标与明确排除项

- 不运行 build-batch / record-decision / mark-applied / record-verification（属编排器步骤）；
- 不修改任何 Agent / Command / Skill / 脚本 / 模板 / AGENTS.md / 知识库正式资产；
- 不新建 problemCode（无新证据）；
- 不因「推荐保留脚本」结论将 observing/candidate 项标记为 verified 或改变状态。

## 9. 验收标准

- [x] 分类统计覆盖全部 23 个脚本类 problemCode，按 5 类根因归类并标注状态与复现数；
- [x] 策略结论给出分级证据（B 级：基于 43 次复现统计 + 3 个 verified 批次 + acceptance 用例），无证据部分显式标注为判断/边界；
- [x] 无新 issue，未重复造码；
- [x] backlog 经 `improvement-backlog.ts upsert-review` 原子更新（updatedAt 刷新、issues 为空无状态变更）；
- [x] 未修改任何正式资产。

## 10. 风险、兼容性与回滚考虑

- **风险**：若决策层误读「保留脚本」为「不修复」，脚本误报将持续消耗人工核验成本——因此本 review 同时列出修复优先级（正则类 > API 校验 > OCR > 契约文档），供后续批次排期；
- **兼容性**：本结论与 AGENTS.md 现有「脚本与子 Agent 各司其职」的架构一致，无结构变更；
- **回滚**：本次仅写 06-Process-Improvement 目录，无需回滚；upsert 以临时文件 + 原子替换方式更新 backlog（脚本保障），如异常可从未变更的备份恢复。

## 11. 优先级与推荐状态

| 事项 | 优先级 | 推荐状态 | 依据 |
|---|---|---|---|
| 保留脚本 + 按既有 goal 修复已知缺陷 | 高 | 已有 candidate 项待编排器 build-batch；observing 项继续观察复现 | 62.8% 复现已 verified；剩余均属可修复缺陷 |
| 正则类「最新财年取值」公共逻辑统一 | 高 | 已在 checklist-auto-year-ambiguity / quality-screen-annual-value-regex 的 goal 中 | 46.5% 复现集中在正则类 |
| evaluate 同比合理性校验/存疑标注 | 高 | 已在 evaluate-yoy-data-anomaly / evaluate-yoy-metric-misparse 的 goal 中（后者为 candidate） | 25.6% 复现为 API 口径 |
| OCR 阈值参数化/默认降级 | 中 | fetch-file-ocr-first-pass-fail（candidate） | 3 个 OCR 相关码 |
| 混合模式交界契约（脚本存疑标注 + 子 Agent 核验回流） | 中 | 已在各 goal 中分散体现，无需新码 | 既有闭环有效 |
| 本 review 本身 | — | succeeded，不触发一般 Review（origin=process-improvement） | 防递归约定 |
