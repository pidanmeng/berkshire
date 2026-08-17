#!/usr/bin/env bun
/**
 * A 股全市场初筛流水线 — 三级漏斗，脚本为主，0 LLM token
 *
 * 用法:
 *   bun run .trae/scripts/screener/screen.ts                     # 全量跑（Stage A→B→C）
 *   bun run .trae/scripts/screener/screen.ts --only a            # 仅 Stage A（代码表+行情+估值+硬过滤）
 *   bun run .trae/scripts/screener/screen.ts --only b            # 仅 Stage B（逐只财务指标，断点续跑）
 *   bun run .trae/scripts/screener/screen.ts --only c            # 仅 Stage C（分池评分 + 输出文件）
 *   bun run .trae/scripts/screener/screen.ts --smoke 20          # 只取主池前 20 家跑通管道（数据标定）
 *   bun run .trae/scripts/screener/screen.ts --codes 600519.SH,300750.SZ   # 只跑指定标的（定向标定）
 *   bun run .trae/scripts/screener/screen.ts --report 2025-4 --prev-report 2024-4
 *
 * 漏斗：
 *   Stage A  代码表(tickers/list) + 东财市值/行业 + 同花顺估值 → 硬过滤（ST/退、市值<minMcap）
 *            PE<0 单列「亏损池」；其余进主漏斗
 *   Stage B  主池逐只 indicators（最新年报），并发 + JSONL 断点续跑 + 重试；
 *            初判非 RED 的再取上一年报做「连续两年」复核
 *   Stage C  复用 quality-screen.screenCompany() 评分 → 明星池/观察池/排除池
 *            输出 latest-screener.json（看板事实源）+ CSV + digest.md
 *
 * 单位口径（与 hithink getIndicators 上游一致，均为百分数 → ÷100）：
 *   ROE/毛利率/净利率/资产负债率/营收同比/净利同比/净利润现金含量(OCF-NI)
 *   ⚠️ 首次跑通后需与 backfill financials 块比对标定（见验证步骤）。
 */

import { parseArgs } from "util";
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getAllAShareTickers,
  getMarketCapFromEastmoney,
  getValuations,
  getIndicatorsRaw,
} from "../hithink/hithink.ts";
import { screenCompany, type CompanyMetrics } from "../quality-gate/quality-screen.ts";

// ==================== 类型 ====================

export type Pool = "star" | "watch" | "exclude" | "loss";

export interface UniverseRow {
  thscode: string;
  ticker: string;
  name: string;
  exchange: string;
}

export interface ExtraRow {
  thscode: string;
  price: number | null;
  changePct: number | null;
  marketCapYi: number | null;   // 总市值（亿元）
  peTtm: number | null;
  pbMrq: number | null;
  industry: string | null;
}

export type FullRow = UniverseRow & ExtraRow;

export interface ScreenRow {
  thscode: string;
  ticker: string;
  name: string;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  marketCapYi: number | null;
  peTtm: number | null;
  pbMrq: number | null;
  roe: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  ocfToNi: number | null;
  debtRatio: number | null;
  revenueYoy: number | null;
  netProfitYoy: number | null;
  roePrev: number | null;                 // 上一年 ROE（连续两年复核）
  overallScore: number;
  verdict: "GREEN" | "YELLOW" | "RED";
  redFlags: string[];
  yellowFlags: string[];
  greenHighlights: string[];
  pool: Pool;
  reason?: string;
  highLeverageNote: boolean;
  dataFailed?: string;
}

export interface ScreenerMeta {
  generatedAt: string;
  report: string;
  prevReport: string;
  quoteAsOf: string;
  config: { minMcapYi: number; excludeSt: boolean; concurrency: number };
  counts: {
    universe: number;
    main: number;
    loss: number;
    excludedStageA: number;
    star: number;
    watch: number;
    exclude: number;
    dataFailed: number;
  };
}

export interface ScreenerOutput {
  meta: ScreenerMeta;
  pools: Record<Pool, ScreenRow[]>;
}

