/**
 * 调研数据源解析 — Markdown 是唯一事实源（Git 仓库内的公司笔记）
 * 数据读取统一经 doc-store（FsDocStore：dev/自托管直读仓库；SqliteDocStore：Vercel 只读 research.db）。
 * 请求时用 gray-matter 解析 frontmatter，60s 缓存。
 * 综合分由 computeComposite 现算（权重改 composite.ts 一处全局生效）。
 */
import { existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import matter from "gray-matter";
import { computeComposite } from "./weights.ts";
import { openDocStore, type DocStore } from "./doc-store.ts";

/** 调研数据存储单例（FS 或 SQLite，由 doc-store 按环境探测） */
const store: DocStore = openDocStore();

export interface FinancialHistoryItem {
  fiscalYear: number;
  revenueYi?: number;
  netProfitYi?: number;
  roe?: number;
  netMargin?: number;
  ocfYi?: number;
  assetLiabilityRatio?: number;
}

export interface Financials {
  reportPeriod?: number;
  revenueYi?: number;
  netProfitYi?: number;
  roe?: number;
  grossMargin?: number;
  netMargin?: number;
  assetLiabilityRatio?: number;
  ocfYi?: number;
  ocfToNi?: number;
  revenueYoy?: number;
  netProfitYoy?: number;
  history?: FinancialHistoryItem[];
}

export interface CompanyNote {
  thscode: string;
  name: string;
  fileName: string;
  notePath: string;
  industry: string | null;
  subIndustry: string | null;
  tags: string[];
  scores: { capability?: number; moat?: number; business_model?: number; management?: number; inversion?: number; historical?: number } | null;
  composite: number | null;   // 系统加权计算
  targetMarketCapYi: { pessimistic?: number; neutral?: number; optimistic?: number } | null;
  forwardPe: { value?: number; baseNetProfitYi?: number; basePeriod?: string; factors?: string[]; directions?: string[] } | null;
  valuationType: string | null;   // 品种：financial/cyclical/resource/conglomerate/growth/general/lossmaking
  peg: PegSnapshot | null;        // PEG 快照（PEG = PE ÷ 预测期增速%）
  researchCutoff: { reportPeriod?: string; reportDate?: string; announcementDate?: string } | null;
  financials: Financials | null;   // backfill 从同花顺三表多期现算的结构化财务字段
  qualityVerdict: string | null;   // GREEN / YELLOW / RED
  qualityScore: number | null;     // 0-10
  backfilled: boolean;
  created: string | null;
  updated: string | null;
  // 一句话判断（公司研究核心结论）
  earnsFrom: string | null;        // 赚谁的钱
  earnsType: string | null;        // 赚的是什么钱
  whyInvest: string | null;        // 为什么投资他
  whyNotInvest: string | null;     // 为什么不投资他
}

/** PEG 快照：PEG = 当前价对应 PE ÷ 预测期增速(%）；growthBasis: forward（预测期）/ yoy（单年同比） */
export interface PegSnapshot {
  value?: number;
  growthBasis?: string;
  basePeriod?: string;   // 盈利基准期，与 forwardPe.basePeriod 对齐
}

/** frontmatter 中 [[X]] / [[X|Y]] → X */
function unwrapWiki(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  return m ? m[1].trim() : v.trim();
}

/**
 * 解析调研数据根目录（Research/ 所在位置）—— 兼容/调试用：
 * 实际读取已统一走 doc-store（openDocStore），本函数保留 FS 模式的根目录探测结果。
 */
export function resolveResearchRoot(): string {
  const env = process.env.RESEARCH_ROOT;
  if (env) return resolve(process.cwd(), env);
  const dataDir = process.env.RESEARCH_DATA_DIR || "research-data";
  const candidates = [
    resolve(process.cwd(), ".."),                        // 本地仓库根（真实数据）
    resolve(process.cwd(), dataDir),                     // research-data（部署副本）
    resolve(process.cwd(), ".next", dataDir),            // standalone 输出
    resolve(process.cwd(), ".next", "server", dataDir),  // Vercel serverless 函数包（.next/server 层级）
  ];
  for (const c of candidates) {
    try {
      if (existsSync(join(c, "Research", "10-Knowledge"))) return c;
    } catch {
      // 探测失败继续下一候选
    }
  }
  return candidates[0];
}

/**
 * 读取质量筛查结论 —— 仅从 frontmatter 读取（调研流程 quality-screen 产出后直接回填
 * quality_verdict/quality_score；存量笔记由 .trae/scripts/valuation/migrate-quality.ts 一次性回填）。
 * 运行时不做任何正文解析。
 */
function readQuality(data: Record<string, unknown>): { verdict: string | null; score: number | null } {
  let verdict: string | null = null;
  if (typeof data.quality_verdict === "string") {
    const v = data.quality_verdict.trim().toUpperCase();
    if (v === "GREEN" || v === "YELLOW" || v === "RED") verdict = v;
  }
  let score: number | null = null;
  if (typeof data.quality_score === "number" && Number.isFinite(data.quality_score)) {
    score = Math.round(data.quality_score * 10) / 10;
  }
  return { verdict, score };
}

/** 解析 frontmatter financials 块（snake_case → camelCase；YYYY 型日期已被 ymd 归一化） */
function parseFinancials(rawFin: Record<string, unknown> | null): Financials | null {
  if (!rawFin) return null;
  return {
    reportPeriod: typeof rawFin.report_period === "number" ? rawFin.report_period : undefined,
    revenueYi: typeof rawFin.revenue_yi === "number" ? rawFin.revenue_yi : undefined,
    netProfitYi: typeof rawFin.net_profit_yi === "number" ? rawFin.net_profit_yi : undefined,
    roe: typeof rawFin.roe === "number" ? rawFin.roe : undefined,
    grossMargin: typeof rawFin.gross_margin === "number" ? rawFin.gross_margin : undefined,
    netMargin: typeof rawFin.net_margin === "number" ? rawFin.net_margin : undefined,
    assetLiabilityRatio: typeof rawFin.asset_liability_ratio === "number" ? rawFin.asset_liability_ratio : undefined,
    ocfYi: typeof rawFin.ocf_yi === "number" ? rawFin.ocf_yi : undefined,
    ocfToNi: typeof rawFin.ocf_to_ni === "number" ? rawFin.ocf_to_ni : undefined,
    revenueYoy: typeof rawFin.revenue_yoy === "number" ? rawFin.revenue_yoy : undefined,
    netProfitYoy: typeof rawFin.net_profit_yoy === "number" ? rawFin.net_profit_yoy : undefined,
    history: Array.isArray(rawFin.history)
      ? rawFin.history.map((h) => {
          const it = (h ?? {}) as Record<string, unknown>;
          return {
            fiscalYear: typeof it.fiscal_year === "number" ? it.fiscal_year : 0,
            revenueYi: typeof it.revenue_yi === "number" ? it.revenue_yi : undefined,
            netProfitYi: typeof it.net_profit_yi === "number" ? it.net_profit_yi : undefined,
            roe: typeof it.roe === "number" ? it.roe : undefined,
            netMargin: typeof it.net_margin === "number" ? it.net_margin : undefined,
            ocfYi: typeof it.ocf_yi === "number" ? it.ocf_yi : undefined,
            assetLiabilityRatio: typeof it.asset_liability_ratio === "number" ? it.asset_liability_ratio : undefined,
          };
        })
      : undefined,
  };
}

function parseNote(relPath: string, content: string): CompanyNote | null {
  const { data } = matter(content);
  // 公司文件夹内可能存在 deep-dive-update 等非公司类型产物，跳过以免被当成独立公司
  if (typeof data.type === "string" && data.type !== "company") return null;
  const sc = (data.stock_code ?? data.stockCode) as string | undefined;
  const thscode = typeof sc === "string" ? sc.toUpperCase() : "";
  if (!thscode) return null;

  const name = (data.name ?? data.company ?? data.title) as string | undefined;
  const q = readQuality(data);

  // frontmatter 为 snake_case，映射为 camelCase
  const rawScores = data.scores && typeof data.scores === "object" ? data.scores as Record<string, number> : null;
  const rawCap = data.target_market_cap_yi && typeof data.target_market_cap_yi === "object"
    ? data.target_market_cap_yi as Record<string, number> : null;
  const rawFpe = data.forward_pe && typeof data.forward_pe === "object"
    ? data.forward_pe as Record<string, unknown> : null;
  const rawPeg = data.peg && typeof data.peg === "object"
    ? data.peg as Record<string, unknown> : null;
  const rawCutoff = data.research_cutoff && typeof data.research_cutoff === "object"
    ? data.research_cutoff as Record<string, string> : null;
  const rawFin = data.financials && typeof data.financials === "object"
    ? data.financials as Record<string, unknown> : null;

  const financials = parseFinancials(rawFin);

  return {
    thscode,
    name: typeof name === "string" ? name : thscode,
    fileName: basename(relPath),
    notePath: relPath,
    industry: unwrapWiki(data.industry),
    subIndustry: unwrapWiki(data.sub_industry ?? data.subIndustry),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    scores: rawScores
      ? {
          capability: rawScores.capability, moat: rawScores.moat,
          business_model: rawScores.business_model, management: rawScores.management,
          inversion: rawScores.inversion, historical: rawScores.historical,
        }
      : null,
    composite: computeComposite(rawScores ?? {}),
    targetMarketCapYi: rawCap
      ? { pessimistic: rawCap.pessimistic, neutral: rawCap.neutral, optimistic: rawCap.optimistic }
      : null,
    forwardPe: rawFpe
      ? {
          value: typeof rawFpe.value === "number" ? rawFpe.value : undefined,
          baseNetProfitYi: typeof rawFpe.base_net_profit_yi === "number" ? rawFpe.base_net_profit_yi : undefined,
          basePeriod: typeof rawFpe.base_period === "string" ? rawFpe.base_period : undefined,
          factors: Array.isArray(rawFpe.factors) ? rawFpe.factors.map(String) : undefined,
          directions: Array.isArray(rawFpe.directions) ? rawFpe.directions.map(String) : undefined,
        }
      : null,
    valuationType: typeof data.valuation_type === "string" ? data.valuation_type : null,
    peg: rawPeg
      ? {
          value: typeof rawPeg.value === "number" ? rawPeg.value : undefined,
          growthBasis: typeof rawPeg.growth_basis === "string" ? rawPeg.growth_basis : undefined,
          basePeriod: typeof rawPeg.base_period === "string" ? rawPeg.base_period : undefined,
        }
      : null,
    researchCutoff: rawCutoff
      ? {
          reportPeriod: rawCutoff.report_period || undefined,
          reportDate: rawCutoff.report_date || undefined,
          announcementDate: rawCutoff.announcement_date || undefined,
        }
      : null,
    financials,
    qualityVerdict: q.verdict,
    qualityScore: q.score,
    backfilled: data.backfilled === true,
    created: typeof data.created === "string" ? data.created : typeof data.created_at === "string" ? data.created_at : null,
    updated: typeof data.updated === "string" ? data.updated : typeof data.updated_at === "string" ? data.updated_at : null,
    earnsFrom: typeof data.earns_from === "string" ? data.earns_from : null,
    earnsType: typeof data.earns_type === "string" ? data.earns_type : null,
    whyInvest: typeof data.why_invest === "string" ? data.why_invest : null,
    whyNotInvest: typeof data.why_not_invest === "string" ? data.why_not_invest : null,
  };
}

// 目录 mtime 缓存（60s）
let cache: { dir: string; expires: number; notes: CompanyNote[] } | null = null;

/** 解析全部公司笔记（60s 缓存） */
export async function loadCompanies(force = false): Promise<CompanyNote[]> {
  const now = Date.now();
  if (!force && cache && cache.expires > now) {
    return cache.notes;
  }
  const notes: CompanyNote[] = [];
  for (const relPath of await store.listNotePaths()) {
    const content = await store.readFile(relPath);
    if (content === null) continue;
    try {
      const note = parseNote(relPath, content);
      if (note) notes.push(note);
    } catch {
      // 跳过解析失败的笔记（不阻断整体）
    }
  }
  cache = { dir: store.describe().kind, expires: now + 60_000, notes };
  return notes;
}

/** 按 thscode 找公司笔记 */
export async function findCompany(thscode: string): Promise<CompanyNote | null> {
  const code = thscode.toUpperCase();
  return (await loadCompanies()).find((n) => n.thscode === code) ?? null;
}

/** 读笔记正文（供详情页渲染财务表/质量筛查/跟踪指标等原始 Markdown 段落） */
export async function readNoteBody(thscode: string): Promise<{ content: string; data: Record<string, unknown> } | null> {
  const note = await findCompany(thscode);
  if (!note) return null;
  const raw = await store.readFile(note.notePath);
  if (raw === null) return null;
  const { data, content } = matter(raw);
  return { content, data };
}

// ===== 基本面更新产物（deep-dive-update）=====

export interface CompanyUpdate {
  thscode: string;
  name: string;
  fileName: string;
  filePath: string;
  type: string;
  updated: string | null;
  dataAsOf: string | null;
  trigger: string | null;
  basedOn: string | null;
  tags: string[];
  financials: Financials | null;
  qualityVerdict: string | null;
  qualityScore: number | null;
  researchConclusion: string | null;
  markdown: string;
}

/** 识别为公司文件夹内的「基本面更新」产物类型 */
const UPDATE_TYPES = new Set(["deep-dive-update", "deep-dive-update-report"]);

/** frontmatter 中 YYYY-MM-DD 会被 js-yaml 解析为 Date，统一归一化为字符串 */
function ymd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return typeof v === "string" ? v : null;
}

