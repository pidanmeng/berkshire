#!/usr/bin/env bun
/**
 * 回测引擎 — 基本面精选指数回测（方案 Step 4）
 *
 * 规则：
 *   基本面筛查 Top10 等权 · 每年 3 次调仓（4/30 一季报、8/31 中报、10/31 三季报披露截止后）
 *   持有至下次调仓 · 以披露截止日收盘价选股、下一交易日收盘价执行（T+1，无未来函数）
 *
 * 数据流：
 *   每期调仓日 → runHistoricalScreen（screen-historical.ts，point-in-time 全市场筛查）→ Top10
 *   收益 → 持仓期日频后复权收益均值（等权，分红再投资）→ 组合净值
 *   基准 → 沪深300（000300.SH，dump 无指数，用东财日K）
 *
 * 输出：Research/00-Workspace/08-Backtest/backtest-result.json（与前端 /api/backtest schema 对齐）
 *
 * 用法：
 *   bun run .trae/scripts/backtest/backtest.ts                       # 完整回测 2020-01 ~ 数据末端
 *   bun run .trae/scripts/backtest/backtest.ts --start 2024-01-01 --end 2026-08-28
 *   bun run .trae/scripts/backtest/backtest.ts --smoke 50 --max-periods 3   # 冒烟（每期仅前 N 只主池）
 *   bun run .trae/scripts/backtest/backtest.ts --year 2024           # 按年分批（配合 JSONL 缓存断点续跑）
 */
import { parseArgs } from "util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getIndexKlineFromTencent, getIndicatorsRaw } from "../hithink/hithink.ts";
import { openMarketDb, type MarketDb } from "./market-db.ts";
import { runHistoricalScreen } from "./screen-historical.ts";
import { parseIndicatorsYear, type ScreenRow } from "../screener/screen.ts";

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "Research", "00-Workspace", "08-Backtest");
const DEFAULT_END = "2026-08-28";
// 止盈阈值：相对入场价涨幅达此比例 → 减仓 50% 锁利（+80% 让趋势走得更远，避免过早锁利）
const TAKE_PROFIT_THRESHOLD = 0.8;
const TAKE_PROFIT_FACTOR = 1 + TAKE_PROFIT_THRESHOLD; // 目标价 = 入场价 × 此倍数

// ==================== 调仓日历 ====================

function genRebalanceDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const [sy, sm] = startDate.split("-").map(Number);
  const [ey] = endDate.split("-").map(Number);
  for (let y = sy; y <= ey; y++) {
    for (const [m, d] of [
      [4, 30],
      [8, 31],
      [10, 31],
    ] as const) {
      if (y === sy && m < sm) continue;
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ds > endDate) continue;
      out.push(ds);
    }
  }
  return out;
}

/** 披露截止日 → 最新可披露报告期 */
function reportFor(asof: string): string {
  const [y, m] = asof.split("-").map(Number);
  if (m === 4) return `${y}-1`;
  if (m === 8) return `${y}-2`;
  return `${y}-3`;
}

/** TopN 组合：GREEN 优先按综合分，不足用 YELLOW 补齐；单行业 ≤ maxPerIndustry。
 *  P0 修复（降级版）：东财 clist 在当前网络间歇性失败，行业映射可能不完整。
 *    - 有行业：受 maxPerIndustry 配额限制（分散风险）
 *    - 无行业：不占配额，但设上限 maxNoIndustry（默认 3）防止全无行业集中持仓
 *    - 宁缺毋滥：候选不足 topN 时返回少于 topN 只 */
function buildPortfolio(
  screener: { pools: Record<"star" | "watch" | "exclude" | "loss", ScreenRow[]> },
  topN: number,
  maxPerIndustry: number,
  maxNoIndustry = 3,
): ScreenRow[] {
  if (topN <= 0) return []; // 双空头空仓：直接返回空，不选股
  const cands = [...screener.pools.star, ...screener.pools.watch].sort(
    (a, b) => b.overallScore - a.overallScore,
  );
  const picks: ScreenRow[] = [];
  const indCount = new Map<string, number>();
  let noIndustryCount = 0;
  for (const c of cands) {
    const key = c.industry?.trim();
    if (!key) {
      // 无行业：不占配额，但有数量上限
      if (noIndustryCount >= maxNoIndustry) continue;
      picks.push(c);
      noIndustryCount++;
    } else {
      if ((indCount.get(key) ?? 0) >= maxPerIndustry) continue;
      picks.push(c);
      indCount.set(key, (indCount.get(key) ?? 0) + 1);
    }
    if (picks.length >= topN) break;
  }
  if (noIndustryCount > 0) console.log(`  [buildPortfolio] 无行业候选 ${noIndustryCount} 只（不占配额，上限 ${maxNoIndustry}）`);
  return picks;
}

