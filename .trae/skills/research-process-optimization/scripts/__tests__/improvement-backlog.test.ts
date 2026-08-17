import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWrite,
  buildBatch,
  canonicalizeTargetPath,
  createFingerprint,
  markApplied,
  recordDecision,
  recordVerification,
  resolveProcessImprovementPath,
  saveBacklog,
  upsertReview,
  validateBatchFileSet,
  type Backlog,
  type ReviewDocument,
} from "../improvement-backlog";

const ROOT = join(import.meta.dir, "tmp-workspace");
const NOW = new Date("2026-08-15T08:00:00.000Z");

function backlog(): Backlog {
  return { schemaVersion: "1.0", updatedAt: new Date(0).toISOString(), items: [], batches: [] };
}

function review(taskId: string, severity: "critical" | "high" | "medium" | "low" = "medium", grade: "A" | "B" | "C" | "D" = "C"): ReviewDocument {
  return {
    schemaVersion: "1.0",
    taskId,
    origin: "process-improvement",
    command: "/research 示例",
    status: "success",
    issues: [{
      problemCode: "MISSING-REVIEW",
      targetKind: "agent",
      targetPath: ".trae/agents/info-hunter.md",
      symptom: "任务终态未生成 Review",
      evidence: [{ grade, detail: `任务 ${taskId} 的运行记录` }],
      rootCauseHypothesis: "缺少全局契约",
      goal: "正式任务结束后生成 Review",
      severity,
      confidence: 0.9,
      benefit: "提升持续改进闭环",
      risk: "增加少量运行成本",
      acceptance: "终态存在 Review JSON 与 Markdown",
    }],
  };
}

