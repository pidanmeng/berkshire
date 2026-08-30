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
import { getIndexKline } from "../hithink/hithink.ts";
import { openMarketDb, type MarketDb } from "./market-db.ts";
import { runHistoricalScreen } from "./screen-historical.ts";
import type { ScreenRow } from "../screener/screen.ts";

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "Research", "00-Workspace", "08-Backtest");
const DEFAULT_END = "2026-08-28";

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

/** TopN 组合：GREEN 优先按综合分，不足用 YELLOW 补齐；单行业 ≤ maxPerIndustry（行业缺失不占配额） */
function buildPortfolio(
  screener: { pools: Record<"star" | "watch" | "exclude" | "loss", ScreenRow[]> },
  topN: number,
  maxPerIndustry: number,
): ScreenRow[] {
  const cands = [...screener.pools.star, ...screener.pools.watch].sort(
    (a, b) => b.overallScore - a.overallScore,
  );
  const picks: ScreenRow[] = [];
  const indCount = new Map<string, number>();
  for (const c of cands) {
    const key = c.industry?.trim() || null;
    if (key && (indCount.get(key) ?? 0) >= maxPerIndustry) continue;
    picks.push(c);
    if (key) indCount.set(key, (indCount.get(key) ?? 0) + 1);
    if (picks.length >= topN) break;
  }
  return picks;
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

async function computeReturns(
  db: MarketDb,
  tradingDates: string[],
  holdings: { period: string; picks: { thscode: string }[] }[],
  benchmarkCode: string,
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
}> {
  // 预取全部持仓股票后复权序列
  const codes = new Set<string>();
  for (const h of holdings) for (const p of h.picks) codes.add(p.thscode);
  const adjMap = new Map<string, { dates: string[]; values: number[] }>();
  for (const code of codes) {
    const s = await db.getAdjSeries(code);
    adjMap.set(code, { dates: s.map((x) => x.date), values: s.map((x) => x.adjClose) });
  }

  // 基准：同花顺指数历史日K（沪深300，指数无复权）
  let benchMap = new Map<string, number>();
  const startMs = Date.parse(`${tradingDates[0]}T00:00:00+08:00`) - 86400000;
  const endMs = Date.parse(`${tradingDates[tradingDates.length - 1]}T00:00:00+08:00`) + 86400000;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const kb = await getIndexKline(benchmarkCode, startMs, endMs);
      // date_ms 为 Asia/Shanghai 零点，+8h 后取 UTC 日期即本地日期
      benchMap = new Map(kb.map((x) => [new Date(x.date_ms + 8 * 3600000).toISOString().slice(0, 10), x.close_price]));
      break;
    } catch (e) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      else console.error(`[基准] ${benchmarkCode} 拉取失败：${e}`);
    }
  }

  // 每期执行日（asof 下一交易日）
  const execDates = holdings.map((h) => nextTradeDate(tradingDates, h.period));

  const dates = tradingDates;
  const n = dates.length;
  const portfolio = new Array<number>(n);
  const benchmark = new Array<number>(n);
  portfolio[0] = 1;
  benchmark[0] = 1;

  let prevBench = benchMap.get(dates[0]) ?? null;
  for (let i = 1; i < n; i++) {
    const t = dates[i]!;
    const tp = dates[i - 1]!;

    // 当前持仓期：execDates 中最后一个 ≤ t 的期
    let k = -1;
    for (let j = 0; j < execDates.length; j++) if (execDates[j] && execDates[j]! <= t) k = j;

    // 组合日收益（等权）
    let r = 0;
    if (k >= 0) {
      const picks = holdings[k]!.picks;
      const rs: number[] = [];
      for (const p of picks) {
        const s = adjMap.get(p.thscode);
        if (!s) continue;
        const a0 = valueAt(s.dates, s.values, tp);
        const a1 = valueAt(s.dates, s.values, t);
        if (a0 && a1 && a0 > 0) rs.push(a1 / a0 - 1);
      }
      if (rs.length > 0) r = rs.reduce((a, b) => a + b, 0) / rs.length;
    }
    portfolio[i] = portfolio[i - 1]! * (1 + r);

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

  // ===== 每期筛查 → 持仓（runHistoricalScreen 自管 market-db 连接，避免 Windows 文件锁冲突） =====
  const holdings: {
    period: string;
    report: string;
    nextPeriod: string | null;
    turnoverPct: number;
    weights: { thscode: string; name: string; industry: string | null; weight: number; score: number; pool: "明星池" | "观察池" }[];
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
    const picks = buildPortfolio(screener, 10, 4);
    console.log(`  → 持仓 ${picks.length} 只（GREEN ${picks.filter((p) => p.verdict === "GREEN").length}）`);
    picks.forEach((p, i) => console.log(`    ${i + 1}. ${p.name} ${p.thscode} ${p.industry ?? ""} 分 ${p.overallScore.toFixed(1)} PE ${p.peTtm?.toFixed(1) ?? "—"}`));
    holdings.push({
      period: asof,
      report,
      nextPeriod: null,
      turnoverPct: 0,
      weights: picks.map((p) => ({
        thscode: p.thscode,
        name: p.name,
        industry: p.industry,
        weight: +(100 / Math.max(picks.length, 1)).toFixed(1),
        score: p.overallScore,
        pool: p.pool === "star" ? "明星池" : "观察池",
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
    const { nav, stats } = await computeReturns(
      db,
      tradingDates,
      holdings.map((h) => ({ period: h.period, picks: h.weights })),
      "000300.SH",
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
        strategy: "基本面筛查 Top10 等权 · 每年 3 次调仓（4月底一季报 / 8月底中报 / 10月底三季报）· 持有至下次调仓",
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
