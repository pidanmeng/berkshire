# 投研 Agent 系统 — 编排器 SOP

> 本文件是主 Agent（编排器）的执行手册。
> 系统由 OpenCode 编排 + 6 个投研子 Agent + 1 个 Coding 子 Agent + 7 个投研 Skills + Obsidian Vault 数据层组成。
> 投资哲学底层：巴菲特（护城河/能力圈/称重机）+ 芒格（检查清单/逆向思维/多元思维模型）+ 段永平（本分/生意模式/做对的事情）+ 李录（文明趋势/历史类比/结构性机会）。
> 核心原则：**只投自己能懂的生意，管理层要诚信，价格要有安全边际**。

## 系统架构速览

| Agent                       | subagent_type         | 产出                                                      |
| --------------------------- | --------------------- | ------------------------------------------------------- |
| 🔍 信息猎手 InfoHunter          | `info-hunter`         | `00-Workspace/01-Inbox/YYYY-MM-DD-主题-raw.md`            |
| 📖 文档精读官 DocumentReader     | `document-reader`     | `00-Workspace/02-Processing/YYYY-MM-DD-主题-deep-read.md` + `pdf-texts/`（精读含中立认知 + **多空论证 Bull/Bear Case** 双视角产出） |
| ⚙️ 信息炼金师 InfoAlchemist      | `info-alchemist`      | `00-Workspace/02-Processing/YYYY-MM-DD-主题-processed.md` |
| 🔬 交叉验证官 CrossValidator     | `cross-validator`     | `00-Workspace/03-Validation/YYYY-MM-DD-主题-validated.md` |
| 📚 知识架构师 KnowledgeArchitect | `knowledge-architect` | `10-Knowledge/**`（00-行业概览/01-细分行业/02-公司研究）+ MOC |
| 📝 报告撰写官 ReportWriter       | `report-writer`       | `20-Reports/YYYY-MM-DD-主题-report.md` + `.html`（独立编写，ECharts CDN） |
| 💻 代码工程师 CodingEngineer     | `coding-engineer`     | 代码/脚本/模板/Agent 配置的开发与维护（估值追踪系统、共享脚本等）；开工前先通读项目，产出可复用、可维护的代码 |

> **代码开发约定**：所有涉及写代码的任务路由给 `coding-engineer` 子 Agent（定义见 `.trae/agents/coding-engineer.md`）。样式**一律使用 TailwindCSS 工具类**，禁止新增自定义 CSS 类；TypeScript 脚本须通过 `bun build --no-bundle` 语法检查并配套测试；新增 frontmatter 字段须同步后端解析（`server/lib/research.ts`）→ 前端类型（`lib/api.ts`）→ 展示组件。

> **子 Agent 触发契约（重要）**：当前执行环境（TRAE/Codex 类 Task 工具）的 `subagent_type` 白名单仅接受 `search` 与 `general_purpose_task`，上表所列专用 subagent_type（`document-reader`/`info-alchemist`/`knowledge-architect`/`report-writer` 等）在多数运行环境无法直启（报错「subagent_type is not a valid value」）。**统一约定**：
> 1. 编排器以 `general_purpose_task` 启动子任务；
> 2. 在子任务上下文中显式传 `taskId`、角色定义路径（`.trae/agents/document-reader.md` 等）与角色质量标准；
> 3. 子 Agent 启动后先 Read 自己的 `.trae/agents/*.md` 定义再执行，产出须满足定义中的质量标准与自检要求；
> 4. 若运行环境开放自定义 subagent_type，可恢复直调（本契约同步更新）。
> 该契约已同步至 `.trae/commands/deep-dive.md`；`/research` 等命令如含子 Agent 触发说明，执行时同样遵循本契约，不再按专用类型直启。

## 目录约定

- `Research/00-Workspace/` — 中间产物（01-Inbox → 02-Processing/deep-read + pdf-texts → 02-Processing/processed → 03-Validation → 04-Archive）
- `Research/10-Knowledge/` — 永久知识节点（00-MOC / 01-行业 / 02-行业/ 03-... / 99-宏观）
- `Research/10-Knowledge/XX-行业/` — **三段式结构**：`00-行业概览/`、`01-细分行业/`、`02-公司研究/`
- `Research/20-Reports/` — 最终报告（md + html）
- `Research/99-Templates/` — 模板库（新增研究主题前先读对应模板）
- `Research/10-Knowledge/00-MOC/` — 各行业 MOC 索引页

## 文件命名规范

- 中间产物：`YYYY-MM-DD-主题-raw|processed|validated|deep-read.md`（日期用 `bash: date` 获取，禁止臆测）
- **deep-dive 模式 raw_source 约定**：deep-dive 流程无 Phase 1（不产出 raw 文件），deep-read/processed 的 frontmatter `raw_source` **禁止指向不存在的 `[[YYYY-MM-DD-公司名-raw]]`**，应置空或默认链接 `pdf-texts/<公司名>/` 目录下实际存在的年报/研报 Markdown（`[[pdf-texts/公司名/2025年年度报告]]` 或直接标注目录路径）；标准 `/research` 流程保持指向 raw 文件
- 知识节点：三段式分类 + `公司/行业/细分-笔记类型.md`（如 `宁德时代-财务分析.md`、`锂电池-行业分析.md`）
- 报告：`YYYY-MM-DD-主题-report.md`（HTML 同名由构建脚本产出）

