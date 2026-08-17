---
description: 汇总流程改进候选并生成审批批次，通过原生多选对话框（AskUserQuestion）收集审批决定，应用已批准批次。用法：/process-optimize [批次路径与批准范围]
---

以 `origin=process-improvement` 执行，不触发一般任务 Review。加载 `research-process-optimization` Skill，并派发 `process-optimizer`。

## 默认：生成批次 + 多选审批

当参数未包含明确批准语义和可识别批次路径时：

1. 读取 `Research/00-Workspace/06-Process-Improvement/improvement-backlog.json`。
2. 调用 backlog 脚本的 `build-batch`，只汇总 `candidate`，去重排序，生成 `batches/YYYY-MM-DD-optimization-batch-<n>.md`（批次列出候选、证据、逐文件修改、依赖顺序、兼容性、专项测试、全量测试、类型检查、路径检查、回滚和排除项）。
3. 编排器（主 Agent）使用 **AskUserQuestion**（原生多选对话框，与 `/plan` 一致）收集审批决定：
   - 问题 1（单选）：审批方式 → 「全部批准」/「部分批准」/「全部拒绝」。
   - 若选择「部分批准」：追加**多选问题**勾选要批准的候选——每问最多 4 个选项，候选多于 4 个时拆分为多个问题；选项 label 用候选中文描述（附问题码），description 标注严重度与目标文件。
4. 收到决定前：**仅完成批次生成与等待，不得修改任何正式配置、脚本、模板或知识资产**。
5. 根据 AskUserQuestion 返回执行：
   - 「全部批准」 → 进入「应用已批准批次」。
   - 「部分批准」 → 按勾选的候选指纹记录部分批准（未选中项转 `rejected`），进入「应用已批准批次」。
   - 「全部拒绝」 → 记录 decision（rejected）与决策文档，以 `succeeded` 结束，不应用任何修改。

## 应用已批准批次

只有用户明确批准（通过 AskUserQuestion 决定或直接文本指示）且批次可识别时执行：

1. 校验批次存在、状态为 `proposed`，批准范围可识别（全部 / 勾选指纹列表 / 拒绝）。
2. 记录 decision。部分批准先生成独立子批次，只保留获批候选。
3. 从批次提取允许修改文件集合，修改前保存快照或差异基线。
4. 严格按依赖顺序实施，不扩大文件范围。
5. 修改后比较实际 diff 文件集合与批准集合；越界立即回滚。
6. 运行批次专项测试、`bun test`、`bunx tsc --noEmit` 和路径引用检查。
7. 全部通过后生成 verification 并记录 `verified`。
8. 任一强制验证失败时按回滚清单恢复，生成失败 verification 并记录 `apply_failed`。

未明确批准、批次不可识别、批准范围含糊或批次状态不合法时，只说明阻塞原因并停止。

## 通用约束

- 所有子模式设置 `origin=process-improvement`，不得触发递归 Review。
- 命令必须以 `succeeded`、`failed` 或 `partial` 结束；该终态不再触发全局 Review。
- `review` 必须接收正式命令分配的 `--task-id`，重试沿用 taskId 并递增 attempt；禁止以主题名或时间戳替代。
- `review` 输入仅限命令名、参数、输入文件清单、原命令终态、阶段验收结果、错误摘要与已声明产物，禁止扫描未声明文件扩张范围。
- Review 产物固定为 `Research/00-Workspace/06-Process-Improvement/reviews/<taskId>.json` 与同名 `.md`；候选汇总只能由 backlog 脚本更新。
- Review 失败只记录 `review_status=failed` 和错误摘要，不得覆盖原命令终态、删除原产物或阻塞原任务交付。
- 审批对话框（AskUserQuestion）只负责**收集审批决定**：不在对话框内执行任何文件修改；决定落地必须走 backlog 脚本（`record-decision` 等）。
- 未经用户明确批准批次，禁止修改正式 Agent、Command、Skill、脚本、模板和 `AGENTS.md`。
- 状态真源是 `Research/00-Workspace/06-Process-Improvement/improvement-backlog.json`，Markdown 是投影。
- 所有持久化写入必须通过 `improvement-backlog.ts` 完成原子更新；禁止手改 backlog。
- 拒绝持久化秘密、环境变量值、Authorization、Cookie 和私钥内容。
