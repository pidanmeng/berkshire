---
description: 基于已有知识生成报告（Phase 5）。用法：/report [主题]
---

基于知识库已有内容生成报告，主题：**$ARGUMENTS**

## 任务
1. 检查知识库 `Research/10-Knowledge/` 中与该主题相关的节点（按行业/公司/细分目录 glob 匹配）
2. 检查是否有对应的 validated 文件（`Research/00-Workspace/03-Validation/`）
3. 若知识节点缺失：向用户确认是否先补充研究（`/research`），或基于现有材料生成
4. 派发子任务 `report-writer` 生成报告：
   - Markdown 报告 + 独立 HTML 报告（HTML 直接基于调研结果编写、图表 ECharts CDN 外链），写入 `Research/20-Reports/YYYY-MM-DD-主题-report.md`
   - frontmatter 完整（related_notes 覆盖所有引用节点）
5. 验收：每条结论可回溯数据、md + html 双份产出、HTML 图表 ≥2 个且全部 ECharts

## 汇报
向用户汇报：报告路径（md + html）、核心结论、引用知识节点、置信度与风险提示。