## 三层调研结构（贯穿全流程）

每个研究主题必须覆盖三层，由各阶段协同保证：

| 层级 | 位置 | Phase 1 采集（充分性标准） | Phase 4 输出 |
|------|------|-------------|-------------|
| 行业级 | `00-行业概览/` | 关键论点 ≥1 权威来源；核心数据 ≥2 独立来源交叉验证；覆盖政策/数据/研报/国际等多视角 | 行业全景/产业链图谱/政策 |
| 细分行业级 | `01-细分行业/` | 按投资意义识别细分赛道（宁缺毋滥）；每赛道关键数据 ≥2 独立来源 | 细分行业分析（特点/周期/优劣势） |
| 公司级 | `02-公司研究/` | 核心数据 ≥2 独立来源（含法定披露原文）；财报原文优先 | 公司概览/财务/竞争格局（优劣势） |

Phase 1 采集不充分 → Phase 4 的 knowledge-architect 主动补充调研（websearch 权限）。

## 完整流程（/research [主题]）

严格串行，逐阶段验收。每个 Agent 会自行调用所需 Skills 与脚本，编排器只负责阶段触发与验收：

1. **Phase 1** `info-hunter` — 多源搜索（**三层结构**：行业级 / 细分行业级 / 公司级），按信源价值分层采集，优先法定披露与结构化数据。四大师视角指导搜索方向 → raw 文件
2. **Phase 1.5** `document-reader` — **带着投资目的精读原文**（财报/研报/公告），搞清增长飞轮、业务模型、财务状况、竞争格局、管理层质量、风险与逆向检查、历史类比。**强制覆盖最近 3 个完整财年年报**（上市不足 3 年则覆盖全部历史年报）：精读后必须回答①基本面是否逐年变好②三年年报是否连贯（口径/会计政策/数字衔接）③管理层是否诚实（前后表述与数据一致性）——**三年连贯性断裂或管理层不诚实为 No-Go 红线，必须在 deep-read 中显式标注**。**精读必须包含数据归因与逻辑一致性核查**（扣非净利润归因拆解、核心指标波动归因、8 项数据逻辑勾稽），凡有结论必有证据（原文出处 + 外部来源 URL/时点）。**精读同步产出多空论证（Bull Case / Bear Case）**：基于同一套原文证据完成多空双视角论证——多方论证增长飞轮/护城河拓宽/财务质量/估值安全边际，空方论证增长见顶/护城河侵蚀/财务红旗/估值过高/产能过剩与地缘风险，双方均须原文引用、区分事实与观点、预判对方论点并回应、诚实记录本方脆弱点（deep-dive 流程强制；/research 标准与深度模式同样执行）。输出结构化认知笔记（含第十章多空论证）→ deep-read 文件
3. **Phase 2** `info-alchemist` — 基于 document-reader 的认知笔记（含多空论证章节），执行结构化提取、口径标准化（按三层归类），识别核心投资指标，区分生意模式数据与周期性数据 → processed 文件
4. **Phase 3** `cross-validator` — 多源比对、置信度评分（1-10）、反共识检验、能力圈评估、管理层诚信检查（按三层逐条评分）→ validated 文件
5. **Phase 4** `knowledge-architect` — 高置信度（≥8 分）信息**按三段式目录**写入知识库，融入护城河/生意模式/历史类比等投资视角 + MOC 更新 + 双链校验
6. **Phase 5** `report-writer` — **必须读取 deep-read 文件（含第十章多空论证）**，Markdown 报告 + **独立 HTML 报告**（直接基于调研结果编写，图表 ECharts CDN 外链），围绕护城河、估值安全边际、反向检查清单展开；**报告必须完成增长驱动与核心优势可持续性分析**（当前是否高增长、增长促成原因、未来增长因素的内因/外因与企业主导性、相对同行的核心优势能否维持，详见 report-writer 定义）；报告核心结论/护城河/风险章节必须呈现多空双方论点及证据强度，**结合产业理解、行业周期、国际形势、政策形势等外围因素做综合裁决**，多空分歧点显式标注并给出裁决理由 → 20-Reports/
7. **Phase 6** 归档 — 中间产物移入 `04-Archive/`，frontmatter 加 `archived_at` + `report_link`

阶段验收不通过 → 向子任务补充上下文要求修正，不跳过、不糊弄。

### 流程模式路由

编排器根据研究类型自动选择流程模式（可通过 `--mode` 显式指定）：

