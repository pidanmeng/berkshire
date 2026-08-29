/**
 * 构建期静态数据生成 — SSG 数据源（替代后端解析 + Turso 同步）
 *
 * 背景：三大痛点改造（访问慢 / 服务端被风控限流 / Turso 同步繁琐）的核心产物。
 * 本脚本在构建期扫描 ../Research/，复用 server/lib/research.ts 的 parseNote / parseUpdate
 * 解析 Markdown frontmatter，产出：
 *   - public/data/companies.json  — 全部公司静态字段（无 quote/zone 实时字段）+ docs 索引
 *   - public/data/docs/<thscode>/ — note.md / updates/<file> / deep-reads/<file> / annual-reports/<file>
 *
 * 生命线约束：构建期零外部请求（东财从服务器 GET 实测被重置），只打包 Markdown 已有静态字段；
 * 实时行情/估值/K线由前端浏览器直连（lib/market-data.ts）。
 *
 * walk/collect 模式与 scripts/build-research-db.ts 保持一致；docs 匹配逻辑对齐
 * server/lib/research.ts 的 scanDeepReads / scanAnnualReports（deep-read 按公司名 + 文件名匹配）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import {
  parseNote,
  parseUpdate,
  type CompanyDocMeta,
  type CompanyNote,
  type CompanyUpdate,
} from "../server/lib/research.ts";

// 标准 ESM 定位脚本目录（不用 Bun 专有的 import.meta.dir，保证 Next/Vercel 类型检查通过）
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", ".."); // valuation-tracker/scripts → 仓库根
const DEFAULT_RESEARCH_SRC = join(REPO_ROOT, "Research");
const DEFAULT_DEST_DIR = join(REPO_ROOT, "valuation-tracker", "public", "data");

/** thscode 目录名校验（防目录穿越；仅允许字母数字点横线，如 300750.SZ / 688041.SH） */
export function isSafeCode(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{0,15}$/.test(code);
}

/** 相对路径统一为 POSIX 分隔符（跨平台一致） */
const posix = (p: string): string => p.split("\\").join("/");

/** 递归收集目录下全部文件绝对路径（复用 build-research-db.ts 的 walk 模式） */
function walk(dir: string, out: string[]): void {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** frontmatter 中 YYYY-MM-DD 会被 js-yaml 解析为 Date，统一归一化为字符串（对齐 research.ts ymd） */
function ymd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return typeof v === "string" ? v : null;
}

/** deep-read 元数据（解析 frontmatter title / read_at，对齐 research.ts scanDeepReads） */
function parseDocMeta(fileName: string, content: string): CompanyDocMeta {
  let title: string | null = null;
  let date: string | null = null;
  try {
    const { data } = matter(content);
    title = typeof data.title === "string" ? data.title : null;
    date =
      ymd(data.read_at) ??
      ymd(data.date) ??
      fileName.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ??
      null;
  } catch {
    // 元数据缺失不影响列表
  }
  return { fileName, title, date, kind: "deep-read", sizeBytes: 0 };
}

/** update 元数据（剔除正文 markdown 与 filePath，正文落盘 docs/<code>/updates/ 按需读取） */
type UpdateMeta = Omit<CompanyUpdate, "markdown" | "filePath">;

export interface StaticGenerateResult {
  jsonPath: string;
  companyCount: number;
  docFileCount: number;
  generatedAt: string;
}

/**
 * 生成静态数据（路径可注入，便于测试）
 * @returns 统计信息；researchSrc 不存在时返回 null（兼容 Vercel 云端无 Research 的场景）
 */
