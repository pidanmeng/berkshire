# Review：deep-dive 中石科技（20260817-cd4f）

- **taskId**: `deep-dive-中石科技-20260817-cd4f`
- **命令**: deep-dive 中石科技
- **终态**: succeeded（全新公司研究，无增量对比；document-reader 精读无 No-Go 红线；quality-screen YELLOW 6.5/10；知识节点+报告+附录全交付）
- **origin**: process-improvement（不递归触发全局 Review）

## 各阶段验收结果

| 步骤 | 结果 | 备注 |
|------|------|------|
| 1 检查已有研究 | ✅ | 无已有笔记，全新研究 |
| 2 数据采集 | ⚠️ | 3 年年报+2025 中报 PDF 提取成功（parse_confidence=1）；研报 2 篇（均看多）；evaluate.ts 同比字段口径错误（见问题 1） |
| 3 document-reader 精读 | ✅ | 9 大目标+多空论证完成；三年连贯、管理层诚实 🟢，未触发 No-Go 红线 |
| 4 info-alchemist+quality-screen | ⚠️ | processed self-check 9/10；quality-screen 正确结论 YELLOW 6.5/10（首次 auto 运行因同比误值触发一次性损益误报，纠正后通过） |
| 5 增量对比 | ➖ | 全新研究，跳过 |
| 6 知识库写入 | ✅ | 中石科技-公司研究.md + 电子-MOC 更新 |
| 7 报告 | ✅ | deep-dive-report.md 完成，附录 5 项齐备（AUTO 扫描 2 项误报经核验纠正） |

## 问题清单（按证据分级）

### candidate（A/B 级证据）
| 问题码 | 目标 | 严重度 | 摘要 |
|--------|------|:------:|------|
| `evaluate-yoy-metric-misparse` | `.trae/scripts/evaluation/evaluate.ts` | high | 同比字段输出 1713.73%/6811.97% vs 年报 +17.14%/+68.12%，并误导 quality-screen 触发一次性损益误报 |
| `checklist-auto-threshold-text-misread` | `.trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts` | medium | #28『短期借款』关键词误判债务风险（实际有息负债 660 万）；#15 阈值文本『<30%』误作实际商誉占比（实际 0.37%）；与生益科技 review 同型，跨任务复现 |

### observing（C 级证据，待跨任务复现）
| 问题码 | 目标 | 严重度 | 摘要 |
|--------|------|:------:|------|
| `deep-dive-bear-report-coverage-gap` | deep-dive 步骤 2.4 研报采集 | medium | 近 365 天仅 2 篇研报均看多，空方外部佐证缺失，Bear Case 依赖自建 |
| `document-reader-selfcheck-missing` | `.trae/agents/document-reader.md` | low | document-reader 无同名 .self-check.ts，deep-read 产出缺乏自动化验收 |

## 去向
- 候选汇总已通过 backlog 状态脚本更新：`bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts upsert-review --review <review-json>`
- 本 Review 只写 `06-Process-Improvement/`，不修改任何正式 Agent/Command/Skill/脚本/模板/AGENTS.md
