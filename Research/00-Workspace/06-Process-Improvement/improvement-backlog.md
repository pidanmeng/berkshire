# 流程改进 Backlog

> 状态真源：improvement-backlog.json · 最后更新：2026-08-17T11:01:52.391Z

| 状态 | 严重度 | 问题描述 | 目标文件 | 任务数 | 问题码 |
|---|---|---|---|---:|---|
| 已验证 | 中 | quality-screen report 模式从公司笔记正则提取数据失真（与 20260816 国际复材、生益科技深调… | .trae/scripts/quality-gate/quality-screen.ts | 6 | qs-report-regex-range-misparse |
| 已验证 | 中 | investment-checklist-auto 扫描误判（与 20260816 国际复材、生益科技深调同型，复发）：… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 6 | checklist-auto-year-ambiguity |
| 观察 | 低 | document-reader 对『未单列/未披露』类表述核实不足：deep-read 3.2 节称『2023 年前五大… | .trae/agents/document-reader.md | 1 | doc-reader-disclosure-check |
| 已验证 | 低 | fetch-file.ts 对含少量 OCR 页的 PDF 直接判失败（exit 4）并保留源文件：风华高科 2024 … | .trae/scripts/file-ingestion/fetch-file.ts | 2 | fetch-file-ocr-fails-annual-report |
| 观察 | 低 | 同一工作日内 04-电子 目录存在并行深调（华正新材）产物：00-行业概览/覆铜板-行业概览.md 与 01-细分行业/… | Research/10-Knowledge/04-电子 | 1 | industry-dir-concurrency-overlap |
| 观察 | 中 | AGENTS.md 与命令约定以专用 subagent_type（document-reader / bull-advo… | AGENTS.md | 1 | task-subagent-type-unavailable |
| 已验证 | 低 | 券商研报全部为看多/正面评级，无看空或谨慎评级（复用既有问题，第 2 例）：本次 13 篇研报（开源/太平洋/民生/国信… | Research/00-Workspace/02-Processing/pdf-texts/鼎泰高科/研报集.md | 2 | research-report-lack-bear-coverage |
| 已验证 | 低 | 投研自定义子 Agent（document-reader/bull-advocate/bear-advocate/inf… | .trae/commands/deep-dive.md | 2 | subagent-type-mapping-for-research-agents |
| 观察 | 中 | 对三年时间序列表格（如 2023/2024/2025 三列财务数据表）做 report 模式扫描时，正则优先匹配到最早年… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-annual-value-regex |
| 观察 | 中 | AUTO 扫描把 OCF/NI=-2.74 读为 2.74 且判为 ✅≥0.8 通过（负号丢失，实际应判 ❌）；#15 … | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 1 | checklist-auto-negative-value-regex |
| 已验证 | 中 | stock.ts --category yjyg（业绩预告）与 --category yjbb（业绩快报）过滤均未生效：… | .trae/scripts/stock-data/stock.ts | 2 | stock-category-filter-ineffective |
| 已拒绝 | 低 | 命令要求采集『至少 1 篇看多 + 1 篇看空/谨慎研报，如有』，但 stock.ts --reports 仅返回东财研… | .trae/commands/deep-dive.md | 2 | deep-dive-bear-research-collection-gap |
| 已验证 | 中 | quality-screen --mode auto 输入单位约定易错（复用既有问题，第 2 例）：按百分比值传参（--… | .trae/scripts/quality-gate/quality-screen.ts | 2 | quality-screen-auto-unit-doc-missing |
| 已验证 | 高 | evaluate.ts 估值快照对含大额一次性损益的标的给出误导性评价，且同比数据存在单位错误：三生国健 2025 年 … | .trae/scripts/evaluation/evaluate.ts | 1 | evaluate-oneshot-income-distortion |
| 已验证 | 高 | quality-screen 自动化评分被一次性 BD 收入美化：三生国健输出 GREEN 7.9/10，其中估值合理性… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-oneshot-greening |
| 观察 | 中 | investment-checklist-auto #30 大额减值项误报：三生国健扫描输出『#30 大额减值 >30%… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 1 | checklist-auto-negation-context |
| 观察 | 中 | 山金国际 2025 年年报（148 页）OCR 页占比 6.76%（10 页：封面/目录/重要提示/公司简介/MD&A5… | .trae/scripts/file-ingestion/fetch-file.ts | 1 | fetch-file-ocr-ratio-limit-too-strict |
| 已验证 | 高 | evaluate.ts --code 000988 输出『净利同比 2048.29%（⚠️ 同比存疑）』，与 2025 … | .trae/scripts/evaluation/evaluate.ts | 4 | evaluate-yoy-data-anomaly |
| 已验证 | 中 | investment-checklist-auto.ts 扫描出现中文正则误报需逐项人工澄清（复用既有问题追加证据）：真… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 2 | checklist-auto-false-positives |
| 观察 | 低 | 2023 年年报『主要矿产品种销售情况』表被上游 @firecrawl/pdf-inspector 解析为异常单位（销量… | .trae/scripts/file-ingestion/fetch-file.ts | 1 | pdf-inspector-parse-table-anomaly |
| 观察 | 中 | 新建行业目录使用了与既有目录重复的编号（05-农化 vs 05-医药生物），导致知识库目录编号不唯一，需手动迁移为 07… | Research/10-Knowledge | 1 | knowledge-dir-number-collision |
| 观察 | 中 | evaluate.ts 输出的营收同比 5262.13%、净利同比 12279.10% 与财报原文（+52.62%/+1… | .trae/scripts/evaluation/evaluate.ts | 1 | api-yoy-calculation-error |
| 观察 | 中 | deep-read 中 2023 年磷矿毛利率 65.79% 与年报原文 76.08% 不符，info-alchemis… | .trae/agents/document-reader.md | 1 | reader-figure-miscitation |
| 观察 | 中 | evaluate.ts 输出的同比增速字段异常：营收同比 6788.94%、净利同比 8982.21%、ROE 33.2… | .trae/scripts/evaluation/evaluate.ts | 1 | evaluate-ttm-yoy-anomaly |
| 观察 | 低 | stock.ts --announcements --category yjyg 过滤业绩预告类别未生效：指定类别 yj… | .trae/scripts/stock-data/stock.ts | 1 | stock-category-filter-noop |
| 观察 | 低 | 编排器为知识库新行业目录分配编号时未先核查目录占用：任务上下文指定 05-游戏，但 05-医药生物 已占用（且 04 已… | AGENTS.md | 1 | orchestrator-dir-number-conflict |
| 已验证 | 低 | fetch-file.ts 首次处理 2024 年报因 1 个扫描封面页触发『PDF 需要 OCR』退出码 4，需编排器… | .trae/scripts/file-ingestion/fetch-file.ts | 2 | fetch-file-ocr-first-pass-fail |
| 已验证 | 低 | deep-dive 流程不产生 raw 文件（01-Inbox 为空），但 document-reader 在 deep… | AGENTS.md | 2 | deep-read-raw-source-dangling-link |
| 已验证 | 高 | AGENTS.md 与 deep-dive 命令约定以专用 subagent_type（document-reader … | AGENTS.md | 1 | task-subagent-type-unavailable |
| 观察 | 低 | investment-checklist-auto 扫描炬芯科技报告与笔记时 #8『财报 PDF 下载』误报（实际 pd… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 1 | checklist-auto-pdf-file-absent-false-positive |
| 已验证 | 中 | deep-dive 命令流程不含 Phase 3（cross-validator，无 validated 文件产出），但… | Research/99-Templates/company-template.md | 2 | deep-dive-validated-link-broken |
| 已验证 | 低 | WebFetch r.jina.ai 前缀抓取东财研报详情页返回『正在进行安全验证』反爬页（复用既有问题，第 2 例）：… | .trae/skills/research-web-search | 2 | web-fetch-jina-anti-bot |
| 观察 | 低 | deep-dive 命令与 AGENTS.md 对报告形态要求不一致：命令步骤 7 仅要求『单公司简版 md 报告』，而… | .trae/commands/deep-dive.md | 1 | deep-dive-report-html-omission |
| 已验证 | 高 | evaluate.ts 输出净利同比 18771.65% 且营收同比『存疑（接口异常）』（实际 2025 年报：营收 +… | .trae/scripts/evaluation/evaluate.ts | 7 | evaluate-yoy-metric-misparse |
| 已验证 | 中 | investment-checklist-auto 扫描太极实业报告与笔记出现两处关键词误读：①商誉/净资产被误读为 3… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 3 | checklist-auto-threshold-text-misread |
| 已验证 | 中 | 思瑞浦近 1100 天 35 篇研报全部为买入/增持/优于大市，无看空或谨慎评级研报；多空论证 Bear Case 主要… | deep-dive 流程·步骤 2.4（研报采集） | 8 | deep-dive-bear-report-coverage-gap |
| 观察 | 低 | document-reader 角色无同名 .self-check.ts 自检脚本（info-alchemist/cro… | .trae/agents/document-reader.md | 1 | document-reader-selfcheck-missing |
| 观察 | 低 | evaluate.ts 输出『利息覆盖倍数 N/A』（未从财报附注提取利息支出），quality-screen repo… | .trae/scripts/evaluation/evaluate.ts | 1 | quality-screen-interest-coverage-missing |
| 观察 | 中 | quality-screen.ts --mode auto 的 growth 类参数按倍数解析（--revenue-gr… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-growth-param-scale |
| 观察 | 中 | quality-screen --mode auto 的 growth 参数单位与负值格式易误用：`--earnings… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-auto-growth-param-unit |
| 已拒绝 | 低 | deep-dive 命令流程步骤 4 仅含 info-alchemist + quality-screen，无 /res… | deep-dive 流程·步骤 4（结构化提取与质量筛查） | 4 | deep-dive-no-cross-validator |
| 观察 | 低 | quality-screen 对低毛利重资产强周期行业（封测 OSAT）机械评分系统性低估：长电科技毛利率 14.15%… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-industry-threshold-bias |
| 观察 | 低 | evaluate.ts 调用同花顺 hithink API 首次运行返回 HTTP 429 Too Many Reque… | .trae/scripts/evaluation/evaluate.ts | 1 | evaluate-api-rate-limit |
| 已拒绝 | 中 | evaluate.ts 对新易盛输出『⚠️ 净利可能含大额一次性收入（BD/license-out/资产处置等），PE-… | .trae/scripts/evaluation/evaluate.ts | 2 | evaluate-nonrecurring-warning-false-positive |
| 观察 | 低 | fetch-source.ts 抓取东财研报正文仅输出『前 3000 字符』readability 截断摘要，盈利预测明… | .trae/skills/research-web-search/scripts/fetch-source.ts | 1 | fetch-source-report-truncation |
| 已验证 | 低 | quality-screen 估值维度按 PE 绝对值区间评分（PE>50→2 分），高 PE 高增长成长股系统性低分；… | .trae/scripts/quality-gate/quality-screen.ts | 3 | quality-screen-growth-valuation-bias |
| 观察 | 低 | checklist-auto #28『有息负债/OCF 流动性红线』对零有息负债公司无法自动解析：报告/笔记明确『短期借… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 1 | investment-checklist-interest-debt-parse-gap |
| 观察 | 中 | 研报引用的财务数据与年报原文矛盾未被及时识别：太平洋证券 2026-06-21 研报『2025 年经营活动现金流量净额 … | deep-dive 流程·步骤 2.4（研报采集与引用） | 1 | report-data-cross-check |
| 观察 | 中 | 同一公司两次扫描结果不一致：第一版（以 deep-read 文件作第二参数）将净利增速提取为 2.9%（实际 1088.… | .trae/skills/research-quality-gate/scripts/investment-checklist-auto.ts | 1 | checklist-auto-growth-column-misread |
| 观察 | 低 | auto 模式传 2026Q1 资产负债率 75.1%（红牌『超 70%』）与 report 模式从笔记 frontma… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-debt-metric-period-mismatch |
| 观察 | 低 | deep-dive 命令步骤 7 仅定义 Markdown 报告路径（company-deep-dive-templat… | deep-dive 流程·步骤 7（报告生成） | 1 | deep-dive-report-html-missing |
| 观察 | 中 | quality-screen --mode report 对扭亏公司误判净利同比：思瑞浦 2025 年归母净利 -1.9… | .trae/scripts/quality-gate/quality-screen.ts | 1 | quality-screen-report-growth-misparse |
| 已验证 | 高 | evaluate.ts 现有估值方法路由表仅包含金融/周期/资源/控股集团/一般工商 5 类，缺少高成长（growth）… | .trae/scripts/evaluation/evaluate.ts | 1 | valuation-routing-by-type |
| 已验证 | 高 | 公司笔记 frontmatter 无 valuation_type（品种分类）与 peg 结构化字段，导致 valuat… | Research/99-Templates/company-template.md | 1 | peg-fields-template |
| 已验证 | 高 | backfill.ts 无 valuation_type 与 peg 字段的解析/回填逻辑，新建笔记模板虽有字段，但存量… | .trae/scripts/valuation/backfill.ts | 1 | peg-fields-backfill |
| 已验证 | 高 | valuation-tracker server 端解析公司笔记 frontmatter 不包含 valuationTy… | valuation-tracker/server/lib/research.ts | 1 | peg-tracker-server-parse |
| 已验证 | 高 | 前端 CompanyItem 类型缺少 valuationType 与 peg 字段，类型不匹配 server 返回 | valuation-tracker/lib/api.ts | 1 | peg-tracker-frontend-types |
| 已验证 | 高 | CompanyDashboard 详情页不展示品种分类与 PEG 值，用户无法在 valuation-tracker 看… | valuation-tracker/components/CompanyDashboard.tsx | 1 | peg-tracker-frontend-display |
| 观察 | 中 | AGENTS.md 共享脚本用法表 evaluate.ts / quality-screen.ts 行未更新 PEG 口… | AGENTS.md | 1 | peg-docs-agents |
