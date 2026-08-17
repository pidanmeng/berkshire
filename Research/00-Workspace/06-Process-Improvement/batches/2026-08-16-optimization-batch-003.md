# 优化批次 2026-08-16-optimization-batch-003

> 批次 ID：`20260816-batch-003` · 状态：`verified` · 生成时间：2026-08-17
> 状态真源：`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json` · 本文件为可读投影
> 来源：`/process-optimize`（origin=process-improvement，不触发全局 Review）
> 审批：全部批准（2026-08-17）→ applied → verified（详见 `verifications/20260816-batch-003-verification.json`；快照见 `batch-runs/20260816-batch-003/snapshots/`）

## 一、候选清单与证据

| 序 | 问题码 | 指纹 | 严重度 | 置信度 | 任务数 | 目标文件 | 摘要 |
|---|---|---|---|---|---|---|---|
| 1 | `checklist-auto-false-positives` | `dbc1daf29fbb25a752de` | medium | 0.8 | 2 | `.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts` | AUTO 扫描中文正则误报需逐项人工澄清（#4/#8/#30 等），真实警示仅 #31 PE 与 #27 负债率 |
| 2 | `quality-screen-auto-unit-doc-missing` | `fc32477b72b5a7a8d669` | medium | 0.75 | 2 | `.trae/scripts/quality-gate/quality-screen.ts` | `--mode auto` 百分比传参（--roe 14.65）被 ×100 放大失真（ROE 1465%/负债率 5120%），帮助文本未明确小数约定 |
| 3 | `deep-dive-validated-link-broken` | `a08bf7f809adcbf7d4c5` | medium | 0.7 | 2 | `Research/99-Templates/company-template.md` | deep-dive 模式无 Phase 3（无 validated 文件），模板仍强制 `validation_source` 指向不存在的 validated → 悬空双链 |
| 4 | `research-report-lack-bear-coverage` | `72ac4c8e1a1a6dca54e2` | low | 0.7 | 2 | `Research/00-Workspace/02-Processing/pdf-texts/鼎泰高科/研报集.md` | 券商研报全为看多/买入，看空观点不进入研报体系，空方论点需 bear-advocate 独立挖掘 |
| 5 | `web-fetch-jina-anti-bot` | `af8dafa04c57f72ed5b0` | low | 0.5 | 2 | `.trae/skills/research-web-search` | WebFetch `r.jina.ai` 前缀抓东财研报返回反爬页，`fetch-source.ts` 同 URL 可成功提取 |

证据等级：候选 1/2/3/4/5 均为 2 个 taskId 复现，且至少含 C 级证据（满足 medium/low 候选门槛）；候选 1/2 含 A 级证据。
全部 5 项按严重度（medium 在前）+ 置信度降序排列。

**范围注意（候选 4/5 目标路径特殊性）**：
- 候选 4 的 `targetPath` 是**数据产物**（鼎泰高科研报集.md），系统性修复（`stock.ts --reports` 信源扩展 / `deep-dive` 命令看空兜底步骤）涉及的文件不在本批 `allowedPaths` 内。本批对候选 4 的修改范围仅限该数据文件本身（补充非研报看空线索清单示范）；系统性修复需另立候选并更正目标路径。
- 候选 5 的 `targetPath` 是**目录**（`.trae/skills/research-web-search`），实施时实际落点为目录内 `SKILL.md`（及可选 `fetch-source.ts` 头注释），应用阶段按实际文件校验。

## 二、逐文件修改

### 候选 1 → `investment-checklist-auto.ts`（AUTO 扫描 #4/#8/#30 判定逻辑）

