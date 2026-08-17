/**
 * 证券代码 → 公告/研报/财报 查询 — 共享脚本（InfoHunter / DocumentReader / 各 Skill 均可调用，bun 环境）
 *
 * 用法（与 Skill 解耦，位于 .trae/scripts/stock-data/，参照 fetch-file.ts 模式）：
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份                       # 名称 → 代码/orgId
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份 --announcements       # 名称 → 公告列表（默认近 90 天）
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份 --announcements --category yjyg --days 180
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份 --reports             # 名称 → 券商研报
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份 --financial           # 名称 → 定期报告（年报/半年报/季报）PDF链接
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --announcements       # 代码 → 公告列表（默认近 90 天）
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --announcements --category yjyg --days 180
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --reports             # 代码 → 券商研报
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --financial           # 代码 → 定期报告（年报/半年报/季报）PDF链接
 *
 * 数据源：
 *   - 公告/财报PDF: 巨潮资讯 cninfo API（A 股法定披露）
 *   - 研报: 东方财富研报中心 API
 *   - 个股搜索: 东方财富 suggest API + 巨潮 topSearch
 *
 * 注意：财务数据（三表/估值/指标）请使用 evaluate.ts 或 hithink.ts 的导出函数。
 *       本脚本不再提供同花顺财务数据 CLI 入口，避免功能重复。
 *
 * 类别参数（--category）: yjyg=业绩预告 | yjbb=业绩报表 | ndbg=年度报告 | bndbg=半年报
 *   | yjdbg=业绩快报 | zqbg=债券公告 | 缺省=全部公告
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const CATEGORY_MAP: Record<string, string> = {
  yjyg: 'category_yjyg_szsh', // 业绩预告
  yjbb: 'category_yjbb_szsh', // 业绩快报
  ndbg: 'category_ndbg_szsh', // 年度报告
  bndbg: 'category_bndbg_szsh', // 半年度报告
  yjdbg: 'category_yjdbg_szsh', // 一季度报告
  sjdbg: 'category_sjdbg_szsh', // 三季度报告
  zqbg: 'category_zqbg_szsh', // 债券公告
};

// 巨潮 API 对部分类别编码静默忽略（实测 yjyg/yjbb 返回全量、ndbg/bndbg/yjdbg 生效）。
// 对不受支持的类别，在客户端按公告标题正则兜底过滤。
export const TITLE_FILTER: Record<string, RegExp> = {
  yjyg: /业绩预[告增减亏]|预增|预减|扭亏|续盈|首亏|续亏|略增|略减|业绩预告/,
  yjbb: /业绩(?:快报|报表)/,
};

interface StockInfo {
  code: string;
  name: string;
  orgId: string;
  market: string; // szse / sse
  category: string;
}

function usage(): never {
  console.log(`
证券代码查询工具 (bun) — 共享脚本

用法:
  bun run .trae/scripts/stock-data/stock.ts --name <公司名>                             名称→代码
  bun run .trae/scripts/stock-data/stock.ts --name <公司名> --announcements             名称→公告
  bun run .trae/scripts/stock-data/stock.ts --name <公司名> --announcements --category yjyg --days 180
  bun run .trae/scripts/stock-data/stock.ts --name <公司名> --reports                   名称→研报
  bun run .trae/scripts/stock-data/stock.ts --name <公司名> --financial                 名称→定期报告
  bun run .trae/scripts/stock-data/stock.ts --code <代码> --announcements      公告（默认近 90 天）
  bun run .trae/scripts/stock-data/stock.ts --code <代码> --announcements --category yjyg --days 180
  bun run .trae/scripts/stock-data/stock.ts --code <代码> --reports            券商研报
  bun run .trae/scripts/stock-data/stock.ts --code <代码> --financial          定期报告(PDF链接)

类别: yjyg 业绩预告 | yjbb 业绩报表 | ndbg 年报 | bndbg 半年报 | yjdbg 业绩快报

注意: 财务数据（估值/三表/指标）请使用 evaluate.ts 或 hithink.ts 导出函数。
`);
  process.exit(1);
}

function fmtTime(ts: number | string): string {
  const n = typeof ts === 'number' ? ts : Number(ts);
  return new Date(n).toISOString().slice(0, 10);
}

/** 东财 suggest：名称 → 代码 + 市场 */
export async function searchStockByName(name: string): Promise<StockInfo[]> {
  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(name)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.QuotationCodeTable?.Data ?? [];
  return items
    .filter(
      (it: { SecurityTypeName?: string }) =>
        it.SecurityTypeName === '深A' || it.SecurityTypeName === '沪A',
    )
    .map((it: { Name: string; Code: string; MktNum: number }) => ({
      code: it.Code,
      name: it.Name,
      orgId: '',
      market: it.MktNum === 0 ? 'szse' : 'sse',
      category: 'A股',
    }));
}