/** 成长放缓检测：拉取同期前 2 年 indicators，比较 3 期营收/净利增速趋势
 *  「纸面高增长」识别：当期增速好看，但连续 2 年下行 → 成长斜率放缓，降权处理
 *  判定（以营收为主、净利为辅，任一满足即判定）：
 *    放缓：连续 2 次下行（g0 < g1 < g2）
 *    加速：连续 2 次上行（g0 > g1 > g2）
 *    平稳：其他
 *    数据不足：缺期或增速为 null
 *  注意：同比比较需同期数据（Q1 vs Q1，年报 vs 年报） */
async function detectGrowthSlowdown(
  thscode: string,
  currentReport: string,
  currentRevenueYoy: number | null,
  currentNetProfitYoy: number | null,
): Promise<"加速" | "平稳" | "放缓" | "数据不足"> {
  if (currentRevenueYoy === null && currentNetProfitYoy === null) return "数据不足";
  const [y, q] = currentReport.split("-").map(Number);
  const prevReports = [`${y - 1}-${q}`, `${y - 2}-${q}`];
  const prevData = await Promise.all(
    prevReports.map(async (r) => {
      try {
        const raw = await getIndicatorsRaw(thscode, r);
        return parseIndicatorsYear(raw);
      } catch {
        return null;
      }
    }),
  );
  const trend = (g0: number | null, g1: number | null, g2: number | null): "加速" | "放缓" | "未知" => {
    if (g0 === null || g1 === null || g2 === null) return "未知";
    if (g0 < g1 && g1 < g2) return "放缓";
    if (g0 > g1 && g1 > g2) return "加速";
    return "未知";
  };
  const revTrend = trend(currentRevenueYoy, prevData[0]?.revenueYoy ?? null, prevData[1]?.revenueYoy ?? null);
  const npTrend = trend(currentNetProfitYoy, prevData[0]?.netProfitYoy ?? null, prevData[1]?.netProfitYoy ?? null);
  if (revTrend === "放缓" || npTrend === "放缓") return "放缓";
  if (revTrend === "加速" || npTrend === "加速") return "加速";
  if (revTrend === "未知" && npTrend === "未知") return "数据不足";
  return "平稳";
}

// ==================== 收益计算 ====================

function nextTradeDate(tradingDates: string[], date: string): string | null {
  for (const d of tradingDates) if (d > date) return d;
  return null;
}

/** 在升序日期数组中找 ≤ date 的最近值（前向填充，处理停牌/缺失） */
function valueAt(dates: string[], values: number[], date: string): number | null {
  let lo = 0;
  let hi = dates.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= date) {
      found = values[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 预拉基准日K → Map<date, close>（腾讯 fqkline，主循环前调用，供趋势判断 + 净值计算复用） */
async function fetchBenchmarkMap(benchmarkCode: string, startDate: string, endDate: string): Promise<Map<string, number>> {
  const [benchCode, benchMarket] = benchmarkCode.split('.');
  const benchPrefix = benchMarket === 'SH' ? 'sh' : benchMarket === 'SZ' ? 'sz' : (benchMarket ?? '').toLowerCase();
  const tencentCode = `${benchPrefix}${benchCode}`;
  // 提前 1 年拉基准数据，确保 MA200 从首期调仓就有足够历史（200 交易日 ≈ 280 自然日）
  const startMs = Date.parse(`${startDate}T00:00:00+08:00`) - 400 * 86400000;
  const endMs = Date.parse(`${endDate}T00:00:00+08:00`) + 86400000;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const kb = await getIndexKlineFromTencent(tencentCode, startMs, endMs);
      const m = new Map(kb.map((x) => [new Date(x.date_ms + 8 * 3600000).toISOString().slice(0, 10), x.close_price]));
      console.log(`[基准] ${benchmarkCode} → 腾讯 ${tencentCode}，${m.size} 条日K`);
      return m;
    } catch (e) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      else console.error(`[基准] ${benchmarkCode} 拉取失败：${e}`);
    }
  }
  return new Map();
}

