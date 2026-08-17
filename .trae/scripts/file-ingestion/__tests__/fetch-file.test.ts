import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  allowOcrDegrade,
  buildMarkdown,
  classifyInput,
  ingestPdf,
  IngestionError,
  parseCliArgs,
  parseContentDispositionFilename,
  redactUrl,
  sanitizeFilename,
  selectFilename,
  sourceHash,
  validatePdfTitle,
  validateRemoteUrl,
} from "../fetch-file";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "file-ingestion-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const parsed = {
  pdfType: "TextBased",
  markdown: "# 报告\n\n|指标|值|\n|---|---|\n|营收|100|",
  pageCount: 3,
  processingTimeMs: 1,
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  title: "年度经营报告",
  confidence: 0.98,
  isComplexLayout: true,
  pagesWithTables: [2],
  pagesWithColumns: [],
  hasEncodingIssues: false,
};

describe("file ingestion helpers", () => {
  it("parses URL and local input", () => {
    expect(classifyInput("https://example.com/a.pdf")).toBe("url");
    expect(classifyInput("C:\\reports\\a.pdf")).toBe("local");
    expect(() => classifyInput("ftp://example.com/a.pdf")).toThrow(IngestionError);
  });

  it("requires the markdown contract and output directory", () => {
    expect(() => parseCliArgs(["a.pdf"])).toThrow("--pdf-markdown");
    expect(parseCliArgs(["a.pdf", "--pdf-markdown", "--output", "out", "--name", "fallback.pdf"]).name).toBe("fallback.pdf");
  });

  it("prefers explicit --name, then valid title, then falls back through the fixed chain", () => {
    expect(selectFilename({ pdfTitle: "年度经营报告", explicitName: "fallback.pdf", sourceBasename: "123.pdf" }).source).toBe("explicit_name");
    expect(selectFilename({ pdfTitle: "年度经营报告", explicitName: "fallback.pdf", sourceBasename: "123.pdf" }).stem).toBe("fallback");
    const title = selectFilename({ pdfTitle: "年度经营报告", sourceBasename: "123.pdf" });
    expect(title.stem).toBe("年度经营报告");
    expect(title.source).toBe("pdf_title");
    const fallback = selectFilename({ pdfTitle: "123456", sourceBasename: "source.pdf" });
    expect(fallback.stem).toBe("source");
    expect(fallback.source).toBe("source_basename");
    expect(fallback.titleFallbackReason).toBe("numeric_only");
  });

  it("rejects invalid titles and sanitizes Windows names", () => {
    expect(validatePdfTitle("untitled").valid).toBe(false);
    expect(validatePdfTitle("��乱码").valid).toBe(false);
    expect(sanitizeFilename("CON.pdf")).toBe("_CON");
    expect(sanitizeFilename("财报:2026?.pdf")).toBe("财报 2026");
    expect(sanitizeFilename("  报告   ")).toBe("报告");
  });

  it("parses content disposition, redacts sensitive URL parameters and hashes deterministically", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E5%B9%B4%E6%8A%A5.pdf")).toBe("年报.pdf");
    expect(redactUrl("https://example.com/a.pdf?token=secret&code=600000")).toBe("https://example.com/a.pdf?token=%5BREDACTED%5D&code=600000");
    expect(sourceHash("https://example.com/a.pdf")).toBe(sourceHash("https://example.com/a.pdf"));
  });

  it("rejects SSRF targets and DNS resolutions to private networks", async () => {
    await expect(validateRemoteUrl("http://127.0.0.1/a.pdf")).rejects.toThrow("私有网络");
    await expect(validateRemoteUrl("https://example.com/a.pdf", async () => ["169.254.169.254"])).rejects.toThrow("私有网络");
    await expect(validateRemoteUrl("https://example.com/a.pdf", async () => ["93.184.216.34"])).resolves.toBeInstanceOf(URL);
  });

  it("writes markdown and required frontmatter", () => {
    const markdown = buildMarkdown({
      source: "C:/reports/a.pdf",
      kind: "local",
      originalFilename: "a.pdf",
      pdfTitle: parsed.title,
      filenameSource: "pdf_title",
      result: parsed,
      fetchedAt: "2026-08-15T00:00:00.000Z",
      hash: "abc123",
    });
    expect(markdown).toContain("source_type: local");
    expect(markdown).toContain("page_count: 3");
    expect(markdown).toContain("pages_with_tables: [2]");
    expect(markdown).toContain("|指标|值|");
  });

  it("buildMarkdown 对 OCR 页追加占位符标记", () => {
    const markdown = buildMarkdown({
      source: "C:/reports/scan.pdf",
      kind: "local",
      originalFilename: "scan.pdf",
      pdfTitle: "扫描年报",
      filenameSource: "pdf_title",
      result: { ...parsed, pageCount: 213, pagesNeedingOcr: [1] },
      fetchedAt: "2026-08-15T00:00:00.000Z",
      hash: "abc123",
    });
    expect(markdown).toContain("pages_needing_ocr: [1]");
    expect(markdown).toContain("OCR 页占位");
  });

  it("allowOcrDegrade：OCR 页占比 ≤5% 默认降级，无需显式开关；占比高或无正文仍拒绝", () => {
    expect(allowOcrDegrade({ ...parsed, pageCount: 200, pagesNeedingOcr: [1] }, {})).toBe(true); // 默认降级，无需显式参数
    expect(allowOcrDegrade({ ...parsed, pageCount: 200, pagesNeedingOcr: [1] }, { allowOcrPages: true })).toBe(true);
    expect(allowOcrDegrade({ ...parsed, pageCount: 20, pagesNeedingOcr: [1, 2] }, {})).toBe(false); // 占比 10% > 5%
    expect(allowOcrDegrade({ ...parsed, markdown: "", pageCount: 200, pagesNeedingOcr: [1] }, {})).toBe(false); // 无正文
  });
});

