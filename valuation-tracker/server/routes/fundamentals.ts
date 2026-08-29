/**
 * 基本面更新检测路由
 * GET /api/fundamentals/:thscode → 巨潮检测（6h TTL 缓存到 store）
 * 逻辑：调研截止日之后是否出现新的定期报告（年报/半年报/业绩报表/业绩预告）。
 * 公司信息（名称 / research_cutoff）读构建期静态产物 public/data/companies.json
 * （不再依赖 doc-store / research.db / Turso，与前端 SSG 同一数据源）。
 */
import { Elysia, t } from "elysia";
import { getStaticNote } from "../../lib/static-data.ts";
import { checkFundamentalUpdate } from "../lib/cninfo.ts";
import { getDb } from "../lib/db.ts";

const CHECK_TTL_MS = 6 * 3600_000;

export const fundamentalsRoutes = new Elysia({ prefix: "/api" })
  .get("/fundamentals/:thscode", async ({ params, query }) => {
    const code = params.thscode.toUpperCase();
    const note = getStaticNote(code);
    if (!note) return { error: "not_found", message: `未找到 ${code} 的调研笔记` };

    // 6h 缓存（?refresh=1 强制刷新，供人工手动触发）
    const store = await getDb();
    const existing = query.refresh !== "1" ? await store.getCheck(code) : null;
    if (existing && Date.now() - new Date(existing.last_checked_at).getTime() < CHECK_TTL_MS) {
      return {
        thscode: code,
        needsUpdate: existing.needs_update,
        latestTitle: existing.latest_report_title,
        latestDate: existing.latest_report_date,
        items: safeParse(existing.detail),
        cachedAt: existing.last_checked_at,
      };
    }

    const result = await checkFundamentalUpdate(note.name, note.researchCutoff);
    await store.setCheck({
      thscode: code,
      last_checked_at: new Date().toISOString(),
      latest_report_title: result.latestTitle,
      latest_report_date: result.latestDate,
      needs_update: result.needsUpdate,
      detail: JSON.stringify(result.items),
    });
    return {
      thscode: code,
      needsUpdate: result.needsUpdate,
      latestTitle: result.latestTitle,
      latestDate: result.latestDate,
      items: result.items,
      cachedAt: new Date().toISOString(),
    };
  }, { params: t.Object({ thscode: t.String() }) });

function safeParse(json: string): { title: string; date: string }[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