/** 趋势过滤：收盘价 vs MA200（长周期）+ MA20（短周期）四档风控
 *  A股经典风控：长周期判多空，短周期判加速/反弹
 *    多头   close > MA200 且 close > MA20 → 满仓 10 只
 *    回调   close > MA200 且 close < MA20 → 5 只（短期走弱减仓）
 *    空头   close < MA200 且 close > MA20 → 3 只（长期走弱但短期反弹，轻仓）
 *    双空头 close < MA200 且 close < MA20 → 2 只（轻仓规避大跌，不完全空仓避免错过反弹）
 *  数据不足（< maLong）默认多头（不阻断早期建仓） */
type TrendLevel = { targetN: number; label: string; bull: boolean };
function getTrendLevel(benchMap: Map<string, number>, date: string, maLong = 200, maShort = 20): TrendLevel {
  const dates = [...benchMap.keys()].filter((d) => d <= date).sort();
  if (dates.length < maLong) return { targetN: 10, label: "数据不足→满仓", bull: true };
  const close = benchMap.get(dates[dates.length - 1]!) ?? 0;
  const maL = dates.slice(-maLong).reduce((s, d) => s + (benchMap.get(d) ?? 0), 0) / maLong;
  const maS =
    dates.length >= maShort
      ? dates.slice(-maShort).reduce((s, d) => s + (benchMap.get(d) ?? 0), 0) / maShort
      : maL;
  const aboveLong = close > maL;
  const aboveShort = close > maS;
  if (!aboveLong && !aboveShort) return { targetN: 2, label: "双空头→2成轻仓", bull: false };
  if (!aboveLong) return { targetN: 3, label: "空头→3成仓", bull: false };
  if (!aboveShort) return { targetN: 5, label: "回调→5成仓", bull: true };
  return { targetN: 10, label: "多头→满仓", bull: true };
}

