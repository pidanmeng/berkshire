/**
 * CrossValidator 阶段内自检脚本
 * 用法: bun run cross-validator.md.self-check.ts <validated-file-path>
 */

import { readFileSync } from "fs";

interface CheckResult {
  pass: boolean;
  score: number;
  issues: string[];
}

function check(validatedPath: string): CheckResult {
  const issues: string[] = [];
  let score = 10;

  try {
    const content = readFileSync(validatedPath, "utf-8");

    // 1. 检查验证结果总览表
    const hasOverview = /验证结果总览/.test(content);
    if (!hasOverview) issues.push("缺少验证结果总览表");

    // 2. 检查每条关键事实是否有置信度
    const confidenceMatches = content.match(/置信度[:：]\s*\d+/g) || [];
    const factRows = (content.match(/\|.*\|.*\|.*\|.*\|.*\d+.*\|/g) || []).length;
    if (confidenceMatches.length < 3 && factRows < 3) {
      issues.push("关键事实置信度评分不足");
      score -= 2;
    }

    // 3. 检查能力圈评估
    const hasAbilityCircle = /能力圈评估|在能力圈内|超出能力圈/.test(content);
    if (!hasAbilityCircle) {
      issues.push("缺少能力圈评估");
      score -= 2;
    }

    // 4. 检查管理层诚信检查
    const hasIntegrity = /管理层诚信|本分原则|一票否决/.test(content);
    if (!hasIntegrity) {
      issues.push("缺少管理层诚信检查");
      score -= 2;
    }

    // 5. 检查反共识独立思考
    const hasAntiConsensus = /反共识|市场共识|独立观察/.test(content);
    if (!hasAntiConsensus) {
      issues.push("缺少反共识独立思考");
      score -= 1;
    }

    // 6. 检查矛盾点标记
    const hasConflict = /矛盾|⚠️/.test(content);
    if (!hasConflict) {
      issues.push("未标记矛盾点（如确无矛盾，请显式标注「无矛盾」）");
    }

    // 7. 检查可写入知识库清单
    const hasKnowledgeList = /可写入知识库/.test(content);
    if (!hasKnowledgeList) issues.push("缺少可写入知识库清单");

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
    console.log("用法: bun run cross-validator.md.self-check.ts <validated-file-path>");
    process.exit(1);
  }
  const result = check(filePath);
  console.log(`# CrossValidator 自检报告: ${filePath}\n`);
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
