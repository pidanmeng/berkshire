/**
 * K 线路由（前端图表数据源）
 * GET /api/kline/:thscode?days=250  → 前复权日 K（60s 缓存）
 */
import { Elysia, t } from "elysia";
import { getKlineBars } from "../lib/quote.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";

const KLINE_TTL = 60_000;

export const klineRoutes = new Elysia({ prefix: "/api" })
  .get("/kline/:thscode", async ({ params, query }) => {
    const code = params.thscode.toUpperCase();
    const days = Math.min(1000, Math.max(30, Number(query.days) || 250));
    const key = `kline:${code}:${days}`;
    const cached = cacheGet<{ thscode: string; bars: import("../lib/quote.ts").KlineBar[] }>(key);
    if (cached) return cached;

    const bars = await getKlineBars(code, days);
    const data = { thscode: code, bars, fetchedAt: Date.now() };
    cacheSet(key, data, KLINE_TTL);
    return data;
  }, { params: t.Object({ thscode: t.String() }) });
