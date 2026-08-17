import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check } from "../info-hunter.md.self-check";

const root = join(import.meta.dir, ".tmp-info-hunter-self-check");
const rawPath = join(root, "Research", "00-Workspace", "01-Inbox", "sample-raw.md");
const pdfPath = join(root, "Research", "00-Workspace", "02-Processing", "pdf-texts", "示例公司", "annual-report.md");

function rawContent(pdfReference: string): string {
  return `
第 1 层：行业级
来源1：https://example.com/industry
护城河 巴菲特 芒格 逆向思维 段永平 生意模式 李录 文明趋势
第 2 层：细分行业级
来源2：https://example.com/sector
研究偏见 反向搜索
第 3 层：公司级
来源3：https://example.com/company
财报原文 定期报告 估值快照 PE-TTM PB-MRQ 最新价
${pdfReference}
待验证点
`;
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("info-hunter 文件事实自检", () => {
  test("声明文件存在且 frontmatter 完整时不报告文件事实问题", () => {
    mkdirSync(join(rawPath, ".."), { recursive: true });
    mkdirSync(join(pdfPath, ".."), { recursive: true });
    writeFileSync(pdfPath, `---\npdf_title: 示例年报\nsource: https://example.com/report.pdf\npage_count: 10\nparse_confidence: 0.98\npages_needing_ocr: []\nhas_encoding_issues: false\n---\n# 示例年报\n`);
    writeFileSync(rawPath, rawContent("Research/00-Workspace/02-Processing/pdf-texts/示例公司/annual-report.md"));

    const result = check(rawPath);

    expect(result.issues.some((issue) => /财报 Markdown 文件不存在|frontmatter 不完整|未声明任何/.test(issue))).toBe(false);
  });

  test("声明文件不存在时报告问题并扣分", () => {
    mkdirSync(join(rawPath, ".."), { recursive: true });
    writeFileSync(rawPath, rawContent("Research/00-Workspace/02-Processing/pdf-texts/示例公司/missing.md"));

    const result = check(rawPath);

    expect(result.issues).toContain("财报 Markdown 文件不存在：Research/00-Workspace/02-Processing/pdf-texts/示例公司/missing.md");
    expect(result.score).toBeLessThan(10);
  });

  test("frontmatter 缺少文件事实字段时报告问题", () => {
    mkdirSync(join(rawPath, ".."), { recursive: true });
    mkdirSync(join(pdfPath, ".."), { recursive: true });
    writeFileSync(pdfPath, "---\npdf_title: 示例年报\nsource: https://example.com/report.pdf\n---\n# 示例年报\n");
    writeFileSync(rawPath, rawContent("Research/00-Workspace/02-Processing/pdf-texts/示例公司/annual-report.md"));

    const result = check(rawPath);

    expect(result.issues).toContain("财报 Markdown frontmatter 不完整：Research/00-Workspace/02-Processing/pdf-texts/示例公司/annual-report.md");
  });

  test("低置信度、待 OCR 页面和编码异常会阻断通过", () => {
    mkdirSync(join(rawPath, ".."), { recursive: true });
    mkdirSync(join(pdfPath, ".."), { recursive: true });
    writeFileSync(pdfPath, `---\npdf_title: 示例年报\nsource: https://example.com/report.pdf\npage_count: 10\nparse_confidence: 0.62\npages_needing_ocr: [2, 7]\nhas_encoding_issues: true\n---\n# 示例年报\n正文含乱码�\n`);
    writeFileSync(rawPath, rawContent("Research/00-Workspace/02-Processing/pdf-texts/示例公司/annual-report.md"));

    const result = check(rawPath);

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.includes("解析置信度低于 0.8"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("仍有页面需要 OCR"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("存在编码异常"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("Unicode 替换字符"))).toBe(true);
  });

  test("非法 OCR、编码和置信度元数据会报告问题", () => {
    mkdirSync(join(rawPath, ".."), { recursive: true });
    mkdirSync(join(pdfPath, ".."), { recursive: true });
    writeFileSync(pdfPath, `---\npdf_title: 示例年报\nsource: https://example.com/report.pdf\npage_count: 10\nparse_confidence: high\npages_needing_ocr: unknown\nhas_encoding_issues: unknown\n---\n# 示例年报\n`);
    writeFileSync(rawPath, rawContent("Research/00-Workspace/02-Processing/pdf-texts/示例公司/annual-report.md"));

    const result = check(rawPath);

    expect(result.issues.some((issue) => issue.includes("parse_confidence 非法"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("pages_needing_ocr 格式非法"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("has_encoding_issues 必须为布尔值"))).toBe(true);
  });
});
