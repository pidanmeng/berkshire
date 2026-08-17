---
name: research-quality-gate
description: 当需要执行阶段间质量验收、记录质量指标、生成质量报告时使用。触发词：质量验收、质量门禁、评分卡、KQI、质量检查、验收标准。为编排器提供统一的质量评估框架。
---

# 质量门禁 Skill

## 能力范围

统一投研流程中的质量评估与度量：

- **阶段间验收评分卡**：编排器在各 Phase 结束后执行标准化验收
- **KQI 记录与追踪**：记录关键质量指标，生成趋势报告
- **质量回溯**：报告发布后 7/30/90 天的质量复盘
- **流程模式路由**：根据研究类型推荐合适的流程模式

## 使用方式

### 1. 阶段间验收评分卡

编排器在触发下一阶段前，调用评分卡对上阶段产出进行打分：

```bash
bun run .trae/skills/research-quality-gate/scripts/quality-scorecard.ts \
  --phase 1 \
  --file Research/00-Workspace/01-Inbox/YYYY-MM-DD-主题-raw.md \
  --mode standard
```

评分维度：
- **完整性** (0-10)：结构是否完整、必填项是否齐全
- **准确性** (0-10)：数据矛盾是否处理、来源是否可回溯
- **投资视角** (0-10)：四大师框架是否体现（护城河/生意模式/反向检查清单/历史类比）

评分标准：
- 总分 < 24 → 拒绝通过，要求修正
- 24-28 → 有条件通过，标注风险提示
- 28-30 → 完全通过

### 2. KQI 记录

每次研究完成后，自动记录关键质量指标：

```bash
bun run .trae/skills/research-quality-gate/scripts/kqi-tracker.ts \
  --record \
  --topic "新能源-锂电池" \
  --source-coverage 0.92 \
  --high-confidence-ratio 0.75 \
  --four-masters-coverage 1.0 \
  --revision-count 1
```

### 3. 质量回溯

报告发布后定期复盘：

```bash
bun run .trae/skills/research-quality-gate/scripts/kqi-tracker.ts \
  --backtrack \
  --report Research/20-Reports/YYYY-MM-DD-主题-report.md \
  --days 30
```

## 关键质量指标（KQI）定义

| KQI | 定义 | 目标值 | 计算方式 |
|-----|------|--------|---------|
| **来源覆盖率** | 关键事实有 ≥2 独立来源的比例 | >90% | 有≥2来源的事实数 / 总关键事实数 |
| **高置信度占比** | 评分 ≥8 的事实占比 | >70% | ≥8分事实数 / 总评分事实数 |
| **四大师覆盖率** | 公司节点包含护城河/生意模式/反向检查清单/历史类比的比例 | 100% | 符合要求的公司笔记数 / 总公司笔记数 |
| **预测准确度** | 90天后核心预测与实际偏差 | <20% | \|预测值-实际值\| / 实际值 |
| **返工率** | 因质量不通过而回退的阶段占比 | <15% | 回退阶段数 / 总阶段数 |
| **知识复用率** | 新研究引用已有知识节点的比例 | >50% | 引用已有节点的数量 / 总引用节点数 |

## 流程模式路由

质量门禁提供流程模式建议：

```bash
bun run .trae/skills/research-quality-gate/scripts/route-mode.ts \
  --topic "新能源" \
  --last-research "2026-01-15" \
  --decision-critical true
```

| 模式 | 触发条件 | 差异 |
|------|---------|------|
| **标准模式** | 全新主题首次覆盖 | 六阶段全量串行 |
| **快速模式** | 已有覆盖且时间<90天 | Phase 1→3 精简为单轮，Phase 4 增量更新，Phase 5 简版 |
| **深度模式** | 重大决策前 | 标准 + 强制四大师评估 + 强制财报精读 + 回溯3年历史 |
| **增量模式** | 补充特定公司/赛道 | 仅 Phase 1（定向）→ Phase 4（追加） |

## 质量趋势报告

每月自动生成质量趋势报告：

```bash
bun run .trae/skills/research-quality-gate/scripts/kqi-tracker.ts --report --month 2026-01
```

输出位置：`Research/00-Workspace/05-Metrics/YYYY-MM-质量趋势报告.md`