- **#30 大额减值（`impairRed`）**：增加否定语境排除——命中「无减值 / 未计提 / 转回 / 冲回 / 未发生 / 通过」时不得判警示；数值化判定优先从结构化章节（财报精读清单/数据来源）匹配「减值损失 X 元，占净利 Y%」，仅当 Y > 30% 或减值金额 ≥ 净利 30% 判警示；纯「大额减值」关键词须附带金额（亿/万）才命中。
- **#8 财报 PDF（`pdfDownloaded`）**：将「pdf-texts/公司名/…年报.md」路径引用与「三年年报已下载/已精读」表述作为强证据；弱化对通用「年报/PDF」字样的宽松命中（避免误判）。
- **#4 三层结构（`hasThreeTiers`）**：关键词须在正文实际章节出现（排除 frontmatter/模板占位），对 deep-dive 模式（无 raw 文件）不误报。
- **回归样例**：锐捷网络（#31/#27 为真警示、其余不再误报）、山金国际（#4/#8/#30 全部通过）。
- **不改动**：清单项定义、退出码逻辑、报告输出结构；其余 50 项判定规则。

### 候选 2 → `quality-screen.ts`（auto 模式单位约定）

- **主修复**：脚本头部用法注释（`--mode auto` 示例）与 CLI 帮助显式声明单位约定——「百分比/比率类参数（--roe / --gross-margin / --net-margin / --debt / --revenue-growth / --earnings-growth / --cash-to-revenue / --receivables-growth / --inventory-growth / --short-debt-ratio / --cash-asset-ratio / --goodwill-ratio）一律传小数（0-1），如 ROE 18% 传 0.18、负债率 51.2% 传 0.512」。
- **可选加固（推荐）**：对固定值域比率字段（roe / gross-margin / net-margin / debt / cash-asset-ratio / goodwill-ratio / short-debt-ratio）在 `|传入值| ≥ 1` 时输出警告「疑似按百分比传参，已折算为小数」并自动 `/100`；growth 类（revenue-growth / earnings-growth / receivables-growth / inventory-growth）合法可 >100%，**不自动折算**，仅文档提示。
- **回归样例**：小数传参（--roe 0.1465 --debt 0.512）输出与现状一致；百分比传参（14.65/51.2）输出正确数值或显式告警。
- **不改动**：评分阈值、红黄绿牌判定、report/batch 模式行为。
- **范围说明**：`AGENTS.md` 用法表同步单位约定不在本批 `allowedPaths`，列入排除项（后续批次）。

### 候选 3 → `company-template.md`（validation_source 按模式取值）

- **frontmatter**：`validation_source: "[[YYYY-MM-DD-公司名称-validated]]"` 改为带模式说明的注释——标准/深度模式指向 validated；deep-dive 模式（无 Phase 3）指向 `[[YYYY-MM-DD-公司名称-deep-read]]` 或置空并注明「deep-dive 模式，主验证源为 deep-read」。
- **页脚**：`*数据来源: [[YYYY-MM-DD-公司名称-validated]]*` 同步改为按模式取值。
- 模板内补充一行取值规则说明，供 knowledge-architect 按模式填写。
- **回归样例**：deep-dive 模式生成的炬芯/锐捷网络笔记 `validation_source` 指向实际存在的 deep-read 文件（或空值+注释），无悬空双链。
- **不改动**：模板其余字段、星级评分结构、估值追踪字段。

### 候选 4 → `研报集.md`（数据文件，范围受限）

- 在本数据文件（鼎泰高科研报集）中补充「非研报看空线索清单」段落：雪球看空长文、减持公告、负面新闻、东财股吧等，逐条标注来源、URL 与时点；若已存在类似记录则补全来源与时点。
- **范围说明**：系统性修复（`stock.ts --reports` 扩展非研报源 / `deep-dive` 命令内置看空采集兜底步骤）超出本批 `allowedPaths`，列入排除项，需另立候选并更正目标路径后入批。
- **不改动**：该文件既有研报摘要、评级与观点内容。

### 候选 5 → `research-web-search`（SKILL.md 文档指引）

- **SKILL.md**：「模式 2：URL 抓取正文」与「脚本工作流建议」中移除/标注「WebFetch + `r.jina.ai` 前缀」直连路径（东财等目标站触发反爬），统一指引使用 `fetch-source.ts`（内部第一梯队 r.jina.ai，失败自动降级）；补充抓取失败降级说明（记录 URL → webfetch 重试 → 仍失败标注「抓取失败，仅引用 URL」）。
- **fetch-source.ts**（可选）：头注释补一句「对 data.eastmoney.com 等站点 r.jina.ai 可能返回反爬页，自动降级处理」。
- **不改动**：`fetch-source.ts` / `search.ts` / `sector.ts` / `sources.ts` 的实际抓取与解析逻辑。