/** 解析公司文件夹内的基本面更新产物（与公司笔记同目录，frontmatter type 为 deep-dive-update） */
function parseUpdate(relPath: string, content: string): CompanyUpdate | null {
  const { data, content: body } = matter(content);
  if (typeof data.type !== "string" || !UPDATE_TYPES.has(data.type)) return null;
  const sc = (data.stock_code ?? data.stockCode) as string | undefined;
  if (typeof sc !== "string") return null;
  const q = readQuality(data);
  const rawFin = data.financials && typeof data.financials === "object"
    ? data.financials as Record<string, unknown> : null;
  return {
    thscode: sc.toUpperCase(),
    name: typeof (data.name ?? data.company ?? data.title) === "string" ? (data.name ?? data.company ?? data.title) as string : sc.toUpperCase(),
    fileName: basename(relPath),
    filePath: relPath,
    type: data.type,
    updated: ymd(data.updated),
    dataAsOf: ymd(data.data_as_of),
    trigger: typeof data.trigger === "string" ? data.trigger : null,
    basedOn: unwrapWiki(data.based_on),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    financials: parseFinancials(rawFin),
    qualityVerdict: q.verdict,
    qualityScore: q.score,
    researchConclusion: typeof data.research_conclusion === "string" ? data.research_conclusion : null,
    markdown: body,
  };
}

