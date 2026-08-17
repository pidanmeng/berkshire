/**
 * 前端 API 客户端 — 全部数据经 Elysia 后端（不直连外部 API）
 * 服务端组件：process.env.API_BASE_URL（默认同域相对路径）
 * 客户端组件：process.env.NEXT_PUBLIC_API_BASE_URL（默认同域相对路径）
 * 前后端一体部署（Vercel route handler / 本地 dev 均在 Next 进程内），默认走 /api 相对路径；
 * 若后端单独部署（如自托管 3001），通过环境变量显式指定地址。
 */

export function getApiBase(): string {
  const key = typeof window !== "undefined" ? "NEXT_PUBLIC_API_BASE_URL" : "API_BASE_URL";
  const envBase = process.env[key];
  if (envBase) return envBase.replace(/\/$/, "");
  return "";
}

/**
 * 服务端同域绝对地址：Node 的 fetch（undici）不支持相对 URL，
 * SSR 调 /api 时必须补全协议 + host（env API_BASE_URL 优先）。
 * 客户端（浏览器）直接返回空串 → 相对路径（浏览器原生支持）。
 */
async function getServerBase(): Promise<string> {
  if (typeof window !== "undefined") return "";
  const envBase = process.env.API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  } catch {
    return ""; // 兜底：仍用相对路径（部分环境 Next 会补全）
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const base = await getServerBase();
  const res = await fetch(`${base}${path}`, {
    signal,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ===== 类型（与 Elysia 返回结构对应）=====

export type CapZone = "deep_undervalued" | "undervalued" | "fair" | "overvalued" | "no_anchor";

/** PEG 快照：PEG = 当前价对应 PE ÷ 预测期增速(%)；growthBasis: forward（预测期）/ yoy（单年同比） */
export interface PegSnapshot {
  value?: number;
  growthBasis?: string;
  basePeriod?: string;   // 盈利基准期，与 forwardPe.basePeriod 对齐
}

export interface CompanyItem {
  thscode: string;
  name: string;
  fileName: string;
  industry: string | null;
  subIndustry: string | null;
  tags: string[];
  scores: Record<string, number> | null;
  composite: number | null;
  targetMarketCapYi: { pessimistic?: number; neutral?: number; optimistic?: number } | null;
  forwardPe: { value?: number; baseNetProfitYi?: number; basePeriod?: string; factors?: string[]; directions?: string[] } | null;
  valuationType: string | null;   // 品种：financial/cyclical/resource/conglomerate/growth/general/lossmaking
  peg: PegSnapshot | null;
  researchCutoff: { reportPeriod?: string; reportDate?: string; announcementDate?: string } | null;
  qualityVerdict: string | null;
  qualityScore: number | null;
  backfilled: boolean;
  // 一句话判断（公司研究核心结论）
  earnsFrom: string | null;
  earnsType: string | null;
  whyInvest: string | null;
  whyNotInvest: string | null;
  quote: { price: number | null; changePct: number | null; marketCap: number | null; peTtm: number | null; pbMrq: number | null; psTtm: number | null; pcfTtm: number | null };
  zone: { zone: CapZone; label: string; marginVsPess: number | null; distanceToNeutral: number | null; distanceToOpt: number | null };
  marketCapYi: number | null;
  needsUpdate: boolean | null;
  latestReportDate: string | null;
  updateCount: number;
}

export interface CompaniesResponse { list: CompanyItem[]; fetchedAt: number }

export interface KlineResponse {
  thscode: string;
  bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  fetchedAt: number;
}

export interface FundamentalResponse {
  thscode: string;
  needsUpdate: boolean | null;
  latestTitle: string;
  latestDate: string;
  items: { title: string; date: string }[];
  cachedAt: string;
}

/** 财务结构化字段（同花顺三表多期现算，backfill / deep-dive-update 产物写入） */
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
  history?: {
    fiscalYear: number;
    revenueYi?: number;
    netProfitYi?: number;
    roe?: number;
    netMargin?: number;
    ocfYi?: number;
    assetLiabilityRatio?: number;
  }[];
}

/** deep-dive-update 基本面更新产物 */
export interface CompanyUpdate {
  thscode: string;
  name: string;
  fileName: string;
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

/** 公司原始文档元数据（年报精读 / 年报原文 PDF 提取） */
export interface CompanyDocMeta {
  fileName: string;
  title: string | null;
  date: string | null;
  kind: "deep-read" | "annual-report";
  sizeBytes: number;
}

export interface CompanyDocs {
  deepReads: CompanyDocMeta[];
  annualReports: CompanyDocMeta[];
}

export interface CompanyDocContent {
  fileName: string;
  title: string | null;
  date: string | null;
  content: string;
}

/** /api/companies/:thscode 实际返回结构（note 为嵌套调研笔记） */
export interface CompanyDetail {
  note: {
    thscode: string;
    name: string;
    fileName: string;
    industry: string | null;
    subIndustry: string | null;
    tags: string[];
    scores: Record<string, number> | null;
    composite: number | null;
    targetMarketCapYi: CompanyItem["targetMarketCapYi"];
    forwardPe: CompanyItem["forwardPe"];
    valuationType: CompanyItem["valuationType"];
    peg: CompanyItem["peg"];
    researchCutoff: CompanyItem["researchCutoff"];
    qualityVerdict: string | null;
    qualityScore: number | null;
    backfilled: boolean;
    financials: Financials | null;
    created: string | null;
    updated: string | null;
    earnsFrom: string | null;
    earnsType: string | null;
    whyInvest: string | null;
    whyNotInvest: string | null;
  };
  quote: CompanyItem["quote"];
  zone: CompanyItem["zone"];
  marketCapYi: number | null;
  markdown: string | null;
  updates: CompanyUpdate[];
  docs: CompanyDocs;
  fundamental: { needsUpdate: boolean | null; latestTitle: string; latestDate: string; cachedAt: string } | null;
}

export function getCompanies(): Promise<CompaniesResponse> {
  return get("/api/companies");
}

export function getCompanyDetail(thscode: string): Promise<CompanyDetail> {
  return get(`/api/companies/${encodeURIComponent(thscode)}`);
}

export function getKline(thscode: string, days = 250, signal?: AbortSignal): Promise<KlineResponse> {
  return get(`/api/kline/${encodeURIComponent(thscode)}?days=${days}`, signal);
}

export function getFundamentals(thscode: string, refresh = false): Promise<FundamentalResponse> {
  return get(`/api/fundamentals/${encodeURIComponent(thscode)}${refresh ? "?refresh=1" : ""}`);
}

export function getCompanyDoc(thscode: string, kind: "deep-read" | "annual-report", file: string): Promise<CompanyDocContent> {
  return get(`/api/companies/${encodeURIComponent(thscode)}/doc?kind=${kind}&file=${encodeURIComponent(file)}`);
}

// ===== 全市场初筛（/api/screener）=====

export type ScreenPool = "star" | "watch" | "exclude" | "loss";

export interface ScreenerRow {
  thscode: string;
  ticker: string;
  name: string;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  marketCapYi: number | null;
  peTtm: number | null;
  pbMrq: number | null;
  roe: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  ocfToNi: number | null;
  debtRatio: number | null;
  revenueYoy: number | null;
  netProfitYoy: number | null;
  roePrev: number | null;
  overallScore: number;
  verdict: "GREEN" | "YELLOW" | "RED";
  redFlags: string[];
  yellowFlags: string[];
  greenHighlights: string[];
  pool: ScreenPool;
  reason?: string;
  highLeverageNote: boolean;
  dataFailed?: string;
  researched: boolean;
}

export interface ScreenerMeta {
  generatedAt: string;
  report: string;
  prevReport: string;
  quoteAsOf: string;
  config: { minMcapYi: number; excludeSt: boolean; concurrency: number };
  counts: {
    universe: number;
    main: number;
    loss: number;
    excludedStageA: number;
    star: number;
    watch: number;
    exclude: number;
    dataFailed: number;
  };
}

export interface ScreenerResponse {
  meta: ScreenerMeta;
  stats: ScreenerMeta["counts"];
  industries: string[];
  rows: ScreenerRow[];
  page: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ScreenerParams {
  pool?: ScreenPool | "all";
  q?: string;
  industry?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  size?: number;
}

export function getScreener(params?: ScreenerParams, signal?: AbortSignal): Promise<ScreenerResponse> {
  const sp = new URLSearchParams();
  if (params?.pool && params.pool !== "all") sp.set("pool", params.pool);
  if (params?.q) sp.set("q", params.q);
  if (params?.industry) sp.set("industry", params.industry);
  if (params?.sort && params.sort !== "score") sp.set("sort", params.sort);
  if (params?.order) sp.set("order", params.order);
  if (params?.page && params.page > 1) sp.set("page", String(params.page));
  if (params?.size && params.size !== 50) sp.set("size", String(params.size));
  const qs = sp.toString();
  return get(`/api/screener${qs ? `?${qs}` : ""}`, signal);
}

export interface QuoteItem {
  thscode: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  peTtm: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
}

export interface QuotesResponse {
  fetchedAt: number;
  items: QuoteItem[];
}

export function getQuotes(codes: string[], signal?: AbortSignal): Promise<QuotesResponse> {
  return get(`/api/quotes?codes=${encodeURIComponent(codes.join(","))}`, signal);
}
