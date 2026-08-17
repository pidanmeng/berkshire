# 计划：引入 PEG 估值方式 + 分品种估值模型路由（/process-optimize）

> 命令：`/plan /process-optimize 引入 PEG估值方式，对不同的品种采用不同的估值模型`
> origin=process-improvement，不触发递归 Review；终态按 succeeded / failed / partial 结束。

## 一、目标与治理

- **业务目标**：在当前「单一 PE 估值」为主的体系上引入 **PEG**，并建立「**品种 → 主估值模型**」路由，使不同品种（金融/周期/资源/集团/高成长/一般工商/亏损）各用与其价值创造机制匹配的模型，统一落到 evaluate.ts、quality-screen.ts、公司笔记 frontmatter/backfill 与 valuation-tracker 全链路。
- **治理方式**：严格走 `/process-optimize` 默认流程：登记候选（`upsert-review`）→ `build-batch` 生成批次 → **AskUserQuestion 审批**（全部/部分/拒绝）→ 应用 → 验证。未获批准前不改任何正式脚本/模板/知识资产。
- **状态真源**：`Research/00-Workspace/06-Process-Improvement/improvement-backlog.json`；所有持久化写入必须经 `improvement-backlog.ts`，禁止手改。

## 二、现状分析（已勘察）

| 组件 | 现状 | 缺口 |
|---|---|---|
| `.trae/scripts/evaluation/evaluate.ts` | 已有 PE/PB/PS/PCF 快照；静态「估值方法路由」表（金融→PB、周期→正常化EPS、资源→储量折现、控股集团→SOTP、一般工商→PE）；PEG = PE-TTM ÷ 单年净利同比（L385），已带 `suspiciousYoy`/`oneshotIncome` 守卫；`--type` 手动指定企业类型 | 路由表静态、不含高成长/亏损；PEG 用单年同比易被一次性损益/周期扭曲；估值快照未按品种给主估值锚 |
| `.trae/scripts/quality-gate/quality-screen.ts` | 估值维度按 PE 绝对值区间评分（L262：PE>50→2 分）；PE>40 黄牌已带 `hasHighGrowth` 豁免（L133-139） | 估值维度评分无 PEG/增速豁免 → 高 PE 高增长成长股系统性低分（backlog 已有候选 `quality-screen-growth-valuation-bias`，status=candidate，low/2 任务） |
| `Research/99-Templates/company-template.md` | frontmatter 含 `scores`/`target_market_cap_yi`/`forward_pe`/`research_cutoff`/`financials` | 无品种（valuation_type）与 peg 字段 |
| `.trae/scripts/valuation/backfill.ts` | 从笔记/同花顺推导并回填 `scores`/`target_market_cap_yi`/`forward_pe`/`financials` | 无 peg / valuation_type 回填逻辑 |
| `valuation-tracker/server/lib/research.ts` | 解析 `forwardPe`/`targetMarketCapYi`/`financials` | 未解析 peg / valuation_type |
| `valuation-tracker/lib/api.ts` / `components/CompanyDashboard.tsx` / `components/CompareTable.tsx` | 详情页展示 Forward PE（CompanyDashboard L406-473）、对比表 Forward PE 列（CompareTable L118） | 无 PEG / 品种展示 |

**既有候选将一并入批**：`quality-screen-growth-valuation-bias`（candidate）天然属于本主题；`deep-dive-bear-research-collection-gap`、`deep-dive-no-cross-validator`、`evaluate-nonrecurring-warning-false-positive` 同为 candidate，`build-batch` 会自动汇总入同一批次（在审批对话框按需勾选即可）。

## 三、设计方案

### 3.1 品种分类与估值模型路由表（evaluate.ts）

沿用 evaluate.ts 现有企业类型体系并扩展，形成统一路由表（导出为 `VALUATION_ROUTING` 常量，单一事实源）：

