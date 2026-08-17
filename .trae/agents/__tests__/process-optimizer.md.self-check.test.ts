import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkReview } from "../process-optimizer.md.self-check";

const DIR = join(import.meta.dir, "tmp-process-optimizer");
const sections = [
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

afterEach(() => rmSync(DIR, { recursive: true, force: true }));

function paths() {
  mkdirSync(DIR, { recursive: true });
  const md = join(DIR, "review.md");
  const json = join(DIR, "review.json");
  writeFileSync(md, sections.map(section => `## ${section}\n内容`).join("\n"));
  return { md, json };
}

function validReview() {
  return {
    schemaVersion: "1.0",
    taskId: "task-1",
    origin: "process-improvement",
    command: "/research 示例",
    status: "success",
    reviewStatus: "completed",
    artifacts: [{ path: "Research/output.md", type: "report", status: "created", exists: true }],
    issues: [{
      problemCode: "MISSING-REVIEW",
      targetKind: "agent",
      targetPath: ".trae/agents/info-hunter.md",
      symptom: "缺失",
      evidence: [{ grade: "B", detail: "运行记录" }],
      rootCauseHypothesis: "契约缺失",
      goal: "补齐",
      severity: "high",
      confidence: 0.9,
      benefit: "闭环",
      risk: "成本",
      acceptance: "存在 Review",
      recommendedStatus: "candidate",
    }],
  };
}

describe("process optimizer self check", () => {
  test("完整 Review 通过", () => {
    const { md, json } = paths();
    writeFileSync(json, JSON.stringify(validReview()));
    expect(checkReview(md, json)).toEqual({ pass: true, issues: [] });
  });

  test("缺章节、空产物和未批准越出 06 目录失败", () => {
    const { md, json } = paths();
    writeFileSync(md, "## 执行摘要\n内容");
    const review = validReview();
    review.artifacts = [];
    Object.assign(review, { modifiedPaths: [".trae/agents/info-hunter.md"] });
    writeFileSync(json, JSON.stringify(review));
    const result = checkReview(md, json);
    expect(result.pass).toBe(false);
    expect(result.issues.some(issue => issue.includes("PRD 缺少章节"))).toBe(true);
    expect(result.issues).toContain("产物清单为空");
    expect(result.issues.some(issue => issue.includes("06 目录"))).toBe(true);
  });

  test("批准阶段校验批准标记与实际文件集合", () => {
    const { md, json } = paths();
    const review = validReview();
    Object.assign(review, {
      approvedBatchId: "batch-1",
      approvalValidated: true,
      approvedPaths: [".trae/agents/info-hunter.md"],
      modifiedPaths: [".trae/agents/info-hunter.md"],
    });
    writeFileSync(json, JSON.stringify(review));
    expect(checkReview(md, json).pass).toBe(true);
    Object.assign(review, { approvalValidated: false, modifiedPaths: ["AGENTS.md"] });
    writeFileSync(json, JSON.stringify(review));
    const result = checkReview(md, json);
    expect(result.issues).toContain("已批准任务缺少 approvalValidated=true");
    expect(result.issues.some(issue => issue.includes("实际文件集合超出批准集合"))).toBe(true);
  });

  test("全字段敏感检测覆盖非 evidence 字段", () => {
    const { md, json } = paths();
    const review = validReview();
    review.issues[0].risk = "PASSWORD=unsafe";
    writeFileSync(json, JSON.stringify(review));
    const result = checkReview(md, json);
    expect(result.pass).toBe(false);
    expect(result.issues.some(issue => issue.includes("敏感字段"))).toBe(true);
  });
});
