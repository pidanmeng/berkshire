/**
 * ReportWriter 阶段内自检脚本
 * 用法: bun run report-writer.md.self-check.ts <report-md-path> [report-html-path]
 */

import { readFileSync, existsSync } from "fs";

interface CheckResult {
  pass: boolean;
  score: number;
  issues: string[];
}

function check(mdPath: string, htmlPath?: string): CheckResult {
  const issues: string[] = [];
  let score = 10;

  try {
    const mdContent = readFileSync(mdPath, "utf-8");

    // 1. 检查 frontmatter
    const hasFrontmatter = /^---\n[\s\S]*?\n---/.test(mdContent);
    if (!hasFrontmatter) issues.push("缺少 frontmatter");

    // 2. 检查核心结论
    const hasConclusion = /核心结论/.test(mdContent);
    if (!hasConclusion) issues.push("缺少核心结论章节");

    // 3. 检查护城河评估
    const hasMoat = /护城河|护城河评估/.test(mdContent);
    if (!hasMoat) {
      issues.push("报告缺少护城河评估");
      score -= 2;
    }

    // 4. 检查反向检查清单
    const hasChecklist = /反向检查清单/.test(mdContent);
    if (!hasChecklist) {
      issues.push("缺少反向检查清单（芒格框架）");
      score -= 2;
    }

    // 5. 检查历史类比
    const hasAnalogy = /历史类比/.test(mdContent);
    if (!hasAnalogy) {
      issues.push("缺少历史类比（李录框架）");
      score -= 1;
    }

    // 6. 检查跟踪指标
    const hasTracking = /跟踪指标/.test(mdContent);
    if (!hasTracking) {
      issues.push("缺少跟踪指标设定");
      score -= 1;
    }

    // 7. 检查能力圈声明
    const hasAbilityCircle = /能力圈|超出能力圈/.test(mdContent);
    if (!hasAbilityCircle) {
      issues.push("缺少能力圈声明");
      score -= 1;
    }

    // 7.1 检查多空论证呈现与综合裁决（依据 deep-read 第十章）
    const hasBullBear = /多方|空方|Bull|Bear|🟢|🔴/.test(mdContent);
    if (!hasBullBear) {
      issues.push("报告未呈现多空双方论点（Bull/Bear Case）");
      score -= 1;
    }
    const hasAdjudication = /裁决|外围因素|产业|周期|国际形势|政策形势/.test(mdContent);
    if (!hasAdjudication) {
      issues.push("多空分歧未结合产业/周期/国际/政策等外围因素裁决");
      score -= 1;
    }

    // 7.2 检查增长驱动分析（当前是否高增长、促成原因、内因/外因与企业主导性、可持续性）
    const hasGrowthStage = /高增长|高成长|增速/.test(mdContent);
    if (!hasGrowthStage) {
      issues.push("增长驱动分析缺失：未判断企业是否处于高增长阶段");
      score -= 1;
    }
    const hasGrowthCause = /增长.*(促成|驱动|归因|原因|量价)|内因|外因|主导/.test(mdContent);
    if (!hasGrowthCause) {
      issues.push("增长驱动分析缺失：未说明当前增长促成原因或内因/外因与企业主导性");
      score -= 1;
    }

    // 7.3 检查核心优势可持续性分析（识别优势维度并与同行/行业对比 + 维持/侵蚀风险）
    const hasAdvantageCompare = /(优势|竞争力|领先).*(行业|同业|均值|对比|平均)|(毛利率|净利率|ROE|市占率|增速).*(行业|同业|均值|对比|平均)/.test(mdContent);
    if (!hasAdvantageCompare) {
      issues.push("核心优势可持续性分析缺失：未识别企业优势维度并与同行/行业对比");
      score -= 1;
    }
    const hasAdvantageSustain = /(优势|竞争力|领先).*(维持|侵蚀|收窄|扩大|下滑|下降|趋势|可持续)|(维持|侵蚀|收窄).*(优势|竞争力)/.test(mdContent);
    if (!hasAdvantageSustain) {
      issues.push("核心优势可持续性分析缺失：未判断优势维持能力或被侵蚀风险");
      score -= 1;
    }

    // 8. 检查数据支撑
    const tableRows = (mdContent.match(/\|.*\|.*\|.*\|/g) || []).length;
    if (tableRows < 3) {
      issues.push("数据表格过少，可能缺乏数据支撑");
      score -= 1;
    }

    // 9. 检查 HTML 报告（强制遵守 design.md 规范）
    if (htmlPath) {
      if (!existsSync(htmlPath)) {
        issues.push(`HTML 报告不存在: ${htmlPath}`);
        score -= 2;
      } else {
        const htmlContent = readFileSync(htmlPath, "utf-8");

        // 9.1 Dark Mode 默认（禁止 prefers-color-scheme 自动切换，必须用直接 --bg-page）
        const hasDarkBg = /--bg-page\s*:\s*#0b1020/.test(htmlContent);
        if (!hasDarkBg) { issues.push("HTML 未按 design.md 设置 Dark Mode 默认（--bg-page: #0b1020 缺失）"); score -= 2; }

        // 9.2 CSS 变量体系（不允许硬编码颜色）
        const hasCssVars = /:root\s*\{[\s\S]*?--bg-page|--bg-card|--text-primary/.test(htmlContent);
        if (!hasCssVars) { issues.push("HTML 缺少 CSS 变量体系（:root 变量块缺失）"); score -= 2; }

        // 9.3 ECharts CDN 固定版本 5.5.x
        const hasEChartsFixedVersion = /echarts@5\.5\.\d\/dist\/echarts\.min\.js/.test(htmlContent);
        if (!hasEChartsFixedVersion) { issues.push("ECharts CDN 版本未锁定（需使用 echarts@5.5.x 固定版本）"); score -= 1; }

        // 9.4 图表/评分实际渲染（至少有一个 chart 容器或评分组件）
        const hasChartInit = /echarts\.init/.test(htmlContent);
        if (!hasChartInit) issues.push("HTML 报告未实际调用 echarts.init() 渲染图表");

        // 9.5 DARK_THEME_BASE 主题 merge
        const hasDarkTheme = /DARK_THEME_BASE|backgroundColor.*transparent/.test(htmlContent);
        if (!hasDarkTheme) issues.push("ECharts 未 merge DARK_THEME_BASE 暗色主题（backgroundColor 需 transparent）");

        // 9.6 A 股红涨绿跌色（--fin-up 红/--fin-down 绿 或 CSS 里显式声明）
        const hasFinSemantic = /--fin-up|--fin-down|ef4444|#ef4444|#22c55e/.test(htmlContent);
        if (!hasFinSemantic) issues.push("未声明 A 股红涨绿跌金融语义色（--fin-up/--fin-down 缺失）");

        // 9.7 星级评分组件（★ 字符至少出现 5 次，或 --star-on 声明）
        const hasStarSystem = /--star-on|star-rating|★/.test(htmlContent);
        if (!hasStarSystem) issues.push("未声明星级评分系统（--star-on/star-rating 缺失）");

        // 9.8 响应式移动端适配
        const hasResponsive = /@media\s*\(max-width.*640/.test(htmlContent);
        if (!hasResponsive) issues.push("缺少 640px 以下移动端响应式适配（@media max-width:640px）");

        // 9.9 页脚免责声明
        const hasDisclaimer = /免责声明|不构成任何投资建议|市场有风险/.test(htmlContent);
        if (!hasDisclaimer) { issues.push("页脚缺失合规免责声明"); score -= 1; }

        // 9.10 ECharts CDN 降级脚本
        const hasFallback = /__ECHARTS_FAIL|图表加载失败|CDN 不可用/.test(htmlContent);
        if (!hasFallback) issues.push("缺少 ECharts CDN 加载失败降级脚本");
      }
    }

    // 10. 检查投资建议的措辞
    const badWords = /强烈买入|强烈卖出|必涨|必跌|抄底|逃顶/.test(mdContent);
    if (badWords) {
      issues.push("投资建议中存在不本分的措辞（如「强烈买入」「必涨」等）");
      score -= 2;
    }

  } catch (err) {
    issues.push(`读取文件失败: ${(err as Error).message}`);
    score = 0;
  }

  const pass = issues.length === 0 || score >= 7;
  return { pass, score: Math.max(0, score), issues };
}

if (import.meta.main) {
  const mdPath = process.argv[2];
  const htmlPath = process.argv[3];
  if (!mdPath) {
    console.log("用法: bun run report-writer.md.self-check.ts <report-md-path> [report-html-path]");
    process.exit(1);
  }
  const result = check(mdPath, htmlPath);
  console.log(`# ReportWriter 自检报告: ${mdPath}\n`);
  console.log(`- 评分: ${result.score}/10`);
  console.log(`- 结果: ${result.pass ? "✅ 通过" : "❌ 不通过"}\n`);
  if (result.issues.length > 0) {
    console.log("## 问题清单");
    result.issues.forEach((issue, i) => console.log(`${i + 1}. ❌ ${issue}`));
  } else {
    console.log("✅ 所有检查项通过");
  }
  process.exit(result.pass ? 0 : 1);
}

export { check };
