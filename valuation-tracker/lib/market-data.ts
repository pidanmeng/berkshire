/**
 * 客户端实时行情数据源 — 浏览器直连外部 API（替代服务端聚合，缓解服务端被风控限流）
 *
 * 数据源优先级（同花顺优先，东财兜底；对齐 server/lib/quote.ts getQuotes / getKlineBars）：
 *   1. 同花顺 fuyao 代理（优先） → 行情快照（价格/涨跌幅）+ 估值（PE/PB/PS/PCF）+ 历史 K 线；key 来源 =
 *      localStorage['hithink-api-key']（二期 UI 写入）→ 兜底 NEXT_PUBLIC_HITHINK_API_KEY（一期构建期内联）
 *   2. 同花顺 10jqka（主源）     → 总市值/价格/涨跌幅（免鉴权 POST，CORS 放行；SH/SZ/BJ 全覆盖，北交所 920 段）
 *   3. 东财 push2（兜底）        → 10jqka 不支持/失败时补总市值；被限流时失败退避 5min，
 *      期间用同花顺价格 × 缓存股本估算市值（见 fetchQuotes）
 *   4. 东财 push2his            → 历史 K 线（同花顺失败/空时降级）
 * 无 key 时同花顺整路跳过（限流 X-RateLimit-Limit: 20），自动退回 10jqka/东财。
 * 任一数据源失败降级为部分字段，不整体失败。
 * 轮询节流：≥60s 一次（模块级缓存），页面隐藏时由调用方暂停。
 *
 * 同步关系：URL 构造与字段映射复制自根仓库 .trae/scripts/hithink/hithink.ts
 * （getSnapshot / getKline / getValuations / toEastmoneySecid / to10jqkaKey / getMarketCapFrom10jqka
 *  / getMarketCapFromEastmoney / getKlineFromEastmoney），
 * 该文件含 process.exit 等 node 依赖不能直接 import 进客户端；上游改动需同步本文件。
 */
import { classifyCapZone, type CapTarget } from "@/server/lib/safety";
import { shDate } from "@/server/lib/sh-date";

/** 实时行情字段（与后端 Quote / 前端 CompanyItem.quote 对齐） */
export interface MarketQuote {
  thscode: string;
  name?: string;
  price: number | null;       // 最新价（元）
  changePct: number | null;   // 涨跌幅（%）
  marketCap: number | null;   // 总市值（元）
  peTtm: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  pcfTtm: number | null;
}

export interface MarketKlineBar {
  date: string;        // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** thscode → 东财 secid（沪=1，深/北=0）— 同步自 hithink.ts toEastmoneySecid */
export function toEastmoneySecid(thscode: string): string {
  const [ticker, ex] = thscode.split(".");
  if (!ticker || !ex) return thscode;
  const prefix = ex.toUpperCase() === "SH" ? "1" : "0";
  return `${prefix}.${ticker}`;
}

/** 10jqka market 编码：.SH→17（含科创板）、.SZ→33（含创业板）、.BJ→151（920 新代码段）— 同步自 hithink.ts to10jqkaKey */
export function to10jqkaKey(thscode: string): { market: string; code: string } | null {
  const [ticker, ex] = thscode.split(".");
  if (!ticker || !ex) return null;
  const m = ex.toUpperCase();
  const market = m === "SH" ? "17" : m === "SZ" ? "33" : m === "BJ" ? "151" : null;
  if (!market) return null;
  return { market, code: ticker };
}

interface EastmoneyDiff {
  f2?: unknown; f3?: unknown; f12?: unknown; f13?: unknown; f14?: unknown; f20?: unknown; f100?: unknown;
}

/** 东财 ulist 字段 → MarketQuote（字段映射同步自 hithink.ts getMarketCapFromEastmoney） */
function fromEastmoneyDiff(d: EastmoneyDiff): MarketQuote {
  const ticker = String(d.f12 ?? "");
  const market = String(d.f13 ?? "0");
  const suffix = market === "1" ? ".SH" : ".SZ";
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "-" || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    thscode: ticker ? `${ticker}${suffix}` : "",
    name: String(d.f14 ?? "") || undefined,
    price: num(d.f2),
    changePct: num(d.f3),
    marketCap: num(d.f20),
    peTtm: null,
    pbMrq: null,
    psTtm: null,
    pcfTtm: null,
  };
}

