/**
 * 市场历史行情本地库 — 回测数据层（方案 Step 1）
 *
 * 能力：
 *  - 下载：同花顺 dump 端点（全市场 10 年日K + 复权因子，Parquet）
 *  - 入库：DuckDB（@duckdb/node-api）持久化库，未复权日K全量 + 复权事件
 *  - 查询：任意交易日收盘价、后复权序列（分红再投资口径）、交易日历
 *
 * CLI：
 *   bun run .trae/scripts/backtest/market-db.ts --download   下载日K + 复权因子 Parquet
 *   bun run .trae/scripts/backtest/market-db.ts --build      建 DuckDB 库（读 Parquet → daily_k / adj_event）
 *   bun run .trae/scripts/backtest/market-db.ts --status     库状态（行数/日期范围/最新交易日）
 *   bun run .trae/scripts/backtest/market-db.ts --check <code> [date]  抽查收盘价（默认最新）
 *
 * 后复权算法（A 股标准，仅按需对个别股票计算）：
 *   事件因子 r = (prev_close − DPS + 配股比×配股价) / ((1+送股比+配股比) × prev_close)
 *   factor(t) = Π r_e（对所有除权日 > t 的事件累乘），adj_close(t) = close(t) × factor(t)
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ==================== 常量与路径 ====================

const BASE = "https://fuyao.aicubes.cn";
const API_KEY =
  process.env.HITHINK_FINANCE_API_KEY ||
  process.env.HITHINK_API_KEY ||
  process.env.FUYAO_TOKEN ||
  "sk-fuyao-yY4oeatOr3CHqzznKEPHBCObUaxJyZan";

const ROOT = join(import.meta.dir, "../../..");
const DEFAULT_MARKET_DIR = join(ROOT, "Research/00-Workspace/08-Backtest/market");
const DB_PATH = join(DEFAULT_MARKET_DIR, "market.duckdb");

const DUMP_ENDPOINTS = [
  { kind: "daily-k", path: "/api/dump/market-dumps/daily-k/download-url", file: "daily-k.parquet" },
  { kind: "adjustment-factors", path: "/api/dump/market-dumps/adjustment-factors/download-url", file: "adjustment-factors.parquet" },
] as const;

// ==================== 下载 ====================

async function signedUrl(kind: "daily-k" | "adjustment-factors"): Promise<string> {
  const ep = DUMP_ENDPOINTS.find((e) => e.kind === kind)!;
  const res = await fetch(`${BASE}${ep.path}`, { headers: { "X-api-key": API_KEY } });
  if (!res.ok) throw new Error(`签名端点 HTTP ${res.status}（${kind}）`);
  const data = (await res.json()) as { code: number; message: string; data: { presigned_url: string } | null };
  if (data.code !== 0 || !data.data?.presigned_url) throw new Error(`签名失败：${data.message}`);
  return data.data.presigned_url;
}

async function download(kind: "daily-k" | "adjustment-factors", dir: string): Promise<string> {
  const ep = DUMP_ENDPOINTS.find((e) => e.kind === kind)!;
  const url = await signedUrl(kind);
  const out = join(dir, ep.file);
  console.log(`[download] ${kind} → ${out}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载 HTTP ${res.status}（${kind}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  await Bun.write(out, buf);
  console.log(`[download] ${kind} 完成：${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);
  return out;
}

// ==================== 建库 ====================

async function buildDb(dir: string, dbPath: string) {
  if (!existsSync(join(dir, "daily-k.parquet")) || !existsSync(join(dir, "adjustment-factors.parquet"))) {
    throw new Error("缺少 Parquet 文件，先运行 --download");
  }
  const db = await DuckDBInstance.create(dbPath);
  const conn = await db.connect();
  try {
    console.log("[build] 导入日K（全市场 10 年，未复权）...");
    await conn.run(`
      CREATE TABLE IF NOT EXISTS daily_k AS
      SELECT thscode,
             (to_timestamp(date_ms / 1000))::DATE AS date,
             open_price, high_price, low_price, close_price, volume, turnover
      FROM read_parquet('${join(dir, "daily-k.parquet").replace(/\\/g, "/")}')
    `);
    await conn.run(`CREATE INDEX IF NOT EXISTS idx_daily_code_date ON daily_k(thscode, date)`);

    console.log("[build] 导入复权事件...");
    await conn.run(`
      CREATE TABLE IF NOT EXISTS adj_event AS
      SELECT thscode, ticker,
             (to_timestamp(ex_date_ms / 1000))::DATE AS ex_date,
             dividend_per_share, per_share_bonus, allotment_ratio, allotment_price
      FROM read_parquet('${join(dir, "adjustment-factors.parquet").replace(/\\/g, "/")}')
    `);
    await conn.run(`CREATE INDEX IF NOT EXISTS idx_event_code_date ON adj_event(thscode, ex_date)`);

    const [k, e, t] = await Promise.all([
      conn.runAndReadAll(`SELECT count(*) c, count(DISTINCT thscode) s, min(date) lo, max(date) hi FROM daily_k`),
      conn.runAndReadAll(`SELECT count(*) c FROM adj_event`),
      conn.runAndReadAll(`SELECT DISTINCT date FROM daily_k ORDER BY date`),
    ]);
    const krow = k.getRowObjects()[0];
    console.log(`[build] 日K ${krow.c} 行 / ${krow.s} 只 / ${krow.lo} ~ ${krow.hi}`);
    console.log(`[build] 复权事件 ${e.getRowObjects()[0].c} 行`);
    console.log(`[build] 交易日 ${t.getRowObjects().length} 天`);
    console.log(`[build] 完成 → ${dbPath}`);
  } finally {
    conn.disconnectSync();
    db.closeSync();
  }
}

// ==================== 查询层（供 point-in-time / backtest import） ====================

export interface MarketDb {
  close(): Promise<void>;
  /** 未复权收盘价（某日，无交易则取该日前最近交易日） */
  getClose(thscode: string, date: string): Promise<number | null>;
  /** 最近交易日（≤ date） */
  getLastTradeDateBefore(date: string): Promise<string | null>;
  /** 全市场交易日（升序） */
  getTradingDates(): Promise<string[]>;
  /** 某股票全量日K（date, close 升序） */
  getDailyRange(thscode: string): Promise<{ date: string; close: number }[]>;
  /** 后复权收盘价（分红再投资口径） */
  getAdjClose(thscode: string, date: string): Promise<number | null>;
  /** 后复权序列（date, adjClose 升序） */
  getAdjSeries(thscode: string): Promise<{ date: string; adjClose: number }[]>;
  /** 批量：指定日期（≤ date 最近交易日）全市场未复权收盘价 → Map<thscode, close> */
  getClosesOnDate(date: string): Promise<Map<string, number>>;
  /** 批量：全市场股本回推因子（date 之后送转/配股累计放大）→ Map<thscode, factor> */
  getShareFactors(date: string): Promise<Map<string, number>>;
  /** 股本回推因子：date 之后送转/配股引起的股本累计放大倍数（除权事件回推）
   *  history_shares(t) = 当前股本 ÷ factor(t)，factor(t) = Π(1 + bonus + allotment) for ex_date > t
   */
  getShareFactor(thscode: string, date: string): Promise<number>;
}

