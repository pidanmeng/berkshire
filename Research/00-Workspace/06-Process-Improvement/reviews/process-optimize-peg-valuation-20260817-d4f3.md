# Review: process-optimize-peg-valuation-20260817-d4f3

## 1. 文档元信息与任务终态

| 字段 | 值 |
|---|---|
| taskId | `process-optimize-peg-valuation-20260817-d4f3` |
| attempt | 1（首次） |
| origin | `process-improvement` |
| command | `/process-optimize 引入 PEG估值方式，对不同的品种采用不同的估值模型` |
| 终态 | `success` |
| reviewStatus | `succeeded` |
| 审阅对象 | 引入 PEG 估值方式 + 分品种估值模型路由（evaluate.ts / quality-screen.ts / 模板+backfill / valuation-tracker / AGENTS.md） |

用户 2026-08-17 明确要求引入 PEG 估值方式，并对不同品种采用不同估值模型。本 review 按「每改动单元一候选」登记 8 个 issue（含复用既有 `quality-screen-growth-valuation-bias` 指纹），供 `build-batch` 生成改进批次。

## 2. 执行摘要

现有体系以「单一 PE 估值」为主：evaluate.ts 路由表仅 5 类（缺高成长/亏损）、PEG 用单年同比；quality-screen 估值维度按 PE 绝对值机械评分（成长股系统性低分）；模板/backfill/valuation-tracker 均无品种与 PEG 字段。本 review 登记 8 个 candidate 覆盖全链路：evaluate.ts（路由 7 类 + PEG 口径）、quality-screen.ts（成长股豁免）、模板、backfill、valuation-tracker server/frontend、AGENTS.md。

## 3. 登记候选清单

| 问题码 | 严重度 | 目标文件 | 核心改动 |
|---|---|---|---|
| `valuation-routing-by-type` | high | `.trae/scripts/evaluation/evaluate.ts` | 路由表 7 类 + 自动判定 + PEG 口径升级（forward 优先） |
| `quality-screen-growth-valuation-bias` | low | `.trae/scripts/quality-gate/quality-screen.ts` | 成长股/PEG 估值豁免（复用既有指纹） |
| `peg-fields-template` | high | `Research/99-Templates/company-template.md` | frontmatter 新增 valuation_type/peg |
| `peg-fields-backfill` | high | `.trae/scripts/valuation/backfill.ts` | 解析/回填 valuation_type/peg |
| `peg-tracker-server-parse` | high | `valuation-tracker/server/lib/research.ts` | 解析新字段 |
| `peg-tracker-frontend-types` | high | `valuation-tracker/lib/api.ts` | 类型同步 |
| `peg-tracker-frontend-display` | high | `valuation-tracker/components/CompanyDashboard.tsx` | 展示品种+PEG |
| `peg-docs-agents` | medium | `AGENTS.md` | 文档同步 |

## 4. 非目标与明确排除项

- `deep-dive-bear-research-collection-gap`、`deep-dive-no-cross-validator`、`evaluate-nonrecurring-warning-false-positive` 为既有 candidate，会被 `build-batch` 自动汇入同一批次，是否批准由编排器审批时决定，不纳入本主题实现范围。
- 全市场初筛（screen.ts）估值维度、行业级估值模型：另立候选，不在本批。

## 5. 验收标准

- [x] 8 个 issue 按改动单元登记，targetPath 覆盖全部计划改动文件；
- [x] 既有 `quality-screen-growth-valuation-bias` 复用 problemCode 合并入本主题候选；
- [x] 证据分级（A 级=用户明确需求；C 级=既有运行证据）合规；
- [x] 通过 `improvement-backlog.ts upsert-review` 原子更新 backlog；
- [x] 未修改任何正式脚本/模板/知识资产（仅写 06-Process-Improvement 与 .trae/documents 计划文件）。
