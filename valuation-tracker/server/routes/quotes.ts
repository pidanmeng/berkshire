/**
 * 实时行情路由（客户端轮询用）
 * GET /api/quotes?codes=300750.SZ,688041.SH  → 批量实时快照（60s 缓存）
 * 每次成功拉取后追加写入价格快照（供时间轴/历史趋势使用）。
 */
import { Elysia } from "elysia";
import { loadCompanies } from "../lib/research.ts";
import { getQuotes } from "../lib/quote.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";
import { getDb } from "../lib/db.ts";

const QUOTES_TTL = 60_000;

export const quotesRoutes = new Elysia({ prefix: "/api" })
  .get("/quotes", async ({ query }) => {
    const cacheKey = `quotes:${query.codes ?? "all"}`;
    const cached = cacheGet<ReturnType<typeof respond>>(cacheKey);
    if (cached) return cached;

    const codes = query.codes
      ? query.codes.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : (await loadCompanies()).map((n) => n.thscode);

    const quotes = await getQuotes(codes);

    // 快照入库（供历史趋势）
    const store = await getDb();
    for (const q of quotes.values()) {
      void store.saveSnapshot({
        thscode: q.thscode,
        ts: q.fetchedAt,
        price: q.price,
        market_cap: q.marketCap,
        pe_ttm: q.peTtm,
        pb_mrq: q.pbMrq,
        change_pct: q.changePct,
      });
    }

    const data = respond(quotes);
    cacheSet(cacheKey, data, QUOTES_TTL);
    return data;
  });

function respond(quotes: Map<string, import("../lib/quote.ts").Quote>) {
  return {
    fetchedAt: Date.now(),
    items: [...quotes.values()].map((q) => ({
      thscode: q.thscode,
      name: q.name ?? null,
      price: q.price,
      changePct: q.changePct,
      marketCap: q.marketCap,
      peTtm: q.peTtm,
      pbMrq: q.pbMrq,
      psTtm: q.psTtm,
      pcfTtm: q.pcfTtm,
    })),
  };
}