export interface StageAOutput {
  meta: Pick<ScreenerMeta, "generatedAt" | "quoteAsOf"> & { minMcapYi: number; excludeSt: boolean };
  main: FullRow[];
  loss: FullRow[];
  excluded: { row: FullRow; reason: string }[];
}

export interface StageBOutput {
  meta: Pick<ScreenerMeta, "generatedAt" | "report" | "prevReport">;
  rows: ScreenRow[];
}

// ==================== 常量 ====================

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, "Research", "00-Workspace", "07-Screener");
const CACHE_DIR = join(OUT_DIR, "cache");
const CHUNK = 100;                 // 批量接口单次请求上限（valuations 硬限制 100 个 thscodes/请求）
const RETRY = 2;                   // 逐只指标重试次数
/** 高杠杆豁免行业（金融/地产属性，负债率高属正常，不自动排除，仅打标人工复核） */
const HIGH_LEVERAGE_INDUSTRY = /银行|保险|证券|信托|金融|地产|房地产|多元金融/;
/** 明显垃圾：名称含 ST / *ST / 退 标识 */
const ST_RE = /ST|退/;

// ==================== 纯函数（可测）====================

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 百分数 → 小数（"15.2" → 0.152）；null/非法 → null */
export function pct(v: string | null | undefined): number | null {
  const n = safeNum(v);
  return n === null ? null : n / 100;
}

/** 分块 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 高杠杆行业判定（用于金融/地产豁免打标，不改变 verdict） */
export function isHighLeverageIndustry(industry: string | null): boolean {
  if (!industry) return false;
  return HIGH_LEVERAGE_INDUSTRY.test(industry);
}

/**
 * Stage A 硬过滤（纯函数）
 * - 名称含 ST / 退 → excluded（excludeSt=true 时）
 * - 市值 < minMcapYi 亿 → excluded（微盘）
 * - PE < 0 → loss 亏损池（不参与主评分漏斗）
 * - 其余 → main 主漏斗
 */
export function applyUniverseFilters(
  rows: FullRow[],
  opts: { minMcapYi: number; excludeSt: boolean },
): { main: FullRow[]; loss: FullRow[]; excluded: { row: FullRow; reason: string }[] } {
  const main: FullRow[] = [];
  const loss: FullRow[] = [];
  const excluded: { row: FullRow; reason: string }[] = [];
  for (const r of rows) {
    const nameUpper = r.name.toUpperCase();
    if (opts.excludeSt && ST_RE.test(nameUpper)) {
      excluded.push({ row: r, reason: "ST/退市风险标识" });
      continue;
    }
    if (r.marketCapYi !== null && r.marketCapYi < opts.minMcapYi) {
      excluded.push({ row: r, reason: `市值<${opts.minMcapYi}亿微盘` });
      continue;
    }
    if (r.peTtm !== null && r.peTtm < 0) {
      loss.push(r);
      continue;
    }
    main.push(r);
  }
  return { main, loss, excluded };
}

/** 指标原始块 → 单年基础指标（百分数统一 ÷100） */
export function parseIndicatorsYear(
  raw: Record<string, Record<string, string | null>>,
): {
  roe: number | null; grossMargin: number | null; netMargin: number | null;
  ocfToNi: number | null; debtRatio: number | null;
  revenueYoy: number | null; netProfitYoy: number | null;
} {
  const g = (ability: string, id: string) => raw[ability]?.[id] ?? null;
  return {
    roe: pct(g("profitability", "index_weighted_avg_roe")),
    grossMargin: pct(g("profitability", "sale_gross_margin")),
    netMargin: pct(g("profitability", "sale_net_interest_ratio")),
    ocfToNi: pct(g("cash-flow", "net_profit_cash_content")),
    debtRatio: pct(g("solvency", "assets_debt_ratio")),
    revenueYoy: pct(g("growth", "calculate_operating_income_yoy_growth_ratio")),
    netProfitYoy: pct(g("growth", "calculate_parent_holder_net_profit_yoy_growth_ratio")),
  };
}