/**
 * 批量实时行情 + 总市值（东财 push2 ulist.np/get，一次请求多只）
 * URL/字段同步自 hithink.ts getMarketCapFromEastmoney（f2 最新价、f3 涨跌幅、f20 总市值、fltt=2 原始数值）
 */
export async function fetchEastmoneyQuotes(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  if (thscodes.length === 0) return new Map();
  const secids = [...new Set(thscodes.map(toEastmoneySecid))].join(",");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f2,f3,f12,f13,f14,f20,f100&fltt=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`东财行情 HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { diff?: EastmoneyDiff[] } };
  const map = new Map<string, MarketQuote>();
  for (const d of json.data?.diff ?? []) {
    const q = fromEastmoneyDiff(d);
    if (q.thscode) map.set(q.thscode, q);
  }
  return map;
}

/**
 * 同花顺 10jqka 批量行情快照（总市值/价格/涨跌幅，免鉴权 POST，浏览器直连 CORS 放行）— 市值主数据源
 * URL/字段同步自 hithink.ts getMarketCapFrom10jqka（multi_last_snapshot）
 * - 支持 SH(17)/SZ(33)/BJ(151)，北交所须为 920 新代码段（当前全部北交所已切换）
 * - 响应字段值与回显 data_fields 一一对应，按回显顺序解析；不含名称/行业
 */
export async function fetch10jqkaQuotes(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  if (thscodes.length === 0) return new Map();
  // 按 market 分组去重
  const groups = new Map<string, string[]>();
  for (const ts of thscodes) {
    const key = to10jqkaKey(ts);
    if (key) {
      const list = groups.get(key.market) ?? [];
      list.push(key.code);
      groups.set(key.market, list);
    }
  }
  if (groups.size === 0) return new Map();
  const codeList = [...groups.entries()].map(([market, codes]) => ({
    codes: [...new Set(codes)],
    market,
  }));
  const res = await fetch(
    "https://quota-h.10jqka.com.cn/fuyao/common_hq_aggr/quote/v1/multi_last_snapshot",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code_list: codeList,
        trade_class: "post_market",
        data_fields: ["3541450", "24", "264648"],
        lang: "zh_hans",
        gpid: 1,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`10jqka 行情 HTTP ${res.status}`);
  const json = (await res.json()) as {
    status_code?: number;
    status_msg?: string;
    data?: { quote_data?: { market: string; code: string; data_fields: string[]; value: (number | null)[][] }[] };
  };
  if (json.status_code !== 0) throw new Error(`10jqka 行情 API error: status_code=${String(json.status_code)}`);
  const map = new Map<string, MarketQuote>();
  for (const q of json.data?.quote_data ?? []) {
    // 取最后一行快照（multi_last_snapshot 语义）；行内值按回显 data_fields 顺序定位
    const row = q.value[q.value.length - 1];
    if (!row) continue;
    const get = (id: string): number | null => {
      const i = q.data_fields.indexOf(id);
      if (i < 0 || i >= row.length) return null;
      const v = row[i];
      return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    const suffix = q.market === "17" ? ".SH" : q.market === "33" ? ".SZ" : ".BJ";
    const thscode = `${q.code}${suffix}`;
    map.set(thscode, {
      thscode,
      price: get("24"),
      changePct: get("264648"),
      marketCap: get("3541450"),
      peTtm: null,
      pbMrq: null,
      psTtm: null,
      pcfTtm: null,
    });
  }
  return map;
}

/**
 * 同花顺行情快照（价格/涨跌幅，优先数据源）— 无 key 直接返回空 Map（自动回退东财）
 * URL/字段同步自 hithink.ts getSnapshot（/api/a-share/prices/snapshot）
 */
export async function fetchHithinkSnapshot(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  const key = getHithinkKey();
  if (!key || thscodes.length === 0) return new Map();
  const url = `https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=${encodeURIComponent(thscodes.join(","))}`;
  const res = await fetch(url, {
    headers: { "X-api-key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`同花顺行情 HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    data?: { item?: { thscode?: string; last_price?: number | null; price_change_ratio_pct?: number | null }[] };
  };
  if (json.code !== 0) throw new Error(`同花顺行情 API error: code=${String(json.code)}`);
  const map = new Map<string, MarketQuote>();
  for (const it of json.data?.item ?? []) {
    if (!it.thscode) continue;
    map.set(it.thscode, {
      thscode: it.thscode,
      price: it.last_price ?? null,
      changePct: it.price_change_ratio_pct ?? null,
      marketCap: null,
      peTtm: null,
      pbMrq: null,
      psTtm: null,
      pcfTtm: null,
    });
  }
  return map;
}

