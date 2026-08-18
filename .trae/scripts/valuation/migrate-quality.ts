#!/usr/bin/env bun
/**
 * 存量公司笔记质量字段回填脚本
 *
 * 背景：valuation-tracker 运行时（server/lib/research.ts）已移除从正文解析质量字段的
 * readQuality 兜底逻辑，质量字段只从 frontmatter 读取（quality_verdict / quality_score，
 * 由调研流程 quality-screen 产出后回填）。本脚本将存量笔记正文《质量筛查结论/报告》段落中
 * 已存在的信息一次性固化到 frontmatter，保证移除解析逻辑后看板不丢数据。
 *
 * 用法:
 *   bun run .trae/scripts/valuation/migrate-quality.ts            # 正式回填
 *   bun run .trae/scripts/valuation/migrate-quality.ts --dry-run   # 只输出变更摘要，不写文件
 *   bun run .trae/scripts/valuation/migrate-quality.ts --dir <相对路径>  # 指定扫描目录（默认 Research/10-Knowledge）
 *
 * 幂等：frontmatter 已含 quality_verdict + quality_score 的笔记跳过；只缺其一则只补缺的那个。
 * 正文解析逻辑与旧版 valuation-tracker research.ts parseQuality 保持一致，确保迁移值 = 旧运行时展示值。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const DEFAULT_DIR = join(ROOT, "Research/10-Knowledge");

const DRY_RUN = process.argv.includes("--dry-run");
const dirIdx = process.argv.indexOf("--dir");
const SCAN_DIR = dirIdx >= 0 ? join(ROOT, process.argv[dirIdx + 1] ?? "") : DEFAULT_DIR;

const VERDICT_EMOJI: Record<string, "GREEN" | "YELLOW" | "RED"> = {
  "🟢": "GREEN",
  "🟡": "YELLOW",
  "🔴": "RED",
};

type Verdict = "GREEN" | "YELLOW" | "RED";

/**
 * 从正文提取质量筛查结论与综合质量分（兼容多种段落格式，与旧版运行时解析保持同源）：
 *  - 判定行内紧邻字母档位（「红黄牌判定/等级判定/判定」→ GREEN|YELLOW|RED）或 emoji 档位（🟢🟡🔴）
 *  - 「质量筛查结论 / 综合质量分 / 质量评分」行内嵌档位与分数
 *  - 分数写法：`综合质量分**: 7.1 / 10`、`质量评分**：0.1-1.9 / 10`（区间取上界）、
 *    `RED（综合 0/10）` / `RED（0.8/10）`（中英文括号）、`质量筛查 RED 1.5/10`
 */
function parseQualityFromBody(content: string): { verdict: Verdict | null; score: number | null } {
  const lines = content.split(/\r?\n/);
  const focusLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/质量筛查|筛查|综合质量分|质量评分|红黄牌|等级判定|判定|总分|总评/.test(lines[i])) {
      focusLines.push(lines.slice(i, Math.min(i + 3, lines.length)).join("\n"));
    }
  }
  const focus = focusLines.join("\n");
  if (!focus) return { verdict: null, score: null };

  const letter =
    focus.match(/(?:红黄牌|等级判定|判定)[^\n]{0,100}?(GREEN|YELLOW|RED)/i) ??
    focus.match(/(?:质量筛查|筛查结论|综合质量分|质量评分)[^\n]{0,120}?(GREEN|YELLOW|RED)/i);
  const emoji = focus.match(/[🟢🟡🔴]/);
  const verdict = letter
    ? (letter[1].toUpperCase() as Verdict)
    : emoji
      ? (VERDICT_EMOJI[emoji[0]] ?? null)
      : null;

  let score: number | null = null;
  const scorePatterns: RegExp[] = [
    /(?:综合质量分|质量评分|综合评分|总分|总评)\s*\*{0,2}\s*[:：]?\s*\*{0,2}\s*([\d.]+)\s*(?:[-–—~〜至]\s*([\d.]+))?\s*\/\s*10/,
    /[（(]\s*(?:综合|质量)?\s*([\d.]+)\s*\/\s*10\s*[)）]/,
    /(?:质量)?筛查\s*[:：]?[^\d\n（(]{0,40}?([\d.]+)\s*\/\s*10/,
  ];
  for (const pat of scorePatterns) {
    const m = pat.exec(focus);
    if (m) {
      const raw = m[2] ?? m[1];
      score = Math.round(parseFloat(raw) * 10) / 10;
      break;
    }
  }
  return { verdict, score };
}