| 模式 | 触发条件 | 差异 |
|------|---------|------|
| **标准模式** `standard` | 全新主题首次覆盖（默认） | 全量串行，含 Phase 1.5 原文精读 |
| **快速模式** `fast` | 已有覆盖且时间 < 90 天 | Phase 1→1.5→3 精简为单轮采集+精读+验证，Phase 4 增量更新，Phase 5 简版报告 |
| **深度模式** `deep` | 重大投资决策前（`--decision-critical`） | 标准 + 强制四大师评估 + 强制财报精读（document-reader 9大目标全量覆盖） + 回溯 3 年历史数据 |
| **增量模式** `incremental` | 补充特定公司/赛道（`--company-only` / `--sector-only`） | 仅 Phase 1（定向搜索）→ Phase 1.5（定向精读）→ Phase 4（追加写入），复用已有验证文件 |

路由决策：
```
if 主题在知识库中已有覆盖且时间 < 90 天:
    路由到「快速模式」
elif 主题标记为「重大决策」或用户显式指定 --deep:
    路由到「深度模式」
elif 用户指定 --company-only 或 --sector-only:
    路由到「增量模式」
else:
    路由到「标准模式」
```

### 弹性降级机制

当某个阶段阻塞或失败时，不是无限重试，而是有策略地降级：

| 故障场景 | 降级策略 | 质量影响 |
|---------|---------|---------|
| Phase 1 某来源抓取失败 | 标记为「来源缺失」，降低该事实置信度上限至 6，继续流程 | 可控 |
| Phase 3 发现关键数据矛盾无法调和 | 在 validated 文件中显式标注「关键分歧」，Phase 5 报告中列为核心风险，不阻塞发布 | 透明 |
| 同花顺 API 不可用 | `.trae/scripts/stock-data/stock.ts` 自动降级到巨潮资讯 + 东财研报，财务数据章节标记「数据源降级」 | 可控 |
| Phase 4 公司数据不足 | 触发「微采集」：自动调用 InfoHunter 对缺口公司进行 3-5 源快速补充，再入库 | 几乎无损 |

### 阶段内并行化

在保持阶段间串行验收的前提下，阶段内部引入并行：

- **Phase 1（InfoHunter）**：行业级/细分级/公司级三层采集并行执行，按层级汇总后统一输出 raw 文件
- **Phase 1.5（DocumentReader）**：各公司财报/研报/公告原文精读 + 多空论证并行执行，按公司输出 deep-read 文件（含第十章多空论证）
- **Phase 4（KnowledgeArchitect）**：行业概览/细分行业/公司研究三个段落的写入并行，最后统一更新 MOC 和反向链接
- **Phase 5（ReportWriter）**：Markdown 报告与 HTML 报告并行编写（两者只是呈现形式不同，数据源一致）

## 常用指令

| 指令 | 用途 | 可选参数 |
|------|------|---------|
| `/research [主题]` | 完整投研流程 | `--mode standard/fast/deep/incremental` `--decision-critical` `--company-only` `--sector-only` |
| `/search [查询]` | 仅 Phase 1 | — |
| `/validate [文件]` | 仅 Phase 3 | — |
| `/report [主题]` | 基于已有知识生成报告 | — |
| `/revise [报告] [意见]` | 修订报告 | — |
| `/sync-links` | 修复断链与缺失 properties | — |
| `/update-moc` | 更新 MOC 索引 | — |
| `/quality-report [月份]` | 生成质量趋势报告 | `--month YYYY-MM` |
| `/screen` | A 股全市场初筛（脚本为主，0 token；结果见 valuation-tracker「全市场初筛」页） | `--report YYYY-N` `--min-mcap` `--only a\|b\|c` `--codes` `--smoke` |
| `/process-optimize [review|ingest|batch|apply|verify]` | 流程复盘、方法论摄取与改进批次治理 | `--task-id` `--input` `--batch-id` `--approved-by` `--targets` |

## 全局 Review 契约

所有正式命令结束时都必须进入 `succeeded`、`failed` 或 `partial` 终态，并在终态后触发一次全局 Review；不得在执行中间态触发。

- **taskId**：正式命令启动时生成并贯穿输入、产物、日志、Review 与改进候选；重试沿用原 taskId 并增加 attempt，不得用主题名或时间戳替代。
- **输入**：Review 至少接收 `taskId`、命令名、参数、输入文件清单、终态、各阶段验收结果与错误摘要；不得读取未声明的工作区文件扩张审阅范围。
- **产物**：Review 写入 `Research/00-Workspace/06-Process-Improvement/reviews/<taskId>.json` 及同名 `.md` 投影；候选汇总仅通过 backlog 状态脚本更新。
- **防递归**：Review 与 `/process-optimize` 任务统一设置 `origin=process-improvement`；该 origin、Review 写入、批次生成、应用和验证均不得再次触发全局 Review。
- **失败隔离**：Review 失败只记录 `review_status=failed` 与错误摘要，不得改变原正式命令终态、删除原产物或阻塞其交付；原命令失败时 Review 仍可独立运行。
- **边界**：常规 Review 只写 `06-Process-Improvement/`；只有用户明确批准可识别批次后，才能修改正式 Agent、Command、Skill、脚本、模板或本文件。