beforeEach(() => mkdirSync(ROOT, { recursive: true }));
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("improvement backlog", () => {
  test("稳定指纹使用规范路径和问题码", () => {
    const path = canonicalizeTargetPath(ROOT, ".trae\\agents\\info-hunter.md");
    expect(path).toBe(".trae/agents/info-hunter.md");
    expect(createFingerprint("Agent", path, "MISSING-REVIEW")).toBe(createFingerprint("agent", path, "missing review"));
    expect(() => canonicalizeTargetPath(ROOT, "../escape.md")).toThrow();
  });

  test("中低严重度需跨两个任务才从 observing 升级 candidate", () => {
    const first = upsertReview(backlog(), review("task-1"), ROOT, NOW);
    expect(first.items[0].status).toBe("observing");
    const second = upsertReview(first, review("task-2"), ROOT, new Date("2026-08-16T08:00:00.000Z"));
    expect(second.items).toHaveLength(1);
    expect(second.items[0].status).toBe("candidate");
    expect(second.items[0].occurrenceCount).toBe(2);
  });

  test("高严重度 B 级证据单次进入 candidate", () => {
    const result = upsertReview(backlog(), review("task-1", "high", "B"), ROOT, NOW);
    expect(result.items[0].status).toBe("candidate");
  });

  test("拒绝任意字段中的敏感信息、非法 schema 和非流程优化 origin", () => {
    const sensitive = review("task-1", "high", "B");
    sensitive.issues[0].benefit = "API_KEY=abc";
    expect(() => upsertReview(backlog(), sensitive, ROOT, NOW)).toThrow("敏感");
    const invalidSchema = review("task-2");
    invalidSchema.schemaVersion = "2.0";
    expect(() => upsertReview(backlog(), invalidSchema, ROOT, NOW)).toThrow("schema");
    const invalid = review("task-3") as ReviewDocument;
    Object.assign(invalid, { origin: "research" });
    expect(() => upsertReview(backlog(), invalid, ROOT, NOW)).toThrow("origin");
  });

  test("流程优化输入输出路径只能位于 06 目录", () => {
    expect(resolveProcessImprovementPath(ROOT, "Research/00-Workspace/06-Process-Improvement/review.json")).toContain("06-Process-Improvement");
    expect(() => resolveProcessImprovementPath(ROOT, "Research/00-Workspace/05-Metrics/review.json")).toThrow("06 目录");
  });

  test("批次仅收 candidate 且部分批准生成独立子批次", () => {
    let state = upsertReview(backlog(), review("task-1", "high", "B"), ROOT, NOW);
    const other = review("task-2", "critical", "A");
    other.issues[0].problemCode = "BROKEN-GATE";
    other.issues[0].targetPath = ".trae/agents/cross-validator.md";
    state = upsertReview(state, other, ROOT, NOW);
    const built = buildBatch(state, NOW);
    expect(built.batch?.itemFingerprints).toHaveLength(2);
    const selected = built.batch!.itemFingerprints[0];
    const decision = recordDecision(built.backlog, built.batch!.id, "partial", [selected], NOW);
    expect(decision.batch.parentBatchId).toBe(built.batch!.id);
    expect(decision.batch.status).toBe("approved");
    expect(decision.batch.itemFingerprints).toEqual([selected]);
    expect(() => recordDecision(decision.backlog, built.batch!.id, "partial", [selected], NOW)).toThrow("子批次已存在");
    expect(() => validateBatchFileSet(decision.batch, [".trae/agents/info-hunter.md"])).toThrow("超出批准集合");
  });

  test("状态机要求批准后应用且强制验证全部通过", () => {
    const candidate = upsertReview(backlog(), review("task-1", "high", "B"), ROOT, NOW);
    const built = buildBatch(candidate, NOW);
    expect(() => markApplied(built.backlog, built.batch!.id, [], NOW)).toThrow("approved");
    const approved = recordDecision(built.backlog, built.batch!.id, "approved", [], NOW).backlog;
    const applied = markApplied(approved, built.batch!.id, [".trae/agents/info-hunter.md"], NOW);
    const failed = recordVerification(applied, built.batch!.id, [{ name: "bun test", required: true, passed: false }], NOW);
    expect(failed.batches[0].status).toBe("apply_failed");
  });

  test("原子写入失败不替换既有文件且保存双投影", () => {
    const path = join(ROOT, "improvement-backlog.json");
    atomicWrite(path, "old");
    expect(() => atomicWrite(path, "new", (() => { throw new Error("write failed"); }) as any)).toThrow("write failed");
    expect(readFileSync(path, "utf-8")).toBe("old");
    saveBacklog(path, backlog());
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path.replace(".json", ".md"))).toBe(true);
  });

  test("backlog.md 投影使用中文列名与中文状态并包含问题描述", () => {
    const path = join(ROOT, "improvement-backlog.json");
    const state = upsertReview(backlog(), review("task-1", "high", "B"), ROOT, NOW);
    saveBacklog(path, state);
    const md = readFileSync(path.replace(".json", ".md"), "utf-8");
    expect(md).toContain("# 流程改进 Backlog");
    expect(md).toContain(`最后更新：${NOW.toISOString()}`);
    expect(md).toContain("| 状态 | 严重度 | 问题描述 | 目标文件 | 任务数 | 问题码 |");
    expect(md).toContain("任务终态未生成 Review"); // 问题描述 = symptom
    expect(md).toContain("| 候选 |"); // 状态中文化（high+B → candidate）
    expect(md).toContain("| 高 |"); // 严重度中文化
    expect(md).not.toContain("| 指纹 |"); // 旧英文列名不再出现
    expect(md).not.toContain("状态图例"); // 图例已移除
  });

  test("backlog.md 问题描述中的管道符被转义且超长描述被截断", () => {
    const path = join(ROOT, "improvement-backlog.json");
    const r = review("task-1", "high", "B");
    r.issues[0].symptom = `含 | 管道符的描述` + "很长的问题描述".repeat(30) + "结尾";
    const state = upsertReview(backlog(), r, ROOT, NOW);
    saveBacklog(path, state);
    const md = readFileSync(path.replace(".json", ".md"), "utf-8");
    expect(md).toContain("\\|"); // 管道符转义，不破坏表格
    expect(md).toContain("…");   // 超长截断
    expect(md).not.toContain("结尾"); // 尾部已被截断掉
  });
});