/** Stage B：组装 screenCompany 输入并评分（纯函数） */
export function scoreRow(
  u: FullRow,
  cur: ReturnType<typeof parseIndicatorsYear>,
  prev?: ReturnType<typeof parseIndicatorsYear>,
): Omit<ScreenRow, "pool" | "reason" | "highLeverageNote" | "dataFailed"> {
  const metrics: CompanyMetrics = {
    name: u.name,
    code: u.ticker,
    roe: cur.roe,
    grossMargin: cur.grossMargin,
    netMargin: cur.netMargin,
    ocfToNi: cur.ocfToNi,
    debtRatio: cur.debtRatio,
    peTtm: u.peTtm,
    revenueGrowth: cur.revenueYoy,
    earningsGrowth: cur.netProfitYoy,
  };
  const s = screenCompany(metrics);
  return {
    thscode: u.thscode,
    ticker: u.ticker,
    name: u.name,
    industry: u.industry,
    price: u.price,
    changePct: u.changePct,
    marketCapYi: u.marketCapYi,
    peTtm: u.peTtm,
    pbMrq: u.pbMrq,
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
  };
}

/** Stage C：分池（纯函数）
 * 明星池 = GREEN（明显有价值）；观察池 = YELLOW（中性偏优，按综合分排序）；
 * 排除池 = RED（明显垃圾/风险，红牌≥2 或综合分<4.5）；亏损池由 Stage A 分流（PE<0）
 */
export function assignPool(
  row: Omit<ScreenRow, "pool" | "reason" | "highLeverageNote" | "dataFailed">,
): { pool: Pool; reason?: string; dataFailed?: string } {
  if (row.verdict === "GREEN") return { pool: "star" };
  if (row.verdict === "YELLOW") return { pool: "watch" };
  return { pool: "exclude", reason: "RED（红牌≥2 或综合分<4.5）" };
}

// ==================== 缓存与并发 ====================

type RawBlock = Record<string, Record<string, string | null>>;

/** 读 JSONL 缓存 → Map<thscode, raw> */
export function loadIndicatorsCache(file: string): Map<string, RawBlock> {
  const map = new Map<string, RawBlock>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { thscode: string; raw: RawBlock };
      if (o?.thscode) map.set(o.thscode, o.raw);
    } catch {
      // 跳过损坏行
    }
  }
  return map;
}

/** 受限并发执行器（带重试） */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  retries = 0,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
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
    }
  });
  await Promise.all(workers);
  return results;
}

// ==================== Stage A ====================