export async function openMarketDb(dbPath: string = DB_PATH): Promise<MarketDb> {
  if (!existsSync(dbPath)) throw new Error(`市场库不存在：${dbPath}，先运行 market-db.ts --download && --build`);
  const db = await DuckDBInstance.create(dbPath);
  const conn = await db.connect();

  async function q1<T>(sql: string): Promise<T | null> {
    const r = await conn.runAndReadAll(sql);
    const rows = r.getRowObjects();
    if (rows.length === 0) return null;
    const v = rows[0] as Record<string, unknown>;
    const key = Object.keys(v)[0];
    return (v[key] ?? null) as T;
  }

  return {
    async close() {
      conn.disconnectSync();
      db.closeSync();
    },
    async getClose(thscode, date) {
      const v = await q1<number>(
        `SELECT close_price FROM daily_k WHERE thscode = '${thscode}' AND date <= DATE '${date}' ORDER BY date DESC LIMIT 1`,
      );
      return v ?? null;
    },
    async getLastTradeDateBefore(date) {
      return q1<string>(`SELECT max(date)::VARCHAR FROM daily_k WHERE date <= DATE '${date}'`);
    },
    async getTradingDates() {
      const r = await conn.runAndReadAll(`SELECT DISTINCT date::VARCHAR AS date FROM daily_k ORDER BY date`);
      return r.getRowObjects().map((o) => (o as { date: unknown }).date as string);
    },
    async getDailyRange(thscode) {
      const r = await conn.runAndReadAll(
        `SELECT date::VARCHAR date, close_price FROM daily_k WHERE thscode = '${thscode}' ORDER BY date`,
      );
      return r.getRowObjects().map((o) => {
        const x = o as { date: string; close_price: number };
        return { date: x.date, close: x.close_price };
      });
    },
    async getAdjClose(thscode, date) {
      const series = await getAdjSeries(conn, thscode);
      const target = date;
      // 找 ≤ target 的最近交易日
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i]!.date <= target) return series[i]!.adjClose;
      }
      return null;
    },
    async getAdjSeries(thscode) {
      return getAdjSeries(conn, thscode);
    },
    async getShareFactor(thscode, date) {
      const v = await q1<number>(
        `SELECT exp(sum(ln(1 + per_share_bonus + allotment_ratio)))
         FROM adj_event
         WHERE thscode = '${thscode}' AND ex_date > DATE '${date}'`,
      );
      return v && Number.isFinite(v) ? v : 1;
    },
    async getClosesOnDate(date) {
      const r = await conn.runAndReadAll(
        `SELECT thscode, close_price FROM (
           SELECT thscode, close_price,
                  row_number() OVER (PARTITION BY thscode ORDER BY date DESC) rn
           FROM daily_k WHERE date <= DATE '${date}'
         ) WHERE rn = 1`,
      );
      const out = new Map<string, number>();
      for (const o of r.getRowObjects()) {
        const x = o as { thscode: string; close_price: number };
        out.set(x.thscode, x.close_price);
      }
      return out;
    },
    async getShareFactors(date) {
      const r = await conn.runAndReadAll(
        `SELECT thscode, exp(sum(ln(1 + per_share_bonus + allotment_ratio))) factor
         FROM adj_event WHERE ex_date > DATE '${date}' GROUP BY thscode`,
      );
      const out = new Map<string, number>();
      for (const o of r.getRowObjects()) {
        const x = o as { thscode: string; factor: number };
        out.set(x.thscode, x.factor ?? 1);
      }
      return out;
    },
  };
}

