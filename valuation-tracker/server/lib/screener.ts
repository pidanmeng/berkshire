/**
 * 全市场初筛数据源解析 — latest-screener.json 为唯一事实源（脚本 .trae/scripts/screener/screen.ts 产出）
 * 读取统一经 doc-store（Fs：直读仓库；SQLite：Vercel 只读 research.db），60s 缓存。
 * 加载后用 loadCompanies() 给每行补 researched 标记（已调研 → 前端可链接详情页）。
 */
import { loadCompanies } from "./research.ts";
import { openDocStore } from "./doc-store.ts";

export type ScreenPool = "star" | "watch" | "exclude" | "loss";

export interface ScreenRow {
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

export interface RawScreener {
  meta: ScreenerMeta;
  pools: Record<ScreenPool, ScreenRow[]>;
}

export interface ScreenerRow extends ScreenRow {
  researched: boolean;
}

export interface ScreenerData {
  meta: ScreenerMeta;
  rows: ScreenerRow[];
}

/** 调研数据存储单例（doc-store 探测 FS / SQLite） */
const store = openDocStore();

let cache: { expires: number; data: ScreenerData | null } | null = null;

/** 加载初筛数据（60s 缓存），并标记 researched；数据缺失返回 null */
export async function loadScreener(force = false): Promise<ScreenerData | null> {
  const now = Date.now();
  if (!force && cache && cache.expires > now) return cache.data;
  try {
    const json = await store.readScreenerJson();
    if (json === null) {
      cache = { expires: now + 60_000, data: null };
      return null;
    }
    const raw = JSON.parse(json) as RawScreener;
    const researchedSet = new Set((await loadCompanies()).map((n) => n.thscode));
    const rows: ScreenerRow[] = (
      [
        ...raw.pools.star,
        ...raw.pools.watch,
        ...raw.pools.exclude,
        ...raw.pools.loss,
      ]
    ).map((r) => ({ ...r, researched: researchedSet.has(r.thscode) }));
    const data: ScreenerData = { meta: raw.meta, rows };
    cache = { expires: now + 60_000, data };
    return data;
  } catch {
    cache = { expires: now + 60_000, data: null };
    return null;
  }
}