async function runStageA(opts: { minMcapYi: number; excludeSt: boolean; smoke: number | null; codes: string[] }): Promise<StageAOutput> {
  console.log("[Stage A] 拉取全 A 代码表（SH/SZ/BJ）...");
  const tickers = await getAllAShareTickers();
  console.log(`  代码表 ${tickers.length} 家`);

  let rows: FullRow[] = tickers.map((t) => ({
    thscode: t.thscode,
    ticker: t.ticker,
    name: t.name,
    exchange: t.exchange ?? "",
    price: null,
    changePct: null,
    marketCapYi: null,
    peTtm: null,
    pbMrq: null,
    industry: null,
  }));

  // --codes：定向标定/抽查，只保留指定标的
  if (opts.codes.length > 0) {
    const set = new Set(opts.codes.map((c) => c.toUpperCase()));
    rows = rows.filter((r) => set.has(r.thscode));
    const missing = opts.codes.filter((c) => !set.has(c.toUpperCase()) || !rows.some((r) => r.thscode === c.toUpperCase()));
    if (missing.length > 0) console.warn(`  ⚠️ 未匹配到代码：${missing.join(", ")}`);
  }

  console.log(`[Stage A] 批量获取市值/行业（东财）与估值（同花顺，chunk=${CHUNK}）...`);
  const emChunks = chunk(rows.map((r) => r.thscode), CHUNK);
  const valChunks = chunk(rows.map((r) => r.thscode), CHUNK);
  const [emResults, valResults] = await Promise.all([
    mapWithConcurrency(emChunks, 4, (codes) => getMarketCapFromEastmoney(codes), 1),
    mapWithConcurrency(valChunks, 4, (codes) => getValuations(codes.join(",")), 1),
  ]);

  const emMap = new Map(emResults.flat().map((m) => [m.thscode, m]));
  const valMap = new Map(valResults.flat().map((v) => [v.thscode, v]));

  for (const r of rows) {
    const em = emMap.get(r.thscode);
    const val = valMap.get(r.thscode);
    r.price = em?.price ?? null;
    r.changePct = em?.change_pct ?? null;
    r.marketCapYi = em?.market_cap != null ? em.market_cap / 1e8 : null;
    r.industry = em?.industry ?? null;
    r.peTtm = val?.pe_ttm ?? null;
    r.pbMrq = val?.pb_mrq ?? null;
  }

  // --smoke：只保留前 N 家（标定用）
  const target = opts.smoke !== null ? rows.slice(0, opts.smoke) : rows;
  const { main, loss, excluded } = applyUniverseFilters(target, opts);

  const meta = {
    generatedAt: new Date().toISOString(),
    quoteAsOf: new Date().toLocaleString("zh-CN", { hour12: false }),
    minMcapYi: opts.minMcapYi,
    excludeSt: opts.excludeSt,
  };
  const output: StageAOutput = { meta, main, loss, excluded };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "stage-a.json"), JSON.stringify(output, null, 2), "utf-8");
  console.log(`[Stage A] 完成 → 主池 ${main.length} | 亏损池 ${loss.length} | 排除 ${excluded.length}`);
  return output;
}

// ==================== Stage B ====================

async function fetchYearRaw(
  codes: string[],
  report: string,
  cacheFile: string,
  concurrency: number,
  progress: (done: number, total: number, code: string) => void,
): Promise<{ map: Map<string, RawBlock>; failed: string[] }> {
  const map = loadIndicatorsCache(cacheFile);
  const failedFile = cacheFile.replace(/\.jsonl$/, ".failed.jsonl");
  const alreadyFailed = new Set(
    existsSync(failedFile)
      ? readFileSync(failedFile, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean)
      : [],
  );
  const pending = codes.filter((c) => !map.has(c) && !alreadyFailed.has(c));
  console.log(`[Stage B] ${report}：缓存 ${map.size} 家，待取 ${pending.length} 家（历史失败跳过 ${alreadyFailed.size} 家）`);

  let done = map.size;
  const total = codes.length;
  const newFailed: string[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await mapWithConcurrency(pending, concurrency, async (code) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY; attempt++) {
      try {
        const raw = await getIndicatorsRaw(code, report);
        appendFileSync(cacheFile, JSON.stringify({ thscode: code, report, raw }) + "\n", "utf-8");
        map.set(code, raw);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY) await sleep(300 * (attempt + 1));
      }
    }
    if (lastErr !== undefined) {
      newFailed.push(code);
      appendFileSync(failedFile, code + "\n", "utf-8");
    }
    done++;
    progress(done, total, code);
  });
  return { map, failed: [...alreadyFailed, ...newFailed] };
}

