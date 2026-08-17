---
description: 仅执行信息搜索（Phase 1）。用法：/search [查询]
---

仅执行 Phase 1 信息获取，不进入后续阶段。查询：**$ARGUMENTS**

## 任务
1. 派发子任务 `info-hunter`，执行多源搜索与采集
2. 验收：文件输出到 `Research/00-Workspace/01-Inbox/YYYY-MM-DD-主题-raw.md`，三层结构均有实质采集内容、关键论点有 URL 来源锚点、核心数据 ≥2 独立来源交叉验证（不以来源总数作为通过标准）
3. 若采集失败或来源不足，补充 websearch 后再交付

## 汇报
向用户汇报：采集来源数、关键发现摘要、待验证点列表、raw 文件路径。提示用户可继续执行 `/validate [文件]` 进入验证阶段。
