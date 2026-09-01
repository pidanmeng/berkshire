/**
 * ST 名单路由 — ST 专题页（/st）数据源
 * GET /api/st-list
 * 数据流：同花顺全市场 tickers → 名称过滤（ST/*ST/退市整理）→ 批量行情快照
 *         → 与调研笔记（loadCompanies 的 st_status 等字段）合并标记已研究
 * 60s 内存 TTL 缓存。
 */
import { Elysia } from "elysia";
import { getAllAShareTickers } from "../../../.trae/scripts/hithink/hithink.ts";
import { getQuotes } from "../lib/quote.ts";
import { loadCompanies } from "../lib/research.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";

const TTL_MS = 60_000;

/** ST 名称识别：ST 前缀 / *ST 前缀 / 退市整理（"退市"前缀或"退"后缀） */
const ST_NAME_RE = /^(\*ST|ST)|^退市|退$/;

export type StType = "ST" | "*ST" | "退";

function classifySt(name: string): StType {
  if (name.startsWith("*ST")) return "*ST";
  if (name.startsWith("ST")) return "ST";
  return "退"; // 退市整理
}

export const stListRoutes = new Elysia({ prefix: "/api" })
  .get("/st-list", async () => {
    const cached = cacheGet<StListPayload>("st-list");
    if (cached) return cached;

    const tickers = await getAllAShareTickers().catch(() => []);
    const st = tickers.filter((t) => ST_NAME_RE.test(t.name));
    const thscodes = st.map((t) => t.thscode);

    // 行情 + 调研笔记并行（任一失败不阻断整体）
    const [quotesResult, companiesResult] = await Promise.allSettled([getQuotes(thscodes), loadCompanies()]);
    const quoteMap = quotesResult.status === "fulfilled" ? quotesResult.value : new Map();

    // 已研究 ST 公司（frontmatter st_status 非空）：合并 st 字段供详情跳转与风险等级展示
    const researchedMap = new Map<string, { stStatus: string | null; delistRisk: string | null; stReason: string | null; removalPath: string | null }>();
    if (companiesResult.status === "fulfilled") {
      for (const c of companiesResult.value) {
        if (c.stStatus) {
          researchedMap.set(c.thscode, {
            stStatus: c.stStatus,
            delistRisk: c.delistRisk,
            stReason: c.stReason,
            removalPath: c.removalPath,
          });
        }
      }
    }

    const items = st.map((t) => {
      const q = quoteMap.get(t.thscode);
      const r = researchedMap.get(t.thscode);
      return {
        thscode: t.thscode,
        name: t.name,
        stType: classifySt(t.name),
        market: t.exchange, // SH / SZ / BJ
        price: q?.price ?? null,
        pct: q?.changePct ?? null,
        mcap: q?.marketCap ?? null, // 元
        researched: !!r,
        stStatus: r?.stStatus ?? null,
        delistRisk: r?.delistRisk ?? null,
        stReason: r?.stReason ?? null,
        removalPath: r?.removalPath ?? null,
      };
    });

    const payload: StListPayload = {
      updatedAt: new Date().toISOString(),
      total: items.length,
      items,
    };
    cacheSet("st-list", payload, TTL_MS);
    return payload;
  });

export interface StListItem {
  thscode: string;
  name: string;
  stType: StType;
  market: string;
  price: number | null;
  pct: number | null;
  mcap: number | null;
  researched: boolean;
  stStatus: string | null;
  delistRisk: string | null;
  stReason: string | null;
  removalPath: string | null;
}

export interface StListPayload {
  updatedAt: string;
  total: number;
  items: StListItem[];
}
