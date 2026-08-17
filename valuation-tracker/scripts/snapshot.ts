/**
 * 价格快照脚本 — 批量拉取追踪公司实时行情并写入存储（供市值历史趋势）
 * 用法：bun run snapshot  （可配置为每交易日收盘后定时执行）
 */
import { loadCompanies } from "../server/lib/research.ts";
import { getQuotes } from "../server/lib/quote.ts";
import { getDb } from "../server/lib/db.ts";

async function main() {
  const notes = await loadCompanies();
  if (notes.length === 0) {
    console.error("❌ 未加载到任何公司（检查 RESEARCH_ROOT / 知识库目录）");
    process.exit(1);
  }
  console.log(`拉取 ${notes.length} 家公司实时行情...`);
  const quotes = await getQuotes(notes.map((n) => n.thscode));
  const store = await getDb();
  let saved = 0;
  for (const q of quotes.values()) {
    await store.saveSnapshot({
      thscode: q.thscode,
      ts: q.fetchedAt,
      price: q.price,
      market_cap: q.marketCap,
      pe_ttm: q.peTtm,
      pb_mrq: q.pbMrq,
      change_pct: q.changePct,
    });
    saved++;
  }
  console.log(`✅ 已保存 ${saved} 条快照（${new Date().toISOString()}）`);
}

// Bun 专有属性：直接执行（bun run snapshot）时为 true；用类型断言避免 ImportMeta 类型错误
const isMain = (import.meta as unknown as { main?: boolean }).main === true;

if (isMain) main().catch((err) => { console.error(`❌ ${err.message}`); process.exit(1); });