/**
 * 历史日 K（东财 push2his，前复权）
 * URL/字段同步自 hithink.ts getKlineFromEastmoney（f51 日期、f52 开盘、f53 收盘、f54 最高、f55 最低、f56 成交量）
 */
export async function fetchEastmoneyKline(thscode: string, days = 250): Promise<MarketKlineBar[]> {
  const secid = toEastmoneySecid(thscode);
  const lmt = Math.max(1, Math.min(1000, Math.round(days)));
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}&klt=101&fqt=1&lmt=${lmt}&end=20500101` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`东财 K 线 HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { klines?: string[] } };
  return (json.data?.klines ?? []).map((line) => {
    const [date, open, close, high, low, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });
}

/**
 * 历史日 K（东财 push2his，前复权，按日期区间）— 回测个股区间走势用
 * 现有 fetchEastmoneyKline 仅支持「最近 N 根」（lmt 上限 1000 ≈ 4 年），
 * 无法回溯 2020 年等早期区间；begin/end 参数直接指定起止日（YYYY-MM-DD）。
 */
export async function fetchEastmoneyKlineRange(
  thscode: string,
  begin: string,
  end: string,
): Promise<MarketKlineBar[]> {
  const secid = toEastmoneySecid(thscode);
  const fmt = (d: string) => d.replace(/-/g, "");
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}&klt=101&fqt=1&lmt=2000&begin=${fmt(begin)}&end=${fmt(end)}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`东财 K 线 HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { klines?: string[] } };
  return (json.data?.klines ?? []).map((line) => {
    const [date, open, close, high, low, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });
}

/**
 * 个股区间 K 线（东财 push2his 前复权）— 按 begin/end 起止日拉取，回测持仓期定位用。
 * 实测东财 push2his 的 begin 参数会被忽略（返回 end 之前的全历史，受 lmt 2000 限制），
 * 因此这里按 [begin, end] 做一次客户端过滤，确保只返回目标区间。
 */
export async function fetchKlineRange(
  thscode: string,
  begin: string,
  end: string,
): Promise<{ bars: MarketKlineBar[]; source: "eastmoney" }> {
  const bars = await fetchEastmoneyKlineRange(thscode, begin, end);
  return {
    bars: bars.filter((b) => b.date >= begin && b.date <= end),
    source: "eastmoney",
  };
}

/**
 * 同花顺历史日 K（优先数据源）— 无 key 返回空数组（自动回退东财）
 * URL/字段同步自 hithink.ts getKline（/api/a-share/prices/historical，date_ms 按北京时间格式化）
 */
export async function fetchHithinkKline(thscode: string, days = 250): Promise<MarketKlineBar[]> {
  const key = getHithinkKey();
  if (!key) return [];
  const end = Date.now();
  const start = end - days * 86400000;
  const url =
    `https://fuyao.aicubes.cn/api/a-share/prices/historical` +
    `?thscode=${encodeURIComponent(thscode)}&interval=1d&start=${start}&end=${end}`;
  const res = await fetch(url, {
    headers: { "X-api-key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`同花顺 K 线 HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    data?: { item?: { date_ms?: number; open_price?: number; high_price?: number; low_price?: number; close_price?: number; volume?: number }[] };
  };
  if (json.code !== 0) throw new Error(`同花顺 K 线 API error: code=${String(json.code)}`);
  return (json.data?.item ?? []).map((k) => ({
    date: shDate(k.date_ms ?? 0),
    open: k.open_price ?? 0,
    high: k.high_price ?? 0,
    low: k.low_price ?? 0,
    close: k.close_price ?? 0,
    volume: k.volume ?? 0,
  }));
}

/**
 * 历史 K 线（同花顺优先，超时/失败/空自动降级东财 push2his）— 对齐 quote.ts getKlineBars 语义。
 * 返回数据源标记 source，便于前端与日志区分。
 */
export async function fetchKline(
  thscode: string,
  days = 250,
): Promise<{ bars: MarketKlineBar[]; source: "hithink" | "eastmoney" }> {
  if (getHithinkKey()) {
    try {
      const bars = await fetchHithinkKline(thscode, days);
      if (bars.length > 0) return { bars, source: "hithink" };
      console.warn(`[market-data] 同花顺 K 线返回空，降级东财 ${thscode}`);
    } catch (err) {
      console.warn(`[market-data] 同花顺 K 线失败，降级东财 ${thscode}: ${describeError(err)}`);
    }
  }
  const bars = await fetchEastmoneyKline(thscode, days);
  return { bars, source: "eastmoney" };
}

/** 同花顺估值 key 来源：localStorage['hithink-api-key']（二期 UI 写入）→ NEXT_PUBLIC_HITHINK_API_KEY（一期） */
function getHithinkKey(): string | null {
  try {
    const fromStorage = window.localStorage.getItem("hithink-api-key");
    if (fromStorage) return fromStorage;
  } catch {
    // 存储不可用时忽略（隐私模式）
  }
  return process.env.NEXT_PUBLIC_HITHINK_API_KEY ?? null;
}

/**
 * 同花顺估值补充（PE/PB/PS/PCF，可选）— 无 key 直接返回空 Map（东财无这些字段，前端展示 —）
 * URL/字段同步自 hithink.ts getValuations（/api/a-share/valuations/snapshot）
 */
export async function fetchHithinkValuations(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  const key = getHithinkKey();
  if (!key || thscodes.length === 0) return new Map();
  const url = `https://fuyao.aicubes.cn/api/a-share/valuations/snapshot?thscodes=${encodeURIComponent(thscodes.join(","))}`;
  const res = await fetch(url, {
    headers: { "X-api-key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`同花顺估值 HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    data?: { item?: { thscode?: string; pe_ttm?: number | null; pb_mrq?: number | null; ps_ttm?: number | null; pcf_ttm?: number | null }[] };
  };
  if (json.code !== 0) throw new Error(`同花顺估值 API error: code=${String(json.code)}`);
  const map = new Map<string, MarketQuote>();
  for (const it of json.data?.item ?? []) {
    if (!it.thscode) continue;
    map.set(it.thscode, {
      thscode: it.thscode,
      price: null,
      changePct: null,
      marketCap: null,
      peTtm: it.pe_ttm ?? null,
      pbMrq: it.pb_mrq ?? null,
      psTtm: it.ps_ttm ?? null,
      pcfTtm: it.pcf_ttm ?? null,
    });
  }
  return map;
}

// ===== 市值源降级：股本缓存估算市值 + 失败退避 =====
// 市值主源（10jqka）失败或东财 ulist 被限流时，用缓存股本 × 同花顺价格估算市值。
// 正常时缓存「股本 = 市值 ÷ 价格」（股本相对稳定），失败时用同花顺价格 × 缓存股本估算，
// 保证安全边际分档（zone）不中断。冷启动无缓存且主源不可用 → 市值降级为 null（与现状一致）。

const SHARES_CACHE_KEY = "eastmoney-shares-v1"; // 键名保留兼容旧缓存（股本数据源无关）
const QUOTE_BACKOFF_MS = 5 * 60_000; // 市值主源失败后退避时长，降低被限流概率
let lastQuoteFailAt = 0;

function loadSharesCache(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SHARES_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 市值主源成功时更新股本缓存（marketCap / price），并重置退避 */
function saveSharesFromQuotes(quotes: Map<string, MarketQuote>): void {
  lastQuoteFailAt = 0;
  try {
    const shares: Record<string, number> = {};
    for (const q of quotes.values()) {
      if (q.marketCap != null && q.marketCap > 0 && q.price != null && q.price > 0) {
        shares[q.thscode] = q.marketCap / q.price;
      }
    }
    if (Object.keys(shares).length > 0) {
      window.localStorage.setItem(SHARES_CACHE_KEY, JSON.stringify({ ...loadSharesCache(), ...shares }));
    }
  } catch {
    // 存储不可用时忽略（隐私模式）
  }
}

/** 市值主源失败时：用同花顺价格 × 缓存股本估算市值（估算不标注来源，降级期间 zone 仍可计算） */
function estimateMarketCapFromCache(map: Map<string, MarketQuote>): void {
  lastQuoteFailAt = Date.now();
  const shares = loadSharesCache();
  for (const q of map.values()) {
    if (q.marketCap === null && q.price != null && shares[q.thscode]) {
      q.marketCap = q.price * shares[q.thscode];
    }
  }
}

/**
 * 合并实时行情（同花顺优先 + 10jqka/东财兜底，任一失败降级不整体失败）— 对齐 quote.ts getQuotes 语义。
 * 优先级：同花顺快照填价格/涨跌幅 → 10jqka 填市值（失败退避 5min，期间用缓存股本估算市值）
 *        → 同花顺估值填 PE/PB/PS/PCF。
 * 只对已存在 thscode 条目填充字段，不新增条目。
 */
export async function fetchQuotes(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  const unique = [...new Set(thscodes)];
  const map = new Map<string, MarketQuote>();
  for (const c of unique) {
    map.set(c, { thscode: c, price: null, changePct: null, marketCap: null, peTtm: null, pbMrq: null, psTtm: null, pcfTtm: null });
  }

  const backoff = Date.now() - lastQuoteFailAt < QUOTE_BACKOFF_MS;
  const [snap, jqka, val] = await Promise.allSettled([
    fetchHithinkSnapshot(unique),
    backoff
      ? Promise.reject(new Error("市值主源退避中（上次失败 <5min，走缓存股本估算）"))
      : fetch10jqkaQuotes(unique),
    fetchHithinkValuations(unique),
  ]);

  // 同花顺快照优先（价格/涨跌幅）
  if (snap.status === "fulfilled") {
    for (const q of snap.value.values()) {
      const cur = map.get(q.thscode);
      if (cur) {
        cur.price = q.price;
        cur.changePct = q.changePct;
      }
    }
  } else {
    console.warn(`[market-data] 同花顺行情失败（无 key 属正常跳过）: ${describeError(snap.reason)}`);
  }
  // 市值主源（10jqka）：市值必填；同花顺缺价时补价格/涨跌幅（.BJ 等不支持项为空 Map，由后续降级处理）
  if (jqka.status === "fulfilled") {
    for (const q of jqka.value.values()) {
      const cur = map.get(q.thscode);
      if (cur) {
        cur.marketCap = q.marketCap;
        if (cur.price === null) cur.price = q.price;
        if (cur.changePct === null) cur.changePct = q.changePct;
      }
    }
    saveSharesFromQuotes(jqka.value);
  } else {
    console.warn(`[market-data] 市值主源失败${backoff ? "（退避中）" : ""}: ${describeError(jqka.reason)}`);
    estimateMarketCapFromCache(map);
  }
  if (val.status === "fulfilled") {
    for (const q of val.value.values()) {
      const cur = map.get(q.thscode);
      if (cur) {
        cur.peTtm = q.peTtm;
        cur.pbMrq = q.pbMrq;
        cur.psTtm = q.psTtm;
        cur.pcfTtm = q.pcfTtm;
      }
    }
  } else {
    console.warn(`[market-data] 同花顺估值失败（无 key 属正常跳过）: ${describeError(val.reason)}`);
  }
  return map;
}

/** ≥60s 节流缓存（Dashboard 轮询与详情页共用；同参 60s 内直接返回上次结果） */
const throttledCache = new Map<string, { ts: number; data: Map<string, MarketQuote> }>();
const THROTTLE_MS = 60_000;

export async function fetchQuotesThrottled(thscodes: string[]): Promise<Map<string, MarketQuote>> {
  const key = [...new Set(thscodes)].sort().join(",");
  const now = Date.now();
  const hit = throttledCache.get(key);
  if (hit && now - hit.ts < THROTTLE_MS) return hit.data;
  const data = await fetchQuotes(thscodes);
  throttledCache.set(key, { ts: now, data });
  return data;
}

/** 展开 fetch 错误 cause 链，输出底层错误码（对齐 quote.ts describeError） */
function describeError(err: unknown): string {
  if (err == null) return String(err);
  const e = err as { message?: string; cause?: unknown };
  let cur: unknown = e.cause;
  let causePart = "";
  while (cur != null && typeof cur === "object") {
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (c.code !== undefined || c.message !== undefined) {
      causePart = ` cause=${String(c.code ?? "")} ${String(c.message ?? "")}`.trim();
      cur = c.cause;
    } else break;
  }
  return `${e.message ?? "fetch failed"}${causePart}`;
}

/** 客户端安全边际分档重算（实时市值 → zone；target 来自静态 JSON） */
export function classifyZone(marketCap: number | null, target: CapTarget | null) {
  const marketCapYi = marketCap != null ? marketCap / 1e8 : null;
  return classifyCapZone(marketCapYi, target);
}
