#!/usr/bin/env bun
/**
 * 历史时点筛查 — 回测筛查层（方案 Step 3）
 *
 * 在任意调仓日回放全市场基本面筛查，严格 point-in-time（无未来函数）：
 *   - 财务指标：indicators 指定报告期（YYYY-N，可回溯）
 *   - 历史 PE：调仓日收盘价 ÷ TTM EPS（利润表区间模式，累计差分单季求和）
 *   - 历史市值：调仓日收盘价 × 当前股本 ÷ 送转配股回推因子
 *   - 当前股本快照（getMarketCapWithFallback）仅提供股本基数，不参与估值时点
 *
 * 输出：Research/00-Workspace/08-Backtest/<asof>-screener.json（回测引擎组合构建输入）
 *
 * 用法：
 *   bun run .trae/scripts/backtest/screen-historical.ts --asof 2024-04-30 --report 2024-1
 *      [--prev-report 2023-4] [--min-mcap 10] [--smoke 20] [--codes 600519.SH,...]
 */
import { parseArgs } from "util";
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getAllAShareTickers,
  getMarketCapWithFallback,
  getMarketCapFromEastmoney,
  getIndustryMapFromClist,
  getIndicatorsRaw,
  getIncomeStatements,
} from "../hithink/hithink.ts";
import { screenCompany, type CompanyMetrics } from "../quality-gate/quality-screen.ts";
import { openMarketDb } from "./market-db.ts";
import { ttmEpsFromStatements, reportEndMs, reportEndDate } from "./point-in-time.ts";
import type { FullRow, ScreenRow, Pool } from "../screener/screen.ts";
import { parseIndicatorsYear, assignPool } from "../screener/screen.ts";

// ==================== 常量 ====================

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "Research", "00-Workspace", "08-Backtest");
const CACHE_DIR = join(OUT_DIR, "cache");
const INDUSTRY_CACHE_FILE = join(CACHE_DIR, "industry-map.json");
const INDUSTRY_CACHE_TTL = 7 * 86400000; // 行业分类相对稳定，缓存 7 天
const CHUNK = 100;
const RETRY = 3;
const ST_RE = /ST|退/;

const poolLabel = (p: Pool) => (p === "star" ? "明星池" : p === "watch" ? "观察池" : p === "loss" ? "亏损池" : "排除池");

// ==================== 并发执行器（带重试） ====================

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  retries = 0,
  progress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i];
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          results[i] = await fn(item);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      if (lastErr !== undefined) throw lastErr;
      done++;
      progress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

// ==================== 缓存 ====================

interface CacheRow {
  thscode: string;
  raw: Record<string, Record<string, string | null>>;
  prevRaw: Record<string, Record<string, string | null>> | null;
  ttmEps: number | null;
}

/** 行业映射缓存：避免每期回测都重新拉取全市场行业（5 市场 × 多页 × 3 重试）
 *  命中且 < TTL → 直接用；否则重新拉取并写入 */
async function getIndustryMapCached(): Promise<Map<string, string>> {
  try {
    if (existsSync(INDUSTRY_CACHE_FILE)) {
      const st = (await import("node:fs")).statSync(INDUSTRY_CACHE_FILE);
      if (Date.now() - st.mtimeMs < INDUSTRY_CACHE_TTL) {
        const obj = JSON.parse(readFileSync(INDUSTRY_CACHE_FILE, "utf-8")) as Record<string, string>;
        const m = new Map<string, string>();
        for (const [k, v] of Object.entries(obj)) if (v) m.set(k, v);
        console.log(`  行业映射缓存命中 ${m.size} 条（${new Date(st.mtimeMs).toLocaleDateString("zh-CN")}）`);
        return m;
      }
    }
  } catch {
    /* 缓存损坏 → 重新拉取 */
  }
  const fresh = await getIndustryMapFromClist();
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of fresh) obj[k] = v;
    writeFileSync(INDUSTRY_CACHE_FILE, JSON.stringify(obj), "utf-8");
  } catch {
    /* 缓存写入失败 → 不影响主流程 */
  }
  return fresh;
}

function loadCache(file: string): Map<string, CacheRow> {
  const map = new Map<string, CacheRow>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as CacheRow;
      if (o?.thscode) map.set(o.thscode, o);
    } catch {
      // 跳过损坏行
    }
  }
  return map;
}

function appendCache(file: string, row: CacheRow) {
  appendFileSync(file, JSON.stringify(row) + "\n", "utf-8");
}

// ==================== 主流程 ====================

export interface HistoricalScreenOpts {
  asof: string; // 调仓日 YYYY-MM-DD
  report: string; // 最新可披露报告期 YYYY-N
  prevReport?: string; // 上期报告期（默认上一年年报 YYYY-1-4）
  minMcapYi?: number;
  smoke?: number | null;
  codes?: string[];
  concurrency?: number;
}