## 三、依赖顺序

1. **候选 1（checklist-auto）与候选 2（quality-screen）**——均为脚本判定/单位修复，互相独立、无文件级耦合，可并行实施；
2. **候选 3（模板）、候选 4（数据文件）、候选 5（Skill 文档）**——文档/数据层改动，独立无依赖，可与 1/2 并行。

无跨文件 import 依赖；建议实施顺序 1 → 2 → 3 → 4 → 5（先脚本后文档，便于回归顺序验证）。

## 四、兼容性

- 候选 1：判定增强为「更严格才警示」，正常数据行为不变；唯一风险是漏报（若新逻辑过严），需以锐捷/山金国际回归样例校验。
- 候选 2：不传参/传小数行为与现状完全一致；仅百分比传参时输出告警或折算，消除 ×100 失真。
- 候选 3：纯模板注释与取值规则变更，对既有笔记无影响；新生成笔记的 validation_source 不再悬空。
- 候选 4：数据文件补充段落，不影响既有内容与下游解析（研报集不被脚本消费为结构化源）。
- 候选 5：纯文档指引变更，无代码行为变化。
- 5 个目标文件互不 import；类型检查与全量测试互不影响。

## 五、专项测试

| 候选 | 测试文件 | 新增用例 |
|---|---|---|
| 1 | `.trae/skills/research-quality-gate/scripts/__tests__/investment-checklist-auto.test.ts`（扩展） | ①#30 含「转回/未计提/无减值」语境不判警示 ②#30 带金额且占净利 >30% 判警示 ③#8 笔记引用 pdf-texts 路径判通过 ④锐捷网络样例：仅 #31/#27 未通过 |
| 2 | `.trae/scripts/quality-gate/__tests__/quality-screen.test.ts`（扩展） | ①按百分比传参（--roe 14.65）输出正确或告警 ②按小数传参行为不变 ③growth 类 >100% 不误折算 |
| 3 | — | 文档核对：company-template.md 含 validation_source 按模式取值说明（人工 + grep 校验） |
| 4 | — | 文档核对：研报集.md 含非研报看空线索清单且逐条标注来源/URL/时点（人工校验） |
| 5 | — | 文档核对：SKILL.md 无「WebFetch + r.jina.ai 前缀」建议路径，或已标注反爬限制（grep 校验） |

## 六、全量测试 / 类型检查 / 路径检查

- 全量测试：`bun test`（项目根）。
- 类型检查：`bunx tsc --noEmit`。
- 路径检查：检索 `AGENTS.md`、`.trae/commands/`、`.trae/agents/`、`.trae/skills/` 中对 5 个目标文件（investment-checklist-auto.ts / quality-screen.ts / company-template.md / 研报集.md / research-web-search）的引用——确认改动仅为增强/文档化，不影响既有命令、Agent、Skill 与共享脚本引用；确认 company-template.md 的 `validation_source` 改动与 knowledge-architect 定义、valuation-tracker 解析兼容（`research_cutoff`/`validation_source` 不参与估值计算，可安全调整）。

## 七、验收回归

| 场景 | 期望 |
|---|---|
| `investment-checklist-auto.ts` 扫描锐捷网络报告与笔记 | 仅 #31 估值与 #27 负债率为真实未通过项，不再出现非真实警示 |
| `quality-screen.ts --mode auto --roe 14.65 --debt 51.2` | 输出 ROE 14.65%、负债率 51.2%（或显式告警），不再出现 1465%/5120% 失真 |
| deep-dive 模式公司笔记 | `validation_source` 指向实际存在的 deep-read 文件（或空值+注释），无悬空双链 |
| 鼎泰高科研报集.md | 含非研报看空线索清单（来源+URL+时点），不破坏既有研报摘要 |
| SKILL.md 研报正文抓取指引 | 统一指向 `fetch-source.ts`，无 `r.jina.ai` 直连建议或已标注反爬限制 |

