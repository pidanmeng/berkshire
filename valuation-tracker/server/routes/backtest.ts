/**
 * 回测路由 — GET /api/backtest → 回测结果（净值曲线 + 模拟指数日K + 持仓与调仓明细）
 *
 * 数据源优先级：
 *   1. 真实回测引擎产物 backtest-result.json（.trae/scripts/backtest/backtest.ts）
 *   2. 回退确定性 mock（引擎未跑/文件缺失时页面仍可用）
 * 页面端通过 meta.dataSource === "mock" 展示占位提示。
 */
import { Elysia } from "elysia";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveResearchRoot } from "../lib/research.ts";

function backtestResultFile(): string {
  return join(resolveResearchRoot(), "Research", "00-Workspace", "08-Backtest", "backtest-result.json");
}

// ===== 确定性伪随机：mulberry32 + Box-Muller（保证每次请求数据一致，便于 UI 稳定） =====
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

function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ===== 交易日序列（mock 简化：仅跳过周末，不含节假日；真实引擎用行情库日K） =====
function tradingDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00+08:00`);
  const last = new Date(`${end}T00:00:00+08:00`);
  while (d <= last) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      out.push(d.toISOString().slice(0, 10));
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** 披露截止日（A 股法定）：4/30 一季报、8/31 中报、10/31 三季报 */
function rebalanceDates(startYear: number, endYear: number): string[] {
  const out: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    out.push(`${y}-04-30`, `${y}-08-31`, `${y}-10-31`);
  }
  return out;
}

// ===== mock 样本公司池（真实回测引擎落地后由筛查结果替代） =====
const SAMPLE_COMPANIES: { thscode: string; name: string; industry: string }[] = [
  { thscode: "600519.SH", name: "贵州茅台", industry: "白酒" },
  { thscode: "300750.SZ", name: "宁德时代", industry: "电池" },
  { thscode: "000858.SZ", name: "五粮液", industry: "白酒" },
  { thscode: "000333.SZ", name: "美的集团", industry: "家电" },
  { thscode: "600036.SH", name: "招商银行", industry: "银行" },
  { thscode: "002415.SZ", name: "海康威视", industry: "电子" },
  { thscode: "600900.SH", name: "长江电力", industry: "电力" },
  { thscode: "300760.SZ", name: "迈瑞医疗", industry: "医疗器械" },
  { thscode: "002594.SZ", name: "比亚迪", industry: "汽车" },
  { thscode: "600309.SH", name: "万华化学", industry: "化工" },
  { thscode: "000651.SZ", name: "格力电器", industry: "家电" },
  { thscode: "601318.SH", name: "中国平安", industry: "保险" },
  { thscode: "600276.SH", name: "恒瑞医药", industry: "医药" },
  { thscode: "000568.SZ", name: "泸州老窖", industry: "白酒" },
  { thscode: "002714.SZ", name: "牧原股份", industry: "农林牧渔" },
  { thscode: "601012.SH", name: "隆基绿能", industry: "光伏" },
  { thscode: "600030.SH", name: "中信证券", industry: "券商" },
  { thscode: "603288.SH", name: "海天味业", industry: "食品饮料" },
  { thscode: "600887.SH", name: "伊利股份", industry: "食品饮料" },
  { thscode: "002475.SZ", name: "立讯精密", industry: "电子" },
];

// ===== 统计指标（纯函数，真实引擎复用） =====
function calcStats(
  portfolio: number[],
  benchmark: number[],
): {
  totalReturn: number;
  annualReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  sharpe: number;
  winRate: number;
} {
  const n = portfolio.length;
  const totalReturn = portfolio[n - 1] - 1;
  const benchmarkReturn = benchmark[n - 1] - 1;
  const years = n / 252;
  const annualReturn = years > 0 ? Math.pow(portfolio[n - 1], 1 / years) - 1 : 0;
  const excessReturn = totalReturn - benchmarkReturn;

  // 最大回撤（组合净值）
  let peak = portfolio[0];
  let maxDrawdown = 0;
  for (const v of portfolio) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 夏普：日收益年化（无风险利率按 2%）
  const rfDaily = 0.02 / 252;
  let sum = 0;
  let sumSq = 0;
  let wins = 0;
  for (let i = 1; i < n; i++) {
    const rp = portfolio[i] / portfolio[i - 1] - 1;
    const rb = benchmark[i] / benchmark[i - 1] - 1;
    sum += rp - rfDaily;
    sumSq += (rp - rfDaily) ** 2;
    if (rp > rb) wins++;
  }
  const mean = sum / (n - 1);
  const std = Math.sqrt(sumSq / (n - 1) - mean ** 2);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  const winRate = n > 1 ? wins / (n - 1) : 0;

  return {
    totalReturn,
    annualReturn,
    benchmarkReturn,
    excessReturn,
    maxDrawdown,
    sharpe,
    winRate,
  };
}

export const backtestRoutes = new Elysia({ prefix: "/api" }).get(
  "/backtest",
  () => {
    // ---- 优先返回真实回测结果（引擎产物） ----
    const file = backtestResultFile();
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf-8")) as { meta?: { dataSource?: string } };
        if (data?.meta?.dataSource === "engine") return data;
      } catch {
        // 文件损坏：回退 mock
      }
    }

    // ---- 回退 mock ----
    const rand = mulberry32(20260830);

    // ---- 生成净值序列：组合（高收益低波动）vs 基准（弱趋势高波动）----
    const startDate = "2020-01-02";
    const endDate = "2026-08-28";
    const dates = tradingDates(startDate, endDate);
    const n = dates.length;

    const portfolio = new Array<number>(n);
    const benchmark = new Array<number>(n);
    let pv = 1;
    let bv = 1;
    for (let i = 0; i < n; i++) {
      // 叠加长周期正弦形成行情段落（牛市/震荡），组合漂移更强、波动更小
      const t = i / 252;
      const rp =
        0.00042 +
        0.0115 * gaussian(rand) +
        0.0012 * Math.sin((2 * Math.PI * t) / 2.4) -
        0.0006 * Math.sin((2 * Math.PI * t) / 1.1);
      const rb =
        0.00032 +
        0.012 * gaussian(rand) +
        0.0009 * Math.sin((2 * Math.PI * t) / 3.2) -
        0.0005 * Math.sin((2 * Math.PI * t) / 1.4);
      pv *= 1 + rp;
      bv *= 1 + rb;
      portfolio[i] = pv;
      benchmark[i] = bv;
    }

    // ---- 模拟指数日K：由组合净值构建点位（1000 起点），OHLCV 推导 ----
    let prevClose = 1000;
    const kline = dates.map((d, i) => {
      const r = portfolio[i] / (i === 0 ? 1 : portfolio[i - 1]) - 1;
      const open = prevClose * (1 + 0.3 * r + 0.0008 * (rand() - 0.5));
      const close = prevClose * (1 + r);
      const high = Math.max(open, close) * (1 + 0.0022 * rand());
      const low = Math.min(open, close) * (1 - 0.0022 * rand());
      const volume = Math.round((0.6 + Math.abs(r) * 55) * 1e7 * (0.8 + 0.4 * rand()));
      prevClose = close;
      return {
        date: d,
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume,
      };
    });

    // ---- 持仓与调仓明细：每期从样本池确定性抽样 10 只等权 ----
    const rebals = rebalanceDates(2020, 2026).filter((d) => d <= endDate);
    const holdings: {
      period: string;
      report: string;
      nextPeriod: string | null;
      turnoverPct: number;
      weights: {
        thscode: string;
        name: string;
        industry: string;
        weight: number;
        score: number;
        pool: "明星池" | "观察池";
      }[];
    }[] = [];
    let prevCodes = new Set<string>();
    for (let i = 0; i < rebals.length; i++) {
      // 确定性洗牌抽样
      const pool = [...SAMPLE_COMPANIES];
      for (let j = pool.length - 1; j > 0; j--) {
        const k = Math.floor(rand() * (j + 1));
        [pool[j], pool[k]] = [pool[k]!, pool[j]!];
      }
      const picks = pool.slice(0, 10);
      const codes = new Set(picks.map((p) => p.thscode));
      const kept = [...codes].filter((c) => prevCodes.has(c)).length;
      const turnoverPct = i === 0 ? 100 : Math.round((1 - kept / 10) * 100);
      prevCodes = codes;

      const date = new Date(`${rebals[i]}T00:00:00+08:00`);
      const y = date.getFullYear();
      const period = `${y}-${i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3}`;
      holdings.push({
        period: rebals[i]!,
        report: period,
        nextPeriod: i + 1 < rebals.length ? rebals[i + 1]! : null,
        turnoverPct,
        weights: picks.map((p, idx) => ({
          thscode: p.thscode,
          name: p.name,
          industry: p.industry,
          weight: +(100 / 10).toFixed(1),
          score: +(6.5 + rand() * 2.5).toFixed(1),
          pool: rand() < 0.75 ? "明星池" : "观察池",
        })),
      });
    }

    // ---- 汇总统计 ----
    const stats = {
      periods: holdings.length,
      avgTurnover: Math.round(
        holdings.reduce((s, h) => s + h.turnoverPct, 0) / holdings.length,
      ),
      ...calcStats(portfolio, benchmark),
    };

    return {
      meta: {
        name: "基本面精选指数",
        strategy:
          "基本面筛查 Top10 等权 · 每年 3 次调仓（4月底一季报 / 8月底中报 / 10月底三季报）· 持有至下次调仓",
        benchmark: "沪深300",
        startDate,
        endDate,
        rebalanceDates: rebals,
        dataSource: "mock",
      },
      nav: {
        dates,
        portfolio: portfolio.map((v) => +v.toFixed(4)),
        benchmark: benchmark.map((v) => +v.toFixed(4)),
      },
      kline,
      stats,
      holdings,
    };
  },
  { detail: { tags: ["backtest"] } },
);