| 品种（type） | 判定信号 | 主估值模型 | 关键警示 |
|---|---|---|---|
| `financial` 金融 | `--type financial`（银行/保险/券商） | PB / 调整后净资产 | 勿用 PE 硬套 |
| `cyclical` 周期 | `--type cyclical`（钢铁/化工/航运/大宗） | 正常化 EPS（5-10 年平均）+ PB 辅助 | 繁荣期 PE-TTM 系统性低估 |
| `resource` 资源 | `--type resource`（矿/油气） | 储量 ×（价格−成本）按开采时间表折现 | 终值假设不适用 |
| `conglomerate` 控股集团 | `--type conglomerate` | SOTP 分部估值 | 承认多元化折扣 |
| `growth` 高成长 | 自动判定：净利增速 ≥25%（forward 或单年）且 PE-TTM>30 | **PEG + Forward PE** | PEG 须用预测期增速，防一次性损益 |
| `general` 一般工商 | 自动判定：盈利为正且增速 <25%（默认） | PE / EV/EBITDA + 股息率辅助 | 反向检验倍数隐含增长 |
| `lossmaking` 亏损 | 自动判定：EPS<0 | PB / PS + 反转路径 | 不适用 PEG/PE |

- `--type` 接受上述 7 值；未传时自动判定提示（EPS<0→lossmaking；否则增速/PE 信号→growth；其余 general；金融/周期/资源/集团因脚本无法判行业，需显式 `--type`）。
- 估值快照与三情景目标价指引按品种显示主估值锚（PEG / PE / PB / 正常化PS）。

### 3.2 PEG 计算口径（evaluate.ts）

```ts
// 增速来源优先级：显式 --forward-growth > 单年净利同比（回退，受 suspiciousYoy/oneshotIncome 保护）
const pegGrowth = forwardGrowth ?? (suspiciousYoy || oneshotIncome ? null : ind?.yoy_net_profit ?? null);
const peg = (peTtm > 0 && pegGrowth != null && pegGrowth > 0 && !suspiciousYoy)
  ? peTtm / (pegGrowth * 100)
  : null;
```

- PEG 判读：<0.8 有吸引力 / 0.8-1.5 基本匹配 / 1.5-2 偏高 / >2 显著偏贵；`suspiciousYoy` 或 `oneshotIncome` 时 PEG 置空并显式标注「需用正常化盈利/显式 --forward-growth」。
- 输出位置：估值与股价快照新增 PEG 行；「倍数隐含假设反推」表沿用统一口径；growth 品种三情景目标价指引默认 PEG 校验。

### 3.3 quality-screen.ts（成长股估值豁免，吸收既有候选）

- 新增可选 `--type`（valuation_type）与 `--peg`。
- 估值维度评分（L262-271）：命中高成长（`earningsGrowth≥25%`）或 `--peg<1.5` 时不再机械低分，改按 PEG 分档（PEG<1→9 / 1-1.5→7 / 1.5-2→5 / >2→3），与既有 PE>40 黄牌 `hasHighGrowth` 豁免（L138）口径一致。
- 报告输出注明「估值模型（按品种）」。达成既有候选 `quality-screen-growth-valuation-bias` 的 acceptance（高 PE 高增长股估值维度不再机械 0-2 分）。

### 3.4 公司笔记模板 + backfill（frontmatter 字段）

`company-template.md` 新增（紧邻 `forward_pe` 之后）：

```yaml
valuation_type: ""            # 品种：financial/cyclical/resource/conglomerate/growth/general/lossmaking
peg:                          # PEG = 当前价对应 PE ÷ 预测期增速(%)
  value: 0.0                 # PEG 值（1 位小数）
  growth_basis: ""           # 增速口径：forward（预测期）/ yoy（单年同比）
  base_period: "2027E"       # 盈利基准期（与 forward_pe.base_period 对齐）
```

`backfill.ts`：
- 解析并回填 `valuation_type`（默认 `general`；`financials.net_profit_yoy≥25` 提示 growth）。
- 回填 `peg`：仅当 frontmatter 已含 `forward_pe.value` 与 `base_net_profit_yi`、且 `financials.net_profit_yi` 可用时，隐含增速 = `base_net_profit_yi/net_profit_yi − 1`，`peg = forward_pe.value ÷ (隐含增速×100)`；增速 ≤0 或无数据时跳过（留人工维护）。
- `peg`/`valuation_type` 加入 `skipExistingKeys`（人工维护优先，防 YAML 重复键覆盖），与 `forward_pe` 一致。

### 3.5 valuation-tracker（数据链路 + 展示）