## 八、回滚

- 修改前对 5 个目标文件保存快照（`batch-runs/20260816-batch-003/snapshots/`），记录修改前 git 差异基线。
- 应用后校验实际 diff 文件集合 ⊆ `allowedPaths`（investment-checklist-auto.ts / quality-screen.ts / company-template.md / 研报集.md / research-web-search 内实际落点文件 + 各自测试文件）；越界立即回滚至快照。
- 任一强制验证失败：恢复快照 → 记录 `apply_failed` → 生成失败 verification，不改动 backlog 中其他项。

## 九、排除项

| 问题码 | 状态 | 排除原因 |
|---|---|---|
| `checklist-auto-negation-context`（三生国健 #30 转回误报）、`checklist-auto-pdf-file-absent-false-positive`（炬芯科技 #8/#30） | observing | 与候选 1 同根因同文件，修复设计自然覆盖（实施候选 1 时一并处理，但不在本批单独列项） |
| `quality-screen-annual-value-regex`（铜冠铜箔 report 模式三年表取值） | observing | 同文件但属 report 模式正则问题，与候选 2（auto 模式单位）不同根因，单 taskId 留后续批次 |
| `deep-dive-bear-research-collection-gap`（铜冠铜箔看空采集兜底） | observing | 与候选 4 同主题，目标 `deep-dive.md` 不在本批 allowedPaths，单 taskId 留后续 |
| 候选 4 的系统性修复（stock.ts 信源扩展 / deep-dive 命令看空兜底步骤） | — | 超出本批 allowedPaths，需另立候选并更正目标路径后入批 |
| `quality-screen-oneshot-greening`、`evaluate-yoy-data-anomaly`、`evaluate-oneshot-income-distortion`、`stock-category-filter-ineffective`、`subagent-type-mapping-for-research-agents`、`task-subagent-type-unavailable` | verified | 已由批次 001/002 修复并验证 |
| `doc-reader-disclosure-check`、`industry-dir-concurrency-overlap`、`fetch-file-ocr-ratio-limit-too-strict`、`pdf-inspector-parse-table-anomaly`、`knowledge-dir-number-collision`、`api-yoy-calculation-error`、`reader-figure-miscitation`、`evaluate-ttm-yoy-anomaly`、`stock-category-filter-noop`、`orchestrator-dir-number-conflict`、`fetch-file-ocr-first-pass-fail`、`deep-read-raw-source-dangling-link`、`checklist-auto-pdf-file-absent-false-positive`、`deep-dive-report-html-omission` | observing | 单 taskId / 证据等级不足 / 需更多复现，不入本批 |
| AGENTS.md 用法表单位约定同步 | — | 不在本批 allowedPaths，候选 2 落地后另立候选处理 |

## 十、审批

批次等待审批：**全部批准** / **部分批准** / **全部拒绝**（经 AskUserQuestion 收集）。审批决定落地走 backlog 脚本 `record-decision`，禁止手改 backlog。

**已批准**（2026-08-17 全部批准）并完成应用与验证：`record-decision --decision approved` → `mark-applied` → `record-verification`（8 项强制验证全部通过，详见 `verifications/20260816-batch-003-verification.json`）。
- 候选 1 回归：investment-checklist-auto 扫描锐捷网络 → 仅剩真实警示 #27（负债率 63%）/#31（PE 170.8），#4/#8/#15/#25/#26/#29/#30 误报全部消除。
- 候选 2 回归：quality-screen --mode auto --roe 14.65 --debt 51.2 → ROE 14.65%/负债率 51.2%（修复前 1465%/5120%），单位折算警告生效。
- 候选 3/4/5 为文档/数据层改动，经路径检查与人工核对通过。
- 全量测试：151/152 通过（唯一失败 hithink.test.ts 为既有并发 mock 泄漏，batch-002 已记录，非本批次引入）。
