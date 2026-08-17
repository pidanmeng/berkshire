import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type Severity = "critical" | "high" | "medium" | "low";
export type EvidenceGrade = "A" | "B" | "C" | "D";
export type ItemStatus = "observing" | "candidate" | "proposed" | "approved" | "rejected" | "applied" | "verified" | "apply_failed";

export interface ReviewIssue {
  problemCode: string;
  targetKind: string;
  targetPath: string;
  symptom: string;
  evidence: Array<{ grade: EvidenceGrade; detail: string }>;
  rootCauseHypothesis: string;
  goal: string;
  severity: Severity;
  confidence: number;
  benefit: string;
  risk: string;
  acceptance: string;
}

export interface ReviewDocument {
  schemaVersion: string;
  taskId: string;
  origin: "process-improvement";
  command: string;
  status: "success" | "partial" | "failed";
  issues: ReviewIssue[];
}

export interface BacklogItem extends ReviewIssue {
  fingerprint: string;
  canonicalTargetPath: string;
  status: ItemStatus;
  taskIds: string[];
  occurrenceCount: number;
  highestSeverity: Severity;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: Array<{ grade: EvidenceGrade; detail: string; taskId: string }>;
  batchIds: string[];
}

export interface Batch {
  id: string;
  status: "proposed" | "approved" | "rejected" | "applied" | "verified" | "apply_failed";
  itemFingerprints: string[];
  allowedPaths: string[];
  actualPaths: string[];
  parentBatchId?: string;
  createdAt: string;
  decisionAt?: string;
  verificationAt?: string;
}

export interface Backlog {
  schemaVersion: "1.0";
  updatedAt: string;
  items: BacklogItem[];
  batches: Batch[];
}

