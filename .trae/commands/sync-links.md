---
description: 扫描并修复知识库断链与缺失 properties。用法：/sync-links
---

执行知识库链接健康检查与修复。

## 任务
1. 提取全库 `[[链接]]`（用 grep 扫描 `Research/10-Knowledge/` 与 `Research/20-Reports/`）
2. 与库内实际文件名比对，定位断链
3. 修复策略：
   - 目标文件存在但名称微差 → 修正链接为目标实际名
   - 目标文件不存在 → 改为纯文本并加 `%% 断链: 目标不存在 %%` 注释；不伪造文件
4. 检查 properties 完整性：所有知识节点必须含 `type` 字段；行业/公司/细分节点的关联字段（`industry`、`sub_industry`、`parent_industry`、`companies`、`sub_industries`）是否存在
5. 缺失 properties 的节点：根据正文内容补全或标注待补
6. 输出修复报告：修复断链数、孤立节点数、缺失 properties 数

## 汇报
向用户汇报修复报告，列出无法自动修复需人工处理的项目。