/** 后复权序列：未复权日K × 日频累计复权因子（因子锚定最新交易日 = 1） */
async function getAdjSeries(
  conn: DuckDBConnection,
  thscode: string,
): Promise<{ date: string; adjClose: number }[]> {
  const [pr, er] = await Promise.all([
    conn.runAndReadAll(
      `SELECT date::VARCHAR date, close_price FROM daily_k WHERE thscode = '${thscode}' ORDER BY date`,
    ),
    conn.runAndReadAll(
      `SELECT ex_date::VARCHAR ex_date, dividend_per_share, per_share_bonus, allotment_ratio, allotment_price
       FROM adj_event WHERE thscode = '${thscode}' ORDER BY ex_date`,
    ),
  ]);
  const prices = pr.getRowObjects().map((o) => {
    const x = o as { date: string; close_price: number };
    return { date: x.date, close: x.close_price };
  });
  const events = er.getRowObjects().map((o) => {
    const x = o as {
      ex_date: string;
      dividend_per_share: number;
      per_share_bonus: number;
      allotment_ratio: number;
      allotment_price: number;
    };
    return {
      exDate: x.ex_date,
      dps: x.dividend_per_share ?? 0,
      bonus: x.per_share_bonus ?? 0,
      allot: x.allotment_ratio ?? 0,
      allotPrice: x.allotment_price ?? 0,
    };
  });
  if (prices.length === 0) return [];

  // 每个事件的除权前一日收盘价（二分查找 ≤ ex_date-1 的最近交易日）
  const exDates = events.map((e) => e.exDate);
  const ratios: number[] = events.map(() => 1);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    // 找 < ex_date 的最近交易日
    let lo = 0;
    let hi = prices.length - 1;
    let prevClose: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (prices[mid]!.date < ev.exDate) {
        prevClose = prices[mid]!.close;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prevClose && prevClose > 0) {
      // 后复权放大因子 = 除权前每股价值当量 / 除权后每股价值 = (1+B+A)×P_prev / (P_prev − DPS + A×AP)
      const denom = prevClose - ev.dps + ev.allot * ev.allotPrice;
      ratios[i] = denom > 0 ? ((1 + ev.bonus + ev.allot) * prevClose) / denom : 1;
    }
  }

  // 日频累计因子：factor(t) = Π{ex_date > t} ratio
  const adj = new Array<{ date: string; adjClose: number }>(prices.length);
  let factor = 1;
  let ei = events.length - 1;
  for (let i = prices.length - 1; i >= 0; i--) {
    while (ei >= 0 && events[ei]!.exDate > prices[i]!.date) {
      factor *= ratios[ei]!;
      ei--;
    }
    adj[i] = { date: prices[i]!.date, adjClose: +(prices[i]!.close * factor).toFixed(4) };
  }
  return adj;
}

