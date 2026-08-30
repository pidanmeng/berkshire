/**
 * 历史时点估值计算 — 回测估值层（方案 Step 2）
 *
 * 严格 point-in-time：只用"调仓日 T 及之前已披露"的信息计算历史 PE / PB / 市值。
 *
 * 公式：
 *   历史 PE(T)   = 调仓日收盘价(T) ÷ TTM_EPS(截至最新可披露报告期 R)
 *   历史 PB(T)   = 调仓日收盘价(T) ÷ 每股净资产(R)
 *   历史市值(T)  = 调仓日收盘价(T) × 历史股本(截至 T)
 *
 * 数据源：
 *   收盘价      → market-db（dump 全市场日K，未复权）
 *   TTM EPS     → 利润表 quarterly（同花顺累计口径，相邻期差分得单季，最近 4 季求和）
 *   归母净资产  → 资产负债表 quarterly（最新可披露报告期）
 *   历史股本    → 当前股本 ÷ 股本回推因子（送转/配股事件，见 market-db.getShareFactor）
 *
 * CLI：
 *   bun run .trae/scripts/backtest/point-in-time.ts --check <code> --asof <YYYY-MM-DD> --report <YYYY-N>
 *   （验证用：股本从当前市值÷现价反推，与真实回测一致）
 */
import { getIncomeStatements, getBalanceSheets, getMarketCapWithFallback } from "../hithink/hithink.ts";
import { openMarketDb, type MarketDb } from "./market-db.ts";

// ==================== 报告期 → 期末毫秒（Asia/Shanghai 零点，与接口 period_end_ms 口径一致） ====================

export function reportEndMs(report: string): number {
  const [y, q] = report.split("-").map((s) => Number(s));
  if (!y || !q || q < 1 || q > 4) throw new Error(`非法报告期：${report}`);
  const end =
    q === 1 ? `${y}-03-31` : q === 2 ? `${y}-06-30` : q === 3 ? `${y}-09-30` : `${y}-12-31`;
  return Date.parse(`${end}T00:00:00+08:00`);
}

export function reportEndDate(report: string): string {
  const [y, q] = report.split("-").map((s) => Number(s));
  return q === 1 ? `${y}-03-31` : q === 2 ? `${y}-06-30` : q === 3 ? `${y}-09-30` : `${y}-12-31`;
}

// ==================== TTM EPS（累计口径差分 → 单季求和） ====================

interface QuarterlyRow {
  periodEndMs: number;
  fiscalYear: number;
  quarter: number; // 1-4
  eps: number | null; // 累计 EPS
}

function quarterOf(fp: string): number {
  if (fp === "FY") return 4;
  const m = /Q([1-4])/.exec(fp);
  return m ? Number(m[1]) : 0;
}

/** 从 quarterly 利润表计算截至 R 期末的 TTM EPS（最近 4 个单季之和） */
export function ttmEpsFromStatements(
  stmts: { fiscal_year: number; fiscal_period: string; period_end_ms: number; basic_eps: number | null }[],
  report: string,
): { ttmEps: number | null; quarters: (number | null)[]; latestQuarter: string } {
  const endMs = reportEndMs(report);
  const rows: QuarterlyRow[] = stmts
    .filter((s) => s.period_end_ms > 0 && s.period_end_ms <= endMs && s.basic_eps !== null)
    .map((s) => ({
      periodEndMs: s.period_end_ms,
      fiscalYear: s.fiscal_year,
      quarter: quarterOf(s.fiscal_period),
      eps: s.basic_eps,
    }))
    .sort((a, b) => a.periodEndMs - b.periodEndMs);

  // 同花顺 quarterly 为累计口径（已实测：H1 累计 > Q1 累计），差分得单季；
  // 若序列显示单季口径（同年内递减），则直接使用。
  const single: (number | null)[] = [];
  let cumulative = true;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const prevSameYear = rows
      .slice(0, i)
      .reverse()
      .find((x) => x.fiscalYear === r.fiscalYear && x.quarter === r.quarter - 1 && r.quarter > 1);
    if (r.eps === null) {
      single.push(null);
      continue;
    }
    if (prevSameYear && prevSameYear.eps !== null) {
      if (r.eps < prevSameYear.eps) cumulative = false;
      single.push(cumulative ? r.eps - prevSameYear.eps : r.eps);
    } else {
      single.push(r.eps); // 各年 Q1 或年初边界
    }
  }

  const last4 = single.slice(-4);
  const latest = rows[rows.length - 1];
  const ttm =
    last4.length >= 4 && last4.every((v) => v !== null)
      ? (last4 as number[]).reduce((a, b) => a + b, 0)
      : null;
  return {
    ttmEps: ttm === null ? null : +(ttm).toFixed(4),
    quarters: last4,
    latestQuarter: latest ? `${latest.fiscalYear}-Q${latest.quarter}` : "",
  };
}

