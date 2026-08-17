---
description: 更新所有 MOC 索引页。用法：/update-moc
---

更新知识库 MOC 索引页。

## 任务
1. 扫描 `Research/10-Knowledge/` 下全部笔记（glob `**/*.md`），按目录归类：行业概览 / 细分行业 / 公司研究 / 宏观
2. 对照各行业 MOC（`Research/10-Knowledge/00-MOC/*-MOC.md`）：
   - 新增笔记按层级插入对应区块
   - 删除不存在的笔记链接
   - 更新 `updated` 字段
3. 更新 `行业总览-MOC`：新增行业时添加链接
4. 输出更新摘要：每个 MOC 增删链接数

## 汇报
向用户汇报每个 MOC 的更新情况。
