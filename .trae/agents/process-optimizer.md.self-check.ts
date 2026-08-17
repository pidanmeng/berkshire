import { existsSync, readFileSync } from "node:fs";

const REQUIRED_SECTIONS = [
  "文档元信息与任务终态",
  "执行摘要",
  "任务目标、范围与成功标准",
  "本次任务全部产物清单",
  "用户/系统影响",
  "问题与证据",
  "优化需求清单",
  "非目标与明确排除项",
  "验收标准",
  "风险、兼容性与回滚考虑",
  "优先级与推荐状态",
];

const STATUSES = new Set(["success", "partial", "failed"]);
const REVIEW_STATUSES = new Set(["completed", "failed"]);
const ISSUE_STATUSES = new Set(["observing", "candidate"]);
const PROTECTED_PREFIXES = [".trae/", "AGENTS.md", "Research/99-Templates/", "Research/10-Knowledge/"];
const PROCESS_IMPROVEMENT_PREFIX = "Research/00-Workspace/06-Process-Improvement/";
const SENSITIVE = /(authorization\s*:|bearer\s+|cookie\s*:|private[_ -]?key|api[_ -]?key|secret\s*[=:]|process\.env|(?:TOKEN|PASSWORD|PASSWD|CREDENTIAL|ACCESS_KEY|SECRET|PRIVATE_KEY|API_KEY)\s*[=:]|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/i;

function checkSensitive(value: unknown, path = "root", issues: string[] = []): string[] {
  if (typeof value === "string" && SENSITIVE.test(value)) issues.push(`敏感字段: ${path}`);
  else if (Array.isArray(value)) value.forEach((entry, index) => checkSensitive(entry, `${path}[${index}]`, issues));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => {
    if (SENSITIVE.test(key)) issues.push(`敏感字段名: ${path}.${key}`);
    checkSensitive(entry, `${path}.${key}`, issues);
  });
  return issues;
}

function normalizePath(path: unknown): string {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

export interface SelfCheckResult {
  pass: boolean;
  issues: string[];
}

export function checkReview(markdownPath: string, jsonPath: string): SelfCheckResult {
  const issues: string[] = [];
  if (!existsSync(markdownPath)) issues.push(`Review Markdown 不存在: ${markdownPath}`);
  if (!existsSync(jsonPath)) issues.push(`Review JSON 不存在: ${jsonPath}`);
  if (issues.length > 0) return { pass: false, issues };

  const markdown = readFileSync(markdownPath, "utf-8");
  for (const section of REQUIRED_SECTIONS) {
    if (!markdown.includes(section)) issues.push(`PRD 缺少章节: ${section}`);
  }

  let review: any;
  try {
    review = JSON.parse(readFileSync(jsonPath, "utf-8"));
  } catch (error) {
    return { pass: false, issues: [...issues, `Review JSON 无法解析: ${(error as Error).message}`] };
  }

  if (review.schemaVersion !== "1.0" || !review.taskId || !review.command) issues.push("Review schema 缺少 schemaVersion/taskId/command");
  if (review.origin !== "process-improvement") issues.push("origin 必须为 process-improvement");
  if (!STATUSES.has(review.status)) issues.push(`非法任务状态: ${String(review.status)}`);
  if (!REVIEW_STATUSES.has(review.reviewStatus)) issues.push(`非法 Review 状态: ${String(review.reviewStatus)}`);
  issues.push(...checkSensitive(review));
  if (!Array.isArray(review.artifacts) || review.artifacts.length === 0) {
    issues.push("产物清单为空");
  } else {
    review.artifacts.forEach((artifact: any, index: number) => {
      if (!artifact.path || !artifact.type || !artifact.status || typeof artifact.exists !== "boolean") {
        issues.push(`产物 ${index + 1} 缺少 path/type/status/exists`);
      }
    });
  }

  if (!Array.isArray(review.issues)) {
    issues.push("issues 必须为数组");
  } else {
    review.issues.forEach((item: any, index: number) => {
      const required = ["problemCode", "targetKind", "targetPath", "symptom", "evidence", "rootCauseHypothesis", "goal", "severity", "confidence", "benefit", "risk", "acceptance"];
      for (const field of required) {
        if (item[field] === undefined || item[field] === "" || (field === "evidence" && (!Array.isArray(item[field]) || item[field].length === 0))) {
          issues.push(`优化点 ${index + 1} 缺少 ${field}`);
        }
      }
      if (!ISSUE_STATUSES.has(item.recommendedStatus)) issues.push(`优化点 ${index + 1} 状态非法: ${String(item.recommendedStatus)}`);
    });
  }

  const modifiedPaths = Array.isArray(review.modifiedPaths) ? review.modifiedPaths.map(normalizePath) : [];
  if (!review.approvedBatchId) {
    for (const path of modifiedPaths) {
      if (path !== PROCESS_IMPROVEMENT_PREFIX.slice(0, -1) && !path.startsWith(PROCESS_IMPROVEMENT_PREFIX)) issues.push(`未批准阶段写入路径不在 06 目录: ${path}`);
      if (PROTECTED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix))) issues.push(`未批准阶段声明修改受保护路径: ${path}`);
    }
  } else {
    if (review.approvalValidated !== true) issues.push("已批准任务缺少 approvalValidated=true");
    if (!Array.isArray(review.approvedPaths)) issues.push("已批准任务缺少 approvedPaths");
    else {
      const approvedPaths = new Set(review.approvedPaths.map(normalizePath));
      const unexpected = modifiedPaths.filter(path => !approvedPaths.has(path));
      if (unexpected.length > 0) issues.push(`实际文件集合超出批准集合: ${unexpected.join(", ")}`);
    }
  }

  return { pass: issues.length === 0, issues };
}

if (import.meta.main) {
  const markdownPath = process.argv[2];
  const jsonPath = process.argv[3];
  if (!markdownPath || !jsonPath) {
    console.error("用法: bun run process-optimizer.md.self-check.ts <review-md> <review-json>");
    process.exit(1);
  }
  const result = checkReview(markdownPath, jsonPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}