- `server/lib/research.ts`：`CompanyNote` 增加 `valuationType`、`peg` 字段并解析（与 `forwardPe` 同模式）。
- `lib/api.ts`：`CompanyItem` 增加对应类型。
- `components/CompanyDashboard.tsx`：Forward PE 区块旁展示「品种」标签 + PEG 值及判读（沿用现有 Tailwind 工具类，禁止自定义 CSS 类）。
- `components/CompareTable.tsx`：**不新增列**（避免展示面过度扩散）。

## 四、逐文件修改清单与依赖顺序

| 序 | 文件 | 修改内容 | 依赖 |
|---|---|---|---|
| 1 | `.trae/scripts/evaluation/evaluate.ts` | 路由表常量 + `--type` 7 值 + PEG 口径升级 + 快照/指引输出 | — |
| 2 | `.trae/scripts/quality-gate/quality-screen.ts` | 成长股/PEG 估值豁免（吸收既有候选） | 1（口径一致，可并行） |
| 3 | `Research/99-Templates/company-template.md` | 新增 `valuation_type`/`peg` 字段说明 | 1（字段定义） |
| 4 | `.trae/scripts/valuation/backfill.ts` | 解析/回填 `valuation_type`/`peg` | 3 |
| 5 | `valuation-tracker/server/lib/research.ts` | 解析新字段 | 3/4 |
| 6 | `valuation-tracker/lib/api.ts` | 类型 | 5 |
| 7 | `valuation-tracker/components/CompanyDashboard.tsx` | 展示品种 + PEG | 5/6 |
| — | `.trae/scripts/evaluation/__tests__/evaluate.test.ts`、`.trae/scripts/quality-gate/__tests__/quality-screen.test.ts`、`.trae/scripts/valuation/__tests__/backfill.test.ts` | 新增用例（见第六节） | 1/2/4 |
| — | `AGENTS.md` | 共享脚本用法表 evaluate.ts / quality-screen.ts 行补充 PEG 口径与 `--type` 说明 | 1/2 |

实施顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 文档/测试。

## 五、/process-optimize 治理执行步骤

1. **构造 review JSON**：`Research/00-Workspace/06-Process-Improvement/reviews/<taskId>.json`
   - taskId：`process-optimize-peg-valuation-20260817-<4位suffix>`；origin=process-improvement；command=`/process-optimize`。
   - issues 按「改动单元」登记候选，**每个将修改的文件都有对应候选 targetPath**（保证 `build-batch` 的 allowedPaths 覆盖全部 diff 文件），每条证据为 A 级「用户 2026-08-17 明确反馈引入 PEG 与分品种估值」、severity=high → 满足候选门槛（high+A/B）：
     - `valuation-routing-by-type` → `.trae/scripts/evaluation/evaluate.ts`
     - `peg-exemption-quality-screen`（复用既有 `quality-screen-growth-valuation-bias` problemCode，追加 A 级证据合并）→ `.trae/scripts/quality-gate/quality-screen.ts`
     - `peg-fields-template` → `Research/99-Templates/company-template.md`
     - `peg-fields-backfill` → `.trae/scripts/valuation/backfill.ts`
     - `peg-tracker-server-parse` → `valuation-tracker/server/lib/research.ts`
     - `peg-tracker-frontend-types` → `valuation-tracker/lib/api.ts`
     - `peg-tracker-frontend-display` → `valuation-tracker/components/CompanyDashboard.tsx`
     - `peg-docs-agents` → `AGENTS.md`
     - 各测试文件随其主文件候选并入 allowedPaths（登记时纳入 targetPath 清单）。
2. `bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts upsert-review --review <json>`。
3. `build-batch` → 生成 `batches/2026-08-17-optimization-batch-005.md`（proposed，自动汇总本批候选 + 既有 3 个无关候选）。
4. **AskUserQuestion 审批**：单选「全部批准 / 部分批准 / 全部拒绝」；选部分批准则多选勾选候选（每问 ≤4 项，候选>4 拆多问，label 用中文描述+问题码，description 标严重度与目标文件）。只收集决定，不在此对话框改文件。
5. 按决定 `record-decision`（approved / partial / rejected），未选中项转 rejected；部分批准生成 `-approved` 子批次。
6. **应用**：修改前快照到 `batch-runs/20260817-batch-005/snapshots/`（含 git diff 基线）→ 按依赖顺序实施 → diff 文件集合 ⊆ allowedPaths（越界立即回滚）。
7. **验证**：专项测试 + `bun test` + `bunx tsc --noEmit` + 路径引用检查；全部通过 → `record-verification` → `verified`；任一强制验证失败 → 按回滚清单恢复 → `apply_failed`。

