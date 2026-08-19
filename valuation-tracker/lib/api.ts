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
 * SSR 调 /api 时必须补全协议 + host。优先级：
 *   1. env API_BASE_URL（后端单独部署时显式指定）
 *   2. Vercel 平台注入域名（VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL，生产/预览均可用）
 *   3. 请求头推导（本地 dev / 自托管；注意 next/headers 动态导入在生产构建不可靠，仅作兜底）
 * 客户端（浏览器）直接返回空串 → 相对路径（浏览器原生支持）。
 */
async function getServerBase(): Promise<string> {
  if (typeof window !== "undefined") return "";
  const envBase = process.env.API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, "");

  // Vercel：平台注入的部署域名（运行时可用），避免依赖 next/headers 动态导入
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  } catch (err) {
    // 暴露真实原因（页面层 catch 只显示通用文案，这里补日志便于诊断）
    console.error("[api] getServerBase 失败（SSR fetch 将使用相对路径，Node undici 会报 Failed to parse URL）：", err);
    return "";
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const base = await getServerBase();
  const res = await fetch(`${base}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    // 优先透出后端错误信息（如登录失败原因），便于页面提示
    let message = `API ${res.status}: ${path}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // 非 JSON 错误体，用默认文案
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
  return request<T>(path, {
    signal,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function post<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function put<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function del<T>(path: string, token?: string | null): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
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
  /** 调研截止后未采信的财报列表（基本面 tooltip 展示） */
  fundamentalItems?: { title: string; date: string }[];
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
  fundamental: {
    needsUpdate: boolean | null;
    latestTitle: string;
    latestDate: string;
    cachedAt: string;
    /** 调研截止后未采信的财报列表（tooltip 展示） */
    items?: { title: string; date: string }[];
  } | null;
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

// ===== 暗盘追踪（/api/darktrade）=====

/** 暗盘单行（后端清洗后的安全结构：金额/价格单位元，涨跌幅/活跃度为百分比数） */
export interface DarkTradeRow {
  rank: number;
  code: string;
  name: string;
  boards: string[];
  darkFund: number;    // 暗盘资金（元）
  brightFund: number;  // 明盘资金（元）
  mainNet: number;     // 主力净流入（元）
  activity: number;    // 活跃度（%）
  price: number;       // 股价（元）
  changePct: number;   // 涨跌幅（%）
}

export interface DarkTradeListResponse {
  actualDate: string;  // yyyyMMdd
  pages: number;
  total: number;
  fetchedAt: number;
  items: DarkTradeRow[];
}

export interface DarkTradeHistoryPoint {
  date: string;        // yyyyMMdd
  row: DarkTradeRow;
}

export interface DarkTradeHistoryResponse {
  code: string;
  pageHint: number;    // 本次查询使用的页码 hint（SQLite 持久化）
  endDate: string;
  startDate: string;
  items: DarkTradeHistoryPoint[];
}

/** 全市场暗盘列表（默认当日，可指定 yyyyMMdd） */
export function getDarkTradeList(date?: string): Promise<DarkTradeListResponse> {
  return get(`/api/darktrade${date ? `?date=${date}` : ""}`);
}

/** 单股暗盘历史（endDate/startDate 均为 yyyyMMdd，后端用 SQLite 页码 hint 加速并同步页码） */
export function getDarkTradeHistory(
  code: string,
  opts?: { endDate?: string; startDate?: string },
): Promise<DarkTradeHistoryResponse> {
  const sp = new URLSearchParams();
  if (opts?.endDate) sp.set("endDate", opts.endDate);
  if (opts?.startDate) sp.set("startDate", opts.startDate);
  const qs = sp.toString();
  return get(`/api/darktrade/history/${encodeURIComponent(code)}${qs ? `?${qs}` : ""}`);
}

// ===== 留言板（/api/messages）=====

export type MessageType = "qa" | "feature" | "wish" | "correction" | "other";

/** 留言（与后端 toDto 输出对应） */
export interface Message {
  id: number;
  type: MessageType;
  content: string;
  tipAmount: number | null;   // 打赏金额（元），null=未标注打赏
  tipMarkedAt: string | null;
  reply: string | null;       // 管理员回复，null=未回复
  repliedAt: string | null;
  createdAt: string;
}

/** 置顶公告（管理员可编辑，公开可读；content/updatedAt 与后端 toDto 对应） */
export interface Announcement {
  content: string;
  updatedAt: string;   // ISO 时间
}

export interface MessagesResponse {
  messages: Message[];
  /** 后端是否已配置 ADMIN_TOKEN（未配置时管理员登录禁用） */
  adminEnabled: boolean;
  /** 置顶公告（未设置时为 null） */
  announcement: Announcement | null;
}

/** 留言列表：all=true 返回全部（含未回复，需管理员 token），默认只返回已回复留言 */
export function getMessages(all = false, token?: string | null): Promise<MessagesResponse> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return get(`/api/messages${all ? "?all=1" : ""}`, undefined, headers);
}

/** 游客匿名留言 */
export function createMessage(input: { type: string; content: string }): Promise<Message> {
  return post("/api/messages", input);
}

/** 管理员登录：密码校验通过返回 token（前端存 sessionStorage） */
export function adminLogin(password: string): Promise<{ token: string }> {
  return post("/api/messages/admin/login", { password });
}

/** 管理员回复 + 标注打赏金额（tipAmount 传 null 表示不标注/清除） */
export function replyMessage(id: number, reply: string, tipAmount: number | null, token: string): Promise<Message> {
  return post(`/api/messages/${id}/reply`, { reply, tipAmount }, token);
}

/** 管理员删除留言 */
export function deleteMessage(id: number, token: string): Promise<{ ok: boolean }> {
  return del(`/api/messages/${id}`, token);
}

/** 管理员更新置顶公告（覆盖更新；content 由后端 trim 校验非空与长度） */
export function updateAnnouncement(content: string, token: string): Promise<Announcement> {
  return put("/api/messages/announcement", { content }, token);
}
