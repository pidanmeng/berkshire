/**
 * 公司列表与详情路由
 * GET /api/companies            → 全量公司 + 实时行情 + 安全边际分档 + 基本面检测缓存
 * GET /api/companies/:thscode   → 单公司详情（含笔记正文段落）
 */
import { Elysia, t } from "elysia";
import { loadCompanies, findCompany, readNoteBody, loadCompanyUpdates, loadCompanyDocs, readCompanyDoc, type CompanyNote } from "../lib/research.ts";
import { getQuotes } from "../lib/quote.ts";
import { classifyCapZone } from "../lib/safety.ts";
import { cacheGet, cacheSet } from "../lib/cache.ts";
import { getDb } from "../lib/db.ts";

const LIST_TTL = 60_000;
const DETAIL_TTL = 10_000;

interface CompanyRow extends CompanyNote {
  quote: {
    price: number | null; changePct: number | null; marketCap: number | null;
    peTtm: number | null; pbMrq: number | null; psTtm: number | null; pcfTtm: number | null;
  };
  zone: ReturnType<typeof classifyCapZone>;
  marketCapYi: number | null;
  needsUpdate: boolean | null;
  latestReportDate: string | null;
  updateCount: number;
  /** 调研截止后未采信的财报列表（tooltip 用；来自 fundamental_checks.detail） */
  fundamentalItems: { title: string; date: string }[];
}

/** 解析基本面检测明细（detail 为公告列表 JSON，解析失败给空数组） */
function parseFundamentalItems(json: string | null): { title: string; date: string }[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((it) => it && typeof it.title === "string").map((it) => ({ title: String(it.title), date: String(it.date ?? "") }))
      : [];
  } catch {
    return [];
  }
}

async function buildList(): Promise<{ list: CompanyRow[]; fetchedAt: number }> {
  const notes = await loadCompanies();
  const quotes = await getQuotes(notes.map((n) => n.thscode));
  const list: CompanyRow[] = [];
  for (const n of notes) {
    const q = quotes.get(n.thscode);
    const marketCapYi = q?.marketCap != null ? q.marketCap / 1e8 : null;
    const check = await (await getDb()).getCheck(n.thscode);
    list.push({
      ...n,
      quote: {
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
        marketCap: q?.marketCap ?? null,
        peTtm: q?.peTtm ?? null,
        pbMrq: q?.pbMrq ?? null,
        psTtm: q?.psTtm ?? null,
        pcfTtm: q?.pcfTtm ?? null,
      },
      zone: classifyCapZone(marketCapYi, n.targetMarketCapYi),
      marketCapYi,
      needsUpdate: check?.needs_update ?? null,
      latestReportDate: check?.latest_report_date ?? null,
      updateCount: (await loadCompanyUpdates(n.thscode)).length,
      fundamentalItems: parseFundamentalItems(check?.detail ?? null),
    });
  }
  return { list, fetchedAt: Date.now() };
}

/** 单公司详情数据（五路数据互不依赖，并行拉取） */
async function buildDetail(code: string) {
  const note = await findCompany(code);
  if (!note) return null;

  const [quotes, body, check, updates, docs] = await Promise.all([
    getQuotes([code]),
    readNoteBody(code),
    (await getDb()).getCheck(code),
    loadCompanyUpdates(code),
    loadCompanyDocs(code),
  ]);
  const q = quotes.get(code);
  const marketCapYi = q?.marketCap != null ? q.marketCap / 1e8 : null;

  return {
    note,
    quote: {
      price: q?.price ?? null, changePct: q?.changePct ?? null,
      marketCap: q?.marketCap ?? null, peTtm: q?.peTtm ?? null,
      pbMrq: q?.pbMrq ?? null, psTtm: q?.psTtm ?? null, pcfTtm: q?.pcfTtm ?? null,
    },
    zone: classifyCapZone(marketCapYi, note.targetMarketCapYi),
    marketCapYi,
    markdown: body?.content ?? null,
    updates,
    docs,
    fundamental: check
      ? {
          needsUpdate: check.needs_update,
          latestTitle: check.latest_report_title,
          latestDate: check.latest_report_date,
          cachedAt: check.last_checked_at,
          items: parseFundamentalItems(check.detail),
        }
      : null,
  };
}

export const companiesRoutes = new Elysia({ prefix: "/api" })
  .get("/companies", async () => {
    const cached = cacheGet<Awaited<ReturnType<typeof buildList>>>("companies");
    if (cached) return cached;
    const data = await buildList();
    cacheSet("companies", data, LIST_TTL);
    return data;
  })
  .get("/companies/:thscode", async ({ params }) => {
    const code = params.thscode.toUpperCase();
    const key = `company:${code}`;
    const cached = cacheGet<Awaited<ReturnType<typeof buildDetail>>>(key);
    if (cached) return cached;
    const data = await buildDetail(code);
    if (data) cacheSet(key, data, DETAIL_TTL);
    return data ?? { error: "not_found", message: `未找到 ${code} 的调研笔记` };
  }, { params: t.Object({ thscode: t.String() }) })
  .get("/companies/:thscode/doc", async ({ params, query }) => {
    const code = params.thscode.toUpperCase();
    if (!(await findCompany(code))) return { error: "not_found", message: `未找到 ${code} 的调研笔记` };
    const doc = await readCompanyDoc(code, query.kind, query.file);
    if (!doc) return { error: "not_found", message: `未找到文档: ${query.file}` };
    return doc;
  }, {
    params: t.Object({ thscode: t.String() }),
    query: t.Object({
      kind: t.Union([t.Literal("deep-read"), t.Literal("annual-report")]),
      file: t.String(),
    }),
  });