## Skills 触发映射

| 场景 | Skill |
|------|-------|
| 搜索/调研（含信源导航与抓取脚本） | `research-web-search` |
| 结构化提取 | `research-data-extraction` |
| 事实核查/置信度 | `research-cross-validation` |
| 市场情绪分析 | `research-sentiment-analysis` |
| 报告生成/ECharts 可视化/HTML 构建 | `research-report-generator` |
| 知识库文件操作/双链/三段式目录 | `obsidian-vault-manager` |
| MOC/孤立节点/断链 | `obsidian-note-synthesizer` |
| 四大师投资框架评估（护城河/生意模式/反向检查清单/历史类比） | `research-investment-framework` |
| 财报精读与深度分析（杜邦分析/盈利质量/同业对比） | `research-financial-analysis` |
| 质量门禁/阶段验收/KQI 追踪/流程路由 | `research-quality-gate` |
| 任务终态 Review/方法论摄取/改进批次治理 | `research-process-optimization` |

## 可用能力（Skills + 脚本）

各 Agent 在需要时自行加载对应 Skills，并调用其中的 bun 脚本。**Agent 描述中不再硬编码脚本路径**：Skill 内脚本的用法在运行时查看 Skill 目录；跨 Skill 的共享脚本用法统一见下方「共享脚本用法」章节。

| Skill | 用途 | 主要能力 |
|------|------|--------|
| `research-web-search` | 搜索/调研/信源抓取 | URL 正文提取（r.jina.ai + readability）、PDF 解析、证券数据查询（巨潮 / 东财）、关键词搜索 |
| `research-data-extraction` | 结构化提取 | 数据清洗、指标提取、口径标准化 |
| `research-cross-validation` | 事实核查/置信度 | 多源比对、置信度评分、反共识检验 |
| `research-sentiment-analysis` | 市场情绪分析 | 情感极性、共识偏离度 |
| `research-report-generator` | 报告生成/HTML 构建 | ECharts 可视化、HTML 模板 |
| `obsidian-vault-manager` | 知识库文件操作 | 三段式目录管理、双链、properties |
| `obsidian-note-synthesizer` | MOC/孤立节点/断链 | 索引更新、链接校验 |
| `research-quality-gate` | 质量门禁/KQI 追踪 | 阶段间验收评分卡、质量指标记录、流程模式路由、质量回溯 |
| `research-process-optimization` | 流程 Review 与改进治理 | 终态任务复盘、证据分级、方法论摄取、改进 backlog、审批应用与验证 |

## 共享脚本用法（Agent / Skill 统一引用）

> 共享脚本与具体 Skill 解耦，**所有 Agent / Skill / Command 提示词一律不内嵌其使用说明**，需要调用时统一查阅本表：

