/**
 * build-research-db.ts 测试 — fixture 目录 → research.db + manifest.json
 * 运行：bun test valuation-tracker/scripts/__tests__/build-research-db.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { buildResearchDb, syncResearchToTurso } from "../build-research-db.ts";

// bun:sqlite 仅 Bun 运行时有类型声明（本测试仅由 bun test 执行）
// @ts-ignore
const { Database } = await import("bun:sqlite");

let root: string;      // fixture 根（内含 Research/）
let destDir: string;   // 输出目录（内含 research.db + manifest.json）
let res: Awaited<ReturnType<typeof buildResearchDb>>;

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

const UPDATE_CONTENT = [
  "---",
  "type: deep-dive-update",
  "stock_code: '600000'",
  "name: 测试公司",
  "updated: 2026-08-01",
  "---",
  "",
  "## 基本面更新",
  "测试更新内容",
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

const ANNUAL_REPORT_CONTENT = [
  "---",
  "source: 巨潮资讯",
  "pdf_title: 2025年年度报告",
  "page_count: 200",
  "---",
  "",
  "# 2025年年度报告",
  "报告正文内容……",
].join("\n");

const SCREENER_JSON = JSON.stringify({
  meta: { generatedAt: "2026-08-01T00:00:00Z", report: "2026-2", prevReport: "2025-4", counts: { universe: 2, star: 1 } },
  pools: { star: [], watch: [], exclude: [], loss: [] },
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "brdb-test-"));
  destDir = join(root, "research-data");

  const knowledgeDir = join(root, "Research", "10-Knowledge", "01-测试行业", "02-公司研究");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, "测试公司-公司研究.md"), NOTE_CONTENT);
  writeFileSync(join(knowledgeDir, "测试公司-基本面更新.md"), UPDATE_CONTENT);

  const processingDir = join(root, "Research", "00-Workspace", "02-Processing");
  mkdirSync(processingDir, { recursive: true });
  writeFileSync(join(processingDir, "2026-08-16-测试公司-deep-read.md"), DEEP_READ_CONTENT);

  const pdfDir = join(processingDir, "pdf-texts", "测试公司");
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, "2025年年度报告.md"), ANNUAL_REPORT_CONTENT);

  const screenerDir = join(root, "Research", "00-Workspace", "07-Screener");
  mkdirSync(screenerDir, { recursive: true });
  writeFileSync(join(screenerDir, "latest-screener.json"), SCREENER_JSON);

  // 只构建一次，后续测试复用（Windows 下重复重建会因句柄未释放触发 EBUSY）
  res = await buildResearchDb({ researchSrc: join(root, "Research"), destDir });
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
  await safeRm(root);
});

describe("buildResearchDb", () => {
  test("生成 research.db + manifest.json，按 kind 正确归类", () => {
    expect(res).not.toBeNull();
    expect(res!.fileCount).toBe(5);
    expect(res!.byKind).toEqual({ note: 2, "deep-read": 1, "annual-report": 1, screener: 1 });
    expect(res!.rawBytes).toBeGreaterThan(0);
    expect(res!.compressedBytes).toBeLessThan(res!.rawBytes);

    expect(existsSync(join(destDir, "research.db"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(destDir, "manifest.json"), "utf-8"));
    expect(manifest.generatedAt).toBeTruthy();
    expect(manifest.files).toEqual({ note: 2, "deep-read": 1, "annual-report": 1, screener: 1 });
  });

  test("content gzip 往返一致（解压后与源文件原文相等）", () => {
    const db = new Database(join(destDir, "research.db"), { readonly: true });
    const rows = db.query("SELECT kind, path, content, raw_size FROM documents").all() as {
      kind: string;
      path: string;
      content: Uint8Array;
      raw_size: number;
    }[];
    db.close();

    expect(rows.length).toBe(5);
    const get = (path: string) => {
      const row = rows.find((r) => r.path === path);
      expect(row).toBeDefined();
      expect(gunzipSync(row!.content).length).toBe(row!.raw_size);
      return gunzipSync(row!.content).toString("utf-8");
    };

    expect(get("Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-公司研究.md")).toBe(NOTE_CONTENT);
    expect(get("Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-基本面更新.md")).toBe(UPDATE_CONTENT);
    expect(get("Research/00-Workspace/02-Processing/2026-08-16-测试公司-deep-read.md")).toBe(DEEP_READ_CONTENT);
    expect(get("Research/00-Workspace/02-Processing/pdf-texts/测试公司/2025年年度报告.md")).toBe(ANNUAL_REPORT_CONTENT);
    expect(get("Research/00-Workspace/07-Screener/latest-screener.json")).toBe(SCREENER_JSON);
  });

  test("路径统一为 POSIX 分隔符（跨平台一致）", () => {
    const db = new Database(join(destDir, "research.db"), { readonly: true });
    const rows = db.query("SELECT path FROM documents").all() as { path: string }[];
    db.close();
    for (const r of rows) {
      expect(r.path).not.toContain("\\");
    }
  });

  test("researchSrc 缺失时早退，且不破坏已存在的 research.db", async () => {
    const marker = readFileSync(join(destDir, "research.db"));
    const missing = await buildResearchDb({ researchSrc: join(root, "no-such-dir"), destDir });
    expect(missing).toBeNull();
    // 已上传的 DB 保持不变
    expect(readFileSync(join(destDir, "research.db")).equals(marker)).toBe(true);
  });

  test("syncResearchToTurso 把同一批条目写入远端库（file: 模拟 Turso），gzip 往返一致", async () => {
    expect(res).not.toBeNull();

    const remoteFile = join(root, "research-data", "remote.db").replace(/\\/g, "/");
    const stat = await syncResearchToTurso(res!.entries, { url: `file:${remoteFile}` });
    expect(stat.inserted).toBe(5);
    expect(stat.compressedBytes).toBeGreaterThan(0);
    expect(stat.compressedBytes).toBeLessThan(res!.rawBytes);

    // 用独立连接读回，验证表结构与内容（BLOB gzip → 原文）
    const client = createClient({ url: `file:${remoteFile}` });
    try {
      const rows = (await client.execute("SELECT kind, path, content, raw_size FROM documents ORDER BY path")).rows;
      expect(rows.length).toBe(5);
      const row = rows.find(
        (r) => r.path === "Research/10-Knowledge/01-测试行业/02-公司研究/测试公司-公司研究.md",
      );
      expect(row).toBeDefined();
      expect(gunzipSync(row!.content as unknown as Uint8Array).toString("utf-8")).toBe(NOTE_CONTENT);
      expect(row!.raw_size).toBe(Buffer.byteLength(NOTE_CONTENT, "utf-8"));
    } finally {
      client.close();
    }
  });
});
