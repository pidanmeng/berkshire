/**
 * 行情客户端 — 三路数据源并发：
 *   1. 东财 push2 ulist.np/get   → 实时价格 / 涨跌幅 / 总市值（同花顺无市值字段）
 *   2. 同花顺 /prices/snapshot   → 行情快照（开高低收、成交量）
 *   3. 同花顺 /valuations/snapshot → PE/PB/PS/PCF
 * 任一失败降级为部分字段，不整体失败。
 * 复用根仓库 .trae/scripts/hithink/hithink.ts 的导出函数。
 */
import {
  getSnapshot,
  getValuations,
  getKline,
  getKlineFromEastmoney,
  getMarketCapWithFallback,
} from "../../../.trae/scripts/hithink/hithink.ts";
import { shDate } from "./sh-date.ts";

export interface Quote {
  thscode: string;
  name?: string;
  price: number | null;       // 最新价（元）
  changePct: number | null;   // 涨跌幅（%）
  marketCap: number | null;   // 总市值（元）
  peTtm: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
  fetchedAt: number;
}

export interface KlineBar {
  date: string;        // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 批量实时行情（三源并发合并，按 thscode 索引返回） */
export async function getQuotes(thscodes: string[]): Promise<Map<string, Quote>> {
  const unique = [...new Set(thscodes)];
  const map = new Map<string, Quote>();
  if (unique.length === 0) return map;

  const base = (code: string): Quote => ({
    thscode: code, price: null, changePct: null, marketCap: null,
    peTtm: null, pbMrq: null, psTtm: null, pcfTtm: null, fetchedAt: Date.now(),
  });
  for (const c of unique) map.set(c, base(c));

  const [em, snap, val] = await Promise.allSettled([
    getMarketCapWithFallback(unique),
    getSnapshot(unique.join(",")),
    getValuations(unique.join(",")),
  ]);

  // 失败原因记录（含 cause 底层错误码），供 Vercel 等远端环境定位网络问题
  if (em.status === "rejected") console.warn(`[quote] 市值/行情主源失败: ${describeError(em.reason)}`);
  if (snap.status === "rejected") console.warn(`[quote] 同花顺行情快照失败: ${describeError(snap.reason)}`);
  if (val.status === "rejected") console.warn(`[quote] 同花顺估值失败: ${describeError(val.reason)}`);

  if (em.status === "fulfilled") {
    for (const it of em.value) {
      const q = map.get(it.thscode);
      if (q) {
        q.name = it.name || undefined;
        q.price = it.price;
        q.changePct = it.change_pct;
        q.marketCap = it.market_cap;
      }
    }
  }
  if (snap.status === "fulfilled") {
    for (const it of snap.value) {
      const q = map.get(it.thscode);
      if (q && q.price === null && it.last_price != null) q.price = it.last_price;
      if (q && q.changePct === null && it.price_change_ratio_pct != null) q.changePct = it.price_change_ratio_pct;
    }
  }
  if (val.status === "fulfilled") {
    for (const it of val.value) {
      const q = map.get(it.thscode);
      if (q) {
        q.peTtm = it.pe_ttm;
        q.pbMrq = it.pb_mrq;
        q.psTtm = it.ps_ttm;
        q.pcfTtm = it.pcf_ttm;
      }
    }
  }
  return map;
}

/**
 * 历史 K 线（前复权）— 同花顺优先，超时/失败自动降级东财 push2his。
 * 返回数据源标记 source，便于前端与日志区分数据来源。
 */
export async function getKlineBars(
  thscode: string,
  days = 250,
): Promise<{ bars: KlineBar[]; source: 'hithink' | 'eastmoney' }> {
  try {
    const bars = await getKline(thscode, days);
    if (bars.length > 0) return { bars: bars.map(toBar), source: 'hithink' };
    // 上游 code=0 但返回空数组（静默空）也会导致图表空白，同样降级
    console.warn(`[quote] 同花顺 K 线返回空，降级东财 ${thscode}`);
  } catch (err) {
    console.warn(`[quote] 同花顺 K 线失败，降级东财 ${thscode}: ${describeError(err)}`);
  }
  try {
    const bars = await getKlineFromEastmoney(thscode, days);
    return { bars: bars.map(toBar), source: 'eastmoney' };
  } catch (err) {
    console.error(`[quote] 东财 K 线也失败 ${thscode}: ${describeError(err)}`);
    throw err;
  }
}

/** 展开 fetch/undici 错误的 cause 链，输出底层错误码（ENOTFOUND/ETIMEDOUT/ECONNREFUSED/TLS 等） */
function describeError(err: unknown): string {
  if (err == null) return String(err);
  const e = err as { message?: string; cause?: unknown };
  let cause: { code?: unknown; message?: unknown } | undefined;
  let cur: unknown = e.cause;
  while (cur != null && typeof cur === "object") {
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (c.code !== undefined || c.message !== undefined) {
      cause = c;
      cur = c.cause;
    } else {
      break;
    }
  }
  const causePart = cause && (cause.code !== undefined || cause.message !== undefined)
    ? `cause: code=${String(cause.code ?? "")} ${String(cause.message ?? "")}`.trim()
    : "";
  return `${e.message ?? "fetch failed"}${causePart ? ` (${causePart})` : ""}`;
}

/** 数据源统一映射：date_ms（北京时间 0 点）+ OHLC + volume → KlineBar */
function toBar(k: {
  date_ms: number;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
}): KlineBar {
  return {
    // date_ms 为北京时间交易日 0 点时间戳，按东八区格式化避免 UTC 偏移一天
    date: shDate(k.date_ms),
    open: k.open_price,
    high: k.high_price,
    low: k.low_price,
    close: k.close_price,
    volume: k.volume,
  };
}
