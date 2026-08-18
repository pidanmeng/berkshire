---
description: 迭代/修改网站（默认 valuation-tracker 估值追踪系统，前端+后端+脚本）。显式调用 💻 CodingEngineer 子 Agent。用法：/dev-site [迭代需求]
---

用户发起网站迭代需求：**$ARGUMENTS**

> **服务启动原则（强制）**：如非必要不启动项目；确需启动时先检查 3000 端口是否已有服务在运行，已启动则直接复用；已运行的服务可能正被其他 Agent 使用，不得随意 kill / 重启，尽量不耽误其他 Agent 的工作。

## 任务

### 1. 明确迭代范围
- 确认目标网站：默认 `valuation-tracker/`（估值追踪系统，Next.js 前端 + Elysia 后端）；若为其他网站，需用户指明路径
- 若 `$ARGUMENTS` 不足以下手（改动点/验收标准含糊），先用 AskUserQuestion 澄清本次迭代的具体改动点与验收标准

### 2. 派发 CodingEngineer 子 Agent（显式调用）

> 按 `AGENTS.md`「子 Agent 触发契约」：当前环境的 `subagent_type` 仅接受 `search` / `general_purpose_task`，**以 `general_purpose_task` 启动 CodingEngineer**，并在上下文显式传递 `taskId`、角色定义路径 `.trae/agents/coding-engineer.md`、质量标准与自检要求；子 Agent 启动后先 Read 自己的 `.trae/agents/coding-engineer.md` 定义再执行。

启动子任务时传递以下上下文：
- **taskId**：`dev-site-YYYYMMDD-<4位随机>`，贯穿输入、产物与汇报
- **角色定义路径**：`.trae/agents/coding-engineer.md`
- **用户迭代需求全文**与验收标准
- **CodingEngineer 质量标准**（通读 AGENTS.md/项目地图后再动手、复用现有资产、`bun build --no-bundle` 语法检查、新增脚本配套测试、不新增自定义 CSS 类、frontmatter 字段改动三处同步（后端解析→前端类型→展示组件）、交付物最小化）

**必须传递给子 Agent 的运行约束（强制，逐条传达）**：

1. **如非必要，不启动项目**：优先用静态手段完成验证——`bun build --no-bundle` 语法检查、`bun test` 单元测试、对后端/脚本的独立运行验证；仅当改动确需浏览器 / SSR 渲染核验时才考虑启动 dev server。
2. **确需启动前先查端口**：用 `netstat -ano | findstr ":3000"`（Windows）或请求 `http://localhost:3000` 判断 Web 服务是否已在运行；**若 3000 端口已有服务在运行，说明 dev server 已启动（无论由谁启动），直接复用即可，不重复启动、不另开新终端**。后端 API（3001 端口）同理检查。
3. **已启动的服务可能被其他 Agent 正在使用，不得耽误他人工作**：
   - 不得 kill / 重启已在运行的 dev server 进程，避免打断其他 Agent 的验证工作
   - 优先利用热更新（Next.js dev / bun 热重载），保存改动后等待自动重载，而不是重启
   - 确需重启（端口冲突 / 进程卡死 / 必须全局重载）时：先确认该服务是否被其他 Agent 占用；无法确认时保守处理——能不重启就不重启，或将重启风险上报给编排器 / 用户决定
   - 验证一律使用轻量 GET 等**非破坏性请求**，不做可能触发大量写库 / 快照的请求；除非本次迭代必需，不修改 `.env`、共享缓存等可能被其他 Agent 依赖的文件

### 3. 验收
- [ ] 改动符合 coding-engineer.md 质量标准（通过代码审查要点）
- [ ] 未启动 dev server 时：已说明替代验证方式（语法检查 / 测试 / 独立运行）及其结果
- [ ] 复用了端口已有服务时：确认未重启、未 kill 原服务，验证请求均为非破坏性
- [ ] 交付物最小化，不遗留临时文件 / 调试代码

## 汇报

向用户汇报：改动文件清单（按前端 / 后端 / 脚本 / 模板 / Agent 分组）、是否启动或复用了 dev server（3000 / 3001 端口当前状态）、验证结果（语法 / 测试 / SSR fetch）、遗留风险与后续建议。