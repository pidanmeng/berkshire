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
  getMarketCapFromEastmoney,
} from "../../../.trae/scripts/hithink/hithink.ts";

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
    getMarketCapFromEastmoney(unique),
    getSnapshot(unique.join(",")),
    getValuations(unique.join(",")),
  ]);

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

/** 历史 K 线（前复权，同花顺） */
export async function getKlineBars(thscode: string, days = 250): Promise<KlineBar[]> {
  const bars = await getKline(thscode, days);
  return bars.map((k) => ({
    date: new Date(k.date_ms).toISOString().slice(0, 10),
    open: k.open_price,
    high: k.high_price,
    low: k.low_price,
    close: k.close_price,
    volume: k.volume,
  }));
}
