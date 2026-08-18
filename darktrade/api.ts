import { format, isBefore, parse, subDays } from 'date-fns';
import { toast } from 'sonner';
import type { DarkTradeItem, DarkTradeResponse } from './types';

// ========== 单页请求 ==========

const UPSTREAM = 'https://quotederivates.eastmoney.com/datacenter/darktrade';

export async function fetchPage(dateParam: string, page: number, pageSize = 100): Promise<DarkTradeResponse> {
  const params = new URLSearchParams({
    version: '100', cver: '100', date: dateParam,
    StartPage: String(page), NumPerPage: String(pageSize),
    sortflag: '1', desc: '1', market: '', datetype: '',
  });
  const resp = await fetch(`${UPSTREAM}?${params}`, {
    headers: {
      'User-Agent':
        '%E4%B8%9C%E6%96%B9%E8%B4%A2%E5%AF%8C/20260518100.965 CFNetwork/3860.500.112 Darwin/25.4.0',
      Accept: 'application/json, text/plain, */*',
    },
  });
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  return JSON.parse(text) as DarkTradeResponse;
}

// ========== 全量加载 ==========

export async function fetchAllPages(
  startDate: string,
  maxRetries = 7,
  onProgress: (msg: string) => void
): Promise<{ data: DarkTradeItem[]; actualDate: string; pages: number; stockPageMap: Record<string, number> }> {
  const base = new Date(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(4, 6)) - 1,
    Number(startDate.slice(6, 8))
  );

  let validDate = '';
  let firstPageData: DarkTradeItem[] = [];

  for (let i = 0; i <= maxRetries; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const dp = format(d, 'yyyyMMdd');
    onProgress(i === 0 ? '正在获取数据…' : `${dp} 无数据，尝试前一天 (${i}/${maxRetries})…`);
    const json = await fetchPage(dp, 1);
    if (json.errid === 0 && Array.isArray(json.data) && json.data.length > 0) {
      validDate = dp;
      firstPageData = json.data;
      if (i > 0) toast.warning(`所选日期无数据，已回退至 ${dp}`, { duration: 5000 });
      break;
    }
  }

  if (!validDate) throw new Error(`未找到最近 ${maxRetries + 1} 天内的有效暗盘数据`);

  let allItems = firstPageData;
  const stockPageMap: Record<string, number> = {};
  // 第 1 页的股票映射
  firstPageData.forEach((d) => { stockPageMap[d['4']] = 1; });

  let page = 2;
  while (true) {
    onProgress(`正在加载第 ${page} 页（已获取 ${allItems.length} 条）…`);
    const json = await fetchPage(validDate, page);
    if (json.errid !== 0 || !Array.isArray(json.data) || json.data.length === 0) break;
    json.data.forEach((d) => { stockPageMap[d['4']] = page; });
    allItems = allItems.concat(json.data);
    page++;
  }

  return { data: allItems, actualDate: validDate, pages: page - 1, stockPageMap };
}

// ========== 单只股票历史数据 ==========

export interface StockHistoryItem {
  date: string;
  item: DarkTradeItem;
}

/**
 * 向前遍历日期拉取单只股票的暗盘历史数据。
 * 利用缓存的 pageHint 加速查找，找不到时尝试前后各一页并更新 pageHint。
 */
export async function fetchStockHistory(
  code: string,
  pageHint: number,
  endDate: string,       // yyyyMMdd
  startDate: string,     // yyyyMMdd，如 '20260511'
  onProgress: (msg: string) => void,
  onPageUpdate: (newPage: number) => void,
): Promise<StockHistoryItem[]> {
  const end = parse(endDate, 'yyyyMMdd', new Date());
  const start = parse(startDate, 'yyyyMMdd', new Date());
  const results: StockHistoryItem[] = [];

  let current = end;
  let hint = pageHint;
  let consecutiveMiss = 0;
  const MAX_CONSECUTIVE_MISS = 15; // 连续 15 个交易日找不到则停止

  while (!isBefore(current, start)) {
    const dateStr = format(current, 'yyyyMMdd');
    onProgress(`正在获取 ${dateStr}（页码 ${hint}）…`);

    // 尝试 hint 页
    let found = await findStockOnPage(code, dateStr, hint);

    if (!found && hint > 1) {
      // 尝试 hint - 1
      found = await findStockOnPage(code, dateStr, hint - 1);
      if (found) {
        hint = hint - 1;
        onPageUpdate(hint);
      }
    }
    if (!found) {
      // 尝试 hint + 1
      found = await findStockOnPage(code, dateStr, hint + 1);
      if (found) {
        hint = hint + 1;
        onPageUpdate(hint);
      }
    }

    if (found) {
      results.push({ date: dateStr, item: found });
      consecutiveMiss = 0;
    } else {
      consecutiveMiss++;
      if (consecutiveMiss >= MAX_CONSECUTIVE_MISS) {
        onProgress(`连续 ${MAX_CONSECUTIVE_MISS} 个交易日未找到 ${code}，提前终止`);
        break;
      }
    }

    current = subDays(current, 1);
  }

  // 按时间正序排列（遍历时是从新到旧）
  results.reverse();
  return results;
}

/** 在指定日期的指定页中查找某只股票 */
async function findStockOnPage(code: string, date: string, page: number): Promise<DarkTradeItem | null> {
  if (page < 1) return null;
  try {
    const json = await fetchPage(date, page);
    if (json.errid !== 0 || !Array.isArray(json.data)) return null;
    return json.data.find((d) => d['4'] === code) ?? null;
  } catch {
    return null;
  }
}
