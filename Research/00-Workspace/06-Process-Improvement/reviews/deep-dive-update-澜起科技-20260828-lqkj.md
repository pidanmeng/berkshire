# Review: deep-dive-update 澜起科技（2026 半年报）

- **taskId**: `deep-dive-update-澜起科技-20260828-lqkj`
- **命令**: `/deep-dive-update 澜起科技`（用户提供 2026 半年报 PDF 链接）
- **终态**: ✅ succeeded
- **origin**: process-improvement（不触发递归 Review）

## 输入文件

- 2026 半年报 PDF → `pdf-texts/澜起科技/2026年半年度报告.md`（196 页，parse_confidence=1）
- 基线：`澜起科技-公司研究.md`（2026-08-16）、`2026-08-16-澜起科技-deep-read.md`、bull/bear
- 公告：stock.ts --announcements（近 60 天 20 条）、--reports（20 条）

## 产出（本次实际创建/更新）

| 产物 | 路径 | 状态 |
|------|------|------|
| 增量精读 | `02-Processing/2026-08-28-澜起科技-deep-read-update.md` | ✅ 新建 |
| 基本面更新 | `10-Knowledge/03-半导体/02-公司研究/澜起科技-基本面更新-2026中报.md` | ✅ 新建 |
| 公司笔记更新 | `10-Knowledge/03-半导体/02-公司研究/澜起科技-公司研究.md` | ✅ 更新（frontmatter + 正文） |
| 更新报告 | `20-Reports/2026-08-28-澜起科技-deep-dive-update-report.md` | ✅ 新建 |

## 阶段验收

| 阶段 | 结果 | 说明 |
|------|------|------|
| 前置校验 | ✅ | 已有研究笔记 + 触发事件确认（2026H1 半年报晚于 cutoff 2026-07-17） |
| 基线提取 | ✅ | Forward PE factors/directions + 6 条跟踪指标整理为 12 项待验证问题清单 |
| 定向采集 | ✅ | 用户提供 PDF 转换成功；stock.ts 公告/研报；evaluate.ts 估值快照 |
| 增量精读 | ✅ | document-reader 子 Agent：12 项问题逐条回答（验证 7/证伪 3/需调整 2），三年连贯性 🟢 诚实，财务红旗 +1，数据归因附外部证据 |
| 质量筛查 | ✅ | quality-screen：3.0 RED（2026H1 口径）；checklist-auto：有条件放行 |
| 知识入库 | ✅ | 基本面更新 + 公司笔记 frontmatter/正文同步（financials/forward_pe/scores/quality 字段更新） |
| 更新报告 | ✅ | 含多空论证裁决、目标价调整理由、8 项更新后跟踪指标、三份附录 |

## 核心结论

- 主业量增+结构升级（毛利率 65.3%、互连类 69.3%、Q2 环比 +28.3%、新品 +80.7%）vs 利润含金量下降（非经常性 6.75 亿占归母 33.8%，含一次性 XConn 4.56 亿）并存；新增应收红旗；存货未消化；韩国调查无进展。
- 估值：PE-TTM 修正 84.6x（扣非 115.4x）、Forward PE 65x（2026E 归母 40 亿）；目标市值中性上修 1920 → 2400 亿；维持观望，150-160 元以下逢低关注。
- 四大师：生意模式 7.5 → 7.0（利润含金量），其余维持。
- quality YELLOW 7.3 → RED 3.0（估值 0 分 + 现金流 3 分 + 盈利质量 5.4 分）。

## 改进候选（已写入 reviews JSON）

1. **quality-screen growth 参数单位混淆**（medium）：auto 模式 growth 传 26.66 输出 2666%，警告文案与实际 ×100 行为矛盾 → 统一单位约定或自动识别。
2. **quality-screen 归母/扣非双口径缺失**（medium）：对利润含金量下降公司单口径机械低分，无法自动区分归母 +72.3%/扣非 +21.2% → 支持双口径 + 背离提示（与既有 quality-screen-growth-valuation-bias 同型复现）。
3. **checklist-auto 商誉占比误读**（low）：#15 输出 30.0%（实际 0.45%），frontmatter 多期 history 取数错误 → 优先取最新 report_period。
4. **stock.ts --financial 披露期滞后**（low）：8 月底半年报密集期数据源滞后，需用户提供 PDF 链接 → 兜底源或滞后提示。

## 错误摘要

- 无阻断性错误；quality-screen 首次传参单位错误已修正重跑；checklist-auto #15/#28 两处脚本误读已在报告中人工核验修正。
