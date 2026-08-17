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
    });
  }
  return { list, fetchedAt: Date.now() };
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
    const note = await findCompany(code);
    if (!note) return { error: "not_found", message: `未找到 ${code} 的调研笔记` };

    const quotes = await getQuotes([code]);
    const q = quotes.get(code);
    const marketCapYi = q?.marketCap != null ? q.marketCap / 1e8 : null;
    const body = await readNoteBody(code);
    const check = await (await getDb()).getCheck(code);
    const updates = await loadCompanyUpdates(code);
    const docs = await loadCompanyDocs(code);

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
        ? { needsUpdate: check.needs_update, latestTitle: check.latest_report_title, latestDate: check.latest_report_date, cachedAt: check.last_checked_at }
        : null,
    };
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