**阻塞情形**：未明确批准 / 批次不可识别 / 批准范围含糊 / 批次状态非 proposed → 只说明阻塞原因并停止。

## 六、专项测试 / 全量验证

| 候选 | 测试文件 | 新增用例 |
|---|---|---|
| evaluate.ts | `evaluate.test.ts`（扩展） | ①`--type growth` 输出 PEG + Forward PE 主锚 ②PEG 用 `--forward-growth` 优先于单年同比 ③`suspiciousYoy`/`oneshotIncome` 时 PEG 置空并标注 ④7 类路由表完整输出 |
| quality-screen.ts | `quality-screen.test.ts`（扩展） | ①PE>40 且增速≥25% → 估值维度不再 0-2 分 ②`--peg 0.9` → 高估值豁免 ③`--peg 2.5` → 仍低分 ④既有 PE 区间行为不变 |
| backfill.ts | `backfill.test.ts`（扩展） | ①已有 forward_pe+financials → 回填 peg（隐含增速口径）②增速≤0 → 跳过 ③peg/valuation_type 已存在 → 跳过不覆盖 |
| research.ts / 前端 | — | 解析样例笔记 frontmatter，CompanyNote 含 valuationType/peg；`bunx tsc --noEmit` 覆盖 |

- 全量测试：`bun test`（项目根）；类型检查：`bunx tsc --noEmit`；路径检查：检索 AGENTS.md / .trae/commands / .trae/agents / .trae/skills 对 4 个核心文件的引用，确认改动仅为增强、不影响既有引用；确认 evaluate.ts 改动与 backfill.ts、composite.ts、screen.ts 下游兼容。
- 回归样例：`evaluate.ts --code 300502 --type growth`（新易盛，PEG 主锚）；`--code 600519`（贵州茅台，general/PE）；`--code 000001 --type financial`（平安银行，PB）；`quality-screen --mode report --file 新易盛-公司研究.md`（估值维度豁免）。

## 七、回滚

- 快照 + diff 基线先行；diff 越界 → 回滚至快照。
- 任一强制验证失败：恢复快照 → `record-verification` 失败结果 → 批次 `apply_failed`，不改动 backlog 其他项。
- 新字段（valuation_type/peg）为增量，不删除既有字段；回滚即恢复快照即可。

## 八、假设与决策

1. **品种口径**：沿用 evaluate.ts 企业类型体系扩展（7 类），不另建独立风格体系（与现有 `--type` 耦合最小）。用户未澄清「品种」含义，此为最贴合现有架构的默认；如实际指股票风格/行业/资产类别，需先改口径再执行。
2. **落地范围**：全链路（evaluate + quality-screen + 模板/backfill + valuation-tracker），因「对不同的品种采用不同的估值模型」是系统级口径，需链路一致；CompareTable 不新增列以收敛前端面。
3. **PEG 增速**：预测期增速（`--forward-growth` / forward_pe 反推）优先，单年净利同比仅作回退且受一次性损益/异常同比守卫。
4. **治理**：多文件特性按「每改动单元一候选」登记以保证 allowedPaths 覆盖全部 diff；既有 `quality-screen-growth-valuation-bias` 通过复用 problemCode 合并入本主题候选。
5. 若审批时希望缩小范围（如仅 evaluate+quality-screen），用「部分批准」勾选即可，未勾选候选转 rejected，不阻塞已批准项。

## 九、排除项

- `deep-dive-bear-research-collection-gap`、`deep-dive-no-cross-validator`、`evaluate-nonrecurring-warning-false-positive`：既有 candidate，会被 build-batch 自动汇入批次；若用户不批准则随审批决定转 rejected，**不纳入本主题实现范围**。
- 全市场初筛（`screen.ts`）估值维度：不在本批范围，另立候选（观察中）。
- 行业级估值模型（按行业统一口径）：超出本主题，不实施。
