# 批次 20260816-batch-002 修复计划（修复前审视 + 实施 + 验证）

> 批次 ID：`20260816-batch-002` · 状态：`approved`（2026-08-16 全部批准）
> 来源：`/process-optimize`（origin=process-improvement，不触发全局 Review）
> 本计划在执行任何代码/文档修改前生成，符合「修复前审视所有 issue → 判断流程能否解决 → 不能则改流程 → 生成计划 → 实施 → 存量数据验证」。

## 一、6 个候选的审视结论与流程适用性

| 序 | 问题码 | 根因（本次审视确认） | 当前流程能否解决 | 处理方式 |
|---|---|---|---|---|
| 1 | `evaluate-yoy-data-anomaly` | hithink API 同比字段口径异常（放大百倍），evaluate.ts 无合理性校验直接透传，Forward PE 用异常同比递推 | 能（脚本层） | 修改 `evaluate.ts`：同比合理性校验 + 存疑标注 + Forward PE 禁用异常递推 |
| 2 | `evaluate-oneshot-income-distortion` | 一次性 BD 收入计入经常性损益，PE-TTM/PEG 直接使用失真 TTM 净利给出『便宜/有吸引力』 | 能（脚本层） | 修改 `evaluate.ts`：一次性损益检测 + 警告 + PE 评价词失真化 |
| 3 | `quality-screen-oneshot-greening` | quality-screen 基于单期报表评分，无一次性损益修正通道，license-out 首付款致 GREEN 高分绕过入库门禁 | 能（脚本层） | 修改 `quality-screen.ts`：`--nonrecurring-net-profit` 输入 + frontmatter 读取 + 失真警告与降分 |
| 4 | `stock-category-filter-ineffective` | **实测确认**：巨潮 API 对 `category_yjyg_szsh`/`category_yjbb_szsh` 编码静默忽略（返回全量 259 条），仅 `ndbg`/`bndbg`/`yjdbg` 编码生效（6/6/3 条） | 能（脚本层） | 修改 `stock.ts`：对不受 API 支持的类别做客户端标题过滤兜底 |
| 5 | `task-subagent-type-unavailable` | 当前环境 Task 工具仅接受 `search`/`general_purpose_task`，AGENTS.md/命令仍按专用 subagent_type 编写触发路径 | **不能（脚本无法解决，环境限制）** | **修改流程**：AGENTS.md 补充统一子 Agent 触发契约（general_purpose_task + 自读 `.trae/agents/*.md`） |
| 6 | `subagent-type-mapping-for-research-agents` | deep-dive 命令未说明投研子 Agent 在 Task 工具下的启动方式，执行者每次自行摸索 | **不能（文档缺失）** | **修改流程**：deep-dive.md（及 research 命令如有同型说明）补充子 Agent 启动方式 |

**结论**：候选 1-4 属脚本缺陷，当前流程可通过脚本修复解决，无需改动流程；候选 5-6 属环境/文档契约问题，脚本无法解决，**必须修改流程文档**（AGENTS.md + deep-dive.md），属本批次正式批准的流程变更。

## 二、实施步骤（严格按依赖顺序）

### 步骤 A：保存快照与差异基线
- 对 5 个目标文件（`evaluate.ts` / `quality-screen.ts` / `stock.ts` / `AGENTS.md` / `deep-dive.md`）复制快照到 `batch-runs/20260816-batch-002/snapshots/`；
- `git diff` 记录基线（现仅 backlog 与批次文件已变更，目标文件干净）。

### 步骤 B：候选 1+2 → `evaluate.ts`（先行，确立判定逻辑）
1. `generateFramework()` 中新增同比合理性校验：
   - `suspiciousYoy` = `|yoy_operating_income| > 5` 或 `|yoy_net_profit| > 5`（即 >500%）；
   - 命中时：核心财务指标速览中同比列输出「⚠️ 数据存疑（>500%），以年报为准」；`forwardGrowth` 缺省不再取 `ind.yoy_net_profit`（置 null，Forward PE 输出「—」并标注原因），仅 `--forward-growth` 显式传入时递推。
2. 一次性损益检测（与候选 3 共用阈值口径）：
   - `oneshotHit` = `yoy_net_profit > 3`（>300%）或（净利率 ≥ 上年净利率 × 2 且 `opts.forwardGrowth` 为负）；
   - 命中时：PE-TTM 评价行追加「⚠️ 净利可能含大额一次性收入（BD/license-out/资产处置），PE-TTM 失真，请用正常化盈利」；PEG 行追加同警示。
3. 输出结构、CLI 参数、其余计算不变。

### 步骤 C：候选 3 → `quality-screen.ts`
1. `CompanyMetrics` 增加可选 `nonrecurringNetProfit?: NumOpt`（剔除一次性损益后归母净利，亿元）与 `nonrecurringNote?: string`；
2. CLI 新增 `--nonrecurring-net-profit` / `--nonrecurring-note`；report 模式从 frontmatter 读取 `financials.nonrecurring_net_profit`；
3. `screenCompany` 中：当 `nonrecurringNetProfit` 与当期净利均可得且 `(净利润 - nonrecurring) / 净利润 > 0.30`（非经常性占比 >30%）时：
   - 输出红色警告「⚠️ 净利含大额一次性损益（占比 X%），自动化评分失真，须结合剔除一次性后主业盈利判断」；
   - `valuation` 与 `growth` 维度各 -3 分（clamp 下限 0），并计入 `verdictText` 附注；
