# 优化批次 2026-08-16-optimization-batch-001

> 批次 ID：`20260816-batch-001` · 状态：`verified` · 生成时间：2026-08-16
> 状态真源：`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json` · 本文件为可读投影
> 来源：`/process-optimize`（origin=process-improvement，不触发全局 Review）
> 审批：全部批准（2026-08-16）→ applied → verified（verificationAt 2026-08-16T03:55:26Z，详见 `verifications/20260816-batch-001-verification.json`）

## 一、候选清单与证据

| 序 | 问题码 | 指纹 | 严重度 | 置信度 | 任务数 | 目标文件 | 摘要 |
|---|---|---|---|---|---|---|---|
| 1 | `qs-report-regex-range-misparse` | `f8e54e1adec09df9e593` | medium | 0.95 | 6 | `.trae/scripts/quality-gate/quality-screen.ts` | report 模式正则取首个匹配命中三年表首行（2023）或阈值文本，结论失真 |
| 2 | `checklist-auto-year-ambiguity` | `17ed133b9065d252ae4e` | medium | 0.85 | 6 | `.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts` | AUTO 扫描全文首匹配 + 商誉警示措辞误触发 + 负号丢失 |
| 3 | `fetch-file-ocr-fails-annual-report` | `e58395d373320827faa3` | low | 0.8 | 2 | `.trae/scripts/file-ingestion/fetch-file.ts` | 含少量 OCR 页年报整体 exit 4，需人工 salvage 脚本 |

证据等级：候选 1/2 含多任务 A 级证据（跨 6 个 taskId，2026-08-16 深调）；候选 3 含 2 个 taskId A 级证据。

## 二、逐文件修改

### 候选 1 → `quality-screen.ts`（`tryParseReportFile()`）

- **目标**：`--mode report` 取值改为「最新财年优先」降级链：
  1. frontmatter `financials` 块存在 → 直接读取（权威数据源）；
  2. 否则按 `research_cutoff.report_period`（如 `2025FY` → 2025）锚定最新财年，从财务表取对应列；
  3. 否则取财务表**末列**数值（跳过含 emoji/文字的趋势列）；
  4. 所有匹配排除 `<`/`≥`/区间/阈值措辞文本；商誉出现「商誉 0/无商誉」时置 0 不触发警示。
- **不改动**：`screenCompany` 评分逻辑、auto/batch 模式、CLI 参数定义。

### 候选 2 → `investment-checklist-auto.ts`（`pct()`/`has()` 及 `#15` 商誉逻辑）

- **目标**：数值提取复用候选 1 的「最新财年取值」逻辑（`financials` 块 → `report_period` 锚点 → 末列）；`#15` 商誉正则排除 `<30%`/「商誉占比过高」等警示措辞、优先识别「商誉 0/无商誉」；数值捕获保留 `[-+]?` 负号前缀（覆盖同根因 observing 项 `checklist-auto-negative-value-regex`）。
- **不改动**：清单项编号、输出 Markdown 块结构、其余 AUTO 项判定逻辑。

### 候选 3 → `fetch-file.ts`

- **目标**：新增可选参数 `--allow-ocr-pages`：`pagesNeedingOcr` 页数占比 ≤5% 时以占位符标记 OCR 页并产出 Markdown，frontmatter 保留 `pages_needing_ocr` 清单；超过阈值或未传参仍按现状 exit 4 + 保留源 PDF。
- **不改动**：默认失败语义、URL/本地处理主流程、命名与输出路径逻辑。

## 三、依赖顺序

1. 候选 1（quality-screen.ts）先行——确立「最新财年取值」实现与测试用例；
2. 候选 2（investment-checklist-auto.ts）其次——复用同一取值策略（两文件独立，仅逻辑约定一致）；
3. 候选 3（fetch-file.ts）最后——独立无依赖。

候选 1/2 有逻辑约定耦合（候选 2 复用候选 1 的取值方式），无文件级冲突；候选 3 完全独立。