async function runStageB(
  stageA: StageAOutput,
  opts: { report: string; prevReport: string; concurrency: number },
): Promise<StageBOutput> {
  const allCodes = [...stageA.main.map((r) => r.thscode), ...stageA.loss.map((r) => r.thscode)];
  const curCache = join(CACHE_DIR, `indicators-${opts.report}.jsonl`);
  mkdirSync(CACHE_DIR, { recursive: true });

  const printProgress = (label: string) => (done: number, total: number) => {
    if (done % 200 === 0 || done === total) console.log(`  ${label} ${done}/${total}`);
  };

  const { map: curMap, failed: curFailed } = await fetchYearRaw(
    allCodes,
    opts.report,
    curCache,
    opts.concurrency,
    (done, total) => printProgress(`[Stage B] ${opts.report}`)(done, total),
  );
  const failedSet = new Set([...curFailed, ...(await loadFailed(curCache))]);

  // 初判非 RED 的取上一年报做连续复核
  const prevCache = join(CACHE_DIR, `indicators-${opts.prevReport}.jsonl`);
  const needPrev = stageA.main.filter((u) => {
    const raw = curMap.get(u.thscode);
    if (!raw) return false;
    const cur = parseIndicatorsYear(raw);
    const s = screenCompany({
      name: u.name, code: u.ticker,
      roe: cur.roe, grossMargin: cur.grossMargin, netMargin: cur.netMargin,
      ocfToNi: cur.ocfToNi, debtRatio: cur.debtRatio, peTtm: u.peTtm,
      revenueGrowth: cur.revenueYoy, earningsGrowth: cur.netProfitYoy,
    });
    return s.verdict !== "RED";
  });
  const prevCodes = needPrev.map((u) => u.thscode);
  const prevMap =
    prevCodes.length > 0
      ? (await fetchYearRaw(
          prevCodes,
          opts.prevReport,
          prevCache,
          opts.concurrency,
          (done, total) => printProgress(`[Stage B] ${opts.prevReport}`)(done, total),
        )).map
      : new Map<string, RawBlock>();

  const rows: ScreenRow[] = [];
  for (const u of [...stageA.main, ...stageA.loss]) {
    const isLoss = stageA.loss.includes(u);
    const raw = curMap.get(u.thscode);
    if (!raw) {
      rows.push({
        ...scoreRow(u, emptyYear()),
        pool: isLoss ? "loss" : "exclude",
        reason: isLoss ? "PE<0（亏损观察池）" : failedSet.has(u.thscode) ? "财务指标获取失败" : "无指标数据",
        highLeverageNote: false,
        dataFailed: "indicators",
      });
      continue;
    }
    const cur = parseIndicatorsYear(raw);
    const prev = isLoss ? undefined : prevMap.get(u.thscode);
    const prevYear = prev ? parseIndicatorsYear(prev) : undefined;
    const base = scoreRow(u, cur, prevYear);
    const { pool, reason } = isLoss
      ? { pool: "loss" as Pool, reason: "PE<0（亏损观察池）" }
      : assignPool(base);
    rows.push({
      ...base,
      pool,
      reason,
      highLeverageNote: isHighLeverageIndustry(u.industry) && (cur.debtRatio ?? 0) > 0.7,
    });
  }

  return { meta: { generatedAt: new Date().toISOString(), report: opts.report, prevReport: opts.prevReport }, rows };
}

function emptyYear() {
  return { roe: null, grossMargin: null, netMargin: null, ocfToNi: null, debtRatio: null, revenueYoy: null, netProfitYoy: null };
}

