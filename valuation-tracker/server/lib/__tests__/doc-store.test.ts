/**
 * doc-store 测试 — FsDocStore 与 SqliteDocStore 读取同一 fixture，输出必须一致
 * 运行：bun test valuation-tracker/server/lib/__tests__/doc-store.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFsDocStore, createSqliteDocStore, createTursoDocStore, type DocStore } from "../doc-store.ts";
import { buildResearchDb, syncResearchToTurso } from "../../../scripts/build-research-db.ts";

let root: string;
let dbFile: string;
let fsStore: DocStore;
let sqliteStore: DocStore;
let tursoStore: DocStore;

const NOTE_CONTENT = [
  "---",
  "type: company",
  "stock_code: '600000'",
  "name: 测试公司",
  "title: 测试公司-公司研究",
  "industry: '[[测试行业-行业概览]]'",
  "tags:",
  "  - 测试",
  "---",
  "",
  "# 测试公司",
  "",
  "## 生意模式",
  "赚谁的钱：测试用例",
].join("\n");

const DEEP_READ_CONTENT = [
  "---",
  "type: deep-read",
  "title: 测试公司 年报精读",
  "read_at: 2026-08-16",
  "---",
  "",
  "# 测试公司 deep-read",
  "多空论证占位",
].join("\n");

const ANNUAL_REPORT_CONTENT = "# 2025年年度报告\n报告正文内容……\n";

const SCREENER_JSON = JSON.stringify({
  meta: { generatedAt: "2026-08-01T00:00:00Z" },
  pools: { star: [], watch: [], exclude: [], loss: [] },
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "docstore-test-"));

  const knowledgeDir = join(root, "Research", "10-Knowledge", "01-测试行业", "02-公司研究");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, "测试公司-公司研究.md"), NOTE_CONTENT);

  const processingDir = join(root, "Research", "00-Workspace", "02-Processing");
  mkdirSync(processingDir, { recursive: true });
  writeFileSync(join(processingDir, "2026-08-16-测试公司-deep-read.md"), DEEP_READ_CONTENT);

  const pdfDir = join(processingDir, "pdf-texts", "测试公司");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "2025年年度报告.md"), ANNUAL_REPORT_CONTENT);

  const screenerDir = join(root, "Research", "00-Workspace", "07-Screener");
  mkdirSync(screenerDir, { recursive: true });
  writeFileSync(join(screenerDir, "latest-screener.json"), SCREENER_JSON);

  const destDir = join(root, "research-data");
  const res = await buildResearchDb({ researchSrc: join(root, "Research"), destDir });
  expect(res).not.toBeNull();
  dbFile = res!.dbPath;

  fsStore = createFsDocStore(root);
  sqliteStore = createSqliteDocStore(dbFile);

  // Turso 兜底：把同一批条目同步到 file: 库，再用 TursoDocStore（同一套 SQL）读取
  const remoteFile = join(root, "research-data", "remote.db").replace(/\\/g, "/");
  await syncResearchToTurso(res!.entries, { url: `file:${remoteFile}` });
  tursoStore = createTursoDocStore(`file:${remoteFile}`);
});

/** Windows 文件句柄释放有延迟，rmSync 可能瞬时 EBUSY，重试直至成功 */
async function safeRm(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

afterAll(async () => {
  sqliteStore.close();
  tursoStore.close();
  await safeRm(root);
});

const sorted = (a: string[]): string[] => [...a].sort();

describe("FsDocStore 与 SqliteDocStore 输出一致性", () => {
  test("describe 元数据", () => {
    expect(fsStore.describe().kind).toBe("fs");
    expect(sqliteStore.describe().kind).toBe("sqlite");
    expect(sqliteStore.describe().fileCount).toBe(4);
    expect(sqliteStore.describe().generatedAt).toBeTruthy();
  });

  test("listNotePaths 一致", async () => {
    const fs = sorted(await fsStore.listNotePaths());
    const sql = sorted(await sqliteStore.listNotePaths());
    expect(sql).toEqual(fs);
    expect(sql).toContain("Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-公司研究.md");
  });

  test("readFile 一致（含不存在的路径返回 null）", async () => {
    const p = "Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-公司研究.md";
    expect(await sqliteStore.readFile(p)).toBe(await fsStore.readFile(p));
    expect(await sqliteStore.readFile(p)).toBe(NOTE_CONTENT);
    expect(await fsStore.readFile("Research/no-such.md")).toBeNull();
    expect(await sqliteStore.readFile("Research/no-such.md")).toBeNull();
  });

  test("listDeepReadPaths 一致", async () => {
    const fs = sorted(await fsStore.listDeepReadPaths());
    const sql = sorted(await sqliteStore.listDeepReadPaths());
    expect(sql).toEqual(fs);
    expect(sql).toContain("2026-08-16-测试公司-deep-read.md");
  });

  test("listAnnualReportPaths 一致", async () => {
    const fs = sorted(await fsStore.listAnnualReportPaths("测试公司"));
    const sql = sorted(await sqliteStore.listAnnualReportPaths("测试公司"));
    expect(sql).toEqual(fs);
    expect(sql).toContain("2025年年度报告.md");
    expect(await fsStore.listAnnualReportPaths("不存在的公司")).toEqual([]);
    expect(await sqliteStore.listAnnualReportPaths("不存在的公司")).toEqual([]);
  });

  test("readDoc / docSize 一致（deep-read + annual-report）", async () => {
    for (const kind of ["deep-read", "annual-report"] as const) {
      const fileName = kind === "deep-read" ? "2026-08-16-测试公司-deep-read.md" : "2025年年度报告.md";
      const fsDoc = await fsStore.readDoc(kind, "测试公司", fileName);
      const sqlDoc = await sqliteStore.readDoc(kind, "测试公司", fileName);
      expect(sqlDoc).not.toBeNull();
      expect(sqlDoc!.content).toBe(fsDoc!.content);
      expect(sqlDoc!.sizeBytes).toBe(fsDoc!.sizeBytes);
      expect(await sqliteStore.docSize(kind, "测试公司", fileName)).toBe(await fsStore.docSize(kind, "测试公司", fileName));
    }
  });

  test("readDoc 防目录穿越（含路径分隔符一律拒绝）", async () => {
    expect(await fsStore.readDoc("annual-report", "测试公司", "../secret.md")).toBeNull();
    expect(await sqliteStore.readDoc("annual-report", "测试公司", "../secret.md")).toBeNull();
    expect(await fsStore.readDoc("annual-report", "测试公司", "a/b.md")).toBeNull();
    expect(await sqliteStore.readDoc("annual-report", "测试公司", "a/b.md")).toBeNull();
  });

  test("readScreenerJson 一致", async () => {
    expect(await sqliteStore.readScreenerJson()).toBe(await fsStore.readScreenerJson());
    expect(await sqliteStore.readScreenerJson()).toBe(SCREENER_JSON);
  });

  test("TursoDocStore（file: 模拟）与 FsDocStore 输出一致", async () => {
    expect(tursoStore.describe().kind).toBe("turso");

    const noteRel = "Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-公司研究.md";
    expect(sorted(await tursoStore.listNotePaths())).toEqual(sorted(await fsStore.listNotePaths()));
    expect(await tursoStore.readFile(noteRel)).toBe(NOTE_CONTENT);
    expect(await tursoStore.readFile("Research/no-such.md")).toBeNull();
    expect(sorted(await tursoStore.listDeepReadPaths())).toEqual(sorted(await fsStore.listDeepReadPaths()));
    expect(sorted(await tursoStore.listAnnualReportPaths("测试公司"))).toEqual(
      sorted(await fsStore.listAnnualReportPaths("测试公司")),
    );

    const doc = await tursoStore.readDoc("deep-read", "测试公司", "2026-08-16-测试公司-deep-read.md");
    expect(doc?.content).toBe(DEEP_READ_CONTENT);
    expect(doc?.sizeBytes).toBe(Buffer.byteLength(DEEP_READ_CONTENT, "utf-8"));
    expect(await tursoStore.docSize("annual-report", "测试公司", "2025年年度报告.md")).toBe(
      await fsStore.docSize("annual-report", "测试公司", "2025年年度报告.md"),
    );
    expect(await tursoStore.readScreenerJson()).toBe(SCREENER_JSON);

    // 路径穿越防护同样生效
    expect(await tursoStore.readDoc("annual-report", "测试公司", "../secret.md")).toBeNull();
  });
});
