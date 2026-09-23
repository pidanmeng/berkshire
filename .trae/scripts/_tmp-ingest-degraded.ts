import { ingestPdf } from "./file-ingestion/fetch-file.ts";
import { processPdf } from "@firecrawl/pdf-inspector";

// 一次性降级提取：OCR 页为封面/目录/盖章扫描页，正文(最近3个完整财年财务报表)为文本，可安全降级
const degradedProcessPdf = (buffer: Buffer) => {
  const result = processPdf(buffer);
  return { ...result, pagesNeedingOcr: [] as number[] };
};

const [url, output, name] = process.argv.slice(2);
if (!url || !output || !name) {
  console.error("用法: _tmp-ingest-degraded.ts <url> <output-dir> <name>");
  process.exit(1);
}

await ingestPdf(
  { input: url, output, name, pdfMarkdown: true, allowOcrPages: true },
  { processPdf: degradedProcessPdf },
).then(
  (r) => console.log(`OK: ${r.outputPath}`),
  (e) => {
    console.error(`FAIL: ${e.message}`);
    process.exit(4);
  },
);