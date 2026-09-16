# Review: deep-dive 国盛智科 (deep-dive-国盛智科-20260916-qf3k)

> **taskId**: `deep-dive-国盛智科-20260916-qf3k`
> **origin**: `process-improvement` (防递归)
> **command**: `deep-dive 国盛智科`
> **params**: 公司=国盛智科, 代码=688558.SH (科创板)
> **terminalState**: `succeeded`
> **reviewAt**: 2026-09-16

## 输入与产物

### 输入文件清单
- `Research/00-Workspace/02-Processing/pdf-texts/国盛智科/2024年年度报告-摘录源材料.md`（数据源降级：同花顺 iFind 公告语义摘录）
- `Research/00-Workspace/02-Processing/pdf-texts/国盛智科/2025年年度报告-摘录源材料.md`（数据源降级）
- `Research/00-Workspace/02-Processing/pdf-texts/国盛智科/2026年半年度报告-摘录源材料.md`（数据源降级）
- `Research/00-Workspace/02-Processing/2026-09-16-国盛智科-deep-read.md`
- `Research/00-Workspace/02-Processing/2026-09-16-国盛智科-processed.md`

### 产物清单
- `Research/10-Knowledge/15-机床/02-公司研究/国盛智科-公司研究.md`
- `Research/10-Knowledge/15-机床/00-行业概览/机床（金属切削）-行业概览.md`
- `Research/10-Knowledge/15-机床/01-细分行业/数控机床-行业分析.md`
- `Research/10-Knowledge/00-MOC/机床-MOC.md`
- `Research/20-Reports/2026-09-16-国盛智科-deep-dive-report.md`
- `Research/20-Reports/2026-09-16-国盛智科-deep-dive-report.html`

## 阶段验收

| 步骤 | 验收结果 | 说明 |
|------|---------|------|
| 1. 检查已有研究 + 定位代码 | ✅ passed | 全新公司研究；代码 688558 科创板（2020-06-30 上市） |
| 2. 财报/中期报告提取 | ✅ passed with caveat | cninfo HTTP403 系统性阻断，三年年报（2023/2024/2025）+2026 半年报经同花顺 iFind MCP search_notice 公告语义摘录为源材料，parse_confidence=medium，2023 年报未单独落盘并入摘录序列 |
| 3. 研报 + evaluate.ts 估值快照 | ✅ passed | 华鑫/东吴 2 份研报（2024-11）温和看多；evaluate.ts PE 25.25/PB 2.49/历史分位 62.9%；品种=一般工商，PEG 1.10，Forward PE 20.6 |
| 4. document-reader 9大精读 + 多空论证 | ✅ passed | deep-read 含第十章多空论证（略偏空裁决）；管理层诚实度🟢；数据源降级显式标注；置信度 6 |
| 5. info-alchemist + quality-screen | ✅ passed | processed 落盘；质量筛查 YELLOW 6.6 无红牌；首跑传百分比数值误触发一次性损益红旗，改传小数后重跑正确 |
| 6. knowledge-architect 知识库写入 | ✅ passed | 公司笔记+行业概览+细分行业+MOC 4 文件；frontmatter quality_verdict=YELLOW quality_score=6.6 回填 |
| 7. report-writer 深度报告 | ✅ passed | md+html 双份，ECharts CDN；Phase5 评分卡首跑 25/30 补『历史类比』后 30/30 ✅；投资清单 AUTO 扫描放行，无 No-Go |

## 关键发现摘要

- **基本面趋势**：2023→2025 归母净利逐年回升（业绩恢复通道），毛利率约 22-23%、净利率约 20% 稳中有升；2026H1 延续中高个位数增长，行业（金属切削机床产量 +9.7%、利润总额 +25.3%）处于景气上行中后段
- **估值位置**：当前市值 42.62 亿 / PE-TTM 25.25 / 历史分位 62.9%，处中高位带，安全边际不足；Forward PE 20.6、PEG 1.10 已计入 2026E 净利 2.1 亿预期
- **核心优势**：中高档数控机床+定梁龙门/卧式加工中心，客户 @ 比亚迪、中集、中车、三一等；五轴/四轴控驱动结构优化，国产替代逻辑清晰
- **风险与多空裁决**：五轴产品仍处小批量验证、竞争加剧（科德/创世纪/海天精工）、成本刚性；『华为/人形机器人叙事』属情绪催化、无法用附注量化（数据源降级下显式标注证据不足）；综合裁决『值得跟踪、等待深度回调』，安全边际现价不满足
- **质量筛查**：YELLOW 6.6，无红牌，未触发 No-Go