describe("ingestPdf", () => {
  const publicDns = async () => ["93.184.216.34"];

  it("reads local PDFs without deleting the source and avoids collisions", async () => {
    const dir = await tempDir();
    const input = join(dir, "report.pdf");
    const output = join(dir, "out");
    const fixture = Buffer.concat([Buffer.from("%PDF-"), Buffer.from("fixture")]);
    await writeFile(input, fixture);
    const process = mock(() => parsed);
    const first = await ingestPdf({ input, output, pdfMarkdown: true }, { processPdf: process });
    const second = await ingestPdf({ input, output, pdfMarkdown: true }, { processPdf: process });
    expect(first.outputPath).toContain("年度经营报告.md");
    expect(second.outputPath).toBe(first.outputPath);
    expect(await readFile(input)).toEqual(fixture);
  });

  it("cleans successful remote temporary PDFs and retains OCR fallbacks", async () => {
    const dir = await tempDir();
    const output = join(dir, "out");
    const successfulFetch = mock(async () => new Response(Buffer.concat([Buffer.from("%PDF-"), Buffer.from("fixture")]), { status: 200, headers: { "content-type": "application/pdf" } }));
    const success = await ingestPdf({ input: "https://example.com/report.pdf?token=secret", output, pdfMarkdown: true }, { fetch: successfulFetch, processPdf: () => parsed, tempRoot: dir, resolveHostname: publicDns });
    const markdown = await readFile(success.outputPath, "utf8");
    expect(markdown).toContain("source_hash:");
    expect(markdown).not.toContain("token=secret");
    const ocrResult = { ...parsed, markdown: "", pagesNeedingOcr: [1] };
    await expect(ingestPdf({ input: "https://example.com/scan.pdf", output, pdfMarkdown: true }, { fetch: successfulFetch, processPdf: () => ocrResult, tempRoot: dir, resolveHostname: publicDns })).rejects.toMatchObject({ retainedPdfPath: expect.stringContaining("failed"), exitCode: 4 });
  });

  it("OCR 页占比 ≤5% 时默认降级产出 Markdown（无需 --allow-ocr-pages），frontmatter 标注 OCR 页且不保留 failed", async () => {
    const dir = await tempDir();
    const output = join(dir, "out");
    const fetchMock = mock(async () => new Response(Buffer.concat([Buffer.from("%PDF-"), Buffer.from("fixture")]), { status: 200, headers: { "content-type": "application/pdf" } }));
    const ocrResult = { ...parsed, markdown: "# 年报正文\n\n营收 100 亿", pageCount: 213, pagesNeedingOcr: [1], ocrReasonsByPage: [{ page: 1, reason: "cover scan" }] };
    const result = await ingestPdf({ input: "https://example.com/annual.pdf", output, pdfMarkdown: true }, { fetch: fetchMock, processPdf: () => ocrResult, tempRoot: dir, resolveHostname: publicDns });
    const markdown = await readFile(result.outputPath, "utf8");
    expect(markdown).toContain("pages_needing_ocr: [1]");
    expect(markdown).toContain("OCR 页占位");
    expect(markdown).toContain("营收 100 亿");
    expect(existsSync(join(output, "failed"))).toBe(false);
  });

  it("OCR 页占比超过 5% 时，--allow-ocr-pages 仍按原样失败并保留源 PDF", async () => {
    const dir = await tempDir();
    const output = join(dir, "out");
    const fetchMock = mock(async () => new Response(Buffer.concat([Buffer.from("%PDF-"), Buffer.from("fixture")]), { status: 200, headers: { "content-type": "application/pdf" } }));
    const heavyOcr = { ...parsed, markdown: "# 正文", pageCount: 10, pagesNeedingOcr: [1, 2, 3] };
    await expect(ingestPdf({ input: "https://example.com/scan-heavy.pdf", output, pdfMarkdown: true, allowOcrPages: true }, { fetch: fetchMock, processPdf: () => heavyOcr, tempRoot: dir, resolveHostname: publicDns })).rejects.toMatchObject({ retainedPdfPath: expect.stringContaining("failed"), exitCode: 4 });
  });

  it("revalidates redirects and rejects oversized responses without output side effects", async () => {
    const dir = await tempDir();
    const output = join(dir, "out");
    const redirectFetch = mock(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.pdf" } }));
    await expect(ingestPdf({ input: "https://example.com/report.pdf", output, pdfMarkdown: true }, { fetch: redirectFetch, processPdf: () => parsed, tempRoot: dir, resolveHostname: publicDns })).rejects.toThrow("私有网络");
    expect(existsSync(output)).toBe(false);
    const oversizedFetch = mock(async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(51 * 1024 * 1024) } }));
    await expect(ingestPdf({ input: "https://example.com/large.pdf", output, pdfMarkdown: true }, { fetch: oversizedFetch, processPdf: () => parsed, tempRoot: dir, resolveHostname: publicDns })).rejects.toThrow("超过");
    expect(existsSync(output)).toBe(false);
  });

  it("does not retain invalid downloads or leave partial markdown on write failure", async () => {
    const dir = await tempDir();
    const output = join(dir, "out");
    const invalidFetch = mock(async () => new Response(Buffer.from("not-pdf"), { status: 200, headers: { "content-type": "application/pdf" } }));
    await expect(ingestPdf({ input: "https://example.com/bad.pdf", output, pdfMarkdown: true }, { fetch: invalidFetch, processPdf: () => parsed, tempRoot: dir, resolveHostname: publicDns })).rejects.toMatchObject({ retainedPdfPath: undefined });
    expect(existsSync(output)).toBe(false);
    const validFetch = mock(async () => new Response(Buffer.concat([Buffer.from("%PDF-"), Buffer.from("fixture")]), { status: 200, headers: { "content-type": "application/pdf" } }));
    const failingWrite = mock(async (path: string, data: string | Buffer) => {
      if (path.endsWith("download.pdf")) return writeFile(path, data);
      throw new Error("disk full");
    });
    await expect(ingestPdf({ input: "https://example.com/report.pdf", output, pdfMarkdown: true }, { fetch: validFetch, processPdf: () => parsed, tempRoot: dir, resolveHostname: publicDns, writeFile: failingWrite })).rejects.toMatchObject({ message: expect.stringContaining("Markdown 写入失败"), retainedPdfPath: undefined });
    expect(existsSync(join(output, "failed"))).toBe(false);
  });
});