/** frontmatter 顶层键集合（0 缩进、字母/下划线开头） */
function topLevelKeys(fm: string): Set<string> {
  const set = new Set<string>();
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w]*):(?:\s|$)/);
    if (m) set.add(m[1]);
  }
  return set;
}

const QUALITY_BLOCK_HEADER = "# ===== 质量筛查结论（供 valuation-tracker 消费；由 quality-screen 产出后固化，运行时不再解析正文）=====";

function main() {
  if (!existsSync(SCAN_DIR)) {
    console.error(`❌ 扫描目录不存在: ${SCAN_DIR}`);
    process.exit(1);
  }

  const companyDirs: string[] = [];
  if (existsSync(join(SCAN_DIR, "02-公司研究"))) {
    companyDirs.push(join(SCAN_DIR, "02-公司研究"));
  }
  for (const industry of readdirSync(SCAN_DIR)) {
    const researchDir = join(SCAN_DIR, industry, "02-公司研究");
    if (existsSync(researchDir)) companyDirs.push(researchDir);
  }
  if (companyDirs.length === 0) {
    console.error(`❌ 未找到 02-公司研究 目录（扫描: ${SCAN_DIR}）`);
    process.exit(1);
  }

  const files: string[] = [];
  for (const dir of companyDirs) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".md")) files.push(join(dir, f));
    }
  }
  console.log(`扫描到 ${files.length} 个公司笔记（${DRY_RUN ? "DRY-RUN，不写文件" : "正式回填"}）\n`);

  let written = 0;
  let skipped = 0;
  let noQuality = 0;

  for (const file of files) {
    const name = basename(file).replace(/\.md$/, "");
    const raw = readFileSync(file, "utf-8");
    // 规范化 v1 遗留的双井号段落头（`# # =====` → `# =====`，与 backfill 段落头风格一致）
    const raw2 = raw.replace(/^# # ===== 质量筛查结论/m, "# ===== 质量筛查结论");
    const hasHeaderFix = raw2 !== raw;
    const fm = raw2.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      console.log(`⚠️ 无 frontmatter，跳过: ${name}`);
      skipped++;
      continue;
    }

    const keys = topLevelKeys(fm[1]);
    const hasVerdict = keys.has("quality_verdict");
    const hasScore = keys.has("quality_score");

    let next: string | null = null;
    let action = "";
    if (hasVerdict && hasScore) {
      if (hasHeaderFix) {
        next = raw2;
        action = "规范化段落头（字段已存在）";
      } else {
        skipped++;
        continue;
      }
    } else {
      const { verdict, score } = parseQualityFromBody(raw2.slice(fm[0].length));
      if (verdict === null && score === null) {
        console.log(`✗ ${name}: 正文未发现质量筛查内容（保持为空，运行时显示 NULL）`);
        noQuality++;
        continue;
      }
      const insertLines: string[] = [];
      if (verdict !== null && !hasVerdict) insertLines.push(`quality_verdict: "${verdict}"`);
      if (score !== null && !hasScore) insertLines.push(`quality_score: ${score}`);
      if (insertLines.length > 0) {
        const block = (!hasVerdict && !hasScore ? `${QUALITY_BLOCK_HEADER}\n` : "") + insertLines.join("\n");
        next = raw2.replace(fm[0], `---\n${block}\n${fm[1].replace(/^\n/, "")}\n---`);
        action = `回填 ${verdict ?? "—"}/${score ?? "—"}`;
      } else if (hasHeaderFix) {
        next = raw2;
        action = "规范化段落头";
      } else {
        skipped++;
        continue;
      }
    }

    console.log(`${DRY_RUN ? "[dry-run] 待" : "✓"} ${action}: ${name}`);
    if (!DRY_RUN) {
      writeFileSync(file, next, "utf-8");
    }
    written++;
  }

  console.log(`\n完成: 回填 ${written} 个文件（${DRY_RUN ? "DRY-RUN 未写盘" : "已写入"}）; 已存在跳过 ${skipped} 个; 正文无质量内容 ${noQuality} 个`);
}

main();