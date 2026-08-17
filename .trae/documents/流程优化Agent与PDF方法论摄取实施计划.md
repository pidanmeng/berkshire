# 流程优化 Agent 与 PDF 方法论摄取实施计划

## 一、Summary

本次改造为现有投研系统增加一个受审批约束的“流程优化产品经理”闭环，并完成 PDF 摄取能力的公共化与 Markdown 化。

目标状态：

1. 根级 `AGENTS.md` 统一规定：所有正式投研任务在 `success`、`partial`、`failed` 三种终态下都必须触发流程优化 Agent；各 command 不重复声明 Review 步骤。
2. 每次 Review 生成一份标准 PRD Markdown 和一份结构化 JSON，至少包含本次任务全部产物清单、问题证据、优化需求、影响、优先级、验收标准和风险。
3. 所有优化点都写入 backlog，但按证据分为 `observing` 与 `candidate`；只有达到门槛的候选才能进入实施批次，避免单次主观观察直接修改系统。
4. 新增 `/process-optimize`：汇总候选、生成可识别审批批次并停止；用户明确批准某一批次后，才允许修改 `.trae`、`AGENTS.md`、脚本或模板，并执行测试、失败回滚和 verification 记录。
5. 流程优化 Agent 首期支持从 PDF URL 或本地 PDF 提炼方法论；B站字幕、视频下载和 ASR 不纳入本期。
6. 将 `fetch-file.ts` 从 `research-web-search` Skill 内直接迁移到公共文件摄取目录，删除旧实现并全量更新引用。
7. PDF 解析结果改存 Markdown；文件名优先使用 PDF 解析器返回的语义标题，异常时依次回退到显式名称、响应头文件名和来源 basename，并记录回退原因。

## 二、Current State Analysis

### 2.1 任务生命周期

