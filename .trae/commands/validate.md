---
description: 对指定文件执行交叉验证（Phase 3）。用法：/validate [文件路径或主题]
---

对指定文件执行交叉验证。目标：**$ARGUMENTS**

## 任务
1. 定位目标文件：
   - 若给出路径，直接使用
   - 若给出主题，在 `Research/00-Workspace/02-Processing/` 下按 `YYYY-MM-DD-主题-processed.md` 匹配
2. 若目标不存在，检查是否已有 raw 文件（`01-Inbox/`），如有则先派发 `info-alchemist` 处理
3. 派发子任务 `cross-validator` 执行多源比对、置信度评分、反共识检验
4. 验收：输出 `Research/00-Workspace/03-Validation/YYYY-MM-DD-主题-validated.md`

## 汇报
向用户汇报：整体置信度、通过/存疑事实数、矛盾点、可写入知识库建议。