const DEFAULT_DIR = "Research/00-Workspace/06-Process-Improvement";
const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const EVIDENCE_RANK: Record<EvidenceGrade, number> = { D: 1, C: 2, B: 3, A: 4 };
const SENSITIVE = /(authorization\s*:|bearer\s+[a-z0-9._-]+|cookie\s*:|private[_ -]?key|api[_ -]?key|secret\s*[=:]|process\.env(?:\.[A-Z0-9_]+)?|[A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|CREDENTIAL|ACCESS_KEY|SECRET|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[=:]|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/i;
const PROCESS_IMPROVEMENT_DIR = "Research/00-Workspace/06-Process-Improvement";

function assertSafeFields(value: unknown, path = "root"): void {
  if (typeof value === "string") {
    if (SENSITIVE.test(value)) throw new Error(`字段包含敏感信息: ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeFields(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE.test(key)) throw new Error(`字段名包含敏感信息: ${path}.${key}`);
      assertSafeFields(entry, `${path}.${key}`);
    }
  }
}

function assertBacklogSchema(backlog: Backlog): void {
  if (!backlog || backlog.schemaVersion !== "1.0" || !Array.isArray(backlog.items) || !Array.isArray(backlog.batches)) throw new Error("Backlog schema 非法");
  assertSafeFields(backlog);
  for (const batch of backlog.batches) {
    if (!batch.id || !Array.isArray(batch.itemFingerprints) || !Array.isArray(batch.allowedPaths) || !Array.isArray(batch.actualPaths)) throw new Error(`批次 schema 非法: ${batch.id}`);
  }
}

function emptyBacklog(): Backlog {
  return { schemaVersion: "1.0", updatedAt: new Date(0).toISOString(), items: [], batches: [] };
}

export function canonicalizeTargetPath(workspaceRoot: string, targetPath: string): string {
  if (!targetPath || targetPath.includes("\0")) throw new Error("目标路径非法");
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, targetPath);
  const rel = relative(root, absolute).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`目标路径越出工作区: ${targetPath}`);
  return rel;
}

export function resolveProcessImprovementPath(workspaceRoot: string, targetPath: string): string {
  const canonical = canonicalizeTargetPath(workspaceRoot, targetPath);
  if (canonical !== PROCESS_IMPROVEMENT_DIR && !canonical.startsWith(`${PROCESS_IMPROVEMENT_DIR}/`)) throw new Error(`流程优化文件必须位于 06 目录: ${targetPath}`);
  return resolve(workspaceRoot, canonical);
}

function canonicalizeAssetPath(workspaceRoot: string, targetPath: string): string {
  if (!targetPath || targetPath.includes("\0")) throw new Error("资产路径非法");
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, targetPath);
  const rel = relative(root, absolute).replaceAll("\\", "/");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`资产路径越出工作区: ${targetPath}`);
  return rel;
}

export function normalizeProblemCode(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) throw new Error("problemCode 规范化后为空");
  return normalized;
}

export function createFingerprint(targetKind: string, canonicalTargetPath: string, problemCode: string): string {
  const source = `${targetKind.trim().toLowerCase()}|${canonicalTargetPath.toLowerCase()}|${normalizeProblemCode(problemCode)}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 20);
}

function assertSafeEvidence(issue: ReviewIssue): void {
  const serialized = JSON.stringify(issue.evidence);
  if (SENSITIVE.test(serialized)) throw new Error(`证据包含敏感字段: ${issue.problemCode}`);
  if (!Array.isArray(issue.evidence) || issue.evidence.length === 0) throw new Error(`问题缺少证据: ${issue.problemCode}`);
  if (issue.evidence.some(item => !Object.hasOwn(EVIDENCE_RANK, item.grade) || !item.detail.trim())) throw new Error(`证据格式非法: ${issue.problemCode}`);
}

function qualifiesAsCandidate(item: Pick<BacklogItem, "highestSeverity" | "taskIds" | "evidence">): boolean {
  const strongest = Math.max(...item.evidence.map(entry => EVIDENCE_RANK[entry.grade]));
  if (item.highestSeverity === "critical" || item.highestSeverity === "high") return strongest >= EVIDENCE_RANK.B;
  return item.taskIds.length >= 2 && strongest >= EVIDENCE_RANK.C;
}

export function upsertReview(backlog: Backlog, review: ReviewDocument, workspaceRoot: string, now = new Date()): Backlog {
  assertBacklogSchema(backlog);
  assertSafeFields(review);
  if (review.schemaVersion !== "1.0" || review.origin !== "process-improvement") throw new Error("Review schema 或 origin 非法");
  if (!review.taskId || !review.command || !review.status || !Array.isArray(review.issues)) throw new Error("Review schema 缺少必填字段");
  const next = structuredClone(backlog);

  for (const issue of review.issues) {
    assertSafeEvidence(issue);
    const canonicalTargetPath = canonicalizeTargetPath(workspaceRoot, issue.targetPath);
    const fingerprint = createFingerprint(issue.targetKind, canonicalTargetPath, issue.problemCode);
    const current = next.items.find(item => item.fingerprint === fingerprint);
    const uniqueEvidence = issue.evidence.filter(entry => !current?.evidence.some(existing => existing.taskId === review.taskId && existing.grade === entry.grade && existing.detail === entry.detail));

    if (current) {
      if (!current.taskIds.includes(review.taskId)) current.taskIds.push(review.taskId);
      current.occurrenceCount = current.taskIds.length;
      current.evidence.push(...uniqueEvidence.map(entry => ({ ...entry, taskId: review.taskId })));
      if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[current.highestSeverity]) current.highestSeverity = issue.severity;
      current.lastSeenAt = now.toISOString();
      current.symptom = issue.symptom;
      current.rootCauseHypothesis = issue.rootCauseHypothesis;
      current.goal = issue.goal;
      current.confidence = Math.max(current.confidence, issue.confidence);
      current.benefit = issue.benefit;
      current.risk = issue.risk;
      current.acceptance = issue.acceptance;
      if (current.status === "observing" && qualifiesAsCandidate(current)) current.status = "candidate";
    } else {
      const item: BacklogItem = {
        ...issue,
        fingerprint,
        canonicalTargetPath,
        status: "observing",
        taskIds: [review.taskId],
        occurrenceCount: 1,
        highestSeverity: issue.severity,
        firstSeenAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        evidence: uniqueEvidence.map(entry => ({ ...entry, taskId: review.taskId })),
        batchIds: [],
      };
      if (qualifiesAsCandidate(item)) item.status = "candidate";
      next.items.push(item);
    }
  }

  next.updatedAt = now.toISOString();
  return next;
}

export function buildBatch(backlog: Backlog, now = new Date()): { backlog: Backlog; batch: Batch | null } {
  assertBacklogSchema(backlog);
  const next = structuredClone(backlog);
  const candidates = next.items
    .filter(item => item.status === "candidate")
    .sort((a, b) => SEVERITY_RANK[b.highestSeverity] - SEVERITY_RANK[a.highestSeverity] || b.confidence - a.confidence || a.fingerprint.localeCompare(b.fingerprint));
  if (candidates.length === 0) return { backlog: next, batch: null };
  const id = `${now.toISOString().slice(0, 10).replaceAll("-", "")}-batch-${String(next.batches.length + 1).padStart(3, "0")}`;
  const allowedPaths = [...new Set(candidates.map(item => item.targetPath))];
  const batch: Batch = { id, status: "proposed", itemFingerprints: candidates.map(item => item.fingerprint), allowedPaths, actualPaths: [], createdAt: now.toISOString() };
  next.batches.push(batch);
  for (const item of candidates) {
    item.status = "proposed";
    item.batchIds.push(id);
  }
  next.updatedAt = now.toISOString();
  return { backlog: next, batch };
}

export function validateBatchFileSet(batch: Batch, actualPaths: string[], workspaceRoot?: string): string[] {
  const normalized = [...new Set(actualPaths.map(path => workspaceRoot ? canonicalizeAssetPath(workspaceRoot, path) : path.replaceAll("\\", "/")))].sort();
  const allowed = new Set(batch.allowedPaths.map(path => path.replaceAll("\\", "/")));
  const unexpected = normalized.filter(path => !allowed.has(path));
  if (unexpected.length > 0) throw new Error(`实际文件集合超出批准集合: ${unexpected.join(", ")}`);
  return normalized;
}

export function recordDecision(backlog: Backlog, batchId: string, decision: "approved" | "rejected" | "partial", approvedFingerprints: string[] = [], now = new Date(), actualPaths: string[] = []): { backlog: Backlog; batch: Batch } {
  assertBacklogSchema(backlog);
  const next = structuredClone(backlog);
  const batch = next.batches.find(entry => entry.id === batchId);
  if (decision === "partial" && batch && next.batches.some(entry => entry.parentBatchId === batch.id)) throw new Error("部分批准子批次已存在");
  if (!batch || batch.status !== "proposed") throw new Error("批次不存在或不处于 proposed 状态");
  if (decision === "partial") {
    const selected = [...new Set(approvedFingerprints)].filter(fingerprint => batch.itemFingerprints.includes(fingerprint));
    if (selected.length === 0 || selected.length === batch.itemFingerprints.length) throw new Error("部分批准必须选择非空真子集");
    if (next.batches.some(entry => entry.parentBatchId === batch.id)) throw new Error("部分批准子批次已存在");
    batch.status = "rejected";
    batch.decisionAt = now.toISOString();
    const selectedItems = next.items.filter(item => selected.includes(item.fingerprint));
    const child: Batch = { id: `${batch.id}-approved`, status: "approved", itemFingerprints: selected, allowedPaths: [...new Set(selectedItems.map(item => item.targetPath))], actualPaths: validateBatchFileSet({ ...batch, allowedPaths: [...new Set(selectedItems.map(item => item.targetPath))] }, actualPaths), parentBatchId: batch.id, createdAt: now.toISOString(), decisionAt: now.toISOString() };
    next.batches.push(child);
    for (const item of next.items) {
      if (selected.includes(item.fingerprint)) {
        item.status = "approved";
        item.batchIds.push(child.id);
      } else if (batch.itemFingerprints.includes(item.fingerprint)) item.status = "rejected";
    }
    next.updatedAt = now.toISOString();
    return { backlog: next, batch: child };
  }
  if (approvedFingerprints.length > 0) throw new Error("全部批准或拒绝不得指定部分候选");
  batch.actualPaths = validateBatchFileSet(batch, actualPaths);
  batch.status = decision;
  batch.decisionAt = now.toISOString();
  for (const item of next.items) if (batch.itemFingerprints.includes(item.fingerprint)) item.status = decision;
  next.updatedAt = now.toISOString();
  return { backlog: next, batch };
}

export function markApplied(backlog: Backlog, batchId: string, actualPaths: string[] = [], now = new Date()): Backlog {
  assertBacklogSchema(backlog);
  const next = structuredClone(backlog);
  const batch = next.batches.find(entry => entry.id === batchId);
  if (!batch || batch.status !== "approved") throw new Error("只有 approved 批次可以标记 applied");
  batch.actualPaths = validateBatchFileSet(batch, actualPaths);
  batch.status = "applied";
  for (const item of next.items) if (batch.itemFingerprints.includes(item.fingerprint)) item.status = "applied";
  next.updatedAt = now.toISOString();
  return next;
}

export function recordVerification(backlog: Backlog, batchId: string, checks: Array<{ name: string; required: boolean; passed: boolean }>, now = new Date()): Backlog {
  assertBacklogSchema(backlog);
  assertSafeFields(checks);
  const next = structuredClone(backlog);
  const batch = next.batches.find(entry => entry.id === batchId);
  if (!batch || batch.status !== "applied") throw new Error("只有 applied 批次可以记录验证");
  if (checks.length === 0 || checks.some(check => check.required && !check.passed)) batch.status = "apply_failed";
  else batch.status = "verified";
  batch.verificationAt = now.toISOString();
  for (const item of next.items) if (batch.itemFingerprints.includes(item.fingerprint)) item.status = batch.status;
  next.updatedAt = now.toISOString();
  return next;
}

export function loadBacklog(path: string): Backlog {
  if (!existsSync(path)) return emptyBacklog();
  const backlog = JSON.parse(readFileSync(path, "utf-8")) as Backlog;
  assertBacklogSchema(backlog);
  return backlog;
}

export function atomicWrite(path: string, content: string, writer: typeof writeFileSync = writeFileSync): void {
  mkdirSync(dirname(path), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}`;
  const temp = `${path}.${suffix}.tmp`;
  const backup = `${path}.${suffix}.bak`;
  let movedExisting = false;
  try {
    writer(temp, content, "utf-8");
    if (existsSync(path)) {
      renameSync(path, backup);
      movedExisting = true;
    }
    renameSync(temp, path);
    if (movedExisting) unlinkSync(backup);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    if (movedExisting && existsSync(backup) && !existsSync(path)) renameSync(backup, path);
    throw error;
  }
}

const SEVERITY_LABEL: Record<Severity, string> = { critical: "严重", high: "高", medium: "中", low: "低" };
const STATUS_LABEL: Record<ItemStatus, string> = {
  observing: "观察", candidate: "候选", proposed: "已入批", approved: "已批准",
  rejected: "已拒绝", applied: "已应用", verified: "已验证", apply_failed: "应用失败",
};

export function saveBacklog(path: string, backlog: Backlog): void {
  atomicWrite(path, `${JSON.stringify(backlog, null, 2)}\n`);
  const markdownPath = path.replace(/\.json$/i, ".md");
  const rows = backlog.items
    .map(item => {
      const description = item.symptom.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
      const short = description.length > 60 ? `${description.slice(0, 60)}…` : description;
      const severity = SEVERITY_LABEL[item.highestSeverity] ?? item.highestSeverity;
      const status = STATUS_LABEL[item.status] ?? item.status;
      return `| ${status} | ${severity} | ${short} | ${item.canonicalTargetPath} | ${item.occurrenceCount} | ${item.problemCode} |`;
    })
    .join("\n");
  const markdown = `# 流程改进 Backlog\n\n> 状态真源：improvement-backlog.json · 最后更新：${backlog.updatedAt}\n\n| 状态 | 严重度 | 问题描述 | 目标文件 | 任务数 | 问题码 |\n|---|---|---|---|---:|---|\n${rows}\n`;
  atomicWrite(markdownPath, markdown);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const workspaceRoot = resolve(option(args, "--workspace") ?? process.cwd());
  const backlogPath = resolveProcessImprovementPath(workspaceRoot, option(args, "--backlog") ?? `${DEFAULT_DIR}/improvement-backlog.json`);
  let backlog = loadBacklog(backlogPath);
  if (command === "upsert-review") {
    const reviewPath = option(args, "--review");
    if (!reviewPath) throw new Error("缺少 --review");
    backlog = upsertReview(backlog, JSON.parse(readFileSync(resolveProcessImprovementPath(workspaceRoot, reviewPath), "utf-8")), workspaceRoot);
    saveBacklog(backlogPath, backlog);
  } else if (command === "build-batch") {
    const result = buildBatch(backlog);
    backlog = result.backlog;
    saveBacklog(backlogPath, backlog);
    console.log(JSON.stringify(result.batch, null, 2));
  } else if (command === "record-decision") {
    const batchId = option(args, "--batch");
    const decision = option(args, "--decision") as "approved" | "rejected" | "partial" | undefined;
    if (!batchId || !decision) throw new Error("缺少 --batch 或 --decision");
    const approved = (option(args, "--items") ?? "").split(",").filter(Boolean);
    const result = recordDecision(backlog, batchId, decision, approved);
    backlog = result.backlog;
    saveBacklog(backlogPath, backlog);
    console.log(JSON.stringify(result.batch, null, 2));
  } else if (command === "mark-applied") {
    const batchId = option(args, "--batch");
    if (!batchId) throw new Error("缺少 --batch");
    backlog = markApplied(backlog, batchId);
    saveBacklog(backlogPath, backlog);
  } else if (command === "record-verification") {
    const batchId = option(args, "--batch");
    const resultsPath = option(args, "--results");
    if (!batchId || !resultsPath) throw new Error("缺少 --batch 或 --results");
    backlog = recordVerification(backlog, batchId, JSON.parse(readFileSync(resolveProcessImprovementPath(workspaceRoot, resultsPath), "utf-8")));
    saveBacklog(backlogPath, backlog);
  } else {
    throw new Error("命令必须为 upsert-review、build-batch、record-decision、mark-applied 或 record-verification");
  }
}