// ==================== 历史估值 ====================

export interface PointInTimeValuation {
  thscode: string;
  asof: string;
  report: string;
  close: number | null; // 调仓日收盘价（未复权）
  ttmEps: number | null;
  pe: number | null;
  equity: number | null; // 归母净资产（元）
  shares: number | null; // 历史股本（股）
  bvps: number | null; // 每股净资产（元）
  pb: number | null;
  marketCap: number | null; // 市值（元）
}

/** 历史时点估值：只用 asof 前已披露信息 */
export async function historicalValuation(opts: {
  thscode: string;
  asof: string; // 调仓日 YYYY-MM-DD
  report: string; // 调仓日可见的最新报告期 YYYY-N
  currentShares: number; // 当前总股本（股）
  db: MarketDb;
}): Promise<PointInTimeValuation> {
  const { thscode, asof, report, currentShares, db } = opts;
  const endMs = reportEndMs(report);
  // 区间模式：TTM 需截至 R 期末最近 4 季 + 差分冗余（往前 16 个月）；end +1 天确保含期末当天
  const rangeStart = endMs - 480 * 86400000;
  const rangeEnd = endMs + 86400000;

  const [inc, bal, close] = await Promise.all([
    getIncomeStatements(thscode, "quarterly", 12, { start: rangeStart, end: rangeEnd }).catch(() => []),
    getBalanceSheets(thscode, "quarterly", 8, { start: rangeStart, end: rangeEnd }).catch(() => []),
    db.getClose(thscode, asof),
  ]);

  const ttm = ttmEpsFromStatements(inc, report);

  // 归母净资产：period_end ≤ R 期末 的最新一期
  let equity: number | null = null;
  for (const b of [...bal].sort((a, b2) => b2.period_end_ms - a.period_end_ms)) {
    if (b.period_end_ms > 0 && b.period_end_ms <= endMs && b.holder_equity_total !== null) {
      equity = b.holder_equity_total;
      break;
    }
  }

  // 历史股本：当前股本 ÷ 送转配股回推因子
  const factor = await db.getShareFactor(thscode, asof);
  const shares = currentShares > 0 ? currentShares / factor : null;

  const bvps = equity !== null && shares ? equity / shares : null;
  const pe = ttm.ttmEps && ttm.ttmEps > 0 && close ? close / ttm.ttmEps : null;
  const pb = bvps && bvps > 0 && close ? close / bvps : null;
  const marketCap = close !== null && shares ? close * shares : null;

  return {
    thscode,
    asof,
    report,
    close,
    ttmEps: ttm.ttmEps,
    pe,
    equity,
    shares,
    bvps,
    pb,
    marketCap,
  };
}

// ==================== CLI（验证用） ====================

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args[0] === "--check") {
    const thscode = (get("--code") ?? "600519.SH").toUpperCase();
    const asof = get("--asof") ?? "2024-04-30";
    const report = get("--report") ?? "2024-1";
    const db = await openMarketDb();
    // 验证用股本：当前市值 ÷ 现价（与真实回测"当前股本快照"口径一致）
    const [m] = await getMarketCapWithFallback([thscode]);
    const currentShares = m?.market_cap && m?.price ? m.market_cap / m.price : 0;
    const v = await historicalValuation({ thscode, asof, report, currentShares, db });
    console.log(`${thscode} @ ${asof}（报告期 ${report}）`);
    console.log(`  收盘 ${v.close} | TTM EPS ${v.ttmEps} | PE(TTM) ${v.pe?.toFixed(2) ?? "—"}`);
    console.log(`  归母净资产 ${v.equity ? (v.equity / 1e8).toFixed(0) + " 亿" : "—"} | 历史股本 ${v.shares ? (v.shares / 1e8).toFixed(2) + " 亿" : "—"}`);
    console.log(`  BVPS ${v.bvps?.toFixed(2) ?? "—"} | PB ${v.pb?.toFixed(2) ?? "—"} | 市值 ${v.marketCap ? (v.marketCap / 1e8).toFixed(0) + " 亿" : "—"}`);
    await db.close();
    return;
  }
  console.log(`用法：
  --check --code <code> --asof <YYYY-MM-DD> --report <YYYY-N>   输出历史时点估值`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