- [research.md](file:///c:/Code/投研/.trae/commands/research.md) 在命令内部显式编排 Phase 1-6，但当前没有通用任务结束 Hook、统一 `taskId` 或终态运行记录。
- 其他正式命令包括 `search`、`validate`、`report`、`revise`、`sync-links`、`update-moc`、`deep-dive`；它们没有统一 Review 收尾机制。
- 根级 [AGENTS.md](file:///c:/Code/投研/AGENTS.md) 会作为全局上下文注入，适合承载所有正式命令共同遵守的 Review 规则。
- 流程优化任务必须设置 `origin=process-improvement` 并排除自动 Review，否则会形成递归复盘。

### 2.2 优化治理

- 当前只有 [TODO.md](file:///c:/Code/投研/TODO.md) 和既有 [投研系统优化计划.md](file:///c:/Code/投研/.trae/documents/投研系统优化计划.md) 记录优化意图，缺少结构化 backlog、稳定指纹、证据门槛、审批批次、应用验证和回滚记录。
- 当前 `research-quality-gate` 主要检查投资研究产物质量，不负责流程变更治理。
- 工作区内尚无本地 `process-optimizer` Agent、`research-process-optimization` Skill 或 `/process-optimize` 命令。

### 2.3 PDF 摄取

- 当前实现位于 [fetch-file.ts](file:///c:/Code/投研/.trae/skills/research-web-search/scripts/fetch-file.ts)，只支持 URL，先下载 PDF，再使用 `@firecrawl/pdf-inspector` 解析。
- 解析器已经返回 Markdown 和 `title`，但脚本忽略 `title`，并把内容写成继承原 URL 文件名的 `.txt`。
- 当前 PDF 调用和 `.txt` 契约散布于 [info-hunter.md](file:///c:/Code/投研/.trae/agents/info-hunter.md)、[document-reader.md](file:///c:/Code/投研/.trae/agents/document-reader.md)、[research.md](file:///c:/Code/投研/.trae/commands/research.md)、[deep-dive.md](file:///c:/Code/投研/.trae/commands/deep-dive.md)、[research-web-search/SKILL.md](file:///c:/Code/投研/.trae/skills/research-web-search/SKILL.md) 和 [fetch-source.ts](file:///c:/Code/投研/.trae/skills/research-web-search/scripts/fetch-source.ts)。
- `@firecrawl/pdf-inspector` 只安装在 `.trae/package.json`，公共摄取 CLI 仍运行于 `.trae` 范围，因此可继续复用该依赖，无需新增解析库。

### 2.4 规范漂移

- 实际实现位于 `.trae`，但 `AGENTS.md` 和部分 Agent/Skill 文档仍引用 `.trae`。本次涉及到的引用必须一并改为 `.trae`，否则新闭环会调用错误路径。
- 本次不顺带重构全部投研业务逻辑、公司节点命名或报告模板；只修复与新增流程优化、PDF 公共摄取直接相关的路径引用。

## 三、Proposed Changes

### 3.1 建立全局任务 Review 契约

#### 修改 `AGENTS.md`

新增“所有正式投研任务的流程 Review”全局章节，作为单一事实源：

- 正式任务范围：`.trae/commands` 下的 `research`、`search`、`validate`、`report`、`revise`、`sync-links`、`update-moc`、`deep-dive`，以及后续新增的正式投研命令。
- 触发终态：`success`、`partial`、`failed`；彻底失败时也必须记录已创建产物、失败证据和未完成项。
- 每次任务开始时建立稳定 `taskId`，建议格式为 `YYYYMMDD-HHmmss-<command>-<短随机标识>`；同一任务的阶段重试沿用同一 `taskId`。
- 任务结束时向 `process-optimizer` 传递：命令、参数、终态、开始/结束时间、产物路径、阶段结果、自检与质量门禁结果、失败/返工/人工介入信息。
- `origin=process-improvement` 的 Review、方法论摄取、批次生成、批次应用和验证任务禁止再次触发一般 Review。
- Review 阶段只允许写入 `Research/00-Workspace/06-Process-Improvement/`；未经明确批次批准，不得修改 Agent、Command、Skill、脚本、`AGENTS.md`、研究模板和正式知识节点。
- Review 失败不得覆盖原投研任务终态；主任务对用户正常交付，同时明确记录 `review_status=failed`，供后续补做。
- 将本次触及的 `.trae/...` 示例路径统一为 `.trae/...`。
- 在命令清单中登记 `/deep-dive` 和新增 `/process-optimize`；`/process-optimize` 标记为流程治理命令，不纳入一般任务自动 Review。

不在每个 command 文件中重复增加 Review 调用，避免规则漂移。

### 3.2 新增流程优化 Agent

#### 新建 `.trae/agents/process-optimizer.md`

Agent 定位为“克制迭代的投研系统产品经理”，包含三种明确模式：

1. `review-task`
   - 审阅任务运行证据和全部产物。
   - 输出标准 PRD Review Markdown 与结构化 JSON。
   - 将所有优化点写入 backlog；有证据但未达门槛的进入 `observing`，达到门槛的进入 `candidate`。
   - 无直接证据的建议必须标记为假设，不得直接进入可实施批次。

2. `ingest-pdf-methodology`
   - 接收 PDF URL 或本地 PDF 路径。
   - 调用公共 PDF 摄取 CLI 生成语义命名 Markdown。
   - 区分原作者观点、可验证事实、适用前提、失效边界、与当前流程冲突、可吸收机制和不建议吸收内容。
   - 通过兼容性矩阵判断应落到哪个 Command、Agent、Skill 或脚本。
   - 只生成方法论卡和 backlog 项，不直接修改投研系统。

3. `optimize-batch`
   - 生成批次时：读取 candidate、去重排序、产出逐文件改动、依赖、兼容性、测试、回滚和排除项，然后停止等待批准。
   - 应用时：只接受可识别且已明确批准的批次；实际修改范围不得超过批次文件。
   - 验证失败时执行批次回滚并标记 `apply_failed`，不得标记 `verified`。

Agent 的 Review 维度固定为：需求理解、输入输出契约、证据质量、返工与人工介入、提示词遵循度、脚本稳定性、规范漂移、门禁有效性、成本与过度工程风险。

#### 新建 `.trae/agents/process-optimizer.md.self-check.ts`

校验 Agent 产物是否满足：

- PRD 必备章节齐全。
- 产物清单包含路径、类型、状态和存在性。
- 每个优化点包含症状、证据、根因假设、目标、严重度、置信度、收益、风险、验收方法。
- 未批准阶段没有修改受保护路径。
- `origin=process-improvement` 已设置。
- Review JSON 可解析且状态枚举合法。

#### 新建 `.trae/agents/__tests__/process-optimizer.md.self-check.test.ts`

覆盖完整 PRD、缺失证据、缺失产物清单、非法状态、未批准越权修改声明等情况。

### 3.3 新增流程优化 Skill 与状态脚本

#### 新建 `.trae/skills/research-process-optimization/SKILL.md`

固化以下规则：

- 写入边界和审批边界。
- A/B/C/D 证据等级。
- critical/high 单次强证据、medium/low 跨任务复现的 candidate 门槛。
- 所有优化点都进入 backlog，但分为 `observing` 和 `candidate`。
- 稳定指纹：`targetKind + canonicalTargetPath + normalizedProblemCode`。
- 状态机：`observing → candidate → proposed → approved/rejected → applied → verified`，失败为 `apply_failed`。
- 批次排序、PDF 方法论兼容性矩阵、验证与回滚规则、防递归规则。

#### 新建 `.trae/skills/research-process-optimization/scripts/improvement-backlog.ts`

提供可测试的结构化状态管理，而不是让 Agent 自由改 JSON：

- `upsert-review`：读取 Review JSON，按稳定指纹新增或合并证据、taskId、出现次数和最高严重度。
- `build-batch`：只选择 `candidate`，更新为 `proposed`，输出批次数据供 Agent 生成 PRD。
- `record-decision`：记录批准、部分批准或拒绝；部分批准必须生成独立子批次。
- `record-verification`：只有强制验证全部通过才转为 `verified`，失败则为 `apply_failed`。
- 所有写入采用临时文件后原子替换，避免 backlog 中断损坏。
- 对路径做 canonicalize 和工作区边界校验，不允许把秘密、环境变量或 Authorization 内容写入证据。

#### 新建 `.trae/skills/research-process-optimization/scripts/__tests__/improvement-backlog.test.ts`

覆盖：

- 指纹稳定性和跨任务去重。
- 单任务重复证据只计一次。
- observing/candidate 门槛。
- 部分批准拆分子批次。
- 未批准不能 applied。
- 验证失败不能 verified。
- 越权路径与敏感字段拒绝。
- 原子写入失败时保留旧 backlog。

### 3.4 定义流程优化产物

首次运行时由状态脚本按需创建以下目录和状态文件，不预先生成空的日期产物：

```text
Research/00-Workspace/06-Process-Improvement/
├── reviews/YYYY-MM-DD/<task-id>-review.md
├── reviews/YYYY-MM-DD/<task-id>-review.json
├── methodologies/YYYY-MM-DD/<source-id>-methodology.md
├── methodologies/YYYY-MM-DD/<source-id>-source.md
├── batches/YYYY-MM-DD-optimization-batch-<n>.md
├── decisions/YYYY-MM-DD-batch-<n>-decision.md
├── verifications/YYYY-MM-DD-batch-<n>-verification.md
├── improvement-backlog.json
└── improvement-backlog.md
```

Review Markdown 采用标准 PRD 结构：

1. 文档元信息与任务终态
2. 执行摘要
3. 任务目标、范围与成功标准
4. 本次任务全部产物清单
5. 用户/系统影响
6. 问题与证据
7. 优化需求清单
8. 非目标与明确排除项
9. 验收标准
10. 风险、兼容性与回滚考虑
11. 优先级与推荐状态

Review JSON 与 Markdown 同源，至少包含：`schemaVersion`、`taskId`、`origin`、`command`、`status`、时间、`artifacts[]`、`issues[]`、`reviewStatus`。每个 issue 包含稳定机器码和完整证据字段。

`improvement-backlog.md` 是 JSON 的可读投影视图，不作为状态真源。

### 3.5 新增统一迭代命令

#### 新建 `.trae/commands/process-optimize.md`

定义两个严格阶段：

1. 默认“生成批次”
   - 读取 backlog 中的 candidate。
   - 去重、排序并生成 `batches/YYYY-MM-DD-optimization-batch-<n>.md`。
   - 批次必须列出候选、证据、逐文件修改、依赖顺序、兼容性、测试、回滚、排除项。
   - 生成后立即停止，不做任何正式修改。

2. “应用已批准批次”
   - 用户必须明确指出批次文件并批准全部或指定候选。
   - 部分批准先生成子批次和 decision，再应用。
   - 修改前记录目标文件快照/差异基线；修改后校验实际文件集合没有越界。
   - 运行批次测试、全量 Bun 测试、TypeScript 检查、路径引用检查。
   - 全部通过后生成 verification 并标记 verified；失败则按回滚清单恢复，记录 apply_failed。

### 3.6 公共化 PDF 文件摄取

#### 新建 `.trae/scripts/file-ingestion/fetch-file.ts`

从现有 Skill 目录直接迁移实现，并重构为“可导入函数 + CLI 入口”：

- 输入支持 HTTP(S) URL 和本地 PDF 路径。
- 规范 CLI：

```text
bun run .trae/scripts/file-ingestion/fetch-file.ts <url-or-local-path> --pdf-markdown --output <dir> [--name <fallback-name>]
```

- 远程输入下载到按任务创建的临时目录；本地输入直接读取，绝不删除用户原文件。
- 使用 PDF 魔数和响应 `Content-Type` 双重校验，拒绝伪 PDF。
- 使用 `processPdf` 的 `markdown` 作为正文，输出 `.md`。
- 文件名优先级固定为：
  1. 有效的 `result.title`
  2. `--name` 显式名称
  3. `Content-Disposition` 文件名
  4. URL 或本地来源 basename
  5. `document`
- PDF title 若为空、纯编号、过短、泛化为 `untitled/document`、包含明显乱码或清洗后为空，则视为无效并回退；在 frontmatter 记录 `filename_source` 和 `title_fallback_reason`。
- Windows 文件名清洗：移除保留字符和尾部点/空格、折叠空白、限制长度、处理保留设备名。
- 同名冲突使用确定性的来源短哈希后缀，不静默覆盖已有不同来源文件。
- Markdown frontmatter 至少记录：来源 URL 或本地路径标识、原始文件名、PDF title、最终名称来源、页数、PDF 类型、解析置信度、表格页、OCR 页、编码问题、抓取时间和来源哈希。
- 正文保持解析器 Markdown，不再包成 TXT。
- 远程 PDF 在成功产出 Markdown 后删除临时文件；解析失败或需要 OCR 时将远程 PDF 移入输出目录的失败保留位置并返回非零退出码。本地 PDF 始终保持原位。
- 下载、解析、写入和清理使用明确退出码；参数缺失、路径穿越、输出目录非法时提前失败。

#### 删除旧文件

- 删除 `.trae/skills/research-web-search/scripts/fetch-file.ts`。
- 不保留包装器或复制实现，防止形成双份逻辑。

#### 新建 `.trae/scripts/file-ingestion/__tests__/fetch-file.test.ts`

通过导出函数和本地夹具测试，不依赖真实网络：

- URL 与本地路径输入解析。
- title 优先和四级回退。
- 纯数字/乱码/泛化 title 判无效。
- Windows 文件名清洗与同名哈希冲突。
- 输出 `.md` 和 frontmatter 字段。
- 表格页、OCR 页、编码异常持久化。
- 成功时清理远程临时 PDF。
- 失败时保留远程 PDF、本地 PDF 永不删除。
- 非 PDF、参数缺失、路径穿越和写入失败。

### 3.7 全量更新 PDF 契约与引用

修改以下文件，将旧 Skill 内路径、`--pdf-text` 和 `.txt` 全部改为公共路径、`--pdf-markdown` 和 `.md`：

- `.trae/skills/research-web-search/SKILL.md`
- `.trae/skills/research-web-search/scripts/fetch-source.ts`
- `.trae/agents/info-hunter.md`
- `.trae/agents/document-reader.md`
- `.trae/agents/info-hunter.md.self-check.ts`
- `.trae/commands/research.md`
- `.trae/commands/deep-dive.md`
- `AGENTS.md`

具体契约：

```text
Research/00-Workspace/02-Processing/pdf-texts/<公司名>/*.md
```

同时：

- `fetch-source.ts` 输出完整公共 CLI 路径，不再输出依赖当前工作目录的裸命令。
- InfoHunter 交接改为财报 Markdown 清单。
- DocumentReader 输入说明改为 Markdown 原文，并要求使用 frontmatter 中的 PDF title、source、page_count 和解析质量信息。
- InfoHunter 自检不再只匹配“fetch-file.ts/财报原文”等关键词；改为检查声明的公司目录中是否实际存在 `.md`，并识别 OCR/编码异常状态。
- `research.md` 和 `deep-dive.md` 的验收描述同步改为 `.md`。

### 3.8 PDF 方法论摄取流程

流程优化 Agent 接到 PDF 方法论请求时执行：

1. 校验 URL 或本地路径。
2. 调用公共摄取 CLI，输出到：
   `Research/00-Workspace/06-Process-Improvement/methodologies/YYYY-MM-DD/`。
3. 保留原文 Markdown 为 `<source-id>-source.md`。
4. 生成 `<source-id>-methodology.md`，结构固定为：
   - 来源与解析质量
   - 原作者核心观点
   - 可验证事实与证据定位
   - 方法论步骤
   - 适用前提与失效边界
   - 与当前六阶段流程/三层结构/四大师框架的兼容性
   - 可吸收机制及目标文件
   - 不建议吸收内容
   - 最小验证方案
   - backlog 建议状态
5. 方法论中的所有建议写入 backlog；普通观点默认为 observing，只有满足证据门槛的项才为 candidate。
6. 停止，不直接修改 Agent、提示词或脚本。

本期明确排除：B站 URL、字幕抓取、音视频下载、ASR、说话人识别。

## 四、Assumptions & Decisions

1. 全局 Review 依赖 `AGENTS.md` 的强制上下文，不新增底层 Hook；这是当前平台能力下的首期实现。
2. 不在每个 command 中复制 Review 指令；命令只遵守根级全局规则。
3. 所有正式投研任务的成功、部分完成、失败终态都 Review；流程优化来源通过 `origin` 防递归。
4. 每次 Review 必须同时有 PRD Markdown 和结构化 JSON。
5. 所有优化建议都进入 backlog；`observing` 与 `candidate` 分层保留，只有 candidate 可进入批次。
6. `/process-optimize` 首期实现完整审批、应用、验证和失败回滚闭环。
7. 未识别到明确批准批次时，系统只允许写 `06-Process-Improvement`，不得修改正式配置和研究资产。
8. PDF 首期支持 URL 与本地路径；B站和 ASR 延后。
9. PDF 解析器 title 始终优先，但无效时允许回退并记录原因；`--name` 是 title 不可用时的 fallback，不覆盖有效 title。
10. 成功转换后只删除远程下载的临时 PDF；用户提供的本地 PDF 永不删除。
11. PDF 输出统一为 Markdown，现有历史 `.txt` 不批量迁移；DocumentReader 在过渡期可只读兼容旧 `.txt`，但新任务必须产出 `.md`。
12. 旧 `fetch-file.ts` 直接删除，不保留包装器；仓库内全部引用一次性更新。
13. 本次只公共化文件摄取 CLI，不把所有 Skill 脚本迁到公共目录，也不提前抽取大规模 shared 工具库。
14. 不顺带修改既有投资研究结论、知识节点内容或未直接相关的 TODO 项。

## 五、Verification

### 5.1 静态与契约检查

1. 搜索 `.trae` 与 `AGENTS.md`，确认不再引用旧的 Skill 内 `fetch-file.ts` 路径。
2. 搜索 `--pdf-text`、财报 `*.txt` 和“保存为 .txt”，确认正式新流程均已改为 `--pdf-markdown`/`.md`；仅允许迁移说明或显式历史兼容代码保留旧词。
3. 检查所有新增 Agent、Skill、Command frontmatter 和路径符合现有 `.trae` 约定。
4. 检查 `AGENTS.md` 的正式命令清单、Review 范围和防递归规则一致。
5. 检查批次应用器的允许修改文件集合与实际 diff 集合比较逻辑。

### 5.2 单元测试

运行：

```powershell
bun test
```

至少通过：

- `process-optimizer.md.self-check.test.ts`
- `improvement-backlog.test.ts`
- `fetch-file.test.ts`
- 现有 `report-writer`、`quality-screen`、`investment-checklist-auto`、`evaluate` 测试

### 5.3 类型检查

运行：

```powershell
bunx tsc --noEmit
```

如根级 TypeScript 检查受既有非本次问题阻塞，则记录完整错误，并对新增/修改的 TypeScript 文件执行可定位的最小类型检查；不得把新增错误标记为通过。

### 5.4 PDF 验收场景

使用不含敏感信息的本地测试夹具和可控响应验证：

1. 有语义 title 的 PDF 输出 `<语义标题>.md`。
2. title 为纯数字时按回退链命名，并在 frontmatter 记录原因。
3. Markdown 正文保留表格结构。
4. 输出 frontmatter 含来源、标题、页数、置信度、OCR/编码状态和哈希。
5. 远程临时 PDF 成功后删除；解析失败时保留；本地 PDF 在所有情况下都不删除。
6. 同名不同来源不会覆盖，使用稳定短哈希区分。

### 5.5 Review 闭环验收场景

1. 模拟一个成功任务：生成配对 Review MD/JSON，产物清单完整。
2. 模拟一个 partial 任务：记录已完成产物、未完成项和降级原因。
3. 模拟一个 failed 任务：Review 失败不改变原任务失败终态。
4. 同一问题跨任务出现：backlog 按指纹合并证据与 taskId。
5. 单次中低风险观察：进入 observing，不进入批次。
6. 达到门槛：转 candidate，可由 `/process-optimize` 生成 proposed 批次。
7. 未批准批次：尝试修改 `.trae` 被拒绝。
8. 部分批准：生成独立子批次，只修改获批候选。
9. 验证失败：执行回滚，状态为 apply_failed，不生成虚假 verified。
10. `origin=process-improvement`：流程优化任务结束后不再次触发 Review。

### 5.6 最终人工验收

- Review Markdown 符合标准 PRD，而不是泛泛总结。
- “本次任务所有产物清单”和“需要优化的点”均为强制且可追溯章节。
- PDF 方法论卡明确区分原作者观点与本系统可验证改进，避免因作者权威直接修改流程。
- 任意正式流程变更都能追溯到：Review/方法论卡 → backlog 候选 → 批次 → decision → verification。