| 脚本 | 用途 | 用法 |
|------|------|------|
| `.trae/scripts/stock-data/stock.ts` | 证券代码 → 公告 / 券商研报 / 定期报告（年报、半年报、季报）PDF | `bun run .trae/scripts/stock-data/stock.ts --name <公司名>` 名称→代码（可追加下方操作参数，自动匹配首个结果）；`--code <代码>` 直接按代码查询。<br>操作参数：`--announcements` 公告（默认近 90 天）、`--reports` 券商研报、`--financial` 定期报告 PDF。可选：`--category yjyg\|yjbb\|ndbg\|bndbg\|yjdbg\|sjdbg\|zqbg` 过滤公告类别（yjyg 业绩预告、yjbb 业绩快报、ndbg 年报、bndbg 半年报、yjdbg 一季报、sjdbg 三季报、zqbg 债券公告；`--financial` 自动覆盖 年报/半年报/一季报/三季报 四类）、`--days N` 调整时间范围 |
| `.trae/scripts/file-ingestion/fetch-file.ts` | 下载 PDF / 处理本地文件并提取为 Markdown（保留表格，@firecrawl/pdf-inspector） | `bun run .trae/scripts/file-ingestion/fetch-file.ts <pdf-url> --pdf-markdown --output "Research/00-Workspace/02-Processing/pdf-texts/<公司名>/" [--name "<可读标题>"]`（支持本地文件路径；远程 PDF 成功转换后自动清理）。**命名规范**：下载财报等正式文档时**必须传 `--name`** 指定可读标题（如 `--name "2025年年度报告"`、`--name "2026年半年度报告"`），禁止用源文件名（如 `1225002214`）落盘；`--name` 优先于 PDF 内嵌标题与源文件名，且不得包含路径分隔符。若漏传 `--name`，脚本回退顺序为：PDF 内嵌标题 → HTTP Content-Disposition → 源文件名 |
| `.trae/scripts/evaluation/evaluate.ts` | 四大师评估 + 财报精读 10 项检查表 + 估值快照（PE/PB/PS/PCF）+ **品种路由（7 类主估值模型）与 PEG 判读** | `bun run .trae/scripts/evaluation/evaluate.ts --code <代码> [--peer <同行代码>]`（财务数据由公共 API 库 hithink.ts 提供）。可选 `--type financial\|cyclical\|resource\|conglomerate\|growth\|general\|lossmaking`（金融/周期/资源/控股集团须显式指定，其余可自动判定）→ 输出《估值方法路由》表（各品种主模型：金融→PB、周期→正常化EPS、资源→储量折现、集团→SOTP、高成长→**PEG + Forward PE**、一般工商→PE/EV-EBITDA、亏损→PB/PS+反转）；`--forward-growth 0.25` 显式给预测期增速（PEG 优先用此值，缺省取单年同比；同比存疑/疑似一次性损益时 PEG 置空须人工用正常化盈利）。frontmatter 建议回填 `valuation_type` + `peg`（与 backfill.ts 口径一致） |
| `.trae/scripts/quality-gate/quality-screen.ts` | 公司质量筛查（7 质量评分 + 8 财务红牌 → 绿/黄/红）+ **成长股估值豁免（PEG 分档）** | `bun run .trae/scripts/quality-gate/quality-screen.ts --mode report --file <公司笔记.md>`（RED 退出码 2）；`--mode auto` 可传 `--roe/--gross-margin/--net-margin/--ocf-to-ni/--debt/--pe-ttm/--revenue-growth/--earnings-growth`；成长股/品种可选 `--type growth` + `--peg 1.2`：命中高成长（净利增速≥25%）或显式 PEG 时估值维度改用 **PEG 分档**（<1→9 / 1-1.5→7 / 1.5-2→5 / >2→3），避免高 PE 机械低分；`--mode report` 从 frontmatter 读 `peg.value`/`valuation_type`（兼容旧笔记无字段不误报）；净利含大额一次性损益时用 `--nonrecurring-net-profit <剔除后净利亿元> --nonrecurring-note "<说明>"` 触发失真警告并下调估值/成长维度 |
| `.trae/scripts/screener/screen.ts` | A 股全市场初筛（三级漏斗：全市场快照硬过滤 → 逐只财务指标 → 分池评分），输出接入 valuation-tracker「全市场初筛」看板 | `bun run .trae/scripts/screener/screen.ts` 全量跑；`--only a\|b\|c` 分阶段；`--report 2025-4 --prev-report 2024-4` 指定报告期；`--min-mcap 10 --exclude-st` 漏斗参数；`--codes <thscode,...>` 定向标定；`--smoke N` 冒烟。产物：`Research/00-Workspace/07-Screener/latest-screener.json`（看板事实源）+ `YYYY-MM-DD-screener.csv` + `-digest.md`；指标 JSONL 缓存断点续跑 |

> 注意：`stock.ts` 只负责公告/研报/财报 PDF 链接，**财务数据（三表/估值/指标）请使用 `evaluate.ts`**（`.trae/scripts/evaluation/evaluate.ts --code <代码> [--peer <同行代码>]`）。`hithink.ts`（`.trae/scripts/hithink/hithink.ts`）为同花顺纯 API 库（无 CLI），供 evaluate.ts 等脚本 import 调用。

## 估值追踪系统（Web 监控终端）

`valuation-tracker/` — 已调研公司的市值监控与数据看板，用于判断股价是否跌到安全边际。

- **架构**：Next.js 15（纯 UI/SSR，无 route handler）+ Elysia 后端（`server/`，全部 API 与数据层）。启动 `cd valuation-tracker && bun run dev`（Web:3000 / API:3001）。
- **数据流**：Markdown 笔记为唯一事实源（请求时解析 frontmatter + 60s 缓存）；数据库只存动态状态（价格快照、基本面检测缓存）。**综合评分不人工给出**，由六维评分经 `.trae/scripts/valuation/composite.ts` 权重加权现算，改权重一处全局生效（前后端共用同一文件）。
- **部署数据**：`bun run build` 自动执行 `sync-data`（`scripts/build-research-db.ts`），把调研文档 gzip 压缩入库为单文件 `research-data/research.db`（约原始 28%）；Git 集成部署时构建环境存在 `../Research`，云端现场重建并打包进函数，本地无需预生成；CLI 从 `valuation-tracker/` 目录上传时构建环境无 `../Research`，需本地先跑 `bun run sync-data` 再上传。配置 `TURSO_URL` 时 build 同时同步同一批数据到 Turso（云上无打包库时 doc-store 自动降级读取，探测链：FS → 打包 DB → Turso）。dev/自托管仍直读 `../Research/`（改笔记即时生效）。
- **维护**：`bun run snapshot` 批量快照行情入库；`bun run build` 自动执行 `sync-data:remote`（生成 research.db + 同步 Turso，配置 `TURSO_URL` 时）；新增公司调研后自动出现（Markdown 解析），回填存量笔记用 `bun run .trae/scripts/valuation/backfill.ts`。
- **结构化字段**（公司笔记 frontmatter，backfill 生成）：`scores`（六维 0-10 分）/ `target_market_cap_yi`（悲观/合理/乐观，亿元）/ `forward_pe`（含 factors/directions）/ `research_cutoff`（财报期+公告截止日，用于判断基本面是否需更新）。
- **API**：`/api/companies`（列表+行情+安全边际分档）、`/api/companies/:thscode`（详情+笔记全文）、`/api/kline/:thscode`、`/api/fundamentals/:thscode`（巨潮检测，`?refresh=1` 强制刷新）、`/api/quotes`（轮询）。
- **部署**：前端可一键部署到 Vercel（设置 `API_BASE_URL` 指向自托管 Elysia）；后端自托管（`bun run server`，bun:sqlite）或 Elysia Serverless + Turso（`.env` 配 `TURSO_URL`）。

