---
name: research-web-search
description: 当需要搜索互联网信息、行业数据、公司新闻、财报数据、政策动态时使用。触发词：搜索、查找、调研、最新动态、新闻、数据。执行多源并行搜索、结果去重与可信度初评。内置信源导航（研报/公告/财报/新闻/官方统计）与 bun 脚本（关键词搜索/证券代码查询/URL 抓取）。
---

# 网络搜索 Skill

## 能力范围
- 多源并行搜索（通用搜索 + 定向来源：交易所、公司官网、主流财经媒体）
- 查询分解：将用户问题拆分为 3-5 个正交子查询
- 结果去重与时效性过滤
- 来源可信度初评（1-10）
- **信源导航**：按研究目标直接定位权威信源（通用，不限定行业）
- **脚本获取内容**：bun 脚本直接获取**内容本身**（关键词搜索 / 证券代码查询 / URL 正文）

## 🧭 信源导航（按研究目标选信源，通用）

> 关键原则：**先想清楚要什么类型的信源，再搜索**。以下信源跨行业通用。

### 1. 找券商研报 → 研报聚合站
| 信源 | URL | 特点 |
|------|-----|------|
| 东方财富研报中心 | data.eastmoney.com/report/ | 按行业/个股检索，PDF 全文 |
| 慧博投研 | www.hibor.com.cn/ | 研报最全（含历史），部分付费 |
| 研报客 fxbaogao | www.fxbaogao.com/ | PDF 直链多 |
| 新浪研报 | stock.finance.sina.com.cn/...vReport | 按股票代码检索 |

### 2. 找企业公告/定期报告 → 法定披露平台（最权威）
| 信源 | URL | 覆盖 |
|------|-----|------|
| **巨潮资讯网 cninfo** | www.cninfo.com.cn | A 股全部公告+定期报告（法定） |
| 上交所 | www.sse.com.cn | 沪市 |
| 深交所 | www.szse.cn | 深市 |
| 港交所披露易 | www1.hkexnews.hk | 港股 |
| SEC EDGAR | www.sec.gov | 美股 |

**业绩预告/快报/定期报告必须回法定披露平台核对**，媒体转述不算。

### 3. 找公司财报数据 → 定期报告 + 投资者关系页
- 财务三表：定期报告全文（巨潮）> 业绩预告 > 媒体汇总

### 4. 找财经新闻 → 权威财经媒体
| 信源 | URL | 侧重 |
|------|-----|------|
| 新华财经 | news.cn/fortune | 政策权威 |
| 财联社 | www.cls.cn | 实时快讯 |
| 第一财经 | www.yicai.com | 宏观/产业 |
| 证券时报/日报 | stcn.com / zqrb.cn | 上市公司 |
| 每经网 | www.nbd.com.cn | 深度报道 |

### 5. 找官方统计数据 → 部委官网（可信度最高，10 分）
| 信源 | URL | 数据 |
|------|-----|------|
| 国家统计局 | www.stats.gov.cn | 宏观、农业、CPI |
| 发改委 | www.ndrc.gov.cn | 价格监测、政策 |
| 工信部/海关/央行/财政部 | miit.gov.cn 等 | 工业/外贸/金融/财政 |

> 行业特定数据站（如生猪行业的中国养猪网、Mysteel 等）不在通用信源表内——按研究主题临时识别，用系统 `websearch` / `webfetch` 工具或 `fetch-source.ts` 获取。

## 🔧 脚本获取内容（bun 直接调用，三模式）

Skill 目录下有 4 个可直接运行的 bun 脚本，**直接返回内容本身**（非仅 URL）：
> 共享脚本（`stock.ts` 证券查询、`fetch-file.ts` PDF 提取、`evaluate.ts` 评估、`quality-screen.ts` 质量筛查）已解耦至 `.trae/scripts/`，**用法统一见 AGENTS.md「共享脚本用法」**，本 Skill 不再重复说明。

### 模式 1：信源导航（按类型推荐信源搜索 URL）
```bash
bun run .trae/skills/research-web-search/scripts/search.ts --list
bun run .trae/skills/research-web-search/scripts/search.ts --search "宁德时代" --type 公告
bun run .trae/skills/research-web-search/scripts/search.ts --search "猪价" --type 官方统计
```
→ 返回：匹配信源列表（名称 | 搜索 URL | 类型 | 说明）
> 注意：`search.ts` 不再提供通用网页搜索。需要通用搜索时请直接使用系统 `websearch` / `webfetch` 工具。

