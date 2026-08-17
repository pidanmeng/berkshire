# /process-optimize 执行计划（2026-08-16）

## 摘要

按 `/process-optimize` 默认模式执行：读取 `improvement-backlog.json` → `build-batch` 汇总全部 `candidate` → 生成批次 Markdown → **AskUserQuestion 收集审批**（全部/部分/全部拒绝）→ 按决定落地 `record-decision` → 应用已批准批次 → 强制验证 → `record-verification`。全程 `origin=process-improvement`，不触发全局 Review，终态为 `succeeded` / `failed` / `partial`。

## 现状分析

### Backlog 状态（`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json`）

- 共 **13 项**：`candidate` **3 项**，`observing` 10 项；`batches` 为空，尚无已生成批次。
- `build-batch`（[improvement-backlog.ts](file:///c:/Code/投研/.trae/skills/research-process-optimization/scripts/improvement-backlog.ts)）只选取 `status === "candidate"` 项，按「严重度 → 置信度 → 指纹」排序。

### 本次批次候选（3 项）

| 问题码 | 严重度/置信度 | 目标文件 | 任务数 | 证据 | 期望批次内顺序 |
|---|---|---|---|---|---|
| `qs-report-regex-range-misparse` | medium / 0.95 | `.trae/scripts/quality-gate/quality-screen.ts` | 6 | A/B | 1 |
| `checklist-auto-year-ambiguity` | medium / 0.85 | `.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts` | 6 | A/B | 2 |
| `fetch-file-ocr-fails-annual-report` | low / 0.8 | `.trae/scripts/file-ingestion/fetch-file.ts` | 2 | A | 3 |

- 预期批次：`20260816-batch-001`（`batches` 当前长度 0 → 编号 001），status `proposed`，`allowedPaths` = 上述 3 个目标文件。
- 批次 Markdown：`Research/00-Workspace/06-Process-Improvement/batches/2026-08-16-optimization-batch-001.md`（目录不存在，需新建）。

### 目标文件关键代码现状（已勘察）

- [quality-screen.ts](file:///c:/Code/投研/.trae/scripts/quality-gate/quality-screen.ts#L361-L388)：`tryParseReportFile()` 的 `pick()` 对每组正则取**首个匹配**，无「最新财年/排除阈值文本」约束 → 命中三年对照表首行（2023）或 `商誉/净资产 <30%` 阈值表述。
- [investment-checklist-auto.ts](file:///c:/Code/投研/.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts#L36-L47)：`pct()` / `has()` 对合并全文取**首个匹配**，同样命中最早年份；`#15` 商誉靠关键词正则，`<30%` 警示措辞会误触发；负号在部分正则中丢失。
- [fetch-file.ts](file:///c:/Code/投研/.trae/scripts/file-ingestion/fetch-file.ts#L350-L352)：`pagesNeedingOcr.length > 0` 一律抛 `IngestionError(exit 4)` 并保留源 PDF，无「OCR 页占位降级」选项。

### 数据源勘察（决定修复方案的关键事实）

- 风华高科笔记（验收样例）**无 `financials` frontmatter 块**；全库仅 3 篇笔记（宁德时代/牧原/温氏）有该块 → 修复**不能假设** `financials` 存在，必须带降级链。
- 笔记 frontmatter 含 **`research_cutoff.report_period: "2025FY"`** 字段（风华高科 L78），可作为「最新财年」锚点。
- 笔记正文含三年表 `| 指标 | 2023 | 2024 | 2025 | 趋势 |`（风华高科 L168-L180），**最新财年数值在末列（2025）**，趋势列在最后且含文字/emoji。
- 已存在测试：`.trae/scripts/quality-gate/__tests__/quality-screen.test.ts`、`.trae/scripts/file-ingestion/__tests__/fetch-file.test.ts`；`investment-checklist-auto.ts` 无测试。

## 流程合理性评判（用户要求先行结论）

**结论：当前流程整体合理，三项候选的根因全部落在脚本层，脚本完全能胜任修复 → 应优先修改脚本，不修改流程。**

| 候选 | 根因归类 | 脚本能否胜任 | 评判依据 |
|---|---|---|---|
| `qs-report-regex-range-misparse` | 脚本缺陷：`pick()` 正则首匹配，未按最新财年取值 | ✅ 能 | 数据在笔记内完整存在（三年表末列 + `report_period` 锚点），仅提取策略错误；修复为「`financials` 块 → `report_period` 锚定列 → 表格末列 → 排除阈值文本」降级链即可 |
| `checklist-auto-year-ambiguity` | 脚本缺陷：全文首匹配 + 商誉关键词过宽 + 负号丢失 | ✅ 能 | 与候选 1 同根因同策略；复用同一「最新财年取值」逻辑 + 商誉正则排除警示措辞 + 保留 `[-+]?` 符号 |
| `fetch-file-ocr-fails-annual-report` | 脚本缺陷：缺 OCR 页降级选项 | ✅ 能 | 临时 salvage 脚本已验证「占位符降级」机制可行，只是未固化进 `fetch-file.ts`；新增 `--allow-ocr-pages` 即可 |

**附带观察**（不改变批次构成）：
- `quality-screen-annual-value-regex`、`checklist-auto-negative-value-regex` 与候选 1/2 **同根因、同文件**（observing：单 taskId，未过候选门槛），修复设计应自然覆盖（末列取值、负号保留），在批次「排除项」中标注，修复后自动消解。
- `quality-screen-auto-unit-doc-missing`（auto 模式百分比/小数单位）同为**脚本层**问题（帮助文本或自适应取值），不属于流程缺陷，可后续单独入批。
- 所有 observing 项均未暴露流程/命令/Agent 定义层的错误；**无流程修改需求**。

## 执行流程（审批后逐项实施）

1. **build-batch**：`bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts build-batch`（原子更新 backlog，3 项 candidate → proposed，写入批次记录）。
2. **生成批次 Markdown**：编排器按命令模板产出 `batches/2026-08-16-optimization-batch-001.md`，包含：候选清单与证据、逐文件修改、依赖顺序、兼容性、专项测试、全量测试、类型检查、路径检查、回滚、排除项。
3. **AskUserQuestion 审批**（收到决定前不做任何正式资产修改）：
   - 问题 1（单选）：审批方式 → 「全部批准」/「部分批准」/「全部拒绝」。
   - 若「部分批准」：追加多选问题勾选候选（3 项，一个多选问题即可；选项 label 用中文描述附问题码，description 标严重度与目标文件）。
4. **决定落地**（走 backlog 脚本，不手改）：
   - 全部批准 → `record-decision --batch 20260816-batch-001 --decision approved`
   - 部分批准 → `record-decision --batch ... --decision partial --items <勾选指纹>`（未勾选自动转 `rejected`，生成子批次 `20260816-batch-001-approved`）
   - 全部拒绝 → `record-decision --batch ... --decision rejected` + 决策说明，以 `succeeded` 结束，不改任何文件。
5. **应用已批准批次**：按批次依赖顺序实施，修改前对目标文件保存快照/差异基线；实施后校验实际 diff 集合 ⊆ 批准集合，越界立即回滚。
6. **强制验证**（见下），全部通过 → `record-verification`；任一强制项失败 → 按回滚清单恢复 → `apply_failed`。

## 各候选修改方案（写入批次 Markdown 的逐文件修改）

### 候选 1 `qs-report-regex-range-misparse` → quality-screen.ts

- **改动点**：重写 `tryParseReportFile()` 取值逻辑为降级链：
  1. frontmatter `financials` 块存在 → 直接读取（权威数据源，来自 backfill/hithink）；
  2. 否则按 `research_cutoff.report_period`（如 `2025FY` → 2025）锚定最新财年，从三年表取对应列数值；
  3. 否则取财务表**末列**数值（2025 在 `| 2023 | 2024 | 2025 | 趋势 |` 中最右数值列，跳过含 emoji/文字的趋势列）；
  4. 所有匹配排除带 `<`/`≥`/`>30%` 区间/阈值措辞的文本；商誉类指标当出现「商誉 0/无商誉」时置 0，不触发警示。
- **兼容性**：auto/batch 模式不变；report 模式行为对齐 auto 模式口径；对无三年表笔记回退旧行为（首匹配）。
- **专项测试**：扩展 `quality-screen.test.ts`：①三年对照表取最新财年（2025 末列）；②`<30%` 阈值文本不误命中；③商誉=0 不触发；④`financials` 块优先。

### 候选 2 `checklist-auto-year-ambiguity` → investment-checklist-auto.ts

- **改动点**：`pct()` / `has()` 复用候选 1 的「最新财年取值」公共逻辑（`financials` 块 → `report_period` 锚点 → 末列）；`#15` 商誉正则排除 `<30%`/「商誉占比过高」等警示措辞，优先识别「商誉 0/无商誉」；数值捕获保留 `[-+]?` 负号前缀（覆盖同根因 `checklist-auto-negative-value-regex`）。
- **兼容性**：输出 Markdown 块结构不变；两脚本文件独立，无文件级冲突，仅约定同一取值逻辑（候选 2 在候选 1 后实施）。
- **专项测试**：新建 `.trae/skills/research-quality-gate/scripts/__tests__/investment-checklist-auto.test.ts`：风华高科验收场景（ROE=2.29%、OCF/NI=1.49、#15 通过、#29 营收取 2025 年报 16.54% 而非 2026Q1）。

### 候选 3 `fetch-file-ocr-fails-annual-report` → fetch-file.ts

- **改动点**：新增可选参数 `--allow-ocr-pages`；当 `pagesNeedingOcr` 页数占比 ≤5% 时以占位符标记 OCR 页并产出 Markdown，frontmatter 保留 `pages_needing_ocr` 清单；超过阈值或未传参仍按现状 exit 4 + 保留源 PDF。
- **兼容性**：默认行为不变（不传参仍失败）；仅显式开启降级；`buildMarkdown` 已支持 `pages_needing_ocr` 输出，仅需放开线 350-352 的硬失败并插入占位。
- **专项测试**：扩展 `fetch-file.test.ts`：mock 含 1 页 OCR 的 PDF，验证带 `--allow-ocr-pages` 产出成功、frontmatter 含 OCR 页清单；不带参数仍 exit 4。

## 假设与决策

- **流程层无修改**：三项候选均为脚本缺陷，脚本能胜任；本批次不触碰命令、Agent 定义、Skill 提示词、模板、`AGENTS.md`。
- 批次内容以执行时 backlog 实际 `candidate` 为准（当前 3 项）；若执行前 backlog 有更新，按脚本 `build-batch` 实际输出执行。
- 相关 `observing` 项（`quality-screen-annual-value-regex`、`checklist-auto-negative-value-regex`、`quality-screen-auto-unit-doc-missing`）**不入批**，在批次「排除项」中标注；前两项由候选 1/2 的修复设计自然覆盖，第三项留待后续批次。
- 修改范围严格限制在 `allowedPaths`（3 个脚本文件 + 各自测试文件）；不扩大文件范围。
- 秘密/环境变量值/Authorization 等一律不进入任何产物。

## 验证步骤

| 项 | 命令/方式 | 强制 |
|---|---|---|
| 专项测试 | `bun test .trae/scripts/quality-gate/__tests__/quality-screen.test.ts`、`bun test .trae/scripts/file-ingestion/__tests__/fetch-file.test.ts`、新增 investment-checklist-auto 测试 | 是 |
| 全量测试 | `bun test`（项目根） | 是 |
| 类型检查 | `bunx tsc --noEmit` | 是 |
| 路径引用检查 | 检索 `AGENTS.md`、`.trae/commands/`、`.trae/agents/`、`.trae/skills/` 中对 3 个目标文件的引用，确认无需同步变更 | 是 |
| 验收回归 | 候选 1/2 以 `Research/10-Knowledge/04-电子/02-公司研究/风华高科-公司研究.md` 跑 `--mode report` / checklist-auto，比对 acceptance：ROE=2.29%（2025FY）、OCF/NI=1.49、商誉 0、#15 通过、结论 RED 与 auto 模式一致 | 是 |

全部通过 → `record-verification --batch <batch-id> --results <verification.json>` 记录 `verified`；任一强制项失败 → 回滚后记录 `apply_failed`。终态为 `succeeded` / `failed` / `partial`，不触发全局 Review。