## 与 ai-berkshire 开源框架的融合（2026 Q1 增强版）

**灵感来源仓库**：https://github.com/xbtlin/ai-berkshire （7-phase 投研多 Agent 工作流 + 5 套核心 Skills）
**融入原则**：保留本系统「四大师框架 + 三段式知识 + 六阶段串行验收」的主干，**选择性吸收** ai-berkshire 的 4 项投研专项能力（质量筛查/财报精读/投资检查清单/多视角并行），不破坏现有流程。

### 融入点速查（按六阶段顺序）

| 阶段 | 融入模块 | 新增/修改物 | 触发时机 |
|------|---------|------------|----------|
| **Phase 1 InfoHunter** | earnings-report 财报抓取 + quality-screen 初筛前置 | 增强 `.trae/scripts/stock-data/stock.ts --financial` + `bun run .trae/scripts/file-ingestion/fetch-file.ts <pdf-url> --pdf-markdown --output --name "<可读标题>"` 自动拉取**最近 3 个完整财年年报**（上市不足 3 年则覆盖全部历史年报；报告缺失则说明替代方案）+ 最近 1 期中报/季报（如有），提取完整 Markdown 以可读标题保存为 `.md` 到 `Research/00-Workspace/02-Processing/pdf-texts/<公司名>/`（**必须传 `--name` 指定可读标题，禁止用源文件名**，如 `--name "2025年年度报告"`），远程 PDF 成功转换后清理；文本提取后 Agent 须带着问题清单精读原文 | 每次公司级采集必跑 |
| **Phase 2 InfoAlchemist** | investment-research 的结构化指标提取 | 在核心指标提取清单中**强制包含** quality-screen 8 项指标（ROE/毛利率/净利率/OCF-NI/负债率/PE/营收增长/净利增长），确保下游可跑自动评分 | 由 self-check 脚本强制校验不缺字段 |
| **Phase 3 CrossValidator** | investment-checklist 的 No-Go 条款注入 | 置信度评分时将 quality-screen 的 RED 级红牌直接降一档（若触发 No-Go 条款，单条事实置信度最高不得 ≥8） | 每条公司级事实评分时 |
| **Phase 4 KnowledgeArchitect** | **quality-screen**（7 质量 + 8 财务） + **earnings-review 10 项精读** | 写入 `02-公司研究/` 前，**必须调用 `quality-screen.ts --file` 生成《质量筛查报告》段落** + 使用 `evaluate.ts` 生成的 10 项财报精读检查表，两者一并嵌入公司笔记 | 每家公司节点必跑，红牌 ≥2 时不得标注为「值得跟踪」等级 |
| **Phase 5 ReportWriter** | **50-item investment-checklist** + 多视角并行 | 报告附录**必须包含**《50 项投资决策清单 AUTO 扫描块》（`investment-checklist-auto.ts` 输出）+ 《质量筛查汇总》；HTML 设计风格锁死见 `design.md`（不是 ai-berkshire 风格，是本系统自研暗黑专业风） | 每份最终报告必附 |
| **Phase 6 归档/复盘** | investment-checklist 的复盘触发 | 归档时保存 quality-screen 总分 + 投资清单结果至 frontmatter，供 30/90 天 KQI 回溯对比（如"当时 CRITICAL ❌ 项是否事后应验"） | KQI-tracker 已读 frontmatter 字段 |

### ai-berkshire 原始技能 → 本系统映射表

