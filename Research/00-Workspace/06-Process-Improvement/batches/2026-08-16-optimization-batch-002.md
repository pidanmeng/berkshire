# 优化批次 2026-08-16-optimization-batch-002

> 批次 ID：`20260816-batch-002` · 状态：`verified` · 生成时间：2026-08-16
> 状态真源：`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json` · 本文件为可读投影
> 来源：`/process-optimize`（origin=process-improvement，不触发全局 Review）
> 审批：全部批准（2026-08-16）→ applied → verified（详见 `verifications/20260816-batch-002-verification.json`；修复前审视与实施计划见 `batch-runs/20260816-batch-002/plan.md`）

## 一、候选清单与证据

| 序 | 问题码 | 指纹 | 严重度 | 置信度 | 任务数 | 目标文件 | 摘要 |
|---|---|---|---|---|---|---|---|
| 1 | `evaluate-yoy-data-anomaly` | `36a6271497278a374a13` | high | 0.95 | 2 | `.trae/scripts/evaluation/evaluate.ts` | 估值快照同比放大近百倍（4149.62% vs 真实 +41.50%），Forward PE 递推被异常增速污染 |
| 2 | `evaluate-oneshot-income-distortion` | `eda9adbff8be8a32dc97` | high | 0.9 | 1 | `.trae/scripts/evaluation/evaluate.ts` | 一次性 BD 收入计入经常性损益导致 PE-TTM/PEG『便宜/有吸引力』误判（三生国健） |
| 3 | `quality-screen-oneshot-greening` | `8705451a11d6c539f9d5` | high | 0.85 | 1 | `.trae/scripts/quality-gate/quality-screen.ts` | 一次性 BD 收入美化评分（GREEN 7.9/10），绕过 Phase 4 入库门禁 |
| 4 | `stock-category-filter-ineffective` | `c5410c998978fa403abb` | medium | 0.5 | 2 | `.trae/scripts/stock-data/stock.ts` | `--category yjyg/yjbb` 过滤未生效，返回全量公告（3 个 taskId 观察） |
| 5 | `task-subagent-type-unavailable` | `63ffb68e043801041910` | high | 0.95 | 1 | `AGENTS.md` | 专用 subagent_type 在当前环境不可用（『subagent_type is not a valid value』），全流程被迫降级兜底 |
| 6 | `subagent-type-mapping-for-research-agents` | `e8a75ac6b1f86f6d2857` | low | 0.7 | 2 | `.trae/commands/deep-dive.md` | deep-dive 命令未说明自定义投研子 Agent 在 Task 工具下的启动方式，执行者需自行摸索 |

证据等级：候选 1/4/6 含多任务证据；候选 2/3/5 为单次 A 级证据（`high`/`critical` 问题有单次 A/B 级证据即可成为 candidate）。

## 二、逐文件修改

### 候选 1 + 候选 2 → `evaluate.ts`（`generateFramework()` / 估值快照段，两候选合并到同一文件同一改动批次）

- **同比合理性校验**：`yoy_revenue` / `yoy_net_profit`（`ind.yoy_operating_income` / `ind.yoy_net_profit`）输出前增加合理性校验：
  - `|同比| > 500%` → 输出「⚠️ 同比数据存疑（>500%），请以财报原文核对」显式标注，不再直接透传数值用于 P/S、PEG、Forward PE 递推；
  - 命中存疑时 `forwardGrowth` 缺省取 `opts.forwardGrowth`（缺省则置 null 并在输出标注），禁止用异常同比递推 `forwardNetProfitYi` / `forwardPe` / 目标市值。
- **一次性损益警告**：估值快照输出段（PE-TTM 评价 / PEG / 净利同比行）增加一次性损益识别：
  - 检测条件：`|yoy_net_profit| > 300%` 或净利率异常抬升（当前净利率 ≥ 上年 2 倍）或 `--forward-growth` 明确为负时，输出「⚠️ 净利可能含大额一次性收入（BD/license-out/资产处置），PE-TTM 与 PEG 失真，请用正常化盈利」；
  - PE-TTM 评价词（`便宜/略贵/合理/偏贵`）在一次性损益命中时改为「失真（疑似一次性损益），请用正常化盈利」。
- **回归样例**：`688336`（三生国健）→ 同比输出 251.81%/311.49%（或显式标注存疑）、出现一次性损益警告、'便宜' 评价不再出现；`688049`（炬芯科技）→ 同比 ≈ +41.50%/+91.95% 或显式标注口径警告。
- **不改动**：估值快照输出结构、其余指标计算、CLI 参数定义。

### 候选 3 → `quality-screen.ts`（`screenCompany` 评分入口 / report 模式指标加载）