### 模式 2：URL 抓取正文 / 文件下载
```bash
bun run .trae/skills/research-web-search/scripts/fetch-source.ts <url>          # 抓正文（自动分类）
bun run .trae/skills/research-web-search/scripts/fetch-source.ts <url> --type 研报
bun run .trae/skills/research-web-search/scripts/fetch-source.ts --list          # 列出通用信源
```
→ PDF/文件下载提取 Markdown 用共享脚本 `fetch-file.ts`
> ⚠️ **研报/公告正文抓取统一走 `fetch-source.ts`**，不要直接用「WebFetch + `https://r.jina.ai/` 前缀」拼 URL——对东财（data.eastmoney.com）等目标站该方式会返回「正在进行安全验证」反爬页。`fetch-source.ts` 内部第一梯队即 r.jina.ai 并带自动降级，同 URL 可成功提取。

### 模式 3：板块成分股查询（产业调研前置）
```bash
bun run .trae/skills/research-web-search/scripts/sector.ts --search "电子"     # 搜索板块
bun run .trae/skills/research-web-search/scripts/sector.ts --code BK0429 --top 20  # 成分股按成交额排序
bun run .trae/skills/research-web-search/scripts/sector.ts --name "电子元件" --top 15
```
→ 返回：Markdown 表格（序号 | 代码 | 名称 | 最新价 | 涨跌幅 | 成交额 | 市盈率 | 市净率 | 换手率）

### 脚本工作流建议
1. 通用信息搜索 → 系统 `websearch` / `webfetch` 工具
2. 产业调研前置 → `sector.ts --search` 找板块 → `--code` 取成分股 → 用户选择重点公司
3. 公司维度 → 共享脚本 `stock.ts` 定位代码并拿公告/研报/财报PDF
4. 估值与评估 → 共享脚本 `evaluate.ts` 获取估值快照 + 四大师框架 + 10项财报精读
5. 深度原文 → `fetch-source.ts <url>` / 共享脚本 `fetch-file.ts` 提取 PDF Markdown
6. 抓取失败（反爬/JS 渲染）：先 `fetch-source.ts <url>`（内部 r.jina.ai + 自动降级）；仍失败用系统 `webfetch` 再试；仍失败标注「抓取失败，仅引用 URL」——**不要用「WebFetch + r.jina.ai 前缀」拼 URL**（东财等站点返回安全验证反爬页）

## 来源可信度分级
| 等级 | 来源类型 | 可信度 |
|------|---------|--------|
| A | 交易所公告、官方统计、公司财报 | 9-10 |
| B | 主流财经媒体、券商研报、行业权威机构 | 7-8 |
| C | 行业网站、自媒体、社区 | 5-6 |
| D | 匿名来源、付费墙未核实 | 1-4 |

## 执行步骤
1. 判断研究目标 → 按「信源导航」选定信源类型与获取方式（脚本 or 搜索）
2. 将查询分解为 3-5 个搜索子查询（覆盖：基本面 / 最新动态 / 数据 / 观点 / 风险）
3. 并行执行（websearch 工具 + 脚本：search / fetch-source / sector）
4. 对结果去重、按时效性排序（优先最近 90 天）
5. 对每条结果标注来源类型与可信度
6. 关键论点确保有权威来源支撑（≥1），核心数据至少 2 个独立来源佐证；来源不足时保留并标注，不以凑数为目标
7. 输出结构化 Markdown

## 输出格式
```markdown
### 搜索结果: [子查询]
- **[标题](URL)** | 来源: xxx | 来源类型: A/B/C/D | 时间: YYYY-MM-DD
  - 摘要: ...
  - 可信度: x/10
```

## 注意事项
- 优先权威来源；标注信息时效性；对付费墙内容标注「付费墙，未验证正文」
- 区分「事实」与「观点」：事实需可追溯，观点需注明主体
- 对同一数据出现多版本时，全部保留并标注差异，不要自行取舍
- 中英文关键词都要尝试；公司财报数据优先法定披露平台
- **业绩类数据（预告/快报/定期报告）必须回巨潮等法定披露平台核对原文**（用共享脚本 `stock.ts`）
- 研报里的预测数据（目标价、盈利预测）必须标注：预测主体 + 发布时点，不可作为事实
- 脚本测试：`bun test .trae/skills/research-web-search/scripts/`（测试用例见 scripts/*.test.ts）
