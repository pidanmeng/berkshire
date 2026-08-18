/**
 * 巨潮 cninfo 公告查询 — 基本面更新检测（移植自 .trae/scripts/stock-data/stock.ts）
 * 用于判断：调研截止日之后是否出现了新的定期报告（年报/半年报/业绩报表）。
 */
import { shDate } from "./sh-date.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CATEGORY_MAP: Record<string, string> = {
  yjyg: "category_yjyg_szsh",   // 业绩预告
  yjbb: "category_yjbb_szsh",   // 业绩报表（一季/三季）
  ndbg: "category_ndbg_szsh",   // 年度报告
  bndbg: "category_bndbg_szsh", // 半年度报告
};

// 巨潮 API 对部分类别编码静默忽略（实测 yjbb 返回全量公告，ndbg/bndbg 生效）。
// 对不受支持的类别，客户端按公告标题正则兜底过滤，只保留财报。
const YJBB_TITLE_RE = /业绩(?:快报|报表)/;

export interface Announcement {
  title: string;
  date: string;   // YYYY-MM-DD
  pdfUrl: string;
}

export interface CninfoStock {
  code: string;
  name: string;
  orgId: string;
  market: "szse" | "sse";
}

/** 巨潮 topSearch：名称 → 代码 + orgId */
export async function searchCninfo(name: string): Promise<CninfoStock[]> {
  const res = await fetch("https://www.cninfo.com.cn/new/information/topSearch/query", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ keyWord: name, maxNum: "10" }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`巨潮搜索 HTTP ${res.status}`);
  const data = (await res.json()) as {
    category: string; code: string; zwjc: string; orgId: string; type: string;
  }[];
  return (data ?? [])
    .filter((it) => it.category === "A股")
    .map((it) => ({
      code: it.code,
      name: it.zwjc,
      orgId: it.orgId,
      // 以代码推断市场为准（topSearch 的 type 字段值不稳定）
      market: marketByCode(it.code),
    }));
}

function marketByCode(code: string): "szse" | "sse" {
  return code.startsWith("6") ? "sse" : "szse";
}

/** 巨潮公告查询（指定类别，默认近 N 天） */
export async function queryAnnouncements(
  stock: { code: string; orgId: string; market: string },
  opts: { category?: string; days?: number; pageSize?: number } = {},
): Promise<Announcement[]> {
  const days = opts.days ?? 365;
  const category = opts.category ? CATEGORY_MAP[opts.category] : "";
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const seDate = `${start.toISOString().slice(0, 10)}~${end.toISOString().slice(0, 10)}`;
  const orgId = stock.orgId || "9900022995";

  const body = new URLSearchParams({
    pageNum: "1",
    pageSize: String(opts.pageSize ?? 30),
    column: stock.market,
    tabName: "fulltext",
    plate: "",
    stock: `${stock.code},${orgId}`,
    searchkey: "",
    secid: "",
    category,
    trade: "",
    seDate,
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  }).toString();

  const res = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`巨潮公告 HTTP ${res.status}`);
  const json = (await res.json()) as { announcements?: { announcementTitle: string; announcementTime: number; adjunctUrl: string }[] };
  return (json.announcements ?? []).map((a) => ({
    title: a.announcementTitle,
    // announcementTime 为北京时间毫秒时间戳，按东八区格式化避免日期偏移
    date: shDate(a.announcementTime),
    pdfUrl: a.adjunctUrl ? `https://static.cninfo.com.cn/${a.adjunctUrl}` : "",
  }));
}

/**
 * 基本面更新检测：调研截止日之后是否出现新的定期报告（财报，不含业绩预告等公告）
 * 只看未采信的财报（年报/半年报/业绩报表），不看未采信的公告（业绩预告 yjyg 属公告，已剔除）。
 * @returns needsUpdate: true=需更新 / false=无新财报 / null=无法判断（缺调研截止信息）
 */
export async function checkFundamentalUpdate(
  companyName: string,
  cutoff: { reportPeriod?: string; announcementDate?: string } | null,
): Promise<{ needsUpdate: boolean | null; latestTitle: string; latestDate: string; items: Announcement[] }> {
  const empty = { needsUpdate: null as boolean | null, latestTitle: "", latestDate: "", items: [] as Announcement[] };
  if (!cutoff || !cutoff.announcementDate) return empty; // 无法判断

  const stocks = await searchCninfo(companyName).catch(() => [] as CninfoStock[]);
  if (stocks.length === 0) return empty;
  const stock = stocks[0];

  const all: Announcement[] = [];
  for (const cat of ["ndbg", "bndbg", "yjbb"]) {
    try {
      const list = await queryAnnouncements(
        { code: stock.code, orgId: stock.orgId, market: stock.market },
        { category: cat, days: 365 },
      );
      // 巨潮对 yjbb 类别静默忽略（返回全量公告），按标题正则兜底过滤，只保留业绩快报/报表
      all.push(...(cat === "yjbb" ? list.filter((a) => YJBB_TITLE_RE.test(a.title)) : list));
    } catch {
      // 单类别失败不阻断
    }
  }
  const cutoffDate = cutoff.announcementDate;
  const newer = all.filter((a) => a.date > cutoffDate);
  if (newer.length === 0) {
    return { needsUpdate: false, latestTitle: "", latestDate: "", items: [] };
  }
  const latest = [...newer].sort((a, b) => b.date.localeCompare(a.date))[0];
  return { needsUpdate: true, latestTitle: latest.title, latestDate: latest.date, items: newer.slice(0, 10) };
}

export { marketByCode };