- **一次性损益修正输入**：新增可选 CLI 参数 `--nonrecurring-net-profit`（剔除一次性损益后的归母净利，万元）与 `--nonrecurring-note`（说明文本）；report 模式优先从笔记 frontmatter `financials` 块读取非经常性损益字段（如 `nonrecurring_net_profit`）。
- **失真检测与降分**：当 `非经常性损益 / 归母净利 > 30%` 或 `一次性收入 / 营收 > 20%`（如 license-out 首付款）时：
  - 输出显式警告「⚠️ 净利含大额一次性损益，自动化评分失真」+ 触发条件数值 + `--nonrecurring-note` 内容；
  - 估值合理性维度与成长性维度得分下调（如各 -3 分，下限 0），并附「剔除一次性后主业净利」提示（若提供了修正净利）。
- **回归样例**：`三生国健` 笔记 → GREEN 附一次性损益失真警告，估值/成长维度不再因 BD 收入给满分；正常高增长股（无一次性损益）评分不变。
- **不改动**：auto/batch 模式默认行为、8 项红牌判定阈值、评分输出结构。

### 候选 4 → `stock.ts`（`queryAnnouncements` / `CATEGORY_MAP` 映射）

- 排查并修复 `--category yjyg/yjbb` 过滤未生效：核对 `CATEGORY_MAP` 中 `category_yjyg_szsh`/`category_yjbb_szsh` 与巨潮接口实际类别参数是否匹配；若映射键名不匹配则修正为接口接受的类别编码，若过滤逻辑未在响应组装后应用则在返回前补过滤。
- **回归样例**：`stock.ts --code 688049 --category yjyg --days 1100` 返回结果全部为业绩预告类公告；`--code 301217 --category yjyg` 不再返回治理类公告。
- **不改动**：其他类别（ndbg/bndbg/ndbg/yjdbg）映射与查询主流程、公告展示结构。

### 候选 5 → `AGENTS.md`（「系统架构速览」+ 流程路由/通用约束区）

- 补充「子 Agent 触发契约」说明：当前执行环境 Task 工具仅接受 `search` 与 `general_purpose_task`，投研专用角色（document-reader / bull-advocate / bear-advocate / info-alchemist / knowledge-architect / report-writer）以 `general_purpose_task` 启动并让子 Agent 自行 Read `.trae/agents/*.md` 定义；若环境开放自定义 subagent_type 则恢复直调。
- **不改动**：六阶段流程、命令清单、共享脚本用法、质量检查体系其他内容。

### 候选 6 → `.trae/commands/deep-dive.md`（Step 3 子 Agent 触发方式）

- 在「触发方式」处补充：自定义投研 Agent 以 `general_purpose_task` 启动，并携带 `.trae/agents/document-reader.md` / `bull-advocate.md` / `bear-advocate.md` / `info-alchemist.md` 角色定义与质量标准；`/research` 命令文档同步（如已有同型说明则对齐）。
- **不改动**：命令流程步骤、采集要求、精读目标。

## 三、依赖顺序

1. **候选 1+2（evaluate.ts）先行**——确立「同比合理性校验」与「一次性损益识别」判定逻辑与测试用例；
2. **候选 3（quality-screen.ts）其次**——复用候选 1/2 的一次性损益判定条件（阈值口径一致），独立实现；
3. **候选 4（stock.ts）**——独立无依赖；
4. **候选 5（AGENTS.md）+ 候选 6（deep-dive.md）最后**——文档类改动，合并一次提交，与 1-4 无耦合。

候选 2 依赖候选 1 的同比校验先落地（一次性损益警告部分复用同一存疑判定）；候选 3 与候选 2 有阈值口径约定耦合（`>300%` / `>30%` / `>20%` 阈值需一致），无文件级冲突。

## 四、兼容性

- 候选 1/2：估值快照输出结构不变，异常同比仅加警告标注、不修改正常数值展示；Forward PE 只在命中存疑时不再递推（此前错误递推本应禁止）。
- 候选 3：不传新参数 / frontmatter 无非经常性损益字段时行为与现状完全一致；仅显式触发时降分与警告。
- 候选 4：修复后指定类别过滤生效，未指定类别行为不变。
- 候选 5/6：纯文档，无代码影响。
- 五文件均无跨脚本 import 依赖；类型检查与全量测试互不影响。

## 五、专项测试

