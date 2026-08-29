/**
 * generate-static-data.ts 测试 — fixture 目录 → public/data/companies.json + docs/<code>/
 * 运行：bun test valuation-tracker/scripts/__tests__/generate-static-data.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateStaticData } from "../generate-static-data.ts";

let root: string;      // fixture 根（内含 Research/）
let destDir: string;   // 输出目录（public/data）
let res: Awaited<ReturnType<typeof generateStaticData>>;

const NOTE_CONTENT = [
  "---",
  "type: company",
  "stock_code: '600000'",
  "name: 测试公司",
  "title: 测试公司-公司研究",
  "industry: '[[测试行业-行业概览]]'",
  "sub_industry: '[[细分-测试]]'",
  "tags:",
  "  - 测试",
  "scores:",
  "  moat: 8",
  "  management: 7",
  "target_market_cap_yi:",
  "  pessimistic: 100",
  "  neutral: 200",
  "  optimistic: 300",
  "created: 2026-01-01",
  "---",
  "",
  "# 测试公司",
  "",
  "## 生意模式",
  "赚谁的钱：测试用例",
  "## 跟踪指标",
  "- 指标一",
].join("\n");

const UPDATE_CONTENT = [
  "---",
  "type: deep-dive-update",
  "stock_code: '600000'",
  "name: 测试公司",
  "updated: 2026-08-01",
  "research_conclusion: 业绩符合预期",
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

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "gsd-test-"));
  destDir = join(root, "public", "data");

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

  // 只生成一次，后续测试复用
  res = await generateStaticData({ researchSrc: join(root, "Research"), destDir });
});

afterAll(async () => {
  await safeRm(root);
});

describe("generateStaticData", () => {
  test("生成 companies.json + docs 文件，公司笔记解析正确（wiki link 解包 / 结构化字段）", () => {
    expect(res).not.toBeNull();
    expect(res!.companyCount).toBe(1);

    const jsonPath = join(destDir, "companies.json");
    expect(existsSync(jsonPath)).toBe(true);
    const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      generatedAt: string;
      list: Record<string, unknown>[];
      docsIndex: Record<
        string,
        {
          deepReads: { fileName: string; title: string | null; date: string | null; kind: string }[];
          annualReports: { fileName: string }[];
          updates: Record<string, unknown>[];
        }
      >;
    };
    expect(data.generatedAt).toBeTruthy();

    // 公司笔记：wiki link frontmatter 解包 + snake_case → camelCase 映射 + 无 notePath
    expect(data.list.length).toBe(1);
    const note = data.list[0]!;
    expect(note.thscode).toBe("600000");
    expect(note.name).toBe("测试公司");
    expect(note.industry).toBe("测试行业-行业概览"); // [[X]] → X
    expect(note.subIndustry).toBe("细分-测试");
    expect(note.tags).toEqual(["测试"]);
    expect((note.scores as Record<string, number>).moat).toBe(8);
    expect((note.targetMarketCapYi as Record<string, number>).neutral).toBe(200);
    expect("notePath" in note).toBe(false);

    // docs 索引：deep-read / annual-report / update 各自归类
    const docsIndex = data.docsIndex["600000"]!;
    expect(docsIndex.deepReads.length).toBe(1);
    expect(docsIndex.deepReads[0]!.fileName).toBe("2026-08-16-测试公司-deep-read.md");
    expect(docsIndex.deepReads[0]!.title).toBe("测试公司 年报精读");
    expect(docsIndex.deepReads[0]!.date).toBe("2026-08-16");
    expect(docsIndex.annualReports.length).toBe(1);
    expect(docsIndex.annualReports[0]!.fileName).toBe("2025年年度报告.md");
    expect(docsIndex.updates.length).toBe(1);
    expect(docsIndex.updates[0]!.fileName).toBe("测试公司-基本面更新.md");
    // update 元数据不含正文 markdown（正文落盘按需读取）
    expect("markdown" in docsIndex.updates[0]!).toBe(false);
  });

  test("docs 目录产出 note.md / updates / deep-reads / annual-reports 正文", () => {
    const base = join(destDir, "docs", "600000");
    expect(existsSync(join(base, "note.md"))).toBe(true);
    const noteBody = readFileSync(join(base, "note.md"), "utf-8");
    expect(noteBody).toContain("## 生意模式");
    expect(noteBody).not.toContain("type: company"); // frontmatter 已剔除

    expect(readFileSync(join(base, "updates", "测试公司-基本面更新.md"), "utf-8")).toContain("测试更新内容");
    expect(readFileSync(join(base, "deep-reads", "2026-08-16-测试公司-deep-read.md"), "utf-8")).toContain("多空论证占位");
    expect(readFileSync(join(base, "annual-reports", "2025年年度报告.md"), "utf-8")).toContain("报告正文内容");
  });

  test("update 按 updated 倒序排列", () => {
    const data = JSON.parse(readFileSync(join(destDir, "companies.json"), "utf-8")) as {
      docsIndex: Record<string, { updates: { updated: string | null }[] }>;
    };
    const updates = data.docsIndex["600000"]!.updates;
    const dates = updates.map((u) => u.updated).filter((v): v is string => v != null);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  test("researchSrc 缺失时返回 null 且不触碰目标目录", async () => {
    const missing = await generateStaticData({ researchSrc: join(root, "no-such-dir"), destDir });
    expect(missing).toBeNull();
    expect(existsSync(join(destDir, "companies.json"))).toBe(true); // 已生成产物不被破坏
  });
});
