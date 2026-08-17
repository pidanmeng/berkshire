/**
 * 板块成分股查询 — 东方财富数据源（免费、稳定）
 *
 * 用法：
 *   bun run sector.ts --search "电子"              # 搜索板块关键词，返回匹配板块列表
 *   bun run sector.ts --code BK0429               # 获取板块成分股（按成交额降序）
 *   bun run sector.ts --code BK0429 --top 20      # 取前20只成分股
 *   bun run sector.ts --name "电子元件" --top 20   # 按板块名搜索并获取成分股
 *
 * 数据源：
 *   - 板块搜索: 东财 suggest API
 *   - 成分股: 东财 clist API（含成交额、市盈率、涨跌幅等）
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface SectorInfo {
  code: string; // 如 BK0429
  name: string;
}

interface SectorStock {
  code: string; // f12
  name: string; // f14
  price: number | null; // f2 最新价
  changePct: number | null; // f3 涨跌幅%
  turnover: number | null; // f6 成交额（元）
  volume: number | null; // f5 成交量（手）
  peTtm: number | null; // f26 市盈率(TTM)，部分板块可能用 f9
  pb: number | null; // f23 市净率
  marketCap: number | null; // f20 总市值
  floatCap: number | null; // f21 流通市值
  turnoverRate: number | null; // f8 换手率
}

function usage(): never {
  console.log(`
板块成分股查询工具 (bun) — 东方财富数据源

用法:
  bun run sector.ts --search <关键词>              搜索板块（如：电子、PCB、光伏）
  bun run sector.ts --code <板块代码> [--top N]    获取成分股，按成交额降序（默认前30）
  bun run sector.ts --name <板块名> [--top N]      先搜索板块名，再取成分股

示例:
  bun run sector.ts --search "电子"
  bun run sector.ts --code BK0429 --top 20
  bun run sector.ts --name "电子元件" --top 15
`);
  process.exit(1);
}

/** 格式化金额：亿/万 */
function fmtMoney(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(2);
}

/** 格式化百分比 */
function fmtPct(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(2) + '%';
}

/** 搜索板块 — 通过东财板块列表 API 本地过滤 */
export async function searchSector(keyword: string): Promise<SectorInfo[]> {
  // 东财板块列表：m:90+t:2 为全部板块，取前 200 个（覆盖绝大多数场景）
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:90+t:2&fields=f12,f14`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.data?.diff ?? [];
  const lowerKw = keyword.toLowerCase();
  return items
    .filter((it: { f12?: string; f14?: string }) =>
      (it.f14 && it.f14.toLowerCase().includes(lowerKw)) ||
      (it.f12 && it.f12.toLowerCase().includes(lowerKw))
    )
    .map((it: { f12: string; f14: string }) => ({
      name: it.f14,
      code: it.f12,
    }));
}

/** 获取板块成分股（按成交额降序） */
export async function getSectorStocks(
  sectorCode: string,
  topN = 30
): Promise<SectorStock[]> {
  // 东财 clist API：fs=b:板块代码，fid=f6 按成交额排序，po=1 降序
  // f9 = 动态市盈率，f26 在此接口中为上市日期（非PE），故用 f9
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${topN}&po=1&np=1&fltt=2&invt=2&fid=f6&fs=b:${sectorCode}&fields=f12,f14,f2,f3,f5,f6,f8,f9,f20,f21,f23`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.data?.diff ?? [];
  return items.map((it: Record<string, number | string | null>) => ({
    code: String(it.f12 || ''),
    name: String(it.f14 || ''),
    price: it.f2 ? Number(it.f2) : null,
    changePct: it.f3 ? Number(it.f3) : null,
    volume: it.f5 ? Number(it.f5) : null,
    turnover: it.f6 ? Number(it.f6) : null,
    turnoverRate: it.f8 ? Number(it.f8) : null,
    peTtm: it.f9 ? Number(it.f9) : null,
    marketCap: it.f20 ? Number(it.f20) : null,
    floatCap: it.f21 ? Number(it.f21) : null,
    pb: it.f23 ? Number(it.f23) : null,
  }));
}

/** 打印板块搜索结果 */
function printSectors(list: SectorInfo[]) {
  if (list.length === 0) {
    console.log('❌ 未找到匹配的板块，请尝试其他关键词。');
    return;
  }
  console.log(`## 板块搜索匹配结果（共 ${list.length} 个）\n`);
  console.log('| 序号 | 板块代码 | 板块名称 |');
  console.log('|------|---------|---------|');
  list.forEach((s, i) => {
    console.log(`| ${i + 1} | ${s.code} | ${s.name} |`);
  });
  console.log(`\n> 获取成分股: \`bun run sector.ts --code ${list[0].code} --top 20\``);
}

/** 打印成分股列表 */
function printStocks(stocks: SectorStock[], sectorCode: string) {
  if (stocks.length === 0) {
    console.log(`❌ 板块 ${sectorCode} 暂无成分股数据。`);
    return;
  }
  console.log(`## 板块成分股（${sectorCode}，按成交额降序，共 ${stocks.length} 只）\n`);
  console.log('| 序号 | 代码 | 名称 | 最新价 | 涨跌幅 | 成交额 | 总市值 | 市盈率(TTM) | 市净率 | 换手率 |');
  console.log('|------|------|------|--------|--------|--------|--------|-------------|--------|--------|');
  stocks.forEach((s, i) => {
    const price = s.price !== null ? s.price.toFixed(2) : '—';
    const change = fmtPct(s.changePct);
    const turnover = fmtMoney(s.turnover);
    const mcap = fmtMoney(s.marketCap);
    const pe = s.peTtm !== null && !Number.isNaN(s.peTtm) ? s.peTtm.toFixed(2) : '—';
    const pb = s.pb !== null && !Number.isNaN(s.pb) ? s.pb.toFixed(2) : '—';
    const rate = fmtPct(s.turnoverRate);
    console.log(`| ${i + 1} | ${s.code} | ${s.name} | ${price} | ${change} | ${turnover} | ${mcap} | ${pe} | ${pb} | ${rate} |`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const searchIdx = args.indexOf('--search');
  const codeIdx = args.indexOf('--code');
  const nameIdx = args.indexOf('--name');
  const topIdx = args.indexOf('--top');
  const topN = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) || 30 : 30;

  try {
    // --search 模式：仅搜索板块
    if (searchIdx >= 0) {
      const keyword = args[searchIdx + 1];
      if (!keyword) usage();
      const list = await searchSector(keyword);
      printSectors(list);
      return;
    }

    // --code 模式：直接取成分股
    if (codeIdx >= 0) {
      const code = args[codeIdx + 1];
      if (!code) usage();
      const stocks = await getSectorStocks(code, topN);
      printStocks(stocks, code);
      return;
    }

    // --name 模式：先搜板块，再取第一个匹配板块的成分股
    if (nameIdx >= 0) {
      const name = args[nameIdx + 1];
      if (!name) usage();
      const list = await searchSector(name);
      if (list.length === 0) {
        console.log('❌ 未找到匹配的板块。');
        process.exit(1);
      }
      console.log(`## 匹配板块: ${list[0].name} (${list[0].code})\n`);
      const stocks = await getSectorStocks(list[0].code, topN);
      printStocks(stocks, list[0].code);
      return;
    }

    usage();
  } catch (err) {
    console.error(`❌ 查询失败: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