| 候选 | 测试文件 | 新增用例 |
|---|---|---|
| 1+2 | `.trae/scripts/evaluation/__tests__/evaluate.test.ts`（扩展） | ①`yoy_net_profit=9195.01` 时输出存疑标注且 `forwardNetProfitYi` 不递推 ②一次性损益命中时 PE 评价为失真提示 ③`--forward-growth` 显式传入时仍正常递推 ④`688336` 回归样例数据 |
| 3 | `.trae/scripts/quality-gate/__tests__/quality-screen.test.ts`（扩展） | ①`nonrecurring/净利>30%` 触发警告并降分 ②无一次性损益时评分不变 ③report 模式从 frontmatter 读取非经常性损益字段 |
| 4 | `.trae/scripts/stock-data/__tests__/stock.test.ts`（扩展） | mock 巨潮接口：`--category yjyg` 仅返回业绩预告类；无 category 返回全量 |
| 5/6 | — | 文档核对：AGENTS.md / deep-dive.md 含统一子 Agent 触发契约说明（人工 + grep 校验） |

## 六、全量测试 / 类型检查 / 路径检查

- 全量测试：`bun test`（项目根）。
- 类型检查：`bunx tsc --noEmit`。
- 路径检查：检索 `AGENTS.md`、`.trae/commands/`、`.trae/agents/`、`.trae/skills/` 中对 5 个目标文件（evaluate.ts / quality-screen.ts / stock.ts / AGENTS.md / deep-dive.md）的引用——确认 AGENTS.md 与 deep-dive.md 的改动仅新增说明，不影响既有命令/Agent/Skill 引用。

## 七、验收回归

| 场景 | 期望 |
|---|---|
| `evaluate.ts --code 688049` | 营收同比 ≈ +41.50%、净利同比 ≈ +91.95%（或显式存疑标注且无 4 位数异常倍数） |
| `evaluate.ts --code 688336` | 同比输出 251.81%/311.49%（或显式标注存疑）、出现一次性损益失真提示、'便宜' 评价不再出现 |
| `quality-screen.ts --file 三生国健-公司研究.md` | 输出一次性损益失真警告，估值/成长维度不再因 BD 收入给满分 |
| `stock.ts --code 688049 --category yjyg --days 1100` | 返回结果全部为业绩预告类公告 |
| deep-dive / research 命令触发子 Agent | 按文档约定以 `general_purpose_task` + 定义路径启动，无需临时摸索 |

## 八、回滚

- 修改前对 5 个目标文件保存快照（临时目录副本），记录修改前 git 差异基线。
- 应用后校验实际 diff 文件集合 ⊆ `allowedPaths`（evaluate.ts / quality-screen.ts / stock.ts / AGENTS.md / deep-dive.md + 各自测试文件）；越界立即回滚至快照。
- 任一强制验证失败：恢复快照 → 记录 `apply_failed` → 生成失败 verification，不改动 backlog 中其他项。

## 九、排除项

| 问题码 | 状态 | 排除原因 |
|---|---|---|
| `api-yoy-calculation-error`、`evaluate-ttm-yoy-anomaly` | observing | 与候选 1 同根因同文件（单 taskId），修复设计自然覆盖 |
| `checklist-auto-negation-context`、`checklist-auto-false-positives`、`checklist-auto-pdf-file-absent-false-positive`、`checklist-auto-year-ambiguity`（已 verified 项仍遗留的变体） | observing | investment-checklist-auto.ts 相关，已批次 001 修复部分根因；新变体单 taskId，留待后续批次 |
| `fetch-file-ocr-ratio-limit-too-strict`、`fetch-file-ocr-first-pass-fail`、`pdf-inspector-parse-table-anomaly` | observing | fetch-file.ts 相关，单 taskId / 证据等级不足，不入批 |
| `quality-screen-annual-value-regex`、`quality-screen-auto-unit-doc-missing` | observing | 同文件单 taskId 观察项，留待后续批次 |
| `orchestrator-dir-number-conflict`、`knowledge-dir-number-collision`、`deep-read-raw-source-dangling-link`、`deep-dive-validated-link-broken`、`reader-figure-miscitation`、`doc-reader-disclosure-check`、`industry-dir-concurrency-overlap`、`research-report-lack-bear-coverage`、`deep-dive-bear-research-collection-gap`、`web-fetch-jina-anti-bot` | observing | 不满足候选门槛（单 taskId / 证据等级不足 / 模板类），不入批 |

## 十、审批

批次等待审批：**全部批准** / **部分批准** / **全部拒绝**（经 AskUserQuestion 收集）。审批决定落地走 backlog 脚本 `record-decision`，禁止手改 backlog。

**已批准**（2026-08-16 全部批准）并完成应用与验证：`record-decision --decision approved` → `mark-applied` → `record-verification`（12 项强制验证全部通过）。用户附加要求已落实：①修复前逐 issue 审视流程适用性（候选 1-4 脚本层可解决、候选 5-6 需改流程文档，见 `batch-runs/20260816-batch-002/plan.md` 第一节）；②修复前生成完整计划文档（`plan.md`）；③修复后以存量数据验证（688049/688336/三生国健/风华高科/吉比特，见 verification）。
