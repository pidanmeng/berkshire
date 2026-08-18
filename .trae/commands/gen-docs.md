---
description: 生成/更新网站结构化文档（估值追踪系统文档中心，Fumadocs MDX，content/docs/）。用法：/gen-docs [主题或全部]
---

用户发起文档生成/更新需求：**$ARGUMENTS**

## 背景

文档中心位于 `valuation-tracker/content/docs/`，由 Fumadocs MDX 渲染（`/docs` 路由）。当前文档按三类组织：

| 文档 | 文件 | 内容来源 |
|------|------|---------|
| 投资理念 | `philosophy.mdx` | 根目录 `AGENTS.md`（四大师框架 / 核心原则 / 六大评估维度） |
| 网站使用指南 | `usage.mdx` | `valuation-tracker/README.md` 与代码（页面功能 / API / 数据流） |
| 研报生产流程 | `research-process.mdx` | 根目录 `AGENTS.md`（六阶段流程 / 三层结构 / 质量体系 / 命令） |
| 文档中心导览 | `index.mdx` | 上述三篇的索引 |

侧边栏分组由 `content/docs/meta.json` 控制（`---标题---` 分隔符）。页面 frontmatter 支持 `title`（必填）/ `description` / `icon` / `full`（与 fumadocs-mdx 13 schema 兼容）。

## 任务

### 1. 明确范围

- 若 `$ARGUMENTS` 指定具体主题（如「投资理念」），只更新对应文档
- 若 `$ARGUMENTS` 为空或「全部」，全量审阅并更新四篇

### 2. 派发文档撰写 Agent（显式调用）

> 按 `AGENTS.md`「子 Agent 触发契约」：以 `general_purpose_task` 启动 docs-writer，显式传递 taskId（`gen-docs-YYYYMMDD-<4位随机>`）、角色定义路径 `.trae/agents/docs-writer.md` 与质量标准；子 Agent 启动后先 Read 自己的定义再执行。

### 3. 验收

- [ ] 文档内容逻辑连贯、分类清晰，一篇一个主题
- [ ] **所有事实真实引用现有资产**（AGENTS.md / README / 知识库 / 代码），禁止编造系统不存在的能力
- [ ] 每篇 frontmatter 含 `title`（必填）+ `description`，与 fumadocs-mdx schema 兼容
- [ ] `content/docs/meta.json` 分组与实际文件一致
- [ ] 改动仅限文档内容与 `meta.json`，不触碰站点代码（页面/样式改动走 `/dev-site`）
- [ ] 文档渲染验证：`/docs` 及子路由 SSR 200 且含关键内容（复用 3000 端口已有服务，不重启）

## 汇报

向用户汇报：更新/新增的文档文件清单、每篇内容要点、引用的资产来源、验证结果（SSR fetch 状态码与关键内容）、遗留事项。