async function loadFailed(cacheFile: string): Promise<string[]> {
  const f = cacheFile.replace(/\.jsonl$/, ".failed.jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean);
}

// ==================== Stage C：输出 ====================

function buildMeta(
  stageA: StageAOutput,
  rows: ScreenRow[],
  opts: { report: string; prevReport: string; minMcapYi: number; excludeSt: boolean; concurrency: number },
): ScreenerMeta {
  const poolCount = (p: Pool) => rows.filter((r) => r.pool === p).length;
  return {
    generatedAt: new Date().toISOString(),
    report: opts.report,
    prevReport: opts.prevReport,
    quoteAsOf: stageA.meta.quoteAsOf,
    config: { minMcapYi: opts.minMcapYi, excludeSt: opts.excludeSt, concurrency: opts.concurrency },
    counts: {
      universe: stageA.main.length + stageA.loss.length + stageA.excluded.length,
      main: stageA.main.length,
      loss: poolCount("loss"),
      excludedStageA: stageA.excluded.length,
      star: poolCount("star"),
      watch: poolCount("watch"),
      exclude: poolCount("exclude"),
      dataFailed: rows.filter((r) => r.dataFailed).length,
    },
  };
}

export function buildScreenerOutput(
  stageA: StageAOutput,
  rows: ScreenRow[],
  opts: { report: string; prevReport: string; minMcapYi: number; excludeSt: boolean; concurrency: number },
): ScreenerOutput {
  const meta = buildMeta(stageA, rows, opts);
  return {
    meta,
    pools: {
      star: rows.filter((r) => r.pool === "star").sort((a, b) => b.overallScore - a.overallScore),
      watch: rows.filter((r) => r.pool === "watch").sort((a, b) => b.overallScore - a.overallScore),
      exclude: rows.filter((r) => r.pool === "exclude").sort((a, b) => b.overallScore - a.overallScore),
      loss: rows.filter((r) => r.pool === "loss").sort((a, b) => (a.marketCapYi ?? 0) - (b.marketCapYi ?? 0)),
    },
  };
}

const CSV_HEADER = [
  "thscode", "name", "industry", "pool", "score", "verdict",
  "roe", "gross_margin", "net_margin", "ocf_to_ni", "debt_ratio",
  "revenue_yoy", "net_profit_yoy", "pe_ttm", "pb_mrq", "market_cap_yi",
  "price", "change_pct", "red_flags", "yellow_flags", "green_highlights",
  "reason", "high_leverage_note",
];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ScreenRow[]): string {
  const lines = [CSV_HEADER.map(csvEscape).join(",")];
  for (const r of rows) {
    const vals = [
      r.thscode, r.name, r.industry, r.pool, r.overallScore, r.verdict,
      r.roe, r.grossMargin, r.netMargin, r.ocfToNi, r.debtRatio,
      r.revenueYoy, r.netProfitYoy, r.peTtm, r.pbMrq, r.marketCapYi,
      r.price, r.changePct,
      r.redFlags.join(";"), r.yellowFlags.join(";"), r.greenHighlights.join(";"),
      r.reason ?? "", r.highLeverageNote ? "1" : "",
    ];
    lines.push(vals.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | null, d = 1): string {
  return v === null ? "—" : v.toFixed(d);
}

export function toDigest(output: ScreenerOutput): string {
  const c = output.meta.counts;
  const fmt = (d: string, v: string) => `| ${d} | ${v} |`;
  const rows = output.pools.star.slice(0, 30);
  const table =
    rows.length === 0
      ? "（无）"
      : [
          "| 代码 | 名称 | 行业 | 综合分 | verdict | ROE | 毛利率 | 净利率 | OCF/NI | 负债率 | PE(TTM) | 市值(亿) | 营收同比 | 净利同比 |",
          "|------|------|------|-------:|---------|----:|-------:|-------:|-------:|-------:|--------:|--------:|--------:|--------:|",
          ...rows.map(
            (r) =>
              `| ${r.thscode} | ${r.name} | ${r.industry ?? "—"} | ${r.overallScore.toFixed(1)} | ${r.verdict} | ${fmtPct(r.roe)} | ${fmtPct(r.grossMargin)} | ${fmtPct(r.netMargin)} | ${fmtNum(r.ocfToNi, 2)} | ${fmtPct(r.debtRatio)} | ${fmtNum(r.peTtm)} | ${fmtNum(r.marketCapYi)} | ${fmtPct(r.revenueYoy)} | ${fmtPct(r.netProfitYoy)} |`,
          ),
        ].join("\n");

  return [
    `# A 股全市场初筛摘要（${output.meta.generatedAt.slice(0, 10)}）`,
    ``,
    `- 报告期：${output.meta.report}（上一年 ${output.meta.prevReport}）· 行情时点：${output.meta.quoteAsOf}`,
    `- 漏斗配置：市值 ≥ ${output.meta.config.minMcapYi} 亿${output.meta.config.excludeSt ? " · 剔除 ST/退" : ""}`,
    ``,
    `## 池统计`,
    ``,
    `| 池 | 数量 |`,
    `|----|-----:|`,
    fmt("全市场", String(c.universe)),
    fmt("主漏斗覆盖", String(c.main)),
    fmt("明星池 🟢", String(c.star)),
    fmt("观察池 🟡", String(c.watch)),
    fmt("排除池 🔴", String(c.exclude)),
    fmt("亏损池", String(c.loss)),
    fmt("数据失败", String(c.dataFailed)),
    fmt("Stage A 排除", String(c.excludedStageA)),
    ``,
    `## 明星池 Top ${rows.length}`,
    ``,
    table,
    ``,
    `> 数据仅供研究参考，不构成投资建议。`,
  ].join("\n");
}

// ==================== CLI ====================

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      report: { type: "string", default: "2025-4" },
      "prev-report": { type: "string", default: "2024-4" },
      "min-mcap": { type: "string", default: "10" },
      "exclude-st": { type: "boolean", default: true },
      concurrency: { type: "string", default: "20" },
      only: { type: "string" },
      smoke: { type: "string" },
      codes: { type: "string" },
    },
  });

  const report = values.report!;
  const prevReport = values["prev-report"]!;
  const minMcapYi = parseFloat(values["min-mcap"]!);
  const excludeSt = values["exclude-st"] !== false;
  const concurrency = parseInt(values.concurrency!, 10) || 20;
  const only = (values.only ?? "").toLowerCase();
  const smoke = values.smoke !== undefined && values.smoke !== "" ? parseInt(values.smoke!, 10) : null;
  if (!["", "a", "b", "c"].includes(only)) {
    console.error(`❌ 无效 --only: ${only}（可选 a|b|c）`);
    process.exit(1);
  }
  if (smoke !== null && (!Number.isFinite(smoke) || smoke <= 0)) {
    console.error(`❌ 无效 --smoke: ${values.smoke}`);
    process.exit(1);
  }
  const codes = (values.codes ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  let stageA: StageAOutput | null = null;
  const stageAFile = join(OUT_DIR, "stage-a.json");
  if (only === "" || only === "a") {
    stageA = await runStageA({ minMcapYi, excludeSt, smoke, codes });
  } else {
    if (existsSync(stageAFile)) {
      stageA = JSON.parse(readFileSync(stageAFile, "utf-8")) as StageAOutput;
      console.log(`[Stage A] 复用缓存 ${stageAFile}`);
    } else {
      stageA = await runStageA({ minMcapYi, excludeSt, smoke, codes });
    }
  }
  if (!stageA) process.exit(1);

  if (only === "a") {
    console.log("\n✅ Stage A 完成（--only a，退出）");
    return;
  }

  const stageB = await runStageB(stageA, { report, prevReport, concurrency });
  const stageBFile = join(OUT_DIR, "stage-b.json");
  writeFileSync(stageBFile, JSON.stringify(stageB, null, 2), "utf-8");
  if (only === "b") {
    console.log(`\n✅ Stage B 完成（--only b），${stageB.rows.length} 行 → ${stageBFile}`);
    return;
  }

  const output = buildScreenerOutput(stageA, stageB.rows, { report, prevReport, minMcapYi, excludeSt, concurrency });
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "latest-screener.json"), JSON.stringify(output, null, 2), "utf-8");
  writeFileSync(join(OUT_DIR, `${date}-screener.csv`), toCsv(stageB.rows), "utf-8");
  writeFileSync(join(OUT_DIR, `${date}-digest.md`), toDigest(output), "utf-8");

  const c = output.meta.counts;
  console.log(`\n✅ 初筛完成（${date}）`);
  console.log(`  全市场 ${c.universe} | 主池 ${c.main} | 明星 ${c.star} | 观察 ${c.watch} | 排除 ${c.exclude} | 亏损 ${c.loss} | 数据失败 ${c.dataFailed}`);
  console.log(`  输出：${join(OUT_DIR, "latest-screener.json")}`);
  console.log(`       ${join(OUT_DIR, `${date}-screener.csv`)}`);
  console.log(`       ${join(OUT_DIR, `${date}-digest.md`)}`);
}

if (import.meta.main) main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