## 四、兼容性

- 候选 1/2：report/AUTO 模式行为对齐 auto 模式口径；对无三年表笔记回退旧行为（首匹配）；输出结构与 CLI 契约不变。
- 候选 3：默认行为不变（不传 `--allow-ocr-pages` 仍 exit 4）；仅显式开启降级；`buildMarkdown` 已支持 `pages_needing_ocr` 输出。
- 三文件均无跨脚本 import 依赖；类型检查与全量测试互不影响。

## 五、专项测试

| 候选 | 测试文件 | 新增用例 |
|---|---|---|
| 1 | `.trae/scripts/quality-gate/__tests__/quality-screen.test.ts`（扩展） | ①三年对照表取最新财年（2025 末列）②`<30%` 阈值文本不误命中 ③商誉=0 不触发 ④`financials` 块优先 |
| 2 | `.trae/skills/research-quality-gate/scripts/__tests__/investment-checklist-auto.test.ts`（新建） | 风华高科验收：ROE=2.29%、OCF/NI=1.49、#15 通过、#29 营收取 2025 年报 16.54% 而非 2026Q1 |
| 3 | `.trae/scripts/file-ingestion/__tests__/fetch-file.test.ts`（扩展） | mock 含 1 页 OCR 的 PDF：带 `--allow-ocr-pages` 产出成功且 frontmatter 含 OCR 页清单；不带参数仍 exit 4 |

## 六、全量测试 / 类型检查 / 路径检查

- 全量测试：`bun test`（项目根）。
- 类型检查：`bunx tsc --noEmit`。
- 路径检查：检索 `AGENTS.md`、`.trae/commands/`、`.trae/agents/`、`.trae/skills/` 中对 3 个目标文件的引用——确认本批次仅改脚本与测试，无命令/Agent/Skill/模板/AGENTS.md 需同步。

## 七、验收回归

候选 1/2 以 `Research/10-Knowledge/04-电子/02-公司研究/风华高科-公司研究.md` 回归：

| 指标 | 期望值（2025FY） | 现状错误值 |
|---|---|---|
| ROE | 2.29% | 3.00% |
| OCF/NI | 1.49 | 0.80 |
| 商誉/净资产 | 0（不触发警示） | 30.00% |
| #29 营收同比 | 16.54%（2025 年报） | 18.9%（2026Q1） |
| 筛查结论 | RED，与 auto 模式一致 | 口径不一致 |

## 八、回滚

- 修改前对 3 个目标文件保存快照（临时目录副本），记录修改前 git 差异基线。
- 应用后校验实际 diff 文件集合 ⊆ `allowedPaths`（3 脚本 + 各自测试）；越界立即回滚至快照。
- 任一强制验证失败：恢复快照 → 记录 `apply_failed` → 生成失败 verification，不改动 backlog 中其他项。

## 九、排除项

| 问题码 | 状态 | 排除原因 |
|---|---|---|
| `quality-screen-annual-value-regex` | observing | 同根因同文件（单 taskId，未过候选门槛）；候选 1 修复设计自然覆盖 |
| `checklist-auto-negative-value-regex` | observing | 同根因同文件（单 taskId）；候选 2 修复设计自然覆盖 |
| `quality-screen-auto-unit-doc-missing` | observing | 脚本层问题但独立（auto 模式单位约定/帮助文本），留待后续批次 |
| `doc-reader-disclosure-check`、`industry-dir-concurrency-overlap`、`task-subagent-type-unavailable`、`research-report-lack-bear-coverage`、`subagent-type-mapping-for-research-agents`、`stock-category-filter-ineffective`、`deep-dive-bear-research-collection-gap` | observing | 不满足候选门槛（单 taskId / 证据等级不足），不入批 |

## 十、审批

批次等待审批：**全部批准** / **部分批准** / **全部拒绝**（经 AskUserQuestion 收集）。审批决定落地走 backlog 脚本 `record-decision`，禁止手改 backlog。
