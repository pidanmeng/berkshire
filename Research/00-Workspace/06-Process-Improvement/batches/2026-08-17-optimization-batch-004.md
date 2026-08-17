# 优化批次 2026-08-17-optimization-batch-004

> 批次 ID：`20260817-batch-004` · 状态：`proposed` · 生成时间：2026-08-17
> 状态真源：`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json` · 本文件为可读投影
> 来源：`/process-optimize`（origin=process-improvement，不触发全局 Review）
> 前置复盘：`reviews/process-optimize-script-strategy-20260817-4f88.md`（脚本故障分类统计 + 策略结论：保留脚本 + 修复已知缺陷）

## 一、候选清单与证据

| 序 | 问题码 | 指纹 | 严重度 | 置信度 | 任务数 | 目标文件 | 摘要 |
|---|---|---|---|---|---|---|---|
| 1 | `evaluate-yoy-metric-misparse` | `5b8a3a505d2500160b39` | high | 0.95 | 2 | `.trae/scripts/evaluation/evaluate.ts` | 同比字段放大百倍（营收 7977.33% vs 年报 +79.77%），自带存疑警告但字段仍污染下游估值/杜邦/同业行 |
| 2 | `checklist-auto-threshold-text-misread` | `9409fe756152cb093273` | medium | 0.85 | 2 | `.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts` | #28 有息负债 CRITICAL 误报（关键词命中即判债务风险，未结合现金余额与 OCF 比值阈值） |
| 3 | `deep-dive-bear-report-coverage-gap` | `c796ae8932bb2616726d` | medium | 0.65 | 2 | `deep-dive 流程·步骤 2.4（研报采集）` | 研报全部看多/增持无看空，空方缺研报级外部佐证，依赖 document-reader 自建 + WebSearch |
| 4 | `fetch-file-ocr-first-pass-fail` | `62b6bdd0d3b7e25ab4a3` | low | 0.65 | 2 | `.trae/scripts/file-ingestion/fetch-file.ts` | 年报类 PDF 首传必因 1 页 OCR 失败（exit 4），需加 `--allow-ocr-pages` 重跑，failed/ 残留 |
| 5 | `deep-read-raw-source-dangling-link` | `72ffcb7c933d9625a3c2` | low | 0.6 | 2 | `AGENTS.md` | deep-dive 模式无 raw 文件，deep-read frontmatter 仍填 `[[...-raw]]` 悬空双链 |

证据等级：全部 5 项均为 2 个 taskId 复现且至少含 C 级证据；候选 1/2 含 A 级证据（2026-08-17 中石科技/胜宏科技运行日志）。按严重度 + 置信度降序排列。

**范围注意（候选 3 目标路径特殊性）**：
- 候选 3 的 `targetPath` 是**流程步骤描述**（`deep-dive 流程·步骤 2.4（研报采集）`），不是文件系统路径。系统性修复的实际落点应为 `.trae/commands/deep-dive.md`（补充看空采集兜底步骤）与/或 `.trae/scripts/stock-data/stock.ts`（中性/谨慎评级定向筛选、跨券商源扩展），均不在本批 `allowedPaths` 内。本批对候选 3 的处理范围需在应用阶段明确实际落点文件并纳入 diff 校验；若无法识别落点，应按部分批准排除或在应用前修正 targetPath（通过脚本）。建议审批时审慎考虑候选 3。

## 二、逐文件修改

### 候选 1 → `evaluate.ts`（同比字段合理性校验 + 下游拦截）

- **主修复**：对同比类字段（营收同比/净利同比）增加合理性校验——`|同比| > 500%` 时输出显式警告「接口同比存疑，请以 2025 年报『主要会计数据和财务指标』核对」；Forward PE/PEG 计算**禁用异常同比递推**（命中异常时跳过递推并标注）。
- **下游拦截**：估值/杜邦/同业对比行消费同比时，若字段命中异常标记则不参与计算、显示「存疑」而非数值。
- **回归样例**：`evaluate.ts --code 300476 --peer 002463` 输出营收同比 +79.77%、净利同比 +273.52%（或显式存疑标注）；`--code 300684` 输出 +17.14%/+68.12%。
- **不改动**：三表/估值快照其他段落、四大师星级、10 项精读检查表结构。

### 候选 2 → `investment-checklist-auto.ts`（#28 有息负债上下文消歧）

- **#28 有息负债/OCF 流动性红线**：由「关键词（短期借款/有息负债）出现即警示」改为「结合有息负债金额、现金余额与经营现金流 OCF 计算比值，按阈值（有息负债/OCF < 5 且现金充足）判定是否触发红线」；仅当关键数值字段在报告/笔记中可解析时判定，无法解析则标注「数据不足，需人工核验」而非直接警示。
- **回归样例**：胜宏科技（有息负债 64.45 亿/OCF 46.03 亿 = 1.40，H 股募资后现金充足）扫描 #28 不再误报；中石科技（有息负债 660 万）不再误报。真实高负债低现金公司仍能正确警示。
- **不改动**：其余 49 项判定规则、退出码逻辑、报告输出结构。

