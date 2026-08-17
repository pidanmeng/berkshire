---
name: obsidian-vault-manager
description: 当需要操作 Obsidian 知识库文件、创建/更新笔记、建立双链、管理 properties 与标签时使用。触发词：知识库、笔记、双链、维基链接、frontmatter、properties、图谱。确保文件写入符合 Obsidian 规范。
---

# Obsidian 知识库管理 Skill

## 能力范围
- 文件创建/更新/重命名（遵守目录结构与命名规范）
- 双向链接建立（`[[笔记名]]` 与 `[[目录/笔记名]]`）
- YAML frontmatter properties 管理
- 标签体系维护

## 📁 知识库目录结构（强制规范）

每个一级行业目录必须按以下三段式结构组织（参考 `10-Knowledge/01-新能源/`）：

```
Research/10-Knowledge/
├── 00-MOC/                      # 索引页
│   ├── 行业总览-MOC.md
│   └── XX行业-MOC.md
├── 01-新能源/                   # 一级行业
│   ├── 00-行业概览/
│   │   ├── 新能源-行业全景.md
│   │   ├── 新能源-产业链图谱.md
│   │   └── 新能源-政策跟踪.md
│   ├── 01-细分行业/
│   │   ├── 光伏/ 储能/ 锂电池/   # 每个细分一个子目录
│   │   │   └── 锂电池-行业分析.md
│   ├── 02-公司研究/
│   │   ├── 宁德时代-公司概览.md
│   │   ├── 宁德时代-财务分析.md
│   │   └── 宁德时代-竞争格局.md
├── 02-行业/ 03-行业/ 04-行业/  # 其余一级行业（同构）
└── 99-宏观/
```

**规则**：
- 一级行业目录编号递增：01-新能源、02-半导体、03-医药……
- 每个一级行业固定三个子目录：`00-行业概览/`、`01-细分行业/`、`02-公司研究/`
- 细分行业有多个时，`01-细分行业/` 下再建子目录（如 `锂电池/`）
- 新行业入库时先建目录骨架，缺子目录用 `.gitkeep` 占位

## 路径规范
- 知识节点写入 `Research/10-Knowledge/` 对应行业目录（三段式结构）
- 中间产物写入 `Research/00-Workspace/01-Inbox|02-Processing|03-Validation/`
- 报告写入 `Research/20-Reports/`
- 命名：`YYYY-MM-DD-主题-raw|processed|validated.md`；知识节点 `行业/公司-笔记类型.md`

## 写入规范
1. 所有知识节点必须含 `type` 字段：`company` / `industry` / `sub_industry` / `MOC` / `report` / `raw` / `processed` / `validated`
2. 关联字段使用 `[[笔记名]]` 格式（列表用 `- "[[笔记名]]"`）
3. 时间字段 ISO 8601（`YYYY-MM-DD`）
4. 标签体系：
   - `#research/raw` 原始信息 / `#research/processed` 处理中 / `#research/validated` 已验证 / `#research/report` 报告
   - `#company/名称`、`#industry/名称`、`#sub_industry/名称`
5. 双向链接：写入 A 引用 B 时，检查 B 是否也应引用 A；若有误更新 B 的 `related_notes`/正文

## 关系矩阵速查
| 关系 | 写入方字段 | 反向方字段 |
|------|-----------|-----------|
| 公司→行业 | `industry: "[[新能源]]"` | `companies: [...]` |
| 公司→细分 | `sub_industry: "[[锂电池]]"` | `companies: [...]` |
| 细分→行业 | `parent_industry: "[[新能源]]"` | `sub_industries: [...]` |
| 报告→笔记 | `related_notes: [...]` | 无（报告消费方） |
| 任意→验证源 | `validation_source: "[[...validated]]"` | 无 |

## 检查清单
- [ ] 写入位置符合三段式目录结构
- [ ] 链接目标是否存在（不存在则在对应目录创建或改为普通文本）
- [ ] 同类笔记命名一致（便于图谱聚合）
- [ ] 不要破坏已有 Dataview 查询块
- [ ] 只更新笔记内容相关字段，不覆盖无关内容
