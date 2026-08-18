/**
 * 暗盘追踪路由
 * GET /api/darktrade?date=yyyyMMdd        → 当日全市场暗盘列表（全量翻页 + 页码批量写回 SQLite，60s 缓存）
 * GET /api/darktrade/history/:code?endDate=&startDate= → 单股暗盘历史（利用 SQLite 页码 hint 加速，页码变化写回）
 * 东财真实 URL / UA / GBK 解码只存在于后端 darktrade.ts，前端仅消费清洗后的安全结构。
 */
import { Elysia, t } from "elysia";
import {
  fetchAllDarkTradePages,
  fetchStockHistory,
  todayStr,
  shiftDate,
} from "../lib/darktrade.ts";
import { getDarkTradePageStore } from "../lib/darktrade-store.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";

const LIST_TTL = 60_000;
/** 单股历史默认回溯天数（约 30 个交易日） */
const DEFAULT_HISTORY_DAYS = 45;

const DATE_RE = /^\d{8}$/;
const CODE_RE = /^\d{6}$/;

export const darktradeRoutes = new Elysia({ prefix: "/api" })
  .get("/darktrade", async ({ query }) => {
    const date = (query.date ?? todayStr()) as string;
    if (!DATE_RE.test(date)) {
      return { error: "bad_request", message: `无效日期: ${date}（应为 yyyyMMdd）` };
    }
    const cacheKey = `darktrade:list:${date}`;
    const cached = cacheGet<ReturnType<typeof buildListResponse>>(cacheKey);
    if (cached) return cached;

    const result = await fetchAllDarkTradePages(date);

    // 页码批量写回 SQLite（仅记录变化，不影响响应）
    try {
      const store = await getDarkTradePageStore();
      await store.setPages(result.stockPageMap);
    } catch {
      // 页码持久化失败不阻塞列表返回
    }

    const data = buildListResponse(result);
    cacheSet(cacheKey, data, LIST_TTL);
    return data;
  }, {
    query: t.Object({ date: t.Optional(t.String()) }),
  })
  .get("/darktrade/history/:code", async ({ params, query }) => {
    const code = params.code as string;
    if (!CODE_RE.test(code)) {
      return { error: "bad_request", message: `无效证券代码: ${code}` };
    }
    const endDate = (query.endDate ?? todayStr()) as string;
    const startDate = (query.startDate ?? shiftDate(endDate, -DEFAULT_HISTORY_DAYS)) as string;
    if (!DATE_RE.test(endDate) || !DATE_RE.test(startDate)) {
      return { error: "bad_request", message: "endDate / startDate 应为 yyyyMMdd" };
    }
    if (startDate > endDate) {
      return { error: "bad_request", message: "startDate 不能晚于 endDate" };
    }

    // 从 SQLite 读取页码 hint（无记录默认第 1 页）
    const store = await getDarkTradePageStore();
    const pageHint = (await store.getPage(code)) ?? 1;

    const items = await fetchStockHistory(code, pageHint, endDate, startDate, (newPage) => {
      // 页码变化 → 写回 SQLite
      void store.setPage(code, newPage);
    });

    return { code, pageHint, endDate, startDate, items };
  }, {
    params: t.Object({ code: t.String() }),
    query: t.Object({
      endDate: t.Optional(t.String()),
      startDate: t.Optional(t.String()),
    }),
  });

function buildListResponse(result: import("../lib/darktrade.ts").DarkTradeAllResult) {
  return {
    actualDate: result.actualDate,
    pages: result.pages,
    total: result.rows.length,
    fetchedAt: Date.now(),
    items: result.rows,
  };
}
