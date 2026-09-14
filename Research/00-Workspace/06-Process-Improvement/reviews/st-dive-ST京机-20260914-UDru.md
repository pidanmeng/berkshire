# 全局 Review：st-dive ST京机

- **taskId**: `st-dive-ST京机-20260914-UDru`
- **origin**: process-improvement
- **命令**: st-dive ST京机（000821.SZ，湖北京山轻工机械/京山轻机）
- **终态**: ✅ succeeded
- **Review 时间**: 2026-09-14

## 各阶段验收结果

| 阶段 | 结果 | 说明 |
|------|------|------|
| 1. 检查已有研究 | ✅ | 全新 ST 研究（知识库无既有 ST京机 笔记；01-新能源/02-公司研究 无京山轻机覆盖）|
| 2. 定位代码 + 财报原文 | ✅ | 代码 000821.SZ（深圳主板，京山轻机）；2023/2024/2025 + 2026H1 四年财报 PDF 提取落盘（pdf-texts/ST京机/ 5 份）+ evaluate.ts 估值快照（价格 7.49 / 市值 46.7 亿 / PE-TTM 82.22 / PB 1.12 / PS 0.66）|
| 3. 公告采集 | ✅ | ST 关键公告靠 web 搜索确定（立案 2024-11-01 / 告知书 2026-01-16 / 戴帽 2026-01-20 / 追溯重述 2022-01-27）；stock.ts --announcements 因分页限制仅返约 20 条近期公告（见改进候选 #1）|
| 4. 原文精读（document-reader） | ✅ | deep-read 产出：13 章含 ST 双轨（修复 7.5 + 博弈 5.5 → 重点关注）+ 三年覆盖（2024/2025/2026H1，2023 比较列）+ 多空论证（Bull B1-B6 / Bear S1-S6）+ 红线结论（三年连贯性✅2/3、管理层诚实🟡有条件通过，无 No-Go）|
| 5. 研报采集 | ✅ | stock.ts --reports 返回 0 条（ST 股票无券商覆盖），多空论证基于财报原文 + 公告构建（记录「无覆盖」）|
| 6. 结构化提取与质量筛查 | ✅ | processed 产出（84 条事实）；quality-screen 最终 RED / 0.0 分（成长维度 -40% 营收 + 扣非依赖临半）；frontmatter 回填 quality_verdict/quality_score + ST 专用字段 + scores 六维 + target_market_cap_yi（33.0/82.0/110.0）+ forward_pe（35.0，2026E）+ valuation_type cyclical|
| 7. 增量对比 | N/A | 全新 ST 研究，无既有笔记 |
| 8. 写入知识库 | ✅ | `01-新能源/02-公司研究/ST京机-公司研究.md` 创建（含 ST 诊断卡/摘帽路径 R2/退市风险评估/公告时间线/财务排雷/双轨裁决/ST检查清单/多空论证/三情景估值）；新能源-MOC 新增 `[[ST京机-公司研究]]`，updated 2026-09-14|
| 9. 报告生成 | ✅ | `20-Reports/2026-09-14-ST京机-st-report.md` 完成，含多空双方核心论点对照表 + 核心结论 4 条（带置信度）+ 估值区间（悲观 33/中性 82/乐观 110 亿）+ 双轨合并裁决（重点关注·配置型安全边际）+ 质量筛查 ST 语境解读 + 附录 A-F；ST 报告为纯 markdown（无 HTML），与 ST臻镭 先例一致 |

## 错误摘要

- stock.ts --announcements 默认 pageSize=20 且不翻页，--days 730 仅返回约 20 条近期公告，ST 一级信源重大公告（立案/告知书/戴帽）全部缺失；靠 web 搜索确定 ST 原因与时间线（改进候选 #1 同款，ST臻镭/ST远智 已上报，本次为第三次 A 级复现）。
- quality-screen --mode auto 传 `--revenue-growth -40.04` 报 argument is ambiguous 退出，改用 `--revenue-growth=-40.04` 成功（改进候选 #2 同款，本次为第三次复现、证据升至 A 级）。
- quality-screen 百分数当小数传参（--revenue-growth=-40.04）输出 -4004% 放大显示失真；改传小数 -0.4004 后方向稳健仍 RED/0.0（改进候选 #4 同款，本次为第四次复现）。

## 改进候选

| # | 问题 | 严重度 | 证据 | 去向 |
|---|------|--------|------|------|
| 1 | stock.ts --announcements 单页 20 条无分页，--days 730 长窗口重大公告漏采（本次 ST 一级信源全缺，靠 web 搜索绕过）| high | A | **candidate（跨 ST 任务三次 A 级复现，taskIds=3）** |
| 2 | quality-screen 负值参数（--revenue-growth -40.04）报 ambiguous 且无语法引导 | low | A（C→B→A，三次复现）| **candidate（跨任务三次复现，证据已升至 A）** |
| 4 | quality-screen auto 模式 growth 参数单位/负值格式易误用，百分数被当小数放大 100 倍 | medium | B（第四次跨任务复现）| **candidate（taskIds≥2 + ≥C 级证据）** |

> 本次未发现任何**新** problemCode；上述 3 项均为既有候选/观察条目的跨任务复现，按稳定指纹去重合并，未新增重复条目。此前批次治理未达成的修复项（#1/#2/#4）均已具备完整候选资格，可进入下一次 build-batch 审批。

## 防递归与边界

- 本 Review 仅写入 `06-Process-Improvement/reviews/`，未修改任何正式 Agent/Command/Skill/脚本/模板/AGENTS.md。
- 未再次触发全局 Review（origin=process-improvement）。
- 复用性问题按稳定指纹与既有条目合并去重，不新增重复条目。