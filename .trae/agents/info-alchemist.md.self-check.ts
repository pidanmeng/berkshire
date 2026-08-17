/**
 * InfoAlchemist 阶段内自检脚本
 * 用法: bun run info-alchemist.md.self-check.ts <processed-file-path>
 */

import { readFileSync } from "fs";

interface CheckResult {
  pass: boolean;
  score: number;
  issues: string[];
}

function check(processedPath: string): CheckResult {
  const issues: string[] = [];
  let score = 10;

  try {
    const content = readFileSync(processedPath, "utf-8");

    // 1. 检查关键事实清单
    const hasFactTable = /关键事实清单/.test(content);
    if (!hasFactTable) issues.push("缺少关键事实清单表");

    // 2. 检查核心投资指标（四大师框架）
    const hasCoreMetrics = /核心投资指标|巴菲特|称重机/.test(content);
    if (!hasCoreMetrics) {
      issues.push("缺少核心投资指标提取（四大师框架）");
      score -= 2;
    }

    // 3. 检查生意模式数据 vs 周期性数据区分
    const hasBusinessModelData = /生意模式数据|周期性数据/.test(content);
    if (!hasBusinessModelData) {
      issues.push("未区分生意模式数据与周期性数据");
      score -= 1;
    }

    // 4. 检查标准化说明
    const hasStandardization = /标准化说明/.test(content);
    if (!hasStandardization) issues.push("缺少标准化说明");

    // 5. 检查数据来源锚点（每条数据应有 [[来源]] 或 URL）
    const rows = content.match(/\|.*\|/g) || [];
    let missingSourceCount = 0;
    for (const row of rows) {
      if (row.includes("事实") || row.includes("指标")) continue; // 跳过表头
      if (!row.includes("[[") && !row.includes("http")) {
        missingSourceCount++;
      }
    }
    if (missingSourceCount > 3) {
      issues.push(`多条数据缺少来源锚点（约 ${missingSourceCount} 条）`);
      score -= 1;
    }

    // 6. 检查数据缺口与矛盾标注
    const hasGaps = /数据缺口|矛盾/.test(content);
    if (!hasGaps) issues.push("缺少数据缺口或矛盾标注");

    // 7. 检查待验证点
    const hasVerifyPoints = /待验证点/.test(content);
    if (!hasVerifyPoints) issues.push("缺少待验证点清单");

  } catch (err) {
    issues.push(`读取文件失败: ${(err as Error).message}`);
    score = 0;
  }

  const pass = issues.length === 0 || score >= 7;
  return { pass, score: Math.max(0, score), issues };
}

if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log("用法: bun run info-alchemist.md.self-check.ts <processed-file-path>");
    process.exit(1);
  }
  const result = check(filePath);
  console.log(`# InfoAlchemist 自检报告: ${filePath}\n`);
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
