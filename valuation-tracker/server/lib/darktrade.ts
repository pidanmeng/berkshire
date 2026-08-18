/**
 * 东财暗盘数据源封装 — 仅在服务端（Elysia）运行。
 * 浏览器不接触真实上游 URL / 东财 App UA / GBK 解码，全部在此层完成脱敏。
 * 上游：https://quotederivates.eastmoney.com/datacenter/darktrade
 * 输出为清洗后的安全结构（金额单位元、价格单位元、涨幅/活跃度为百分比数），
 * 原始数值索引 key（'3'..'21'）与上游实现细节不对外暴露。
 */

import iconv from "iconv-lite";

// ===== 上游原始结构（东财数值索引 key，仅供本文件内部解析使用）=====

export interface DarkTradeRawItem {
  '3': number;   // 序号
  '4': string;   // 证券代码
  '5': number;
  '6': number;   // 暗盘资金（元）
  '7': number;   // 明盘资金（元）
  '8': number;   // 主力净流入（元）
  '9': number;
  '10': number;
  '11': number;  // 暗盘活跃度（小数值，0.05 = 5%）
  '12': number;
  '13': number;  // 股价（厘，除以 1000 为元）
  '14': number;  // 涨跌幅（小数值，0.05 = 5%）
  '15': string;
  '16': string;  // 证券名称
  '17': string;  // 板块标签 1
  '18': string;  // 板块标签 2
  '19': number;
  '20': string;
  '21': number;
}

interface DarkTradeRawResponse {
  errid: number;
  errmsg: string;
  data?: DarkTradeRawItem[];
}

// ===== 清洗后对外结构（安全字段，前端只消费此结构）=====

export interface DarkTradeRow {
  rank: number;
  code: string;
  name: string;
  boards: string[];
  darkFund: number;    // 暗盘资金（元）
  brightFund: number;  // 明盘资金（元）
  mainNet: number;     // 主力净流入（元）
  activity: number;    // 活跃度（%）
  price: number;       // 股价（元）
  changePct: number;   // 涨跌幅（%）
}

export interface DarkTradeHistoryPoint {
  date: string;        // yyyyMMdd
  row: DarkTradeRow;
}

const UPSTREAM = "https://quotederivates.eastmoney.com/datacenter/darktrade";
const EASTMONEY_APP_UA =
  "%E4%B8%9C%E6%96%B9%E8%B4%A2%E5%AF%8C/20260518100.965 CFNetwork/3860.500.112 Darwin/25.4.0";
/** 翻页保护上限：避免上游异常返回时无限请求 */
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 15_000;

// ===== 日期工具（yyyyMMdd，纯函数）=====

/** Date → yyyyMMdd（本地时区） */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** yyyyMMdd → 当天本地 Date（中午时刻避免夏令时/跨日边界干扰） */
export function parseDate(dateStr: string): Date {
  return new Date(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(4, 6)) - 1,
    Number(dateStr.slice(6, 8)),
    12,
  );
}

