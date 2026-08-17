---
name: research-process-optimization
description: 审阅投研任务过程、提炼外部方法论并治理改进候选。任务结束复盘、方法论摄取、改进池汇总、审批应用流程变更时调用。
---

# 投研流程优化

## 边界

常规 Review、方法论摄取和批次生成仅可写入 `Research/00-Workspace/06-Process-Improvement/`。只有用户明确批准可识别批次后，才能修改批次中列明的 Agent、Command、Skill、脚本、`AGENTS.md`、模板或其他正式资产。

所有本 Skill 任务设置 `origin=process-improvement`，不得递归触发一般任务 Review。

## 证据等级

- A：可复现失败、测试结果、完整运行日志、明确用户反馈或产物与契约的直接差异。
- B：两项及以上相互独立的强佐证，能够定位同一问题。
- C：单次人工观察、弱日志、间接迹象或尚未完成归因的异常。
- D：无直接证据的假设、偏好或外部方法论主张。

`critical` 或 `high` 问题有单次 A/B 级证据即可成为 `candidate`。`medium` 或 `low` 问题需在至少两个不同 taskId 中复现，且至少包含 C 级证据，才能成为 `candidate`。其余进入 `observing`。

## 稳定指纹

指纹由 `targetKind + canonicalTargetPath + normalizedProblemCode` 生成。问题码转小写并移除非字母数字字符；目标路径必须规范化并位于工作区内。

## 状态机

`observing → candidate → proposed → approved/rejected → applied → verified`

应用或验证失败进入 `apply_failed`。不得跳过批准直接进入 `applied`；不得在强制验证未全部通过时进入 `verified`。

## Backlog

状态真源是 `improvement-backlog.json`，Markdown 仅为可读投影。使用状态脚本完成操作：

```powershell
bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts upsert-review --review <review-json>
bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts build-batch
bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts record-decision --batch <batch-id> --decision approved
bun run .trae/skills/research-process-optimization/scripts/improvement-backlog.ts record-verification --batch <batch-id> --results <verification-json>
```

所有写入先写同目录临时文件，再原子替换。证据中出现秘密、环境变量值、Authorization、Cookie 或私钥内容时拒绝写入。

## 批次规则

只选择 `candidate`。排序依次考虑严重度、证据等级、置信度、预期收益、依赖和改动风险。批次需给出逐文件修改集合、依赖顺序、兼容性、专项测试、全量测试、类型检查、路径检查、回滚步骤与明确排除项。

部分批准必须生成只包含获批候选的独立子批次。实际 diff 文件集合必须是获批文件集合的子集。

## 方法论兼容性矩阵

对外部方法逐项判断：适用问题、证据强度、当前流程对应阶段、目标 Command/Agent/Skill/脚本、与六阶段串行验收的兼容性、与三层结构的兼容性、与四大师框架的兼容性、引入成本、失效边界、最小实验和回滚方式。

外部观点默认是 `observing`；只有满足相同证据门槛时才成为 `candidate`。