### 候选 3 → `deep-dive` 看空采集兜底（范围受限，见上）

- **目标落点（待应用阶段确认）**：`.trae/commands/deep-dive.md` 步骤 2.4 补充「若研报无看空/谨慎覆盖，显式走 WebSearch 采集空方/谨慎观点并记录来源时点」；`stock.ts --reports` 可选增加中性/谨慎评级定向筛选说明。
- **本批范围**：候选 3 的 `targetPath` 非文件系统路径，`allowedPaths` 不含 deep-dive.md / stock.ts。应用阶段须先明确实际落点并更新批次 allowedPaths 后方可修改；否则按越界处理。
- **不改动**：若无法识别落点，候选 3 不实施。

### 候选 4 → `fetch-file.ts`（OCR 默认降级策略）

- **主修复**：对 OCR 页占比 ≤5% 且正文可提取的 PDF（年报封面/目录/声明等常规扫描页）**默认降级产出**（保留 `pages_needing_ocr` frontmatter + parse_confidence 降权 + 文档内占位符标记），不再硬失败（exit 4）；占比 >5% 时维持硬失败以暴露真实异常。
- **清理**：降级路径成功产出后自动清理源 PDF（与现有远程转换清理逻辑一致），避免 failed/ 目录残留。
- **回归样例**：吉比特 2023/2024/2025 年报 + 2026H1 中报单次调用即产出 Markdown；胜宏科技 2024 年报单次调用成功。
- **不改动**：`--allow-ocr-pages` 显式开关语义（仍可强制覆盖）；占比 >5% 的严格失败策略。

### 候选 5 → `AGENTS.md`（deep-dive 模式 raw_source 双链约定）

- **deep-dive 命令适配说明**：在 AGENTS.md 文件命名规范/双层结构说明处补充「deep-dive 模式（无 Phase 1 raw 文件）时，deep-read 与 processed 的 `raw_source` 允许置空或默认链接 `pdf_texts/` 目录，禁止指向不存在的 `[[YYYY-MM-DD-公司名-raw]]`」。
- **回归样例**：胜宏科技/吉比特 deep-read frontmatter 无指向不存在 raw 文件的断链。
- **不改动**：标准 /research 流程的 raw 文件约定。

## 三、依赖顺序

1. **候选 1（evaluate）与候选 2（checklist-auto）**——独立脚本文件，可并行实施；
2. **候选 4（fetch-file）**——独立脚本文件，可与 1/2 并行；
3. **候选 5（AGENTS.md 文档）**——文档层改动，独立；
4. **候选 3（deep-dive 看空兜底）**——依赖落点识别，且 `stock.ts` 若改动需与 evaluate 回归错开（共用 hithink 数据层但不共用文件）。

建议实施顺序：1 → 2 → 4 → 5 → 3（候选 3 最后，待落点确认）。

## 四、兼容性

- 候选 1：仅对 |同比|>500% 的异常值增加警告/拦截，正常同比展示不变；回归 3 个既有样例。
- 候选 2：#28 判定由关键词改为阈值比值，正常高负债公司警示行为不变；需测试覆盖真实警示场景。
- 候选 4：OCR 占比 ≤5% 自动降级，>5% 行为不变；`--allow-ocr-pages` 语义不变。
- 候选 5：纯文档约定变更，无代码行为变化。
- 候选 3：若落点识别为 deep-dive.md / stock.ts，为命令/脚本文档级增强；需确认不破坏既有研报采集步骤。
- 5 个目标文件互不 import（候选 3 落点确认后复核）；类型检查与全量测试互不影响。

## 五、专项测试

| 候选 | 测试文件 | 新增用例 |
|---|---|---|
| 1 | `.trae/scripts/evaluation/__tests__/evaluate.test.ts`（扩展） | ①同比 7977.33%/27351.63% 命中异常 → 输出存疑警告且 Forward PE 不递推 ②正常同比 +79.77% 展示不变 ③PEG 计算不消费异常同比 |
| 2 | `.trae/skills/research-quality-gate/scripts/__tests__/investment-checklist-auto.test.ts`（扩展） | ①胜宏科技样例（负债 64.45 亿/OCF 46.03 亿）→ #28 通过 ②真实高负债低现金样例 → #28 仍警示 ③数值不可解析 → 标注需人工核验 |
| 4 | `.trae/scripts/file-ingestion/__tests__/fetch-file.test.ts`（扩展） | ①OCR 页占比 ≤5% → 默认降级产出 + frontmatter 记录 ②占比 >5% → 仍失败 ③`--allow-ocr-pages` 显式开关行为不变 |
| 5 | — | 文档核对：AGENTS.md 含 deep-dive 模式 raw_source 取值规则（grep + 人工校验） |
| 3 | — | 落点确认后：deep-dive.md 含看空采集兜底步骤（grep + 人工校验）；若未确认落点则不实施 |

## 六、全量测试 / 类型检查 / 路径检查

