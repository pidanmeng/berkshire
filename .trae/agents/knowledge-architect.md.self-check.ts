/**
 * KnowledgeArchitect 阶段内自检脚本
 * 用法: bun run knowledge-architect.md.self-check.ts <knowledge-dir-or-file>
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

interface CheckResult {
  pass: boolean;
  score: number;
  issues: string[];
}

function getAllMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getAllMarkdownFiles(fullPath));
      } else if (entry.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch {
    // 如果是单个文件
    if (dir.endsWith(".md")) files.push(dir);
  }
  return files;
}

function checkCompanyNote(content: string, fileName: string): string[] {
  const issues: string[] = [];

  // 检查 properties
  if (!/type:\s*"company"/.test(content)) issues.push(`${fileName}: 缺少 type: company`);

  // 检查护城河评估
  const hasMoat = /护城河|护城河评估/.test(content);
  if (!hasMoat) issues.push(`${fileName}: 缺少护城河评估`);

  // 检查生意模式评价
  const hasBusinessModel = /生意模式|怎么赚钱/.test(content);
  if (!hasBusinessModel) issues.push(`${fileName}: 缺少生意模式评价`);

  // 检查管理层诚信
  const hasIntegrity = /管理层诚信|本分原则/.test(content);
  if (!hasIntegrity) issues.push(`${fileName}: 缺少管理层诚信检查`);

  // 检查跟踪指标
  const hasTracking = /跟踪指标/.test(content);
  if (!hasTracking) issues.push(`${fileName}: 缺少跟踪指标`);

  // 检查估值追踪结构化字段（frontmatter）
  const hasScores = /^scores:/m.test(content)
    && ["capability", "moat", "business_model", "management", "inversion", "historical"]
      .filter(k => new RegExp(`^\\s{2}${k}:`,"m").test(content)).length >= 6;
  if (!hasScores) issues.push(`${fileName}: 缺少 scores 六维十分制字段（capability/moat/business_model/management/inversion/historical）`);
  const hasTargetCap = /^target_market_cap_yi:/m.test(content)
    && /pessimistic:/.test(content) && /neutral:/.test(content) && /optimistic:/.test(content);
  if (!hasTargetCap) issues.push(`${fileName}: 缺少 target_market_cap_yi 目标市值字段（pessimistic/neutral/optimistic）`);
  const hasForwardPe = /^forward_pe:/m.test(content)
    && /value:/.test(content) && /base_net_profit_yi:/.test(content) && /base_period:/.test(content);
  if (!hasForwardPe) issues.push(`${fileName}: 缺少 forward_pe 字段（value/base_net_profit_yi/base_period）`);
  // 检查估值模型与参数明细（正文章节 + frontmatter valuation_model）
  const hasVmSection = /估值模型与参数明细/.test(content);
  if (!hasVmSection) issues.push(`${fileName}: 缺少「估值模型与参数明细」章节（模型选择/参数明细/敏感性）`);
  const hasVmFm = /^valuation_model:/m.test(content)
    && /model:/.test(content) && /base_period:/.test(content) && /parameters:/.test(content)
    && /pessimistic:/.test(content) && /neutral:/.test(content) && /optimistic:/.test(content);
  if (!hasVmFm) issues.push(`${fileName}: 缺少 valuation_model 字段（model/base_period/parameters 三情景）`);
  const hasCutoff = /^research_cutoff:/m.test(content)
    && /report_period:/.test(content) && /report_date:/.test(content) && /announcement_date:/.test(content);
  if (!hasCutoff) issues.push(`${fileName}: 缺少 research_cutoff 字段（report_period/report_date/announcement_date）`);

  // 检查双链
  const wikiLinks = content.match(/\[\[[^\]]+\]\]/g) || [];
  if (wikiLinks.length < 2) issues.push(`${fileName}: 双链过少（建议至少关联行业/细分/竞争对手）`);

  return issues;
}

function check(knowledgePath: string): CheckResult {
  const issues: string[] = [];
  let score = 10;

  try {
    const files = getAllMarkdownFiles(knowledgePath);
    if (files.length === 0) {
      issues.push("未找到任何知识库文件");
      return { pass: false, score: 0, issues };
    }

    // 检查三段式目录结构
    const hasIndustryOverview = files.some(f => f.includes("00-行业概览") || f.includes("行业全景"));
    const hasSubIndustry = files.some(f => f.includes("01-细分行业"));
    const hasCompany = files.some(f => f.includes("02-公司研究"));

    if (!hasIndustryOverview) issues.push("缺少 00-行业概览 内容");
    if (!hasSubIndustry) issues.push("缺少 01-细分行业 内容");
    if (!hasCompany) issues.push("缺少 02-公司研究 内容");

    // 检查公司笔记质量
    const companyFiles = files.filter(f => f.includes("02-公司研究") || f.includes("公司概览"));
    for (const cf of companyFiles) {
      try {
        const content = readFileSync(cf, "utf-8");
        const fileIssues = checkCompanyNote(content, cf.split(/[\\/]/).pop() || cf);
        issues.push(...fileIssues);
      } catch {
        issues.push(`无法读取 ${cf}`);
      }
    }

    // 扣分逻辑
    const companyIssues = issues.filter(i => i.includes("02-公司研究") || i.includes("公司概览"));
    if (companyIssues.length > 5) score -= 2;
    if (issues.length > 10) score -= 2;

  } catch (err) {
    issues.push(`检查失败: ${(err as Error).message}`);
    score = 0;
  }

  const pass = issues.length === 0 || score >= 7;
  return { pass, score: Math.max(0, score), issues };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.log("用法: bun run knowledge-architect.md.self-check.ts <knowledge-dir-or-file>");
    process.exit(1);
  }
  const result = check(path);
  console.log(`# KnowledgeArchitect 自检报告: ${path}\n`);
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