| ai-berkshire 原 Skill | 主要理念 | 本系统落地位置 |
|----------------------|---------|--------------|
| `investment-research`（7 phase 多 Agent 并行） | 多视角并行分析：价值/成长/宏观/竞争/风险/估值/定性 七人团 | **未全量照搬**（本系统六阶段串行 + 验收更严）→ 仅吸收「并行化」理念：Phase 4 知识入库允许行业/细分/公司并行，Phase 5 报告中核心结论要求列出多视角正反两方论点 |
| `quality-screen`（7-quality + 8-financial filters） | 8 项财务红牌筛查 + 加权 7 项质量评分 = 绿/黄/红结论 | **完全落地**：`.trae/scripts/quality-gate/quality-screen.ts`，Phase 4 入库门禁 + 模板段落嵌入 |
| `earnings-review`（10-point 精读 + ROIC/WACC 回报） | 10 项财报必查（ROE/现金流/负债/审计意见/MD&A 等）+ 回报周期框架 | **完全落地**：`.trae/scripts/evaluation/evaluate.ts` 新增 Section《财报精读 10 项检查清单》，缺项由 Agent 从 PDF MD&A 手动补齐 |
| `investment-checklist`（50+ 检查项，分 CRITICAL/IMPORTANT/NORMAL） | 50 项分三级检查，CRITICAL > 1 项不发布，No-Go 条款一票否决 | **完全落地**：<br>• 模板：`Research/99-Templates/50-item-investment-checklist.md`<br>• Auto 脚本：`.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts`<br>• Phase 5 附录必附 AUTO 扫描块 |
| `financial-data`（fundamental + 估值数据拉取） | 结构化数据优先，次选 SEC/EDGAR | 与本系统 `hithink-finance` Skill 合并，同花顺 + 巨潮 + 东财三源取并 |

### 流程触发新增的关键脚本

> 以下 bun 脚本在编排器验收阶段、Agent 自检阶段**可以直接调用**，不再需要子 Agent 写代码：
>
> ```bash
> # 1. Phase 4 公司级质量筛查
> bun run .trae/scripts/quality-gate/quality-screen.ts --file "Research/10-Knowledge/XX-行业/02-公司研究/公司名-公司研究.md"
> # （退出码 2 = RED，需编排器判断是否降级处理）
>
> # 2. Phase 5 报告投资清单 AUTO 扫描
> bun run .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts \
>    "Research/20-Reports/2026-01-01-主题-report.md" \
>    "Research/10-Knowledge/XX-行业/02-公司研究/XXXX-公司研究.md"
> # （退出码 2 = 触发 No-Go，1 = CRITICAL 未通过>1）
>
> # 3. Phase 2 核心指标提取 + Phase 4 评估 + 10 项精读
> bun run .trae/scripts/evaluation/evaluate.ts --code 600519 --peer 000858
> # （输出 Markdown 中包含 10 项财报精读检查表 + 四大师星级评分建议 + 估值快照）
> ```

## 质量检查体系

### 第一层：阶段内自检（Agent 自治）

每个 Agent 在提交产出前，执行内置的 `self-check.ts` 脚本自动检查：

| Agent | 自检脚本 | 检查重点 |
|-------|---------|---------|
| InfoHunter | `.trae/agent/info-hunter.md.self-check.ts` | 三层结构完整性、来源充分性（关键论点有来源支撑）、URL 锚点、四大师视角搜索、研究偏见校验 |
| DocumentReader | `.trae/agent/document-reader.md.self-check.ts` | 9大精读目标覆盖率 + 三年年报覆盖（最近 3 个完整财年）、基本面趋势判断、三年连贯性、管理层诚实红线标注、原文引用完整性、支持/反对证据记录、矛盾标注、红旗信号检查、扣非归因/指标波动归因/逻辑一致性检查、**多空论证完整性**（第十章 Bull/Bear Top 论点、五维度对照、预判回应、脆弱点） |
| InfoAlchemist | `.trae/agent/info-alchemist.md.self-check.ts` | 关键事实清单、核心投资指标提取、生意模式数据区分、标准化说明 |
| CrossValidator | `.trae/agent/cross-validator.md.self-check.ts` | 置信度评分覆盖率、能力圈评估、管理层诚信检查、反共识检验 |
| KnowledgeArchitect | `.trae/agent/knowledge-architect.md.self-check.ts` | properties 完整性、三段式目录、双链双向、护城河/生意模式/跟踪指标 |
| ReportWriter | `.trae/agent/report-writer.md.self-check.ts` | 报告结构、HTML 图表、投资建议措辞、四大师框架覆盖、增长驱动与核心优势可持续性分析、多空论证综合裁决（读 deep-read 第十章） |

自检不通过 → Agent 自动修正后重新提交；紧急场景可 `--skip-check`（需记录理由）。

### 第二层：阶段间验收（编排器把关）

编排器在触发下一阶段前，调用 `research-quality-gate` Skill 的评分卡进行验收：

```bash
bun run .trae/skills/research-quality-gate/scripts/quality-scorecard.ts \
  --phase <1|3|5> --file <产出文件路径> --mode <standard|deep|fast>
```

评分维度（每项 0-10）：
- **完整性**：结构是否完整、必填项是否齐全
- **准确性**：数据矛盾是否处理、来源是否可回溯
- **投资视角**：四大师框架是否体现（护城河/生意模式/反向检查清单/历史类比）

评分标准：
- 总分 < 24 → ❌ 拒绝通过，要求修正
- 24-28 → ⚠️ 有条件通过，标注风险提示
- 28-30 → ✅ 完全通过

### 第三层：发布后复盘（系统级）

报告交付后触发质量回溯：

