---
name: research-report-generator
description: 当需要生成最终投研报告、输出 Markdown/HTML 报告、设计可视化组件时使用。触发词：生成报告、写报告、输出报告、报告. 构建逻辑链条、提炼投资建议、ECharts 可视化、HTML 报告。
---

# 报告生成 Skill

## 设计规范（强制遵守）
编写 HTML 报告前**必须先读取**同目录下的 [design.md](design.md)，**严格遵守其中的设计规范**，包括但不限于：
- **Dark Mode 默认**（不做自动浅色检测，直接用 `--bg-page: #0b1020` 等暗色变量）
- 所有颜色、字号、间距**必须通过 CSS 变量引用**，不得硬编码 hex
- 色彩体系：品牌色 `--accent-primary: #5b8cff`（宝蓝），A 股红涨绿跌 `--fin-up/down`
- 星级评分：用 `★/☆/✩` 字符 + `.star-rating` 组件（配色 `--star-on: #fbbf24`）
- ECharts：每个图 merge `DARK_THEME_BASE` 配置，使用 `REPORT_PALETTE` 调色盘
- 报告区块顺序固定（12 步结构），详见 design.md 第 6 节
- **10 项自检必过**（design.md 第 10 节），完成后逐条打钩

## 能力范围
- 报告结构设计（结论前置、逻辑递进）
- **ECharts 可视化图表**（HTML 报告中使用，CDN 外链，按 design.md 第 5 节主题配置）
- Markdown 报告 + HTML 报告**双产物独立编写**
- 逻辑链条梳理（背景 → 驱动 → 验证 → 结论 → 风险 → 建议）
- 来源与验证附录

## 报告结构（按序）
1. 核心结论（带置信度，条数以最重要的发现为准，不强凑）
2. 研究背景与逻辑
3. 行业分析（产业链、竞争格局、驱动因素、周期位置）
4. 细分行业分析（赛道对比、优劣势）
5. 代表公司分析（覆盖主要商业模式差异的公司：经营数据、竞争优势、劣势与风险）
6. 关键数据与验证（指标表 + 置信度）
7. 风险提示
8. 投资建议（客观、非倾向性；附关键跟踪指标）
9. 附录：来源 / 验证日志 / 相关研究

## 双产物规范（核心）

### 1. Markdown 报告（`20-Reports/YYYY-MM-DD-主题-report.md`）
- 内容完整、数据可回溯（F 编号/来源锚点）
- 图表呈现方式自由：表格/文字为主，不需要 ECharts 块
- 是知识库的「文本存档」与阅读入口

### 2. HTML 报告（`20-Reports/YYYY-MM-DD-主题-report.html`）—— 独立编写
- **直接基于调研结果编写 HTML**（validated 数据 + 知识节点 + 原始数据）
- 可视化导向：图表 + 数据卡片 + 对比表，布局更紧凑
- **图表全部 ECharts，外链 CDN**：
  ```html
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
  ```
- 明暗主题：CSS 变量 + `prefers-color-scheme`；图表 `backgroundColor: "transparent"`
- 每个图表 `id` 唯一，`echarts.init(el).setOption({...})`

## 📊 ECharts 图表规范（HTML 报告）

### 基本结构
```html
<div id="chart-price" style="width:100%; height:360px; margin:16px 0;"></div>
<script>
  var chart = echarts.init(document.getElementById("chart-price"));
  chart.setOption({
    backgroundColor: "transparent",
    color: ["#b91c1c", "#2563eb", "#16a34a", "#d97706"],
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    title: { text: "图表标题", left: 0 },
    xAxis: { type: "category", data: [...] },
    yAxis: { type: "value" },
    series: [ ... ]
  });
</script>
```

### 常用图表类型与数据要求
| 场景 | 类型 | 要点 |
|------|------|------|
| 价格/指标趋势 | `line`（+smooth） | 数值标注 `label`，可加 `markLine` 关键线 |
| 公司/指标对比 | `bar` | `label: {show: true, position: "top"}` |
| 结构占比 | `pie` | `tooltip: {trigger: "item"}` |
| 产能/库存区间 | `bar` + `stack` / `markArea` | 区间上下限分两个 series |
| 周期阶段 | 横向 `bar` | 阶段时长/幅度 |

### 数据纪律
- 每个图表数据来自验证文件（F 编号可追溯），带单位与时点
- 图表下方小字标注：「数据来源：[[YYYY-MM-DD-主题-validated]] Fxx | 时点：2026-07」
- 低置信度数据（<7）在图内标注「存疑」
- 预测数据（目标价/盈利预测）标注预测主体与发布时点

### 明暗主题自适应（CSS）
```css
:root { --bg:#fff; --text:#1f2937; --muted:#6b7280; --accent:#b91c1c; --border:#e5e7eb; --card:#f9fafb; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111827; --text:#e5e7eb; --muted:#9ca3af; --accent:#f87171; --border:#374151; --card:#1f2937; }
}
body { background: var(--bg); color: var(--text); }
```
ECharts option 中文字颜色用 `#9ca3af`（暗色下也可见），或通过 JS 检测 `matchMedia('(prefers-color-scheme: dark)')` 动态设置。

### CDN 降级方案（网络不可用）
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js" onerror="window.__ECHARTS_FAIL=true"></script>
<script>
  if (window.__ECHARTS_FAIL) {
    document.querySelectorAll("[id^='chart-']").forEach(function(el){
      el.innerHTML = '<div style="padding:16px;border:1px dashed #ccc;color:#999;">图表加载失败（CDN 不可用），请查阅 Markdown 报告数据表</div>';
    });
  }
</script>
```

## 执行步骤
1. 读取知识库相关节点（`10-Knowledge/`）与验证文件（`00-Workspace/03-Validation/`）与原始数据
2. 构建逻辑链条（每一条核心结论必须能回溯到数据与来源）
3. 按模板生成 Markdown 报告（完整文字版）
4. 独立编写 HTML 报告：同一套结论，可视化重新组织（图表 + 数据卡 + 对比表）
5. 填充 frontmatter：`title`、`date`、`confidence`、`related_notes`、`validation_source`
6. 写入 `20-Reports/YYYY-MM-DD-主题-report.md` 与 `YYYY-MM-DD-主题-report.html`
7. 自检：有数据支撑的图表均已渲染（每图带数据锚点）、CDN 降级方案存在、数据锚点完整

## 注意事项
- 结论与证据分离呈现：观点必须有数据支撑，数据必须有来源
- 低置信度内容（<7 分）在报告中显式标注「存疑」
- 投资建议避免倾向性表述，使用「关注 / 跟踪」而非「买入 / 卖出」
- HTML 是独立编写的可视化产物，不是 md 的机械转换；两个产物内容一致但表达方式不同
- md 报告不需要 ECharts 块（除非作者偏好），HTML 报告必须有 ECharts
