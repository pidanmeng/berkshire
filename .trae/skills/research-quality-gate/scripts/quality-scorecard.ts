/**
 * 阶段间验收评分卡
 *
 * 用法：
 *   bun run quality-scorecard.ts --phase 1 --file <file-path> --mode standard
 *   bun run quality-scorecard.ts --phase 3 --file <validated-path> --mode deep
 *
 * 评分维度：完整性(0-10) + 准确性(0-10) + 投资视角(0-10) = 总分(0-30)
 *   <24  → 拒绝通过
 *   24-28 → 有条件通过（标注风险）
 *   28-30 → 完全通过
 */

import { readFileSync } from "fs";

interface ScoreResult {
  completeness: number;
  accuracy: number;
  investmentView: number;
  total: number;
  verdict: "pass" | "conditional" | "fail";
  issues: string[];
}

function evaluatePhase1(content: string, mode: string): ScoreResult {
  let completeness = 10;
  let accuracy = 10;
  let investmentView = 10;
  const issues: string[] = [];

  // 完整性检查
  const hasLayer1 = /第 1 层[:：]\s*行业级/.test(content);
  const hasLayer2 = /第 2 层[:：]\s*细分行业级/.test(content);
  const hasLayer3 = /第 3 层[:：]\s*公司级/.test(content);
  if (!hasLayer1 || !hasLayer2 || !hasLayer3) {
    issues.push("三层结构不完整");
    completeness -= 3;
  }

  const sourceMatches = content.match(/来源\d+[:：]/g) || [];
  if (sourceMatches.length < (mode === "deep" ? 8 : 5)) {
    issues.push(`来源数量不足: ${sourceMatches.length}`);
    completeness -= 2;
  }

  // 准确性检查
  const urlMatches = content.match(/https?:\/\//g) || [];
  if (urlMatches.length === 0) {
    issues.push("缺少 URL 来源锚点");
    accuracy -= 3;
  }

  const hasVerifyPoints = /待验证点/.test(content);
  if (!hasVerifyPoints) {
    issues.push("缺少待验证点清单");
    accuracy -= 1;
  }

  // 投资视角检查
  const hasBafeite = /巴菲特|护城河/.test(content);
  const hasMangge = /芒格|逆向思维/.test(content);
  const hasDuan = /段永平|生意模式/.test(content);
  const hasLilu = /李录|文明趋势/.test(content);
  const missingViews = [!hasBafeite, !hasMangge, !hasDuan, !hasLilu].filter(Boolean).length;
  if (missingViews > 0) {
    issues.push(`缺少 ${missingViews} 个四大师视角搜索`);
    investmentView -= missingViews * 2;
  }

  const hasBiasCheck = /研究偏见|反向关键词/.test(content);
  if (!hasBiasCheck) {
    issues.push("缺少研究偏见校验");
    investmentView -= 1;
  }

  return finalizeScore(completeness, accuracy, investmentView, issues);
}

function evaluatePhase3(content: string, mode: string): ScoreResult {
  let completeness = 10;
  let accuracy = 10;
  let investmentView = 10;
  const issues: string[] = [];

  // 完整性
  const hasOverview = /验证结果总览/.test(content);
  if (!hasOverview) {
    issues.push("缺少验证结果总览表");
    completeness -= 3;
  }

  const hasKnowledgeList = /可写入知识库/.test(content);
  if (!hasKnowledgeList) {
    issues.push("缺少可写入知识库清单");
    completeness -= 2;
  }

  // 准确性
  const confidenceMatches = content.match(/置信度[:：]\s*\d+/g) || [];
  if (confidenceMatches.length < 3) {
    issues.push("关键事实置信度评分不足");
    accuracy -= 3;
  }

  const hasConflict = /矛盾|⚠️/.test(content);
  if (!hasConflict) {
    issues.push("未标记矛盾点");
    accuracy -= 1;
  }

  // 投资视角
  const hasAbilityCircle = /能力圈评估|在能力圈内|超出能力圈/.test(content);
  if (!hasAbilityCircle) {
    issues.push("缺少能力圈评估");
    investmentView -= 3;
  }

  const hasIntegrity = /管理层诚信|本分原则/.test(content);
  if (!hasIntegrity) {
    issues.push("缺少管理层诚信检查");
    investmentView -= 3;
  }

  const hasAntiConsensus = /反共识|市场共识/.test(content);
  if (!hasAntiConsensus) {
    issues.push("缺少反共识独立思考");
    investmentView -= 1;
  }

  return finalizeScore(completeness, accuracy, investmentView, issues);
}

function evaluatePhase5(content: string, _mode: string): ScoreResult {
  let completeness = 10;
  let accuracy = 10;
  let investmentView = 10;
  const issues: string[] = [];

  // 完整性
  const hasConclusion = /核心结论/.test(content);
  const hasRisk = /风险提示/.test(content);
  const hasAdvice = /投资建议/.test(content);
  if (!hasConclusion || !hasRisk || !hasAdvice) {
    issues.push("报告结构不完整（缺少核心结论/风险提示/投资建议）");
    completeness -= 3;
  }

  // 准确性
  const tableRows = (content.match(/\|.*\|.*\|.*\|/g) || []).length;
  if (tableRows < 3) {
    issues.push("数据表格过少");
    accuracy -= 2;
  }

  // 投资视角
  const checks = [
    { name: "护城河评估", pattern: /护城河|护城河评估/, weight: 3 },
    { name: "反向检查清单", pattern: /反向检查清单/, weight: 3 },
    { name: "历史类比", pattern: /历史类比/, weight: 2 },
    { name: "跟踪指标", pattern: /跟踪指标/, weight: 1 },
    { name: "能力圈声明", pattern: /能力圈|超出能力圈/, weight: 1 },
  ];
  for (const check of checks) {
    if (!check.pattern.test(content)) {
      issues.push(`缺少 ${check.name}`);
      investmentView -= check.weight;
    }
  }

  const badWords = /强烈买入|强烈卖出|必涨|必跌/.test(content);
  if (badWords) {
    issues.push("投资建议存在不本分措辞");
    investmentView -= 2;
  }

  return finalizeScore(completeness, accuracy, investmentView, issues);
}

function finalizeScore(c: number, a: number, i: number, issues: string[]): ScoreResult {
  const completeness = Math.max(0, c);
  const accuracy = Math.max(0, a);
  const investmentView = Math.max(0, i);
  const total = completeness + accuracy + investmentView;
  let verdict: "pass" | "conditional" | "fail";
  if (total >= 28) verdict = "pass";
  else if (total >= 24) verdict = "conditional";
  else verdict = "fail";
  return { completeness, accuracy, investmentView, total, verdict, issues };
}

function evaluate(phase: number, content: string, mode: string): ScoreResult {
  switch (phase) {
    case 1: return evaluatePhase1(content, mode);
    case 3: return evaluatePhase3(content, mode);
    case 5: return evaluatePhase5(content, mode);
    default:
      return finalizeScore(10, 10, 10, ["该阶段暂无详细评分规则，默认通过"]);
  }
}

function usage(): never {
  console.log(`
阶段间验收评分卡

用法:
  bun run quality-scorecard.ts --phase <1|3|5> --file <path> [--mode standard|deep|fast]

示例:
  bun run quality-scorecard.ts --phase 1 --file raw.md --mode standard
  bun run quality-scorecard.ts --phase 3 --file validated.md --mode deep
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const phaseIdx = args.indexOf("--phase");
  const fileIdx = args.indexOf("--file");
  const modeIdx = args.indexOf("--mode");

  if (phaseIdx < 0 || fileIdx < 0) usage();

  const phase = parseInt(args[phaseIdx + 1], 10);
  const filePath = args[fileIdx + 1];
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : "standard";

  if (![1, 2, 3, 4, 5].includes(phase) || !filePath) usage();

  try {
    const content = readFileSync(filePath, "utf-8");
    const result = evaluate(phase, content, mode);

    console.log(`# Phase ${phase} 验收评分卡\n`);
    console.log(`- 文件: ${filePath}`);
    console.log(`- 模式: ${mode}\n`);
    console.log(`| 维度 | 得分 | 权重 |`);
    console.log(`|------|------|------|`);
    console.log(`| 完整性 | ${result.completeness}/10 | 33% |`);
    console.log(`| 准确性 | ${result.accuracy}/10 | 33% |`);
    console.log(`| 投资视角 | ${result.investmentView}/10 | 33% |`);
    console.log(`| **总分** | **${result.total}/30** | — |\n`);

    const verdictMap = { pass: "✅ 完全通过", conditional: "⚠️ 有条件通过", fail: "❌ 拒绝通过" };
    console.log(`-  verdict: ${verdictMap[result.verdict]}\n`);

    if (result.issues.length > 0) {
      console.log("## 问题清单");
      result.issues.forEach((issue, i) => console.log(`${i + 1}. ❌ ${issue}`));
    } else {
      console.log("✅ 所有检查项通过");
    }

    process.exit(result.verdict === "fail" ? 1 : 0);
  } catch (err) {
    console.error(`❌ 评分失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
export { evaluate };