export async function generateStaticData(opts: {
  researchSrc: string;
  destDir: string;
}): Promise<StaticGenerateResult | null> {
  const { researchSrc, destDir } = opts;
  if (!existsSync(researchSrc)) {
    console.warn(`[generate-static-data] 未找到 ${researchSrc}，跳过静态数据生成`);
    return null;
  }

  const notes: CompanyNote[] = [];
  // 公司目录（绝对路径）与笔记相对目录（POSIX，相对 Research 根）
  const noteDirs = new Map<string, string>();
  const knowledgeBase = join(researchSrc, "10-Knowledge");
  if (existsSync(knowledgeBase)) {
    for (const industry of readdirSync(knowledgeBase)) {
      const researchDir = join(knowledgeBase, industry, "02-公司研究");
      if (!existsSync(researchDir)) continue;
      for (const f of readdirSync(researchDir)) {
        if (!f.endsWith(".md")) continue;
        const abs = join(researchDir, f);
        const rel = posix(join("Research/10-Knowledge", industry, "02-公司研究", f));
        try {
          const note = parseNote(rel, readFileSync(abs, "utf-8"));
          if (note) {
            notes.push(note);
            noteDirs.set(note.thscode, researchDir);
          }
        } catch {
          // 跳过解析失败的笔记（不阻断整体，与 loadCompanies 一致）
        }
      }
    }
  }

  const processingDir = join(researchSrc, "00-Workspace", "02-Processing");
  // 02-Processing 根目录下 deep-read 文件名（非递归，对齐 doc-store listDeepReadPaths）
  const deepReadFiles = existsSync(processingDir)
    ? readdirSync(processingDir).filter((f) => /\.md$/i.test(f) && f.includes("deep-read"))
    : [];

  const docsIndex: Record<
    string,
    { deepReads: CompanyDocMeta[]; annualReports: CompanyDocMeta[]; updates: UpdateMeta[] }
  > = {};
  const docFiles: { relDest: string; content: string }[] = [];

  for (const note of notes) {
    const code = note.thscode;
    if (!isSafeCode(code)) {
      console.warn(`[generate-static-data] 跳过非法 thscode：${code}（${note.name}）`);
      continue;
    }
    const dir = noteDirs.get(code)!;
    const dirRel = posix(dirname(note.notePath));

    // 笔记正文（剔除 frontmatter）
    docFiles.push({ relDest: `docs/${code}/note.md`, content: matter(readFileSync(join(dir, basenameSafe(note.fileName)), "utf-8")).content });

    // 基本面更新产物（deep-dive-update），按 updated 倒序（对齐 loadCompanyUpdates）
    const updates: UpdateMeta[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const u = parseUpdate(posix(join(dirRel, f)), readFileSync(join(dir, f), "utf-8"));
        if (u && u.thscode === code) {
          const { markdown, filePath: _fp, ...meta } = u;
          updates.push(meta);
          docFiles.push({ relDest: `docs/${code}/updates/${f}`, content: markdown });
        }
      } catch {
        // 跳过解析失败的更新产物
      }
    }
    updates.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));

    // 年报精读（02-Processing 根目录下文件名含公司名 + deep-read）
    const deepReads: CompanyDocMeta[] = [];
    for (const f of deepReadFiles) {
      if (!f.includes(note.name)) continue;
      const content = readFileSync(join(processingDir, f), "utf-8");
      deepReads.push(parseDocMeta(f, content));
      docFiles.push({ relDest: `docs/${code}/deep-reads/${f}`, content });
    }
    deepReads.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    // 年报原文（pdf-texts/<公司名>/ 下 *.md / *.txt）
    const annualReports: CompanyDocMeta[] = [];
    const pdfDir = join(processingDir, "pdf-texts", note.name);
    if (existsSync(pdfDir)) {
      for (const f of readdirSync(pdfDir)) {
        if (!/\.(md|txt)$/i.test(f)) continue;
        annualReports.push({
          fileName: f,
          title: null,
          date: null,
          kind: "annual-report",
          sizeBytes: statSync(join(pdfDir, f)).size,
        });
        docFiles.push({ relDest: `docs/${code}/annual-reports/${f}`, content: readFileSync(join(pdfDir, f), "utf-8") });
      }
      annualReports.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }

    docsIndex[code] = { deepReads, annualReports, updates };
  }

  // 清空目标目录后重建（先删后建，避免残留旧公司文档）
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  for (const df of docFiles) {
    const p = join(destDir, df.relDest);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, df.content, "utf-8");
  }

  // list 剔除 notePath（前端 CompanyStaticItem 不含该字段，避免冗余路径泄露）
  const list = notes.map((n) => {
    const { notePath: _np, ...rest } = n;
    return rest;
  });
  const jsonPath = join(destDir, "companies.json");
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), list, docsIndex }, null, 2), "utf-8");

  console.log(
    `[generate-static-data] 完成：${notes.length} 家公司，${docFiles.length} 份文档 → ${jsonPath}`,
  );
  return {
    jsonPath,
    companyCount: notes.length,
    docFileCount: docFiles.length,
    generatedAt: new Date().toISOString(),
  };
}

/** basename 安全包装（fileName 来自 readdirSync 时天然安全，此处防御非法输入） */
function basenameSafe(p: string): string {
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] ?? p;
}

// Bun 专有属性：直接执行（bun run scripts/generate-static-data.ts）时为 true；被测试 import 时为 false
const isMain = (import.meta as unknown as { main?: boolean }).main === true;
if (isMain) await main();

async function main(): Promise<void> {
  const result = await generateStaticData({
    researchSrc: DEFAULT_RESEARCH_SRC,
    destDir: DEFAULT_DEST_DIR,
  });
  if (!result) process.exitCode = 1;
}