async function computeReturns(
  db: MarketDb,
  tradingDates: string[],
  holdings: {
    period: string;
    picks: { thscode: string; weight: number; targetPrice?: number | null }[];
  }[],
  benchMap: Map<string, number>,
): Promise<{
  nav: { dates: string[]; portfolio: number[]; benchmark: number[] };
  stats: {
    periods: number;
    avgTurnover: number;
    totalReturn: number;
    annualReturn: number;
    benchmarkReturn: number;
    excessReturn: number;
    maxDrawdown: number;
    sharpe: number;
    winRate: number;
  };
  weightSeries: {
    period: string;
    codes: string[];
    dates: string[];
    matrix: (number | null)[][];
  }[];
}> {
  // 预取全部持仓股票后复权序列
  const codes = new Set<string>();
  for (const h of holdings) for (const p of h.picks) codes.add(p.thscode);
  const adjMap = new Map<string, { dates: string[]; values: number[] }>();
  for (const code of codes) {
    const s = await db.getAdjSeries(code);
    adjMap.set(code, { dates: s.map((x) => x.date), values: s.map((x) => x.adjClose) });
  }

  // 基准 benchMap 由主循环前预拉（fetchBenchmarkMap），此处直接复用

  // 每期执行日（asof 下一交易日）
  const execDates = holdings.map((h) => nextTradeDate(tradingDates, h.period));

  // 真实买入持有状态：
  //   periodShares[k] — 第 k 期各股票份额（份额固定，权重随价格自然漂移）
  //   periodState[k]  — 第 k 期各股票入场后复权价 + 是否已止盈（触发止盈卖出 50% 份额转现金）
  const periodShares = holdings.map(() => new Map<string, number>());
  const periodState = holdings.map((h) => {
    const m = new Map<string, { entryAdj: number | null; stopped: boolean }>();
    for (const p of h.picks) m.set(p.thscode, { entryAdj: null, stopped: false });
    return m;
  });

  const dates = tradingDates;
  const n = dates.length;
  const portfolio = new Array<number>(n);
  const benchmark = new Array<number>(n);
  portfolio[0] = 1;
  benchmark[0] = 1;

  let cash = 1.0; // 期初全部现金（首个调仓日前持有现金）
  let prevBench = benchMap.get(dates[0]) ?? null;
  // 每日实时权重收集：date → [{ thscode, pct }]（份额×复权价 ÷ 组合净值 × 100）
  const allDailyWeights: { date: string; ws: { thscode: string; pct: number }[] }[] = [];
  for (let i = 1; i < n; i++) {
    const t = dates[i]!;

    // 当前持仓期：execDates 中最后一个 ≤ t 的期
    let k = -1;
    for (let j = 0; j < execDates.length; j++) if (execDates[j] && execDates[j]! <= t) k = j;

    if (k >= 0) {
      const picks = holdings[k]!.picks;
      const shares = periodShares[k]!;
      const state = periodState[k]!;

      // 调仓日：清仓上期持仓 → 全部现金 → 按权重买入本期（份额 = 分配资金 / 当日后复权价）
      //   此后每只份额固定，权重随价格自然漂移（涨的股票权重自动变大，跌的自动变小）
      if (t === execDates[k]) {
        if (k > 0) {
          for (const [code, sh] of periodShares[k - 1]!) {
            if (sh <= 0) continue;
            const s = adjMap.get(code);
            if (!s) continue;
            const px = valueAt(s.dates, s.values, t);
            if (px) cash += sh * px;
          }
        }
        // 注意：分配基准必须是买入前总资金 totalCash（cash 在循环内递减，若直接用会
        //   导致前几只股票超配、后几只资金不足、剩余资金滞留现金）
        const totalCash = cash;
        let allocated = 0;
        for (const p of picks) {
          const s = adjMap.get(p.thscode);
          if (!s) continue;
          const px = valueAt(s.dates, s.values, t);
          if (!px || px <= 0) continue; // 停牌缺价 → 资金留现金
          const alloc = totalCash * (p.weight / 100);
          if (alloc <= 0) continue;
          shares.set(p.thscode, alloc / px);
          state.get(p.thscode)!.entryAdj = px;
          allocated += alloc;
        }
        cash = totalCash - allocated;
      }

      // 日频止盈检查：涨幅 ≥ TAKE_PROFIT_THRESHOLD → 卖出 50% 份额转现金（锁利部分不再参与收益）
      for (const p of picks) {
        const s = adjMap.get(p.thscode);
        if (!s) continue;
        const sh = shares.get(p.thscode);
        if (!sh || sh <= 0) continue;
        const px = valueAt(s.dates, s.values, t);
        if (!px || px <= 0) continue;
        const st = state.get(p.thscode);
        if (st && !st.stopped && st.entryAdj && px / st.entryAdj - 1 >= TAKE_PROFIT_THRESHOLD) {
          const sellSh = sh * 0.5;
          cash += sellSh * px;
          shares.set(p.thscode, sh * 0.5);
          st.stopped = true;
          console.log(
            `  [止盈] ${p.thscode} @ ${t} 涨幅 ${((px / st.entryAdj - 1) * 100).toFixed(1)}% → 卖出 50% 份额`,
          );
        }
      }

      // 组合净值 = Σ 份额 × 当日后复权价 + 现金；同时收集各股市值用于实时权重
      let value = cash;
      const liveMv: { thscode: string; mv: number }[] = [];
      for (const p of picks) {
        const s = adjMap.get(p.thscode);
        if (!s) continue;
        const sh = shares.get(p.thscode);
        if (!sh || sh <= 0) continue;
        const px = valueAt(s.dates, s.values, t);
        if (px && px > 0) {
          const mv = sh * px;
          value += mv;
          liveMv.push({ thscode: p.thscode, mv });
        }
      }
      portfolio[i] = value;
      // 实时权重 = 个股市值 / 组合净值 × 100（现金部分为剩余占比，未单独列出）
      allDailyWeights.push({
        date: t,
        ws: value > 0 ? liveMv.map((x) => ({ thscode: x.thscode, pct: (x.mv / value) * 100 })) : [],
      });
    } else {
      portfolio[i] = portfolio[i - 1]!; // 首个调仓日前：纯现金 1.0
    }

    // 基准日收益
    const bv = benchMap.get(t) ?? prevBench;
    if (prevBench && bv && prevBench > 0) benchmark[i] = benchmark[i - 1]! * (bv / prevBench);
    else benchmark[i] = benchmark[i - 1]!;
    if (bv) prevBench = bv;
  }

  // ===== 指标 =====
  const totalReturn = portfolio[n - 1]! - 1;
  const benchmarkReturn = benchmark[n - 1]! - 1;
  const years = n / 252;
  const annualReturn = years > 0 ? Math.pow(portfolio[n - 1]!, 1 / years) - 1 : 0;
  const excessReturn = totalReturn - benchmarkReturn;
  let peak = portfolio[0]!;
  let maxDrawdown = 0;
  for (const v of portfolio) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const rfDaily = 0.02 / 252;
  let sum = 0;
  let sumSq = 0;
  let wins = 0;
  for (let i = 1; i < n; i++) {
    const rp = portfolio[i]! / portfolio[i - 1]! - 1;
    const rb = benchmark[i]! / benchmark[i - 1]! - 1;
    sum += rp - rfDaily;
    sumSq += (rp - rfDaily) ** 2;
    if (rp > rb) wins++;
  }
  const mean = sum / (n - 1);
  const std = Math.sqrt(sumSq / (n - 1) - mean ** 2);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  const winRate = wins / (n - 1);

  // 换手率
  let totalTurn = 0;
  let prevCodes = new Set<string>();
  for (const h of holdings) {
    const codesNow = new Set(h.picks.map((p) => p.thscode));
    const kept = [...codesNow].filter((c) => prevCodes.has(c)).length;
    totalTurn += prevCodes.size === 0 ? 1 : 1 - kept / Math.max(codesNow.size, 1);
    prevCodes = codesNow;
  }
  const avgTurnover = Math.round((totalTurn / Math.max(holdings.length, 1)) * 100);

  // ===== 每期实时权重序列（前端悬浮展示实时仓位） =====
  // 按 execDates 边界切分每日权重 → codes/dates/matrix 紧凑格式（dates × codes 的权重 %，null=当日无持仓数据）
  const weightSeries = holdings.map((h, k) => {
    const start = execDates[k] ?? "9999-12-31";
    const end = k + 1 < execDates.length ? execDates[k + 1]! : null;
    const codes = h.picks.map((p) => p.thscode);
    const daily = allDailyWeights.filter((d) => d.date >= start && (end ? d.date < end : true));
    return {
      period: h.period,
      codes,
      dates: daily.map((d) => d.date),
      matrix: daily.map((d) => {
        const m = new Map(d.ws.map((w) => [w.thscode, w.pct] as const));
        return codes.map((c) => {
          const v = m.get(c);
          return v === undefined ? null : +v.toFixed(2);
        });
      }),
    };
  });

  return {
    nav: {
      dates,
      portfolio: portfolio.map((v) => +v.toFixed(4)),
      benchmark: benchmark.map((v) => +v.toFixed(4)),
    },
    stats: {
      periods: holdings.length,
      avgTurnover,
      totalReturn,
      annualReturn,
      benchmarkReturn,
      excessReturn,
      maxDrawdown,
      sharpe,
      winRate,
    },
    weightSeries,
  };
}