| 时间点 | 复盘内容 | 执行方式 |
|--------|---------|---------|
| 7 天 | 检查用户是否提出事实性质疑 | 人工审查 + 问题记录 |
| 30 天 | 对比期间事件与报告风险提示的吻合度 | 评估反向检查清单有效性 |
| 90 天 | 对比核心预测与实际财报/行业数据 | 计算预测准确度，更新 KQI |

```bash
bun run .trae/skills/research-quality-gate/scripts/kqi-tracker.ts \
  --backtrack --report <report-path> --days 30
```

## 交付质量检查（编排器验收标准）

### 基础质量
- [ ] 每个关键事实可追溯到 URL 来源
- [ ] 数据带单位与时点
- [ ] 置信度 <7 的结论在报告中显式标注「存疑」
- [ ] 知识节点 properties 完整（`type` 必填，关联字段用 `[[双链]]`）
- [ ] **知识节点三段式目录齐全**（00-行业概览 / 01-细分行业 / 02-公司研究 均有产出）
- [ ] 公司笔记 → 关联行业/细分行业；行业笔记 → 关联公司/细分行业
- [ ] 报告输出 md + html 双份（HTML 独立编写、图表 ECharts CDN）
- [ ] 日期均来自真实系统时间
- [ ] **Phase 1.5 deep-read 文件已产出**（每家公司一份，含9大精读目标、原文引用、红旗信号）
- [ ] **deep-read 含 4.2 扣非归因拆解**：归母 vs 扣非差额拆解到具体非经常性损益项 + 持续性判断
- [ ] **deep-read 含 4.3 指标波动归因 + 4.8 逻辑一致性检查**：归因附外部证据（来源+时点）或显式标注证据不足；逻辑断裂点已追因
- [ ] **三年年报精读已覆盖**：最近 3 个完整财年年报均已精读（上市不足 3 年覆盖全部历史年报），deep-read 含「基本面趋势（逐年变好？）/ 三年连贯性 / 管理层诚实」结论；**三年连贯性断裂或管理层不诚实已按红线显式标注**
- [ ] **deep-read 含第十章多空论证**（每家公司：10.1 多方 Top3-5 + 10.2 空方 Top3-5 + 10.3 五维度对照 + 10.4 对对方论点预判回应 + 10.5 双方脆弱点，各含原文引用、事实/观点分离、强度/置信度分级）——deep-dive / research 标准与深度模式必检
- [ ] **报告已读取并综合 deep-read 多空论证**：核心结论/护城河/风险章节呈现多空双方论点及证据强度，多空分歧点显式标注并给出结合产业/周期/国际/政策外围因素的裁决理由
- [ ] **报告已覆盖增长驱动与核心优势可持续性分析**：判断企业是否处于高增长阶段、当前增长促成原因、未来增长因素的内因/外因与企业主导性；识别企业相对同行的核心优势维度（按企业实际突出的指标）与量化差距、优势成因、维持/被侵蚀风险与独特壁垒
- [ ] **pdf-texts 中间产物目录已建立**（`Research/00-Workspace/02-Processing/pdf-texts/<公司名>/`），每家公司声明的 `.md` 文件实际存在且 frontmatter 含 `source`、`pdf_title`、`page_count`、`parse_confidence`、OCR/编码状态；**三年年报的 `.md` 文件齐全**

### 投资哲学质量（四大师框架）
- [ ] **能力圈**：报告中是否明确标注了哪些公司/行业「超出能力圈」或「理解有限」？
- [ ] **护城河**：公司笔记是否回答了「护城河是什么？有多宽？能否持续 10 年？」
- [ ] **生意模式**：是否清晰描述了目标公司「怎么赚钱、谁付钱、为什么选它」？
- [ ] **本分/诚信**：是否检查了管理层诚信记录？有问题的是否已标注或排除？
- [ ] **安全边际**：报告是否给出了估值区间判断和安全边际条件？
- [ ] **反向检查清单**：报告是否包含「什么情况下我们会错」的章节？
- [ ] **历史类比**：行业概览是否提供了海外/历史类比，帮助判断时间框架？
- [ ] **跟踪指标**：是否为每家公司设定了 3-5 个核心跟踪指标？

### 关键质量指标（KQI）

每次研究完成后自动记录（`research-quality-gate/scripts/kqi-tracker.ts --record`）：

| KQI | 目标值 | 说明 |
|-----|--------|------|
| 来源覆盖率 | >90% | 关键事实有 ≥2 独立来源的比例 |
| 高置信度占比 | >70% | 评分 ≥8 的事实占比 |
| 四大师覆盖率 | 100% | 公司节点包含护城河/生意模式/反向检查清单/历史类比的比例 |
| 返工率 | <15% | 因质量不通过而回退的阶段占比 |
| 知识复用率 | >50% | 新研究引用已有知识节点的比例 |

月度质量趋势报告输出位置：`Research/00-Workspace/05-Metrics/YYYY-MM-质量趋势报告.md`
