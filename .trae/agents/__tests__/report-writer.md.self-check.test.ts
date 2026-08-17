import { describe, it, expect } from "bun:test";
import { check } from "../report-writer.md.self-check";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempDir(): string {
  const dir = join(tmpdir(), `rw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * 完整报告基底：包含所有必查章节（多空论证、增长驱动、核心优势可持续性），
 * 用于构造「仅缺单一章节」的测试用例。
 */
const GROWTH_MARGIN_BLOCK = `\n\n增长驱动分析：企业当前处于高增长阶段，营收增速 30%；当前增长由量价齐升促成；未来增长因素中产品创新属内因（企业可主导），行业景气属外因。核心优势分析：成本领先优势突出，毛利率高于行业均值 10pp，由技术壁垒支撑，处于维持高位趋势；侵蚀风险为原材料涨价。\n`;

function completeReport(content: string): string {
  return `${content}${GROWTH_MARGIN_BLOCK}`;
}

describe("report-writer.md.self-check", () => {
  it("passes for a complete report with all sections", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---
title: 测试报告
date: 2026-08-04
---

# 核心结论

## 护城河评估

## 反向检查清单

## 历史类比

## 跟踪指标

能力圈声明：在能力圈内

| 指标 | 值 | 说明 |
|------|-----|------|
| A | 1 | x |
| B | 2 | y |
| C | 3 | z |
| D | 4 | z |

买入建议基于安全边际

## 多空辩论摘要

多方论点🟢 vs 空方论点🔴 对照

裁决：结合产业理解、行业周期、国际形势、政策形势综合判断
`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(10);
    expect(result.issues).toHaveLength(0);
    cleanup(dir);
  });

  it("fails for missing frontmatter", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true); // score still >= 7
    expect(result.issues).toContain("缺少 frontmatter");
    cleanup(dir);
  });

  it("fails for missing moat section", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("报告缺少护城河评估");
    expect(result.score).toBe(8);
    cleanup(dir);
  });

  it("fails for missing reverse checklist", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("缺少反向检查清单（芒格框架）");
    expect(result.score).toBe(8);
    cleanup(dir);
  });

  it("fails for missing analogy section", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("缺少历史类比（李录框架）");
    expect(result.score).toBe(9);
    cleanup(dir);
  });

  it("fails for missing tracking indicators", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("缺少跟踪指标设定");
    expect(result.score).toBe(9);
    cleanup(dir);
  });

  it("fails for missing ability circle", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("缺少能力圈声明");
    expect(result.score).toBe(9);
    cleanup(dir);
  });

  it("fails for too few table rows", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("数据表格过少，可能缺乏数据支撑");
    expect(result.score).toBe(9);
    cleanup(dir);
  });

  it("fails for bad words in investment advice", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n\n强烈买入，必涨！
`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain("投资建议中存在不本分的措辞（如「强烈买入」「必涨」等）");
    expect(result.score).toBe(8);
    cleanup(dir);
  });

  it("fails when HTML is missing", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const htmlPath = join(dir, "report.html");
    const content = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath, htmlPath);
    expect(result.pass).toBe(true);
    expect(result.issues).toContain(`HTML 报告不存在: ${htmlPath}`);
    expect(result.score).toBe(8);
    cleanup(dir);
  });

  it("fails HTML dark mode check", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const htmlPath = join(dir, "report.html");
    const mdContent = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    const htmlContent = `<html><head></head><body></body></html>`;
    writeFileSync(mdPath, mdContent, "utf-8");
    writeFileSync(htmlPath, htmlContent, "utf-8");
    const result = check(mdPath, htmlPath);
    expect(result.pass).toBe(false);
    expect(result.issues).toContain("HTML 未按 design.md 设置 Dark Mode 默认（--bg-page: #0b1020 缺失）");
    expect(result.issues).toContain("HTML 缺少 CSS 变量体系（:root 变量块缺失）");
    cleanup(dir);
  });

  it("passes HTML check with proper design.md compliance", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const htmlPath = join(dir, "report.html");
    const mdContent = completeReport(`---\ntitle: t\n---\n\n# 核心结论\n\n## 护城河评估\n\n## 反向检查清单\n\n## 历史类比\n\n## 跟踪指标\n\n能力圈声明\n\n| A | B | C |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\n多空辩论：多方🟢 vs 空方🔴\n\n裁决：结合产业、周期、国际形势、政策形势综合判断\n`);
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
<style>
:root { --bg-page: #0b1020; --bg-card: #111827; --text-primary: #e5e7eb; --fin-up: #ef4444; --fin-down: #22c55e; --star-on: #fbbf24; }
@media (max-width: 640px) { body { font-size: 14px; } }
</style>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
</head>
<body>
<script>
echarts.init(document.getElementById('chart'));
const DARK_THEME_BASE = { backgroundColor: 'transparent' };
</script>
<div class="star-rating">★★★★★</div>
<footer>免责声明：不构成任何投资建议，市场有风险</footer>
<script>if (window.__ECHARTS_FAIL) { console.log('图表加载失败'); }</script>
</body>
</html>`;
    writeFileSync(mdPath, mdContent, "utf-8");
    writeFileSync(htmlPath, htmlContent, "utf-8");
    const result = check(mdPath, htmlPath);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(10);
    expect(result.issues).toHaveLength(0);
    cleanup(dir);
  });

  it("handles file read errors gracefully", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "nonexistent.md");
    const result = check(mdPath);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.issues[0]).toMatch(/读取文件失败/);
    cleanup(dir);
  });

  it("accumulates multiple issues correctly", () => {
    const dir = createTempDir();
    const mdPath = join(dir, "report.md");
    const content = `# 核心结论\n\n正文内容占位\n\n风险提示章节\n\n行业对比分析\n\n| A | B | C |\n| 1 | 2 | 3 |

强烈买入必涨！
`;
    writeFileSync(mdPath, content, "utf-8");
    const result = check(mdPath);
    expect(result.pass).toBe(false);
    expect(result.score).toBeLessThan(7);
    expect(result.issues).toContain("缺少 frontmatter");
    expect(result.issues).toContain("报告缺少护城河评估");
    expect(result.issues).toContain("缺少反向检查清单（芒格框架）");
    expect(result.issues).toContain("缺少历史类比（李录框架）");
    expect(result.issues).toContain("缺少跟踪指标设定");
    expect(result.issues).toContain("缺少能力圈声明");
    expect(result.issues).toContain("数据表格过少，可能缺乏数据支撑");
    expect(result.issues).toContain("投资建议中存在不本分的措辞（如「强烈买入」「必涨」等）");
    expect(result.issues).toContain("报告未呈现多空双方论点（Bull/Bear Case）");
    expect(result.issues).toContain("增长驱动分析缺失：未判断企业是否处于高增长阶段");
    expect(result.issues).toContain("核心优势可持续性分析缺失：未识别企业优势维度并与同行/行业对比");
    cleanup(dir);
  });
});
