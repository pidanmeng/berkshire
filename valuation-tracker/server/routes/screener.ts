/**
 * 全市场初筛路由
 * GET /api/screener?pool=&q=&industry=&sort=&order=&page=&size=
 *   服务端过滤 + 排序 + 分页（默认 50/页，60s 缓存）
 *   pool 取值：star | watch | exclude | loss | all
 *   sort 白名单：score | pe | marketCapYi | roe | revenueYoy | netProfitYoy
 */
import { Elysia, t } from "elysia";
import { loadScreener } from "../lib/screener.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";

const TTL = 60_000;
const MAX_PAGE_SIZE = 100;

const SORT_KEYS = ["score", "pe", "marketCapYi", "roe", "revenueYoy", "netProfitYoy"] as const;
const POOLS = ["star", "watch", "exclude", "loss", "all"] as const;

interface Query {
  pool?: string;
  q?: string;
  industry?: string;
  sort?: string;
  order?: string;
  page?: string;
  size?: string;
}

export const screenerRoutes = new Elysia({ prefix: "/api" }).get(
  "/screener",
  async ({ query }) => {
    const q = query as Query;
    const pool = (q.pool ?? "all") as typeof POOLS[number];
    if (!POOLS.includes(pool)) {
      return { error: "bad_request", message: `无效 pool: ${q.pool}（可选 ${POOLS.join("|")}）` };
    }
    const sort = (q.sort ?? "score") as typeof SORT_KEYS[number];
    if (!SORT_KEYS.includes(sort)) {
      return { error: "bad_request", message: `无效 sort: ${q.sort}（可选 ${SORT_KEYS.join("|")}）` };
    }
    const order = q.order === "asc" ? "asc" : "desc";
    const page = Math.max(1, parseInt(q.page ?? "1", 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(q.size ?? "50", 10) || 50));
    const search = (q.q ?? "").trim().toLowerCase();
    const industry = (q.industry ?? "").trim();

    const cacheKey = `screener:${pool}:${search}:${industry}:${sort}:${order}:${page}:${pageSize}`;
    const cached = cacheGet<ReturnType<typeof buildResponse>>(cacheKey);
    if (cached) return cached;

    const data = await loadScreener();
    if (!data) {
      return {
        error: "not_found",
        message: "初筛数据缺失：请先运行 bun run .trae/scripts/screener/screen.ts 生成 latest-screener.json",
      };
    }

    const res = buildResponse(data, { pool, search, industry, sort, order, page, pageSize });
    cacheSet(cacheKey, res, TTL);
    return res;
  },
  {
    query: t.Object({
      pool: t.Optional(t.String()),
      q: t.Optional(t.String()),
      industry: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      order: t.Optional(t.String()),
      page: t.Optional(t.String()),
      size: t.Optional(t.String()),
    }),
  },
);

interface FilterOpts {
  pool: string;
  search: string;
  industry: string;
  sort: string;
  order: string;
  page: number;
  pageSize: number;
}

function buildResponse(
  data: import("../lib/screener.ts").ScreenerData,
  o: FilterOpts,
) {
  const num = (v: number | null | undefined): number | null =>
    v === null || v === undefined || !Number.isFinite(v) ? null : v;

  let rows = data.rows;
  if (o.pool !== "all") rows = rows.filter((r) => r.pool === o.pool);
  if (o.search) {
    rows = rows.filter((r) =>
      r.name.toLowerCase().includes(o.search) ||
      r.ticker.toLowerCase().includes(o.search) ||
      r.thscode.toLowerCase().includes(o.search),
    );
  }
  if (o.industry) rows = rows.filter((r) => (r.industry ?? "").includes(o.industry));

  const field = (r: typeof rows[number]): number | null => {
    switch (o.sort) {
      case "pe": return num(r.peTtm);
      case "marketCapYi": return num(r.marketCapYi);
      case "roe": return num(r.roe);
      case "revenueYoy": return num(r.revenueYoy);
      case "netProfitYoy": return num(r.netProfitYoy);
      default: return r.overallScore;
    }
  };
  const dir = o.order === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = field(a);
    const bv = field(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;   // null 排最后
    if (bv === null) return -1;
    return (av - bv) * dir;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / o.pageSize));
  const page = Math.min(o.page, totalPages);
  const sliced = rows.slice((page - 1) * o.pageSize, page * o.pageSize);

  const industries = [...new Set(data.rows.map((r) => r.industry).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "zh-CN"));

  return {
    meta: data.meta,
    stats: data.meta.counts,
    industries,
    rows: sliced,
    page: { page, pageSize: o.pageSize, total, totalPages },
  };
}