- 全量测试：`bun test`（项目根）。
- 类型检查：`bunx tsc --noEmit`。
- 路径检查：检索 `AGENTS.md`、`.trae/commands/`、`.trae/agents/`、`.trae/skills/` 中对 5 个目标文件（evaluate.ts / investment-checklist-auto.ts / deep-dive.md / stock.ts / fetch-file.ts / AGENTS.md）的引用——确认改动仅为增强/文档化，不影响既有命令、Agent、Skill 与共享脚本引用；确认 evaluate.ts 改动与 backfill.ts、screen.ts、composite.ts 等下游消费者兼容（同比字段消费点需逐一核对）。

## 七、验收回归

| 场景 | 期望 |
|---|---|
| `evaluate.ts --code 300476 --peer 002463` | 营收同比 +79.77%、净利同比 +273.52%（或显式存疑标注），不再输出百倍异常值 |
| `investment-checklist-auto.ts` 扫描胜宏科技报告+笔记 | #28 不再误报；真实高负债低现金公司仍能警示 |
| `fetch-file.ts` 下载 OCR 占比 ≤5% 的年报 | 单次调用产出 Markdown，frontmatter 记录 pages_needing_ocr，无 failed/ 残留 |
| deep-dive 模式公司笔记 | raw_source 无指向不存在 raw 文件的断链 |
| deep-dive 研报采集（候选 3，落点确认后） | 无看空研报时显式走 WebSearch 兜底并记录来源时点 |

## 八、回滚

- 修改前对目标文件保存快照（`batch-runs/20260817-batch-004/snapshots/`），记录修改前 git 差异基线。
- 应用后校验实际 diff 文件集合 ⊆ `allowedPaths`（含候选 3 落点确认后的实际文件 + 各自测试文件）；越界立即回滚至快照。
- 任一强制验证失败：恢复快照 → 记录 `apply_failed` → 生成失败 verification，不改动 backlog 中其他项。

## 九、排除项

| 问题码 | 状态 | 排除原因 |
|---|---|---|
| `quality-screen-annual-value-regex`、`checklist-auto-negative-value-regex`、`checklist-auto-negation-context`、`checklist-auto-pdf-file-absent-false-positive` | observing | 与候选 2 同根因同文件（正则/上下文消歧），修复设计自然覆盖，单 taskId 未达门槛，不入本批单独列项 |
| `evaluate-ttm-yoy-anomaly`、`api-yoy-calculation-error` | observing | 与候选 1 同根因同文件，单 taskId 未达门槛；候选 1 修复后需回归验证是否覆盖 |
| `fetch-file-ocr-ratio-limit-too-strict` | observing | 与候选 4 同文件（OCR 阈值），候选 4 默认降级策略覆盖 ≤5% 场景；>5% 阈值参数化留后续 |
| `stock-category-filter-noop`、`quality-screen-interest-coverage-missing`、`pdf-inspector-parse-table-anomaly` | observing | 单 taskId / 证据等级不足，不入本批 |
| `task-subagent-type-unavailable`、`subagent-type-mapping-for-research-agents`、`deep-dive-validated-link-broken`、`checklist-auto-false-positives` 等 | verified | 已由批次 001/002/003 修复并验证 |
| 候选 3 的 stock.ts 跨券商源扩展 | — | 超出本批落点范围，需另立候选 |

## 十、审批

批次等待审批：**全部批准** / **部分批准** / **全部拒绝**（经 AskUserQuestion 收集）。审批决定落地走 backlog 脚本 `record-decision`，禁止手改 backlog。候选 3 因目标路径非文件系统路径，建议在审批时审慎考虑（可部分批准排除，待落点修正后另立候选）。

**已批准**（2026-08-17 全部批准）并完成应用与验证：`record-decision --decision approved` → `mark-applied` → `record-verification`（9 项强制验证全部通过，详见 `verifications/20260817-batch-004-verification.json`）。
- 候选 1 回归：evaluate 同比异常（688049 场景）速览区显示「存疑（接口异常，以年报为准）」，不再透传 9195.01%，Forward PE 不自动递推。
- 候选 2 回归：investment-checklist-auto 扫描胜宏科技 → #28 输出「有息负债64.5亿 / OCF 46.0亿 = 1.40（<5）✅」，CRITICAL 0/2 未通过，关键词误报消除。
- 候选 3 落点：因 `targetPath` 为流程步骤描述（非文件路径），实际修改落点收敛到 `AGENTS.md` 共享脚本用法表（stock.ts 行新增看空兜底指引），在 `allowedPaths` 内未越界。
- 候选 4 回归：fetch-file OCR 页占比 ≤5% 默认降级产出（无需 `--allow-ocr-pages`），frontmatter 记录 pages_needing_ocr 且无 failed/ 残留。
- 候选 5 回归：AGENTS.md 新增 deep-dive 模式 raw_source 取值约定，禁止指向不存在的 `[[...-raw]]` 悬空双链。
- 专项测试：45/45 通过；全量测试：111/112（唯一 error screen.test.ts 为既有并发 mock 泄漏，单独运行 20/20 通过）；3 个被改脚本 `bun build --no-bundle` exit 0。
