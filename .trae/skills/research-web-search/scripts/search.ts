/**
 * 投研内容搜索 — 直接获取公司公告/财报/研报本身（bun 环境）
 *
 * 用法：
 *   bun run search.ts --company 利通电子                     # 名称→代码，并输出公告+研报+财报
 *   bun run search.ts --code 603629 --announcements          # 代码→公告列表
 *   bun run search.ts --code 603629 --announcements --category yjyg --days 180
 *   bun run search.ts --code 603629 --reports                # 代码→券商研报
 *   bun run search.ts --code 603629 --financial              # 代码→定期报告PDF链接
 *   bun run search.ts --code 603629 --all                    # 输出公告+研报+财报
 *
 * 注意：本脚本直接返回内容本身（标题/日期/PDF链接），不做信源导航。
 *       如需抓取 URL 正文，请使用 fetch-source.ts <url>。
 */

import {
  searchCninfo,
  searchStockByName,
  marketByCode,
  queryAnnouncements,
  queryReports,
  queryFinancial,
  organizeFinancial,
  CATEGORY_MAP,
  type StockInfo,
} from "../../../scripts/stock-data/stock.ts";

function usage(): never {
  console.log(`
投研内容搜索 (bun) — 直接获取公告/研报/财报本身

用法:
  bun run search.ts --company <公司名>              名称→代码，输出公告+研报+财报
  bun run search.ts --code <代码> --announcements   公告（默认近90天）
  bun run search.ts --code <代码> --reports         券商研报
  bun run search.ts --code <代码> --financial       定期报告(PDF链接)
  bun run search.ts --code <代码> --all             公告+研报+财报

类别: yjyg 业绩预告 | yjbb 业绩报表 | ndbg 年报 | bndbg 半年报 | yjdbg 业绩快报

示例:
  bun run search.ts --company 利通电子
  bun run search.ts --code 603629 --announcements --category yjyg --days 180
  bun run search.ts --code 603629 --all
`);
  process.exit(1);
}

async function resolveStock(nameOrCode: string): Promise<{ code: string; orgId: string; market: string; name: string }> {
  // 如果是纯数字，当作代码处理
  if (/^\d{6}$/.test(nameOrCode)) {
    const code = nameOrCode;
    const cn = await searchCninfo(code).catch(() => [] as StockInfo[]);
    if (cn.length > 0) {
      return { code: cn[0].code, orgId: cn[0].orgId, market: cn[0].market, name: cn[0].name };
    }
    return { code, orgId: "", market: marketByCode(code), name: code };
  }

  // 名称搜索
  const [cn, em] = await Promise.all([
    searchCninfo(nameOrCode).catch(() => [] as StockInfo[]),
    searchStockByName(nameOrCode).catch(() => [] as StockInfo[]),
  ]);
  const list = cn.length > 0 ? cn : em;
  if (list.length === 0) {
    console.error(`❌ 未找到 A 股「${nameOrCode}」，请检查名称或代码。`);
    process.exit(1);
  }
  const first = list[0];
  return { code: first.code, orgId: first.orgId || "", market: first.market, name: first.name };
}

async function printAnnouncements(stock: { code: string; orgId: string; market: string }, category?: string, days?: number) {
  const r = await queryAnnouncements(stock, { category, days });
  console.log(`\n## 公告列表（${stock.code}，${category ? `类别:${category}，` : ""}近 ${days ?? 90} 天，共 ${r.total} 条）`);
  for (const a of r.items as { date: string; title: string; pdfUrl: string }[]) {
    console.log(`\n- [${a.date}] ${a.title}`);
    if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
  }
}

async function printReports(code: string, days?: number) {
  const r = await queryReports(code, { days });
  console.log(`\n## 券商研报（${code}，近 ${days ?? 365} 天，共 ${r.total} 条）`);
  for (const x of r.items as { date: string; org: string; title: string; detailUrl: string }[]) {
    console.log(`\n- [${x.date}] ${x.org}: ${x.title}`);
    if (x.detailUrl) console.log(`  详情: ${x.detailUrl}`);
  }
}

async function printFinancial(stock: { code: string; orgId: string; market: string }, days?: number) {
  const fin = await queryFinancial(stock, { days });
  const org = organizeFinancial(fin);
  console.log(`\n## 定期报告（${stock.code}，近 ${days ?? 730} 天，共 ${org.allSorted.length} 条）`);

  console.log(`\n### 近三年的年报`);
  for (const a of org.annualReports) {
    console.log(`- [${a.date}] ${a.title}`);
    if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
  }

  console.log(`\n### 最近一期财报`);
  if (org.latestReport) {
    console.log(`- [${org.latestReport.date}] ${org.latestReport.title}`);
    if (org.latestReport.pdfUrl) console.log(`  PDF: ${org.latestReport.pdfUrl}`);
  }

  console.log(`\n### 全部定期报告（按时间倒序）`);
  for (const a of org.allSorted) {
    console.log(`- [${a.date}] ${a.title}`);
    if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const companyIdx = args.indexOf("--company");
  const codeIdx = args.indexOf("--code");
  const catIdx = args.indexOf("--category");
  const daysIdx = args.indexOf("--days");

  const category = catIdx >= 0 ? args[catIdx + 1] : undefined;
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : undefined;

  try {
    // --company 模式：名称→代码，然后输出全部内容
    if (companyIdx >= 0) {
      const name = args[companyIdx + 1];
      if (!name) usage();
      const stock = await resolveStock(name);
      console.log(`# ${stock.name}（${stock.code}）`);
      console.log(`\n> 市场: ${stock.market.toUpperCase()} | orgId: ${stock.orgId || "—"}`);
      await printAnnouncements(stock, category, days);
      await printReports(stock.code, days);
      await printFinancial(stock, days);
      return;
    }

    // --code 模式
    if (codeIdx >= 0) {
      const code = args[codeIdx + 1];
      if (!code) usage();
      const stock = await resolveStock(code);

      const wantAnnouncements = args.includes("--announcements");
      const wantReports = args.includes("--reports");
      const wantFinancial = args.includes("--financial");
      const wantAll = !(wantAnnouncements || wantReports || wantFinancial);

      if (wantAnnouncements || wantAll) {
        await printAnnouncements(stock, category, days);
      }
      if (wantReports || wantAll) {
        await printReports(stock.code, days);
      }
      if (wantFinancial || wantAll) {
        await printFinancial(stock, days);
      }
      return;
    }

    usage();
  } catch (err) {
    console.error(`❌ 查询失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
export { main };