/** 加载某公司文件夹内的全部基本面更新产物（按 updated 倒序），无则返回空数组 */
export async function loadCompanyUpdates(thscode: string): Promise<CompanyUpdate[]> {
  const note = await findCompany(thscode);
  if (!note) return [];
  // notePath 为 POSIX 相对路径；dirname 取公司目录前缀（FS 与 SQLite 模式一致）
  const dirPrefix = dirname(note.notePath);
  const updates: CompanyUpdate[] = [];
  for (const relPath of await store.listNotePaths()) {
    if (dirname(relPath) !== dirPrefix) continue;
    const content = await store.readFile(relPath);
    if (content === null) continue;
    try {
      const u = parseUpdate(relPath, content);
      if (u && u.thscode === thscode.toUpperCase()) updates.push(u);
    } catch {
      // 跳过解析失败的更新产物（不阻断整体）
    }
  }
  updates.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  return updates;
}

// ===== 公司原始文档（年报精读 / 年报原文 PDF 提取）=====

export interface CompanyDocMeta {
  fileName: string;
  title: string | null;
  date: string | null;
  kind: "deep-read" | "annual-report";
  sizeBytes: number;
}

/** 按公司名匹配年报精读文档（02-Processing 下 `*<公司名>*deep-read*.md`） */
async function scanDeepReads(name: string): Promise<CompanyDocMeta[]> {
  const out: CompanyDocMeta[] = [];
  for (const f of await store.listDeepReadPaths()) {
    if (!f.includes(name)) continue;
    const doc = await store.readDoc("deep-read", name, f);
    let title: string | null = null;
    let date: string | null = null;
    if (doc) {
      try {
        const { data } = matter(doc.content);
        title = typeof data.title === "string" ? data.title : null;
        date = ymd(data.read_at ?? data.date) ?? (f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null);
      } catch { /* 元数据缺失不影响列表 */ }
    }
    out.push({ fileName: f, title, date, kind: "deep-read", sizeBytes: doc?.sizeBytes ?? 0 });
  }
  out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return out;
}