export async function runHistoricalScreen(opts: HistoricalScreenOpts): Promise<ScreenerOutput> {
  const asof = opts.asof;
  const report = opts.report;
  const [ry] = report.split("-").map(Number);
  const prevReport = opts.prevReport ?? `${ry - 1}-4`;
  const minMcapYi = opts.minMcapYi ?? 10;
  const smoke = opts.smoke ?? null;
  const codes = opts.codes ?? [];
  const concurrency = opts.concurrency ?? 8;

  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `historical-${report}_${prevReport}.jsonl`);
  const cache = loadCache(cacheFile);

  const db = await openMarketDb();
  const endMs = reportEndMs(report);

  try {
    // ===== Stage A：代码表 + 股本快照 + 历史市值 =====
    console.log(`[Stage A] ${asof} 全市场（报告期 ${report}，上期 ${prevReport}）...`);
    const tickers = await getAllAShareTickers();
    console.log(`  代码表 ${tickers.length} 家`);

    // 股本快照（当前时点，仅提供股本基数：市值 ÷ 现价；跨期复用，每日刷新一次）
    const SNAPSHOT_FILE = join(CACHE_DIR, "equity-snapshot.json");
    const loadSnapshot = (): { fetchedAt: number; items: { thscode: string; price: number | null; shares: number | null; industry: string | null }[] } | null => {
      if (!existsSync(SNAPSHOT_FILE)) return null;
      try {
        return JSON.parse(readFileSync(SNAPSHOT_FILE, "utf-8"));
      } catch {
        return null;
      }
    };
    let snapshot = loadSnapshot();
    if (!snapshot || Date.now() - snapshot.fetchedAt > 86400000) {
      console.log(`  股本快照刷新（全市场 ${tickers.length} 家）...`);
      // 行业字段：10jqka 主源无 f100；东财 push2 ulist 在 bun 下被拒。
      // 改用东财 clist 端点批量拉全市场行业映射 → Map<thscode, industry>
      // P0 修复：东财 push2 在当前网络间歇性 TLS 握手失败（bun fetch/powershell/curl 均受影响）。
      //   进程内 getIndustryMapFromClist 带 3 次重试，能拿到部分行业（~2000-5000 条）。
      //   行业映射不完整时，buildPortfolio 降级：无行业不占配额 + 上限 3 只（确保能选出 10 只）。
      console.log(`  clist 拉全市场行业（f100，5 个市场分页，3 次重试）...`);
      const industryMap = await getIndustryMapCached();
      console.log(`  行业映射 ${industryMap.size} 条${industryMap.size < 4000 ? '（不完整，buildPortfolio 将降级）' : ''}`);
      const emChunks: string[][] = [];
      for (let i = 0; i < tickers.length; i += CHUNK) emChunks.push(tickers.slice(i, i + CHUNK).map((t) => t.thscode));
      const emResults = await mapWithConcurrency(emChunks, 4, (codes) => getMarketCapWithFallback(codes), 1);
      const items: { thscode: string; price: number | null; shares: number | null; industry: string | null }[] = [];
      for (const m of emResults.flat()) {
        items.push({
          thscode: m.thscode,
          price: m.price,
          shares: m.price ? (m.market_cap ?? 0) / m.price : null,
          industry: industryMap.get(m.thscode) ?? null,
        });
      }
      snapshot = { fetchedAt: Date.now(), items };
      writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot), "utf-8");
    }
    const mcapMap = new Map(snapshot.items.map((i) => [i.thscode, { price: i.price, shares: i.shares, industry: i.industry }]));
    console.log(`  股本快照 ${mcapMap.size} 家（缓存 ${new Date(snapshot.fetchedAt).toLocaleTimeString("zh-CN", { hour12: false })}）`);

    // 历史收盘价 + 股本回推因子（本地批量）
    const [closes, factors] = await Promise.all([db.getClosesOnDate(asof), db.getShareFactors(asof)]);
    console.log(`  历史收盘价覆盖 ${closes.size} 只（全市场 ${tickers.length}）`);

    // 组装 FullRow + 硬过滤（ST、市值<minMcap；历史 PE 在 Stage B 产出）
    const rows: FullRow[] = [];
    const excludedStageA: { row: FullRow; reason: string }[] = [];
    for (const t of tickers) {
      const m = mcapMap.get(t.thscode);
      const close = closes.get(t.thscode);
      const factor = factors.get(t.thscode) ?? 1;
      const shares = m?.shares ?? null;
      const marketCapYi = close !== null && close !== undefined && shares ? (close * shares) / factor / 1e8 : null;
      const row: FullRow = {
        thscode: t.thscode,
        ticker: t.ticker,
        name: t.name,
        exchange: t.exchange ?? "",
        price: close ?? null,
        changePct: null,
        marketCapYi,
        peTtm: null,
        pbMrq: null,
        industry: m?.industry ?? null,
      };
      if (ST_RE.test(t.name.toUpperCase())) {
        excludedStageA.push({ row, reason: "ST/退市风险标识" });
        continue;
      }
      if (close === null || close === undefined) {
        excludedStageA.push({ row, reason: "无历史行情（当时未上市/停牌）" });
        continue;
      }
      if (marketCapYi !== null && marketCapYi < minMcapYi) {
        excludedStageA.push({ row, reason: `市值<${minMcapYi}亿微盘` });
        continue;
      }
      rows.push(row);
    }

    let main = rows;
    if (codes.length > 0) {
      const set = new Set(codes);
      main = main.filter((r) => set.has(r.thscode));
    }
    if (smoke !== null) main = main.slice(0, smoke);
    console.log(`  主池 ${main.length}（排除 ${excludedStageA.length}）`);

    // ===== Stage B：逐只财务指标 + TTM EPS + 历史 PE（JSONL 断点续跑，单只失败跳过） =====
    console.log(`[Stage B] 财务指标 + TTM（缓存 ${cache.size}，待取 ${main.filter((r) => !cache.has(r.thscode)).length}）...`);
    const pending = main.filter((r) => !cache.has(r.thscode));
    const failedFile = cacheFile.replace(/\.jsonl$/, ".failed.jsonl");
    const failedSet = new Set(
      existsSync(failedFile)
        ? readFileSync(failedFile, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean)
        : [],
    );
    const stillPending = pending.filter((r) => !failedSet.has(r.thscode));
    const range = { start: endMs - 480 * 86400000, end: endMs + 86400000 };
    let newFailed = 0;
    await mapWithConcurrency(
      stillPending,
      concurrency,
      async (r) => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= RETRY; attempt++) {
          try {
            const [raw, prevRaw, inc] = await Promise.all([
              getIndicatorsRaw(r.thscode, report),
              getIndicatorsRaw(r.thscode, prevReport),
              getIncomeStatements(r.thscode, "quarterly", 12, range),
            ]);
            const ttm = ttmEpsFromStatements(inc, report);
            const row: CacheRow = { thscode: r.thscode, raw, prevRaw, ttmEps: ttm.ttmEps };
            cache.set(r.thscode, row);
            appendCache(cacheFile, row);
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < RETRY) await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          }
        }
        if (lastErr !== undefined) {
          // 单只数据源不可用（未上市/数据缺失/上游故障）：跳过不中断，计入 dataFailed
          failedSet.add(r.thscode);
          appendFileSync(failedFile, r.thscode + "\n", "utf-8");
          newFailed++;
        }
      },
      0,
      (done, total) => {
        if (done % 500 === 0 || done === total) console.log(`    进度 ${done}/${total}（失败 ${newFailed}）`);
      },
    );
    if (newFailed > 0) console.log(`  本次失败 ${newFailed} 只（历史失败 ${failedSet.size - newFailed}）`);

    // ===== Stage C：评分 + 分池 =====
    console.log(`[Stage C] 评分分池...`);
    const scored: (ScreenRow & { dataFailed?: string })[] = [];
    let dataFailed = 0;
    for (const r of main) {
      const c = cache.get(r.thscode);
      if (!c) {
        dataFailed++;
        continue;
      }
      const cur = parseIndicatorsYear(c.raw);
      const prev = c.prevRaw ? parseIndicatorsYear(c.prevRaw) : undefined;
      const close = r.price;
      const peTtm = c.ttmEps && c.ttmEps > 0 && close ? close / c.ttmEps : null;
      // 季节性修正：季报累计 ROE 年化（×4/q）后按年报阈值评分；OCF/NI 用上年年报（避免 Q1 现金流季节失真）
      const q = Number(report.split("-")[1]) || 4;
      const roeAdj = cur.roe !== null && q < 4 ? cur.roe * (4 / q) : cur.roe;
      const ocfToNiAdj = prev?.ocfToNi ?? cur.ocfToNi;
      // 历史 PB 仅展示且需资产负债表（增请求量），回测不拉取 → 置空
      const pbMrq = null;

      const metrics: CompanyMetrics = {
        name: r.name,
        code: r.ticker,
        roe: roeAdj,
        grossMargin: cur.grossMargin,
        netMargin: cur.netMargin,
        ocfToNi: ocfToNiAdj,
        debtRatio: cur.debtRatio,
        peTtm,
        revenueGrowth: cur.revenueYoy,
        earningsGrowth: cur.netProfitYoy,
      };
      const s = screenCompany(metrics);
      const base: ScreenRow = {
        thscode: r.thscode,
        ticker: r.ticker,
        name: r.name,
        industry: r.industry,
        price: r.price,
        changePct: null,
        marketCapYi: r.marketCapYi,
        peTtm,
        pbMrq,
        roe: cur.roe,
        grossMargin: cur.grossMargin,
        netMargin: cur.netMargin,
        ocfToNi: cur.ocfToNi,
        debtRatio: cur.debtRatio,
        revenueYoy: cur.revenueYoy,
        netProfitYoy: cur.netProfitYoy,
        roePrev: prev?.roe ?? null,
        overallScore: s.overallScore,
        verdict: s.verdict,
        redFlags: s.redFlags,
        yellowFlags: s.yellowFlags,
        greenHighlights: s.greenHighlights,
        pool: "watch" as Pool,
        highLeverageNote: false,
      };
      const ap = assignPool(base);
      scored.push({ ...base, pool: ap.pool, reason: ap.reason, dataFailed: ap.dataFailed });
    }

    // ===== 输出 =====
    const pools: Record<Pool, ScreenRow[]> = { star: [], watch: [], exclude: [], loss: [] };
    for (const s of scored) pools[s.pool]!.push(s);
    for (const k of Object.keys(pools) as Pool[]) pools[k]!.sort((a, b) => b.overallScore - a.overallScore);

    const meta = {
      generatedAt: new Date().toISOString(),
      asOf: asof,
      report,
      prevReport,
      reportEnd: reportEndDate(report),
      config: { minMcapYi, excludeSt: true, concurrency },
      counts: {
        universe: tickers.length,
        main: main.length,
        loss: pools.loss.length,
        excludedStageA: excludedStageA.length,
        star: pools.star.length,
        watch: pools.watch.length,
        exclude: pools.exclude.length,
        dataFailed,
      },
    };
    const output = { meta, pools };
    writeFileSync(join(OUT_DIR, `${asof}-screener.json`), JSON.stringify(output, null, 2), "utf-8");

    // CSV
    const header = "thscode,name,industry,price,marketCapYi,peTtm,pbMrq,roe,grossMargin,netMargin,ocfToNi,debtRatio,revenueYoy,netProfitYoy,roePrev,overallScore,verdict,pool,redFlags";
    const csvLines = [header];
    for (const s of scored) {
      csvLines.push(
        [s.thscode, s.name, s.industry ?? "", s.price ?? "", s.marketCapYi ?? "", s.peTtm ?? "", s.pbMrq ?? "",
         s.roe ?? "", s.grossMargin ?? "", s.netMargin ?? "", s.ocfToNi ?? "", s.debtRatio ?? "",
         s.revenueYoy ?? "", s.netProfitYoy ?? "", s.roePrev ?? "", s.overallScore, s.verdict, s.pool,
         s.redFlags.join(";")]
          .join(","),
      );
    }
    writeFileSync(join(OUT_DIR, `${asof}-screener.csv`), csvLines.join("\n"), "utf-8");

    console.log(`[完成] ${asof} 明星池 ${pools.star.length} | 观察池 ${pools.watch.length} | 排除池 ${pools.exclude.length} | 亏损池 ${pools.loss.length} | 数据失败 ${dataFailed}`);
    const top = pools.star.slice(0, 10);
    console.log(`  Top${top.length}（明星池优先）:`);
    top.forEach((s, i) => console.log(`    ${i + 1}. ${s.name} ${s.thscode} 综合分 ${s.overallScore.toFixed(1)} PE ${s.peTtm?.toFixed(1) ?? "—"} 市值 ${s.marketCapYi?.toFixed(0) ?? "—"}亿`));

    return output;
  } finally {
    await db.close();
  }
}

// ==================== CLI 入口 ====================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      asof: { type: "string" },
      report: { type: "string" },
      "prev-report": { type: "string" },
      "min-mcap": { type: "string" },
      smoke: { type: "string" },
      codes: { type: "string" },
      concurrency: { type: "string" },
    },
  });
  const asof = values.asof as string | undefined;
  const report = values.report as string | undefined;
  if (!asof || !report) {
    console.error("必填：--asof <YYYY-MM-DD> --report <YYYY-N>");
    process.exit(1);
  }
  await runHistoricalScreen({
    asof,
    report,
    prevReport: values["prev-report"] as string | undefined,
    minMcapYi: values["min-mcap"] ? Number(values["min-mcap"]) : undefined,
    smoke: values.smoke ? Number(values.smoke) : null,
    codes: values.codes ? values.codes.toUpperCase().split(",") : undefined,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
  });
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