## 问题清单（按证据等级 + 严重度排序）

### Issue #1: cninfo HTTP403 强迫走语义摘录降级 (low, A 级)
- **problemCode**: `cninfo-http403-forcing-semantic-downgrade`
- **targetKind**: command | **targetPath**: `.trae/commands/deep-dive.md`
- **severity**: low | **confidence**: 0.7 | **evidence grade**: A
- **symptom**: 国盛智科 cninfo/巨潮 PDF 接口返回 HTTP 403 系统性阻断（stock.ts --financial 及裸/--code 调用均失败），无法下载年报 PDF 原文，被迫改用同花顺 iFind MCP search_notice 公告语义摘录（parse_confidence=medium、无页码、无附注全文、2023 年报并入 2025 序列）。deep-read 置信度仅 6，凡依赖附注全文的结论（现金收入比、会计政策、关联交易明细、产能与台单价）只能标注证据不足；『华为/人形机器人叙事』等无法用附注量化
- **影响**: 表外/附注级结论的证据层级不透明，读者可能误把中置信度结论当高置信原文结论
- **rootCauseHypothesis**: cninfo 公开 PDF 接口存在 IP/UA 级反爬封禁，stock.ts 未内置 403 自动切备用源兜底；降级路径存在但产出规范未要求显式输出『受影响结论 + 证据等级』清单
- **改进方向**: deep-dive.md 在财报 PDF 获取 403/失败时强制输出『受影响结论清单』；源材料 frontmatter 显式标注降级原因+parse_confidence；置信度≤6 结论在报告/笔记显式标『存疑』

### Issue #2: deep-dive 报告模板缺『历史类比』章节导致返工 (low, C 级)
- **problemCode**: `deep-dive-report-template-missing-historical-analogy-section`
- **targetKind**: template | **targetPath**: `Research/99-Templates/company-deep-dive-template.md`
- **severity**: low | **confidence**: 0.6 | **evidence grade**: C
- **symptom**: company-deep-dive-template.md 正文无独立『历史类比』章节（仅四大师评分卡行出现『历史类比与时间框架』字样），但 quality-scorecard.ts Phase5 对 /历史类比/ 有硬性判定（投资视角权重），本报告首轮评分 25/30 判定『缺少历史类比』扣分，事后在 md+html 双份补写『历史类比（李录框架）』小节并重跑评分卡才达 30/30；模板与评分卡判定项不同步造成一次返工
- **rootCauseHypothesis**: report-writer 严格按 template 章节生成，而模板正文未内置『历史类比』这一 AGENTS.md 要求覆盖项，形成模板与验收不一致
- **改进方向**: 在 company-deep-dive-template.md 正文『周期位置』后增加『历史类比（李录框架）』章节占位，使 report-writer 一次成型，评分卡不再因缺历史类比误判

## 改进候选去向

按 Skill 定义，候选汇总通过 backlog 状态脚本更新：
- Issue #1（low, A 级）→ candidate（严重度 low，有单次 A 级证据，满足 low 级 'critical/high 单次 A/B 才够' 之外的分档需按脚本 `qualifiesAsCandidate` 以 strongest≥C && taskIds≥2 判定——本次为单次，将以脚本实际判定结果为准）
- Issue #2（low, C 级）→ observing（仅单次 + C 级证据，未达跨任务复现门槛，保持观察等待同类复现）

## 防递归与失败隔离

- 本 Review `origin=process-improvement`，不再触发一般任务 Review
- Review 失败时只记录 `review_status=failed`，不改变本命令终态、不删除产物、不阻塞交付
- 边界：常规 Review 只写 `06-Process-Improvement/`；正式 Agent/Command/Skill/脚本/模板/AGENTS.md 修改需用户明确批准可识别批次后才能进行