/** 按公司名匹配年报原文文档（pdf-texts/<公司名>/*.{md,txt}） */
async function scanAnnualReports(name: string): Promise<CompanyDocMeta[]> {
  const out: CompanyDocMeta[] = [];
  for (const f of await store.listAnnualReportPaths(name)) {
    out.push({
      fileName: f,
      title: null,
      date: null,
      kind: "annual-report",
      sizeBytes: await store.docSize("annual-report", name, f),
    });
  }
  // 大文件优先按文件名（巨潮公告编号）排序即可，保持稳定
  out.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return out;
}

/** 加载某公司可匹配到的年报精读与年报原文文档元数据（不含正文，正文按需读取） */
export async function loadCompanyDocs(thscode: string): Promise<{ deepReads: CompanyDocMeta[]; annualReports: CompanyDocMeta[] }> {
  const note = await findCompany(thscode);
  if (!note) return { deepReads: [], annualReports: [] };
  // 两类文档目录互不依赖，并行扫描
  const [deepReads, annualReports] = await Promise.all([
    scanDeepReads(note.name),
    scanAnnualReports(note.name),
  ]);
  return { deepReads, annualReports };
}

/** 读取公司文档正文（kind + fileName 校验路径，防止目录穿越） */
export async function readCompanyDoc(
  thscode: string,
  kind: "deep-read" | "annual-report",
  fileName: string,
): Promise<{ fileName: string; title: string | null; date: string | null; content: string } | null> {
  const note = await findCompany(thscode);
  if (!note) return null;
  const doc = await store.readDoc(kind, note.name, fileName);
  if (!doc) return null;
  let title: string | null = null;
  let date: string | null = null;
  if (kind === "deep-read") {
    try {
      const { data } = matter(doc.content);
      title = typeof data.title === "string" ? data.title : null;
      date = ymd(data.read_at ?? data.date);
    } catch { /* 忽略 */ }
  }
  return { fileName, title, date, content: doc.content };
}

/** 用于诊断缓存状态（调试用） */
export function cacheStat(): { store: ReturnType<DocStore["describe"]>; cached: boolean } {
  return { store: store.describe(), cached: cache !== null };
}
