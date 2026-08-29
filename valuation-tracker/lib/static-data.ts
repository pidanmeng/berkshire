/**
 * 服务端静态数据读取 — SSG 数据源（public/data/companies.json + docs/<code>/）
 *
 * 产物由 scripts/generate-static-data.ts 构建期生成（build 前置 / dev 启动前置）；
 * 页面（app/page.tsx、app/companies/[thscode]/page.tsx）与后端
 * （server/routes/fundamentals.ts）在构建/运行时读取。
 * 路径安全：thscode 目录名校验 + 文档文件名禁止路径分隔符（沿用 doc-store 防目录穿越约定）。
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  CompanyDocMeta,
  CompanyStaticItem,
  CompanyUpdateMeta,
  StaticCompaniesData,
} from "./api.ts";

/** thscode 目录名校验（防目录穿越；仅允许字母数字点横线，如 300750.SZ / 688041.SH） */
export function isSafeCode(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.\-]{0,15}$/.test(code);
}

/**
 * public/data 定位探测链（本地 dev / 自托管 → Next standalone 输出 → 函数包 tracing 复制目录）。
 * standalone 输出会把 public/ 复制到 .next/standalone/<app>/public；Vercel 函数包经
 * next.config.mjs outputFileTracingIncludes 打入 ./public/data。
 */
const DATA_DIR_CANDIDATES = [
  resolve(process.cwd(), "public", "data"),
  resolve(process.cwd(), ".next", "standalone", "valuation-tracker", "public", "data"),
  resolve(process.cwd(), ".next", "standalone", "public", "data"),
];

function findDataDir(): string | null {
  for (const c of DATA_DIR_CANDIDATES) {
    try {
      if (existsSync(join(c, "companies.json"))) return c;
    } catch {
      // 探测失败继续下一候选
    }
  }
  return DATA_DIR_CANDIDATES[0];
}

let dataDirCache: string | null | undefined;

function getDataDir(): string | null {
  if (dataDirCache === undefined) dataDirCache = findDataDir();
  return dataDirCache;
}

/** 读取静态公司数据（构建期产物缺失时返回 null） */
export function readStaticCompanies(): StaticCompaniesData | null {
  const dir = getDataDir();
  if (!dir) return null;
  const p = join(dir, "companies.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as StaticCompaniesData;
  } catch {
    return null;
  }
}

/** 按 thscode 找静态公司条目（大小写不敏感） */
export function getStaticNote(code: string): CompanyStaticItem | null {
  const data = readStaticCompanies();
  if (!data) return null;
  const upper = code.toUpperCase();
  return data.list.find((n) => n.thscode.toUpperCase() === upper) ?? null;
}

/** 某公司 docs 索引（deep-reads / annual-reports / updates 元数据；无则返回空结构） */
export function getStaticDocs(code: string): {
  deepReads: CompanyDocMeta[];
  annualReports: CompanyDocMeta[];
  updates: CompanyUpdateMeta[];
} | null {
  const data = readStaticCompanies();
  if (!data) return null;
  const entry = data.docsIndex[code.toUpperCase()];
  if (!entry) return null;
  return entry;
}

/** 全部 thscode（generateStaticParams 用） */
export function listStaticCodes(): string[] {
  const data = readStaticCompanies();
  return data ? data.list.map((n) => n.thscode) : [];
}

/** 静态文档正文（路径安全：code 目录名校验 + fileName 不得含路径分隔符） */
export function readStaticDoc(
  code: string,
  kind: "note" | "updates" | "deep-reads" | "annual-reports",
  fileName?: string,
): string | null {
  if (!isSafeCode(code)) return null;
  const dir = getDataDir();
  if (!dir) return null;
  if (kind === "note") {
    const p = join(dir, "docs", code, "note.md");
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }
  if (!fileName || basename(fileName) !== fileName) return null; // 禁止路径穿越
  const p = join(dir, "docs", code, kind, fileName);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}