4. 无该输入时行为与现状完全一致（兼容性）。

### 步骤 D：候选 4 → `stock.ts`
1. `queryAnnouncements` 增加客户端标题过滤兜底：`CATEGORY_MAP` 保留服务端编码；新增 `TITLE_FILTER: Record<string, RegExp>`（`yjyg` → `/业绩预[告增减]|预增|预减/`，`yjbb` → `/业绩(?:快报|报表)/` 等）；
2. 对已知不受 API 支持的类别（yjyg/yjbb，经实测）在 `items` 返回后按标题正则过滤；标题带 em 标签时先去除 HTML 标签；
3. `total` 同步返回过滤后条数；未指定类别行为不变。

### 步骤 E：候选 5+6 → `AGENTS.md` + `.trae/commands/deep-dive.md`
1. `AGENTS.md` 「系统架构速览」区补充**子 Agent 触发契约**：当前环境 Task 工具仅接受 `search`/`general_purpose_task`；投研专用角色以 `general_purpose_task` 启动，子 Agent 自行 Read `.trae/agents/*.md` 定义；环境开放自定义 subagent_type 后恢复直调。
2. `deep-dive.md` Step 3 触发方式补充同上说明（general_purpose_task + 内嵌角色定义路径）。
3. 不改变命令流程步骤、采集要求、精读目标。

## 三、专项测试

| 候选 | 测试文件 | 用例 |
|---|---|---|
| 1+2 | `.trae/scripts/evaluation/__tests__/evaluate.test.ts` | ① `yoy_net_profit=91.95`（9195%）→ 速览标存疑、Forward PE 为「—」且 `--forward-growth` 显式传入仍递推 ② `yoy_net_profit=3.11`（311%）→ 一次性损益警告出现、PE 评价含失真提示 ③ 正常 `yoy=0.20` → 无警告 |
| 3 | `.trae/scripts/quality-gate/__tests__/quality-screen.test.ts` | ① `nonrecurringNetProfit` 使非经常占比 >30% → 警告 + 估值/成长降分 ② 无一次性输入 → 评分不变 ③ frontmatter `financials.nonrecurring_net_profit` 读取 |
| 4 | `.trae/scripts/stock-data/__tests__/stock.test.ts`（新建） | ① `applyTitleFilter` 对 yjyg 标题过滤（含 em 标签剥离）② 非目标标题剔除 ③ 无类别过滤时原样返回 |

## 四、全量测试 / 类型检查 / 路径检查

- 专项测试：`bun test .trae/scripts/evaluation/__tests__/evaluate.test.ts`、`bun test .trae/scripts/quality-gate/__tests__/quality-screen.test.ts`、`bun test .trae/scripts/stock-data/__tests__/stock.test.ts`；
- 全量测试：`bun test`（项目根）；
- 类型检查：`bunx tsc --noEmit`（记录既有阻塞，见批次 001 verification）；
- 路径检查：grep AGENTS.md / 命令 / agents / skills 对 5 目标文件的引用，确认改动兼容。

## 五、存量数据验证（用户要求）

| 场景 | 命令 | 期望 |
|---|---|---|
| evaluate 同比存疑 | `bun run .trae/scripts/evaluation/evaluate.ts --code 688049` | 同比不再输出 4 位数异常倍数（标注存疑或回退口径） |
| evaluate 一次性损益 | `bun run .trae/scripts/evaluation/evaluate.ts --code 688336` | 出现一次性损益警告；'便宜' 评价不再单独出现 |
| quality-screen 一次性 | `bun run .trae/scripts/quality-gate/quality-screen.ts --mode report --file "Research/10-Knowledge/05-医药生物/02-公司研究/三生国健-公司研究.md" --nonrecurring-net-profit <剔除后值>` | 输出一次性损益失真警告，估值/成长降分 |
| quality-screen 回归 | `--mode report --file "Research/10-Knowledge/04-电子/02-公司研究/风华高科-公司研究.md"` | 结论不变（RED），与批次 001 修复后一致 |
| stock 类别过滤 | `bun run .trae/scripts/stock-data/stock.ts --code 603444 --announcements --category yjyg --days 900` | 返回结果全部为业绩预告类 |

> 注：存量验证需依赖同花顺 API 与网络；API 不可用时验证降级为测试用例覆盖并记录。

## 六、回滚

- 修改前快照在 `batch-runs/20260816-batch-002/snapshots/`；
- 应用后校验实际 diff 文件集合 ⊆ 批准集合（evaluate.ts / quality-screen.ts / stock.ts / AGENTS.md / deep-dive.md + 各自测试）；越界立即回滚；
- 任一强制验证失败：恢复快照 → 记录 `apply_failed` → 生成失败 verification。

## 七、排除项

同批次文档第九节：`api-yoy-calculation-error`、`evaluate-ttm-yoy-anomaly` 等单 taskId observing 项由本批次修复设计自然覆盖或留待后续；不扩大本批次文件范围。