/** 巨潮 topSearch：名称 → 代码 + orgId（权威） */
export async function searchCninfo(name: string): Promise<StockInfo[]> {
  const res = await fetch(
    'https://www.cninfo.com.cn/new/information/topSearch/query',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ keyWord: name, maxNum: '10' }).toString(),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data ?? [])
    .filter((it: { category: string }) => it.category === 'A股')
    .map((it: { code: string; zwjc: string; orgId: string; type: string }) => ({
      code: it.code,
      name: it.zwjc,
      orgId: it.orgId,
      market: it.type === 'shj' ? 'sse' : 'szse',
      category: 'A股',
    }));
}

/** 解析代码 → 市场（用于无 orgId 时的兜底） */
export function marketByCode(code: string): 'szse' | 'sse' {
  // 6 开头沪市，0/3 开头深市，8/4 北交所归深市接口列
  if (code.startsWith('6')) return 'sse';
  return 'szse';
}

/** 巨潮公告查询 */
export async function queryAnnouncements(
  stock: { code: string; orgId: string; market: string },
  opts: { category?: string; days?: number; pageSize?: number } = {},
) {
  const days = opts.days ?? 90;
  const category = opts.category ? CATEGORY_MAP[opts.category] : '';
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const seDate = `${start.toISOString().slice(0, 10)}~${end.toISOString().slice(0, 10)}`;
  const orgId = stock.orgId || '9900022995'; // 兜底

  const body = new URLSearchParams({
    pageNum: '1',
    pageSize: String(opts.pageSize ?? 20),
    column: stock.market,
    tabName: 'fulltext',
    plate: '',
    stock: `${stock.code},${orgId}`,
    searchkey: '',
    secid: '',
    category,
    trade: '',
    seDate,
    sortName: '',
    sortType: '',
    isHLtitle: 'true',
  }).toString();

  const res = await fetch(
    'https://www.cninfo.com.cn/new/hisAnnouncement/query',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  let items = (data.announcements ?? []).map(
    (a: {
      secName: string;
      announcementTitle: string;
      announcementTime: number;
      adjunctUrl: string;
    }) => ({
      name: a.secName,
      title: a.announcementTitle,
      date: fmtTime(a.announcementTime),
      pdfUrl: a.adjunctUrl
        ? `https://static.cninfo.com.cn/${a.adjunctUrl}`
        : '',
    }),
  );
  // 巨潮 API 对 yjyg/yjbb 类别编码静默忽略（返回全量）——客户端标题过滤兜底
  if (opts.category && TITLE_FILTER[opts.category]) {
    items = applyTitleFilter(items, opts.category);
  }
  return { total: items.length, items };
}

/** 按类别标题正则过滤公告列表（客户端兜底，供 API 不支持的类别使用） */
export function applyTitleFilter<T extends { title: string }>(
  items: T[],
  category: string,
): T[] {
  const re = TITLE_FILTER[category];
  if (!re) return items;
  return items.filter(it => re.test(stripHtmlTags(it.title)));
}

/** 剥离公告标题中的 HTML 标签（巨潮接口标题可能含 <em> 高亮标记） */
export function stripHtmlTags(title: string): string {
  return title.replace(/<[^>]+>/g, '');
}

/** 东财研报查询 */
export async function queryReports(
  code: string,
  opts: { days?: number; pageSize?: number } = {},
) {
  const days = opts.days ?? 365;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const beginTime = start.toISOString().slice(0, 10);
  const endTime = end.toISOString().slice(0, 10);
  const pageSize = opts.pageSize ?? 20;

  const url = `https://reportapi.eastmoney.com/report/list?industryCode=*&pageSize=${pageSize}&pageNo=1&qType=0&code=${code}&beginTime=${beginTime}&endTime=${endTime}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // 东财接口有时返回 JSONP（`datatable({...})`），有时返回纯 JSON —— 自适应解包
  type ReportItem = {
    orgSName: string;
    title: string;
    publishDate: string;
    infoCode: string;
    stockName: string;
    stockCode: string;
  };
  type ReportData = { hits?: number; data?: ReportItem[] };
  let data: ReportData;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    data = JSON.parse(trimmed);
  } else {
    const jsonStr = trimmed.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
    data = JSON.parse(jsonStr);
  }
  const items = (data.data ?? []).map(
    (r: {
      orgSName: string;
      title: string;
      publishDate: string;
      infoCode: string;
      stockName: string;
      stockCode: string;
    }) => ({
      org: r.orgSName,
      title: r.title,
      date: (r.publishDate || '').slice(0, 10),
      detailUrl: r.infoCode
        ? `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${r.infoCode}`
        : '',
    }),
  );
  return { total: data.hits ?? items.length, items };
}

/** 定期报告单条（queryFinancial 的扁平化条目，category 标注类别） */
export interface FinancialItem {
  category: string; // ndbg | bndbg | yjdbg | sjdbg
  date: string;
  title: string;
  pdfUrl: string;
}

/** 财报 = 定期报告（年报/半年报/季报）公告 */
export async function queryFinancial(
  stock: { code: string; orgId: string; market: string },
  opts: { days?: number } = {},
) {
  const days = opts.days ?? 730;
  // 定期报告类别：年度报告 + 半年度报告 + 一季度报告 + 三季度报告（业绩快报 yjbb 另查，非定期报告主体）
  const results: { category: string; items: FinancialItem[] }[] = [];
  for (const cat of ['ndbg', 'bndbg', 'yjdbg', 'sjdbg']) {
    const r = await queryAnnouncements(stock, { category: cat, days });
    results.push({
      category: cat,
      items: r.items.map((a: FinancialItem) => ({
        category: cat,
        date: a.date,
        title: a.title,
        pdfUrl: a.pdfUrl,
      })),
    });
  }
  return results;
}

/** 从年度报告标题解析财年（如「2025年年度报告」→ 2025），非年报返回 null */
export function extractFiscalYear(title: string): number | null {
  const m = title.match(/(20\d{2})年年度报告/);
  return m ? Number(m[1]!) : null;
}

/** 从定期报告标题解析报告期截止日（年报→12-31 / 半年报→06-30 / 一季报→03-31 / 三季报→09-30），解析失败返回 null */
export function periodEndDate(title: string): string | null {
  const m = title.match(
    /(20\d{2})年(?:年度报告|半年度报告|第一季度报告|第三季度报告)/,
  );
  if (!m) return null;
  const year = m[1]!;
  // 注意：「半年度报告」包含「年度报告」子串，必须优先判定半年报
  if (title.includes('半年度报告')) return `${year}-06-30`;
  if (title.includes('年度报告')) return `${year}-12-31`;
  if (title.includes('第一季度报告')) return `${year}-03-31`;
  if (title.includes('第三季度报告')) return `${year}-09-30`;
  return null;
}

/** 定期报告整理结果：近三年年报 / 最近一期财报 / 全部按时间倒序 */
export interface OrganizedFinancial {
  annualReports: FinancialItem[];
  latestReport: FinancialItem | null;
  allSorted: FinancialItem[];
}

/**
 * 将按类别分组的定期报告整理为：
 * 1) 近三年年报：按财年聚合、取最近 3 个财年，每年优先正文（剔除摘要）、取最新公告
 * 2) 最近一期财报：按报告期截止日新→旧取最新（同公告日先正文）
 * 3) 全部条目：按公告日期倒序（同日按报告期倒序、正文优先）
 */
export function organizeFinancial(
  groups: { category: string; items: FinancialItem[] }[],
): OrganizedFinancial {
  const all = groups.flatMap((g) => g.items);
  const cmp = (a: FinancialItem, b: FinancialItem) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const pa = periodEndDate(a.title) ?? '';
    const pb = periodEndDate(b.title) ?? '';
    if (pa !== pb) return pa < pb ? 1 : -1;
    const sa = a.title.includes('摘要') ? 1 : 0;
    const sb = b.title.includes('摘要') ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title);
  };
  const allSorted = [...all].sort(cmp);

  // 近三年年报：按财年聚合
  const byYear = new Map<number, FinancialItem[]>();
  for (const it of all) {
    const year = extractFiscalYear(it.title);
    if (year === null) continue;
    const list = byYear.get(year);
    if (list) list.push(it);
    else byYear.set(year, [it]);
  }
  const annualReports = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([, items]) => {
      const full = items.filter((i) => !i.title.includes('摘要'));
      const pool = full.length > 0 ? full : items;
      return [...pool].sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      )[0]!;
    });

  return { annualReports, latestReport: allSorted[0] ?? null, allSorted };
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const codeIdx = args.indexOf('--code');
  const catIdx = args.indexOf('--category');
  const daysIdx = args.indexOf('--days');

  if (nameIdx < 0 && codeIdx < 0) usage();
  const category = catIdx >= 0 ? args[catIdx + 1] : undefined;
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : undefined;

  try {
    // ---- 名称 → 代码 ----
    if (nameIdx >= 0) {
      const name = args[nameIdx + 1];
      const [cn, em] = await Promise.all([
        searchCninfo(name).catch(() => [] as StockInfo[]),
        searchStockByName(name).catch(() => [] as StockInfo[]),
      ]);
      if (cn.length === 0 && em.length === 0) {
        console.log(`❌ 未找到 A 股「${name}」，请检查名称。`);
        process.exit(1);
      }
      // 检查是否还有后续操作参数（--announcements / --reports / --financial）
      const hasAction =
        args.includes('--announcements') ||
        args.includes('--reports') ||
        args.includes('--financial');
      if (!hasAction) {
        // 纯 --name 查询，展示匹配结果
        console.log(`## 公司匹配: ${name}\n`);
        if (cn.length > 0) {
          console.log('**巨潮资讯:**');
          cn.forEach((s) =>
            console.log(
              `- ${s.name} | 代码: ${s.code} | 市场: ${s.market.toUpperCase()} | orgId: ${s.orgId}`,
            ),
          );
        }
        if (em.length > 0) {
          console.log('**东方财富:**');
          em.forEach((s) =>
            console.log(
              `- ${s.name} | 代码: ${s.code} | 市场: ${s.market.toUpperCase()}`,
            ),
          );
        }
        const firstCode = cn.length > 0 ? cn[0].code : em[0].code;
        console.log(
          `\n> 继续查询: \`bun run .trae/scripts/stock-data/stock.ts --code ${firstCode} --announcements\``,
        );
        return;
      }
      // 有后续操作参数 → 自动使用第一个匹配结果继续
      const first = cn.length > 0 ? cn[0] : em[0];
      console.log(`## 自动匹配: ${first.name} (${first.code})\n`);
      // 重写 args 模拟 --code 路径
      const newArgs: string[] = ['--code', first.code];
      // 保留可选的 --category 和 --days
      if (category !== undefined) {
        newArgs.push('--category', category);
      }
      if (days !== undefined) {
        newArgs.push('--days', String(days));
      }
      if (args.includes('--announcements')) newArgs.push('--announcements');
      if (args.includes('--reports')) newArgs.push('--reports');
      if (args.includes('--financial')) newArgs.push('--financial');
      // 用新的参数重新执行 main
      const savedArgs = process.argv.slice(2);
      process.argv.splice(2);
      process.argv.push(...newArgs);
      // 递归调用
      await main();
      // 恢复原 argv（尽管之后不会再用到，保持整洁）
      process.argv.splice(2);
      process.argv.push(...savedArgs);
      return;
    }

    // ---- 代码 → 各类数据 ----
    const code = args[codeIdx + 1];
    const stock: { code: string; orgId: string; market: string } = {
      code,
      orgId: '',
      market: marketByCode(code),
    };
    // 尝试补 orgId
    try {
      const cn = await searchCninfo(code);
      if (cn.length > 0) {
        stock.orgId = cn[0].orgId;
        stock.market = cn[0].market;
      }
    } catch {}

    const wantReports = args.includes('--reports');
    const wantFinancial = args.includes('--financial');
    const wantAnnouncements = args.includes('--announcements');
    const wantAll = !(wantReports || wantFinancial || wantAnnouncements);

    if (wantAnnouncements || wantAll) {
      const r = await queryAnnouncements(stock, { category, days });
      console.log(
        `## 公告列表（${stock.code}，${category ? `类别:${category}` : '全部'}，近 ${days ?? 90} 天，共 ${r.total} 条）\n`,
      );
      r.items.forEach((a: { date: string; title: string; pdfUrl: string }) => {
        console.log(`- [${a.date}] ${a.title}`);
        if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
      });
      console.log('');
    }

    if (wantReports || wantAll) {
      const r = await queryReports(code, { days });
      console.log(
        `## 券商研报（${stock.code}，近 ${days ?? 365} 天，共 ${r.total} 条）\n`,
      );
      r.items.forEach(
        (x: {
          date: string;
          org: string;
          title: string;
          detailUrl: string;
        }) => {
          console.log(`- [${x.date}] ${x.org}: ${x.title}`);
          if (x.detailUrl) console.log(`  详情: ${x.detailUrl}`);
        },
      );
      console.log('');
    }

    if (wantFinancial || wantAll) {
      const fin = await queryFinancial(stock, { days });
      const org = organizeFinancial(fin);
      console.log(
        `## 定期报告（${stock.code}，近 ${days ?? 730} 天，共 ${org.allSorted.length} 条）\n`,
      );

      console.log('### 近三年的年报\n');
      org.annualReports.forEach((a) => {
        console.log(`- [${a.date}] ${a.title}`);
        if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
      });
      console.log('');

      console.log('### 最近一期财报\n');
      if (org.latestReport) {
        console.log(`- [${org.latestReport.date}] ${org.latestReport.title}`);
        if (org.latestReport.pdfUrl) {
          console.log(`  PDF: ${org.latestReport.pdfUrl}`);
        }
      }
      console.log('');

      console.log('### 全部定期报告（按时间倒序）\n');
      org.allSorted.forEach((a) => {
        console.log(`- [${a.date}] ${a.title}`);
        if (a.pdfUrl) console.log(`  PDF: ${a.pdfUrl}`);
      });
      console.log('');
    }
  } catch (err) {
    console.error(`❌ 查询失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

// 支持 import 测试
if (import.meta.main) main();
export { main };
export type { StockInfo };