/** yyyyMMdd 加减 N 天 */
export function shiftDate(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

/** 今天（本地时区）yyyyMMdd */
export function todayStr(): string {
  return fmtDate(new Date());
}

// ===== 原始字段 → 清洗结构（纯函数，供单元测试）=====

export function mapRawToRow(raw: DarkTradeRawItem): DarkTradeRow {
  return {
    rank: raw["3"],
    code: raw["4"],
    name: raw["16"],
    boards: [raw["17"], raw["18"]].filter(Boolean),
    darkFund: raw["6"],
    brightFund: raw["7"],
    mainNet: raw["8"],
    activity: +(raw["11"] * 100).toFixed(2),
    price: +(raw["13"] / 1000).toFixed(2),
    changePct: +(raw["14"] * 100).toFixed(2),
  };
}

// ===== 单页请求 =====

/** 拉取指定交易日单页暗盘数据；上游无数据（errid != 0 或空数组）时 ok=false */
export async function fetchDarkTradePage(
  date: string,
  page: number,
  pageSize = 100,
): Promise<{ ok: boolean; rows: DarkTradeRow[] }> {
  const params = new URLSearchParams({
    version: "100",
    cver: "100",
    date,
    StartPage: String(page),
    NumPerPage: String(pageSize),
    sortflag: "1",
    desc: "1",
    market: "",
    datetype: "",
  });
  const resp = await fetch(`${UPSTREAM}?${params}`, {
    headers: { "User-Agent": EASTMONEY_APP_UA, Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) return { ok: false, rows: [] };
  // 东财接口返回 GBK 编码；Bun 的 TextDecoder 不支持 gbk（无 full-icu），用 iconv-lite 解码
  const buf = Buffer.from(await resp.arrayBuffer());
  const text = iconv.decode(buf, "gbk");
  const json = JSON.parse(text) as DarkTradeRawResponse;
  if (json.errid !== 0 || !Array.isArray(json.data) || json.data.length === 0) {
    return { ok: false, rows: [] };
  }
  return { ok: true, rows: json.data.map(mapRawToRow) };
}

// ===== 全量加载（当日完整暗盘列表 + 每只股票所在页码）=====

export interface DarkTradeAllResult {
  actualDate: string;   // 实际取数的交易日（向前回退后）
  pages: number;
  rows: DarkTradeRow[];
  /** 证券代码 → 页码，供 SQLite 持久化加速后续单股查询 */
  stockPageMap: Record<string, number>;
}

/**
 * 拉取指定日期（或向前回退最多 maxRetries 天）的当日完整暗盘列表。
 * 顺序翻页直到上游返回空，构建 code → page 映射。
 */
export async function fetchAllDarkTradePages(
  startDate: string,
  maxRetries = 7,
): Promise<DarkTradeAllResult> {
  let actualDate = "";
  let firstPage: DarkTradeRow[] = [];
  for (let i = 0; i <= maxRetries; i++) {
    const dateStr = shiftDate(startDate, -i);
    const res = await fetchDarkTradePage(dateStr, 1);
    if (res.ok) {
      actualDate = dateStr;
      firstPage = res.rows;
      break;
    }
  }
  if (!actualDate) {
    throw new Error(`最近 ${maxRetries + 1} 天内未找到有效的暗盘数据（起始日期 ${startDate}）`);
  }

  const rows = [...firstPage];
  const stockPageMap: Record<string, number> = {};
  for (const r of firstPage) stockPageMap[r.code] = 1;

  let page = 2;
  while (page <= MAX_PAGES) {
    const res = await fetchDarkTradePage(actualDate, page);
    if (!res.ok) break;
    for (const r of res.rows) stockPageMap[r.code] = page;
    rows.push(...res.rows);
    page++;
  }

  return { actualDate, pages: page - 1, rows, stockPageMap };
}

// ===== 单股历史 =====

const MAX_CONSECUTIVE_MISS = 15; // 连续 N 个自然日在该股原页码附近找不到 → 提前终止

/**
 * 从 endDate 向前逐日拉取单只股票的暗盘数据（结果按时间正序返回）。
 * 每日期先查 pageHint 页，miss 时尝试 hint±1 页；命中后更新 hint 并通过 onPageUpdate
 * 通知调用方写回 SQLite（页码变化持久化）。
 */
export async function fetchStockHistory(
  code: string,
  pageHint: number,
  endDate: string,
  startDate: string,
  onPageUpdate?: (newPage: number) => void,
): Promise<DarkTradeHistoryPoint[]> {
  const results: DarkTradeHistoryPoint[] = [];
  let hint = Math.max(1, pageHint);
  let consecutiveMiss = 0;

  for (let d = endDate; d >= startDate; d = shiftDate(d, -1)) {
    let found = await findRowOnPage(code, d, hint);
    if (!found && hint > 1) {
      found = await findRowOnPage(code, d, hint - 1);
      if (found) {
        hint -= 1;
        onPageUpdate?.(hint);
      }
    }
    if (!found) {
      found = await findRowOnPage(code, d, hint + 1);
      if (found) {
        hint += 1;
        onPageUpdate?.(hint);
      }
    }

    if (found) {
      results.push({ date: d, row: found });
      consecutiveMiss = 0;
    } else {
      consecutiveMiss++;
      if (consecutiveMiss >= MAX_CONSECUTIVE_MISS) break;
    }
  }

  results.reverse();
  return results;
}

/** 在指定日期的指定页中查找某只股票（页号 < 1 或请求失败返回 null） */
async function findRowOnPage(code: string, date: string, page: number): Promise<DarkTradeRow | null> {
  if (page < 1) return null;
  try {
    const res = await fetchDarkTradePage(date, page);
    if (!res.ok) return null;
    return res.rows.find((r) => r.code === code) ?? null;
  } catch {
    return null;
  }
}