// ==================== 主流程 ====================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      start: { type: "string" },
      end: { type: "string" },
      year: { type: "string" },
      "min-mcap": { type: "string" },
      smoke: { type: "string" },
      "max-periods": { type: "string" },
      concurrency: { type: "string" },
    },
  });

  const year = values.year;
  const startDate = year ? `${year}-01-01` : (values.start as string | undefined) ?? "2020-01-01";
  const endDate = year ? `${year}-12-31` : (values.end as string | undefined) ?? DEFAULT_END;
  const minMcapYi = Number(values["min-mcap"] ?? 10);
  const smoke = values.smoke ? Number(values.smoke) : null;
  const maxPeriods = values["max-periods"] ? Number(values["max-periods"]) : null;
  const concurrency = Number(values.concurrency ?? 8);

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`回测区间 ${startDate} ~ ${endDate}（minMcap ${minMcapYi}亿，smoke ${smoke ?? "全量"}）`);

  // 调仓日历（由披露截止日字符串生成，不依赖交易日）
  let rebalances = genRebalanceDates(startDate, endDate);
  if (maxPeriods !== null) rebalances = rebalances.slice(0, maxPeriods);
  console.log(`调仓 ${rebalances.length} 期：${rebalances.join(", ")}`);

  // 趋势过滤：预拉沪深300日K（主循环前拉取，供 isBullTrend 判断 + computeReturns 复用）
  const benchMap = await fetchBenchmarkMap("000300.SH", startDate, endDate);

  // ===== 每期筛查 → 持仓（runHistoricalScreen 自管 market-db 连接，避免 Windows 文件锁冲突） =====
  const holdings: {
    period: string;
    report: string;
    nextPeriod: string | null;
    turnoverPct: number;
    trend: string;
    weights: {
      thscode: string;
      name: string;
      industry: string | null;
      weight: number;
      score: number;
      pool: "明星池" | "观察池";
      targetPrice: number | null;
    }[];
  }[] = [];
  for (const asof of rebalances) {
    const report = reportFor(asof);
    console.log(`\n[期] ${asof} 报告期 ${report}（prev ${Number(report.split("-")[0]) - 1}-4）`);
    const screener = await runHistoricalScreen({
      asof,
      report,
      minMcapYi,
      smoke,
      concurrency,
    });
    // 趋势过滤：沪深300 MA200（长周期）+ MA20（短周期）四档风控
    const tl = getTrendLevel(benchMap, asof);
    const topN = tl.targetN;
    console.log(`  趋势：${tl.label}（targetN ${topN}）`);
    const picks = buildPortfolio(screener, topN, 4, 5);
    // 成长放缓检测：拉取同期前 2 年增速，连续下行者降分 10%（避免纸面高增长陷阱）
    //   降分只影响权重分配（分数加权下 → 降权），不剔除持仓
    const slowdownChecks = await Promise.all(
      picks.map((p) =>
        detectGrowthSlowdown(p.thscode, report, p.revenueYoy, p.netProfitYoy).then((t) => ({
          thscode: p.thscode,
          trend: t,
        })),
      ),
    );
    const slowdownMap = new Map(slowdownChecks.map((s) => [s.thscode, s.trend]));
    const adjustedPicks = picks.map((p) => {
      const t = slowdownMap.get(p.thscode);
      return t === "放缓" ? { ...p, overallScore: +(p.overallScore * 0.9).toFixed(2) } : p;
    });
    const slowdownCount = slowdownChecks.filter((s) => s.trend === "放缓").length;
    if (slowdownCount > 0)
      console.log(
        `  [成长放缓] ${slowdownCount}/${picks.length} 只增速连续下行 → 降分 10%（${slowdownChecks.filter((s) => s.trend === "放缓").map((s) => s.thscode).join(", ")}）`,
      );
    // 分数加权：weight_i = (score_i / sumScores) × totalPositionPct
    //   totalPositionPct = min(picks.length, 10) × 10（满仓 100%，空头 30%，空仓 0%）
    const totalScore = adjustedPicks.reduce((s, p) => s + p.overallScore, 0);
    const totalPositionPct = Math.min(adjustedPicks.length, 10) * 10;
    console.log(
      `  → 持仓 ${adjustedPicks.length} 只（GREEN ${adjustedPicks.filter((p) => p.verdict === "GREEN").length}，总仓位 ${totalPositionPct}%）`,
    );
    adjustedPicks.forEach((p, i) =>
      console.log(
        `    ${i + 1}. ${p.name} ${p.thscode} ${p.industry ?? ""} 分 ${p.overallScore.toFixed(1)} PE ${p.peTtm?.toFixed(1) ?? "—"}`,
      ),
    );
    holdings.push({
      period: asof,
      report,
      nextPeriod: null,
      turnoverPct: 0,
      trend: tl.label,
      weights: adjustedPicks.map((p) => ({
        thscode: p.thscode,
        name: p.name,
        industry: p.industry,
        weight: totalScore > 0 ? +((p.overallScore / totalScore) * totalPositionPct).toFixed(2) : 0,
        score: p.overallScore,
        pool: p.pool === "star" ? "明星池" : "观察池",
        // 止盈目标价：调仓日收盘价 × TAKE_PROFIT_FACTOR（乐观估值上沿，+80%）
        //   简化版：统一 +80% 目标，未结合历史 PE 分位（数据不足时降级）
        //   触及即减仓 50%，锁利至下次调仓
        targetPrice: p.price && p.price > 0 ? +(p.price * TAKE_PROFIT_FACTOR).toFixed(2) : null,
      })),
    });
  }

  if (holdings.length === 0) throw new Error("无调仓期，检查区间");
  for (let i = 0; i < holdings.length - 1; i++) holdings[i]!.nextPeriod = holdings[i + 1]!.period;
  // 换手率（与上期对比）
  let prevCodes = new Set<string>();
  for (const h of holdings) {
    const codes = new Set(h.weights.map((w) => w.thscode));
    const kept = [...codes].filter((c) => prevCodes.has(c)).length;
    h.turnoverPct = prevCodes.size === 0 ? 100 : Math.round((1 - kept / Math.max(codes.size, 1)) * 100);
    prevCodes = codes;
  }

  // ===== 收益计算（此时再开 market-db） =====
  const db = await openMarketDb();
  try {
    const allDates = await db.getTradingDates();
    const tradingDates = allDates.filter((d) => d >= startDate && d <= endDate);
    if (tradingDates.length < 2) throw new Error("区间内交易日不足");
    console.log(`\n[收益] 组合净值计算（${tradingDates.length} 交易日）...`);
    const { nav, stats, weightSeries } = await computeReturns(
      db,
      tradingDates,
      holdings.map((h) => ({ period: h.period, picks: h.weights })),
      benchMap,
    );

    // ===== 模拟指数日K（点位 = 1000 × 组合净值，前端展示用） =====
    const rand = mulberry32(20260830);
    let prevClose = 1000;
    const kline = nav.dates.map((d, i) => {
      const prev = i === 0 ? 1 : nav.portfolio[i - 1]!;
      const cur = nav.portfolio[i]!;
      const r = cur / prev - 1;
      const open = prevClose * (1 + 0.3 * r + 0.0008 * (rand() - 0.5));
      const close = prevClose * (1 + r);
      const high = Math.max(open, close) * (1 + 0.0022 * rand());
      const low = Math.min(open, close) * (1 - 0.0022 * rand());
      const volume = Math.round((0.6 + Math.abs(r) * 55) * 1e7 * (0.8 + 0.4 * rand()));
      prevClose = close;
      return { date: d, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume };
    });

    const result = {
      meta: {
        name: "基本面精选指数",
        strategy: "基本面筛查 Top10 · 每年 3 次调仓（4/8/10月底财报披露截止后）· 趋势过滤（沪深300 MA200 空头半仓）",
        benchmark: "沪深300",
        startDate: nav.dates[0],
        endDate: nav.dates[nav.dates.length - 1],
        rebalanceDates: holdings.map((h) => h.period),
        dataSource: "engine",
      },
      nav,
      kline,
      stats,
      holdings,
      weightSeries,
    };
    writeFileSync(join(OUT_DIR, "backtest-result.json"), JSON.stringify(result, null, 2), "utf-8");
    console.log(`\n[完成] → ${join(OUT_DIR, "backtest-result.json")}`);
    console.log(`  累计收益 ${(stats.totalReturn * 100).toFixed(1)}% | 年化 ${(stats.annualReturn * 100).toFixed(1)}% | 基准 ${(stats.benchmarkReturn * 100).toFixed(1)}% | 超额 ${(stats.excessReturn * 100).toFixed(1)}%`);
    console.log(`  最大回撤 ${(stats.maxDrawdown * 100).toFixed(1)}% | 夏普 ${stats.sharpe.toFixed(2)} | 胜率 ${(stats.winRate * 100).toFixed(1)}% | 平均换手 ${stats.avgTurnover}% | ${stats.periods} 期`);
  } finally {
    await db.close();
  }
}

function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