// ==================== CLI ====================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const dir = DEFAULT_MARKET_DIR;
  mkdirSync(dir, { recursive: true });

  if (cmd === "--download") {
    const kind = args[1] as "daily-k" | "adjustment-factors" | undefined;
    if (kind && !DUMP_ENDPOINTS.some((e) => e.kind === kind)) {
      console.error(`未知数据类：${kind}`);
      process.exit(1);
    }
    if (kind) await download(kind, dir);
    else {
      await download("daily-k", dir);
      await download("adjustment-factors", dir);
    }
    return;
  }
  if (cmd === "--build") {
    await buildDb(dir, DB_PATH);
    return;
  }
  if (cmd === "--status") {
    if (!existsSync(DB_PATH)) {
      console.log("市场库尚未构建");
      return;
    }
    const mdb = await openMarketDb(DB_PATH);
    const tradingDates = await mdb.getTradingDates();
    console.log(`交易日 ${tradingDates.length} 天：${tradingDates[0]} ~ ${tradingDates[tradingDates.length - 1]}`);
    const last = tradingDates[tradingDates.length - 1];
    const mtx = await mdb.getClose("600519.SH", last!);
    console.log(`抽查 600519 最新交易日 ${last} 收盘：${mtx}`);
    await mdb.close();
    return;
  }
  if (cmd === "--check") {
    const code = (args[1] ?? "600519.SH").toUpperCase();
    const date = args[2];
    const mdb = await openMarketDb(DB_PATH);
    const close = await mdb.getClose(code, date ?? "9999-12-31");
    const lastDate = await mdb.getLastTradeDateBefore(date ?? "9999-12-31");
    const adj = await mdb.getAdjClose(code, date ?? "9999-12-31");
    console.log(`${code} 收盘 ${close}（未复权，${lastDate}） 后复权 ${adj}`);
    await mdb.close();
    return;
  }
  console.log(`用法：
  --download                    下载日K + 复权因子 Parquet
  --build                       建 DuckDB 库
  --status                      库状态
  --check <code> [date]         抽查收盘价`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
