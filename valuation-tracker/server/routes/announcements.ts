/**
 * 巨潮公告代理路由 — 供 K 线公告 POI 与 ST 详情公告时间线使用
 * GET /api/announcements/:thscode?days=365&category=all&st=1
 *   - category: all（默认，不过滤类别，按重要公告关键词过滤）| ndbg | bndbg | yjyg | yjbb
 *   - st=1：ST 公司放宽——不过滤重要公告关键词，全部返回（公告驱动标的）
 * 数据流：thscode → 公司名（静态数据优先，缺则同花顺 searchTicker）→ 巨潮 orgId → 公告列表
 * 巨潮始终经服务端代理（CORS/UA/Cookie 原因，浏览器不直连），复用 server/lib/cninfo.ts。
 * 60s 内存 TTL 缓存。
 */
import { Elysia, t } from "elysia";
import { searchCninfo, queryAnnouncements, type Announcement } from "../lib/cninfo.ts";
import { getStaticNote } from "../../lib/static-data.ts";
import { searchTicker } from "../../../.trae/scripts/hithink/hithink.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";

const TTL_MS = 60_000;

/** 重要公告关键词（普通公司过滤用：仅保留高信息含量公告，避免 K 线 POI 过密） */
const IMPORTANT_RE =
  /ST|风险警示|摘帽|戴帽|退市|重整|重组|立案|问询|业绩预告|业绩快报|审计|年报|半年报|停牌|复牌|回购|增持|减持|易主|控制权|资金占用|担保|诉讼|仲裁|拍卖|股东大会|分配|送转|股权变动|破产|清算|处罚/;

const CATEGORY_KEYS = new Set(["ndbg", "bndbg", "yjyg", "yjbb"]);

export const announcementsRoutes = new Elysia({ prefix: "/api" })
  .get("/announcements/:thscode", async ({ params, query }) => {
    const code = params.thscode.toUpperCase();
    const days = Math.min(Math.max(Number(query.days ?? 365) || 365, 30), 730);
    const category = query.category && CATEGORY_KEYS.has(query.category) ? query.category : "";
    const isSt = query.st === "1";

    const cacheKey = `announcements:${code}:${days}:${category}:${isSt}`;
    const cached = cacheGet<{ thscode: string; items: Announcement[]; fetchedAt: number }>(cacheKey);
    if (cached) return cached;

    // thscode → 公司名：静态调研数据优先（权威中文名），缺则同花顺 ticker 兜底
    const note = getStaticNote(code);
    const name =
      note?.name ??
      (await searchTicker(code)
        .then((list) => list[0]?.name)
        .catch(() => undefined));
    if (!name) {
      return { thscode: code, items: [], error: "not_found", message: `未找到 ${code} 的公司信息` };
    }

    // 公司名 → 巨潮 code + orgId（topSearch）
    const stocks = await searchCninfo(name).catch(() => []);
    const stock = stocks[0];
    if (!stock) {
      return { thscode: code, items: [], error: "cninfo_not_found", message: `巨潮未找到 ${name} 的信息` };
    }

    let items = await queryAnnouncements(
      { code: stock.code, orgId: stock.orgId, market: stock.market },
      { category: category || undefined, days, pageSize: 50 },
    );
    // 普通公司按重要公告关键词过滤；ST 公司（公告驱动）放宽全部返回
    if (!isSt) items = items.filter((a) => IMPORTANT_RE.test(a.title));
    items = items.slice(0, 80);

    const result = { thscode: code, items, fetchedAt: Date.now() };
    cacheSet(cacheKey, result, TTL_MS);
    return result;
  }, {
    params: t.Object({ thscode: t.String() }),
    query: t.Object({
      days: t.Optional(t.String()),
      category: t.Optional(t.String()),
      st: t.Optional(t.String()),
    }),
  });
