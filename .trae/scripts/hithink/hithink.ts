/**
 * 同花顺金融数据 API 客户端 — 纯 API 库（无 CLI 入口）
 *
 * 被 evaluate.ts / quality-screen.ts 等脚本通过 import 调用。
 * 如需命令行查询，请使用 evaluate.ts --code <代码>。
 *
 * 导出函数：
 *   searchTicker(q)              名称/代码 → thscode
 *   getSnapshot(thscodes)        行情快照
 *   getKline(thscode, days)      历史 K 线
 *   getIncomeStatements(...)     利润表
 *   getBalanceSheets(...)        资产负债表
 *   getCashFlows(...)            现金流量表
 *   getIndicators(thscode, report) 财务指标
 *   getValuations(thscodes)      估值快照
 *   to10jqkaKey(thscode)         thscode → 10jqka 参数（market/code：SH→17/SZ→33/BJ→151）
 *   getMarketCapFrom10jqka(thscodes) 市值/价格/涨跌幅（同花顺 10jqka 免鉴权接口，主数据源）
 *   getMarketCapWithFallback(thscodes) 市值主数据源（10jqka 优先，失败/缺数降级东财）
 *   getMarketCapFromEastmoney(thscodes) 总市值（东财 push2 兜底，含行业/名称）
 *   getKlineFromEastmoney(thscode, days) 历史日 K（东财 push2his 前复权，同花顺 K 线超时降级用）
 */

// 同花顺金融数据 API Key 配置
// 统一凭据来源优先级（与 hithink-finance Skill 契约一致）：
// 1. HITHINK_FINANCE_API_KEY（推荐新名称）
// 2. HITHINK_API_KEY（兼容旧名称）
// 3. FUYAO_TOKEN（兼容旧来源）
const API_KEY =
  process.env.HITHINK_FINANCE_API_KEY ||
  process.env.HITHINK_API_KEY ||
  process.env.FUYAO_TOKEN ||
  'sk-fuyao-yY4oeatOr3CHqzznKEPHBCObUaxJyZan';
const BASE = 'https://fuyao.aicubes.cn';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ==================== 类型定义 ====================

interface ApiResponse<T> {
  code: number;
  message: string;
  request_id: string;
  data: T | null;
}

interface TickerItem {
  thscode: string;
  ticker: string;
  name: string;
  exchange: string;
  asset_type: string;
  currency: string;
}

interface SnapshotItem {
  thscode: string;
  ticker: string;
  volume: number;
  turnover: number;
  last_price: number;
  price_change: number;
  price_change_ratio_pct: number;
  open_price: number;
  high_price: number;
  low_price: number;
  prev_price: number;
}

interface KlineItem {
  thscode: string;
  ticker: string;
  date_ms: number; // 实际 API 字段：K 线日期（毫秒）
  open_price: number; // 实际 API 字段：开盘价
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  turnover: number;
}

export interface IncomeStatement {
  thscode: string;
  ticker: string;
  period: string;
  fiscal_year: number;
  fiscal_period: string;
  report_date_ms: number;
  period_end_ms: number;
  currency: string;
  operating_income: number | null;
  operating_costs: number | null;
  operating_expenses: number | null;
  sales_fee: number | null;
  manage_fee: number | null;
  research_and_development_expenses: number | null;
  operating_profit: number | null;
  interest_expenses: number | null;
  profit_total: number | null;
  income_tax_expense: number | null;
  net_profit: number | null;
  parent_holder_net_profit: number | null;
  basic_eps: number | null;
}

export interface BalanceSheet {
  thscode: string;
  ticker: string;
  period: string;
  fiscal_year: number;
  fiscal_period: string;
  report_date_ms: number;
  period_end_ms: number;
  currency: string;
  assets_total: number | null;
  total_current_assets: number | null;
  non_current_nets_total: number | null;
  cash: number | null;
  accounts_receivable: number | null;
  total_debt: number | null;
  holder_equity_total: number | null;
}

export interface CashFlow {
  thscode: string;
  ticker: string;
  period: string;
  fiscal_year: number;
  fiscal_period: string;
  report_date_ms: number;
  period_end_ms: number;
  currency: string;
  act_cash_flow_net: number | null;
  invest_cash_flow_net: number | null;
  financing_cash_flow_net: number | null;
  pay_fixed_assets_etc_cash: number | null;
  pay_dividends_profits_interest_cash: number | null;
  cash_equivalents_net_addition: number | null;
}

interface FinancialIndicator {
  thscode: string;
  ticker: string;
  period: string;
  fiscal_year: number;
  fiscal_period: string;
  report_date_ms: number;
  period_end_ms: number;
  // 成长能力
  yoy_operating_income: number | null;
  yoy_net_profit: number | null;
  yoy_parent_holder_net_profit: number | null;
  // 盈利能力
  gross_profit_ratio: number | null;
  net_profit_ratio: number | null;
  roe: number | null;
  roa: number | null;
  // 偿债能力
  asset_liability_ratio: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  // 营运能力
  inventory_turnover_days: number | null;
  receivables_turnover_days: number | null;
  // 现金流
  operating_cash_flow_per_share: number | null;
}

interface ValuationItem {
  thscode: string;
  ticker: string;
  pe_ttm: number | null;
  pb_mrq: number | null;
  ps_ttm: number | null;
  pcf_ttm: number | null;
  timestamp: number;
}

// ==================== 通用请求层 ====================

async function apiGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<ApiResponse<T>> {
  if (!API_KEY) {
    console.error('❌ 未配置 HITHINK_API_KEY 环境变量');
    process.exit(1);
  }
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${BASE}${path}${qs}`;
  const res = await fetch(url, {
    headers: { 'X-api-key': API_KEY, 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new Error(
      `API error: code=${json.code}, message=${json.message}, request_id=${json.request_id}`,
    );
  }
  return json;
}

// ==================== 业务接口 ====================

/** 名称/代码 → thscode */
export async function searchTicker(q: string): Promise<TickerItem[]> {
  const res = await apiGet<{ timestamp: number; item: TickerItem[] }>(
    '/api/meta/tickers/search',
    { q },
  );
  return res.data?.item ?? [];
}

/** 代码表（按交易所/资产类别批量分页，如全 A 股代码表）
 * 终止条件：item 数量 < limit 或返回空页；迭代方式：offset += limit
 */
export async function getTickerList(
  exchange = 'SH,SZ,BJ',
  assetType = 'a-share',
  limit = 10000,
  offset = 0,
): Promise<{ total: number; item: TickerItem[] }> {
  const res = await apiGet<{
    timestamp: number;
    total?: number;
    item: TickerItem[];
  }>('/api/meta/tickers/list', {
    exchange,
    asset_type: assetType,
    limit: String(limit),
    offset: String(offset),
  });
  return { total: res.data?.total ?? 0, item: res.data?.item ?? [] };
}

/** 拉取全部 A 股代码表（SH/SZ/BJ，自动分页） */
export async function getAllAShareTickers(
  pageSize = 10000,
): Promise<TickerItem[]> {
  const all: TickerItem[] = [];
  let offset = 0;
  for (;;) {
    const { item, total } = await getTickerList(
      'SH,SZ,BJ',
      'a-share',
      pageSize,
      offset,
    );
    all.push(...item);
    if (item.length < pageSize || (total > 0 && all.length >= total)) break;
    offset += pageSize;
  }
  return all;
}

/** 行情快照 */
export async function getSnapshot(thscodes: string): Promise<SnapshotItem[]> {
  const res = await apiGet<{
    timestamp: number;
    total: number;
    item: SnapshotItem[];
  }>('/api/a-share/prices/snapshot', { thscodes });
  return res.data?.item ?? [];
}

/** 历史 K 线 */
export async function getKline(
  thscode: string,
  days: number,
): Promise<KlineItem[]> {
  const end = Date.now();
  const start = end - days * 86400000;
  const res = await apiGet<{ timestamp: number; item: KlineItem[] }>(
    '/api/a-share/prices/historical',
    {
      thscode,
      interval: '1d',
      start: String(start),
      end: String(end),
    },
  );
  return res.data?.item ?? [];
}

/** 财务报表：利润表 */
export async function getIncomeStatements(
  thscode: string,
  period: 'annual' | 'quarterly' = 'annual',
  limit = 4,
): Promise<IncomeStatement[]> {
  const res = await apiGet<{ timestamp: number; item: IncomeStatement[] }>(
    '/api/a-share/financials/income-statements',
    {
      thscode,
      period,
      limit: String(limit),
    },
  );
  return res.data?.item ?? [];
}

/** 财务报表：资产负债表 */
export async function getBalanceSheets(
  thscode: string,
  period: 'annual' | 'quarterly' = 'annual',
  limit = 4,
): Promise<BalanceSheet[]> {
  const res = await apiGet<{ timestamp: number; item: BalanceSheet[] }>(
    '/api/a-share/financials/balance-sheets',
    {
      thscode,
      period,
      limit: String(limit),
    },
  );
  return res.data?.item ?? [];
}

/** 财务报表：现金流量表 */
export async function getCashFlows(
  thscode: string,
  period: 'annual' | 'quarterly' = 'annual',
  limit = 4,
): Promise<CashFlow[]> {
  const res = await apiGet<{ timestamp: number; item: CashFlow[] }>(
    '/api/a-share/financials/cash-flow-statements',
    {
      thscode,
      period,
      limit: String(limit),
    },
  );
  return res.data?.item ?? [];
}

/** 财务指标（单报告期）
 * report 格式: yyyy-1(一季报)/2(中报)/3(三季报)/4(年报)
 */
export async function getIndicators(
  thscode: string,
  report: string,
): Promise<FinancialIndicator[]> {
  const res = await apiGet<{
    thscode: string;
    report: string;
    abilities: {
      ability: string;
      indicators: { index_id: string; value: string | null }[];
    }[];
  }>('/api/a-share/financials/indicators', {
    thscode,
    report,
  });
  // 将 abilities 扁平化为 FinancialIndicator 格式
  const data = res.data;
  if (!data) return [];
  const indicator: FinancialIndicator = {
    thscode: data.thscode,
    ticker: data.thscode.split('.')[0] || '',
    period: 'annual',
    fiscal_year: parseInt(data.report.split('-')[0] || '0'),
    fiscal_period: data.report.endsWith('-4')
      ? 'FY'
      : data.report.endsWith('-1')
        ? 'Q1'
        : data.report.endsWith('-2')
          ? 'Q2'
          : 'Q3',
    report_date_ms: 0,
    period_end_ms: 0,
    yoy_operating_income: null,
    yoy_net_profit: null,
    yoy_parent_holder_net_profit: null,
    gross_profit_ratio: null,
    net_profit_ratio: null,
    roe: null,
    roa: null,
    asset_liability_ratio: null,
    current_ratio: null,
    quick_ratio: null,
    inventory_turnover_days: null,
    receivables_turnover_days: null,
    operating_cash_flow_per_share: null,
  };
  for (const ability of data.abilities) {
    for (const ind of ability.indicators) {
      const v = ind.value === null ? null : parseFloat(ind.value);
      switch (ind.index_id) {
        case 'calculate_operating_income_yoy_growth_ratio':
          // 上游返回百分数（如 41.4962 = +41.50%），统一 ÷100 为比率（与毛利率/ROE 等兄弟字段口径一致）
          indicator.yoy_operating_income = v === null ? null : v / 100;
          break;
        case 'calculate_parent_holder_net_profit_yoy_growth_ratio':
          indicator.yoy_parent_holder_net_profit = v === null ? null : v / 100;
          indicator.yoy_net_profit = v === null ? null : v / 100;
          break;
        case 'sale_gross_margin':
          indicator.gross_profit_ratio = v ? v / 100 : null;
          break;
        case 'sale_net_interest_ratio':
          indicator.net_profit_ratio = v ? v / 100 : null;
          break;
        case 'index_weighted_avg_roe':
          indicator.roe = v ? v / 100 : null;
          break;
        case 'total_assets_net_ratio':
          indicator.roa = v ? v / 100 : null;
          break;
        case 'assets_debt_ratio':
          indicator.asset_liability_ratio = v ? v / 100 : null;
          break;
        case 'current_ratio':
          indicator.current_ratio = v;
          break;
        case 'quick_ratio':
          indicator.quick_ratio = v;
          break;
        case 'inventory_turnover_ratio':
          indicator.inventory_turnover_days = v;
          break;
        case 'receive_account_turnover_ratio':
          indicator.receivables_turnover_days = v;
          break;
        case 'net_profit_cash_content':
          indicator.operating_cash_flow_per_share = v;
          break;
      }
    }
  }
  return [indicator];
}

/** 财务指标原始块（按 ability 分组，index_id → value 字符串，未做单位换算）
 * 供需要精确处理百分数/比值单位的调用方（如全市场初筛）使用，避免现有 getIndicators 的语义归并歧义。
 */
export async function getIndicatorsRaw(
  thscode: string,
  report: string,
): Promise<Record<string, Record<string, string | null>>> {
  const res = await apiGet<{
    thscode: string;
    report: string;
    abilities: {
      ability: string;
      indicators: { index_id: string; value: string | null }[];
    }[];
  }>('/api/a-share/financials/indicators', { thscode, report });
  const out: Record<string, Record<string, string | null>> = {};
  for (const ab of res.data?.abilities ?? []) {
    out[ab.ability] = {};
    for (const ind of ab.indicators) {
      out[ab.ability]![ind.index_id] = ind.value;
    }
  }
  return out;
}

/** 估值快照 */
export async function getValuations(
  thscodes: string,
): Promise<ValuationItem[]> {
  const res = await apiGet<{ timestamp: number; item: ValuationItem[] }>(
    '/api/a-share/valuations/snapshot',
    { thscodes },
  );
  return res.data?.item ?? [];
}

// ==================== 东财市值补充（同花顺估值端点不含市值）====================

export interface MarketCapItem {
  thscode: string; // 完整 thscode（如 300750.SZ）
  ticker: string;
  name: string;
  price: number | null; // 最新价（元）
  change_pct: number | null; // 涨跌幅（%）
  market_cap: number | null; // 总市值（元）
  industry: string | null; // 所属行业（东财 f100，可能为 "-" 或缺失）
}

const EM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** thscode → 东财 secid（沪=1，深/北=0） */
export function toEastmoneySecid(thscode: string): string {
  const [ticker, ex] = thscode.split('.');
  if (!ticker || !ex) return thscode;
  const prefix = ex.toUpperCase() === 'SH' ? '1' : '0';
  return `${prefix}.${ticker}`;
}

/**
 * 批量获取 A 股实时价格与总市值（东财 push2 ulist.np/get，一次请求多只）
 * 同花顺 hithink 估值端点不返回市值，本函数作为补充数据源。
 * 字段：f2 最新价、f3 涨跌幅、f12 代码、f13 市场、f14 名称、f20 总市值、f100 所属行业（fltt=2 原始数值）
 */
export async function getMarketCapFromEastmoney(
  thscodes: string[],
): Promise<MarketCapItem[]> {
  if (thscodes.length === 0) return [];
  const secids = [...new Set(thscodes.map(toEastmoneySecid))].join(',');
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f2,f3,f12,f13,f14,f20,f100&fltt=2`;
  const res = await fetch(url, {
    headers: { 'User-Agent': EM_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`东财行情 HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { diff?: Record<string, number | string>[] };
  };
  const diff = json.data?.diff ?? [];
  return diff.map((d) => {
    const ticker = String(d['f12'] ?? '');
    const market = String(d['f13'] ?? '0');
    const suffix = market === '1' ? '.SH' : '.SZ';
    const num = (v: unknown) => {
      if (v === null || v === undefined || v === '-' || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const industryRaw = d['f100'];
    const industry =
      industryRaw === null ||
      industryRaw === undefined ||
      industryRaw === '-' ||
      industryRaw === ''
        ? null
        : String(industryRaw);
    return {
      thscode: ticker ? `${ticker}${suffix}` : '',
      ticker,
      name: String(d['f14'] ?? ''),
      price: num(d['f2']),
      change_pct: num(d['f3']),
      market_cap: num(d['f20']),
      industry,
    };
  });
}

// ==================== 同花顺 10jqka 市值/行情主数据源（免鉴权）====================

const JQKA_QUOTE_URL =
  'https://quota-h.10jqka.com.cn/fuyao/common_hq_aggr/quote/v1/multi_last_snapshot';

/** 10jqka market 编码：.SH→17（含科创板）、.SZ→33（含创业板）、.BJ→151（920 新代码段） */
export function to10jqkaKey(
  thscode: string,
): { market: string; code: string } | null {
  const [ticker, ex] = thscode.split('.');
  if (!ticker || !ex) return null;
  const m = ex.toUpperCase();
  const market = m === 'SH' ? '17' : m === 'SZ' ? '33' : m === 'BJ' ? '151' : null;
  if (!market) return null;
  return { market, code: ticker };
}

/**
 * 批量获取 A 股实时价格/涨跌幅/总市值（同花顺 10jqka fuyao 快照，免鉴权，一次请求多只）
 * - 支持 SH(17)/SZ(33)/BJ(151)，北交所须为 920 新代码段（当前全部北交所已切换）
 * - POST body 的 code_list 按 market 分组，data_fields 请求 3541450 总市值 / 24 最新价 / 264648 涨跌幅
 * - 响应字段值与回显 data_fields 数组一一对应（服务端会重排字段顺序），须按回显顺序解析，勿按请求顺序硬编码
 * - 接口不含股票名称与行业字段 → name 置空字符串、industry 置 null
 * 返回结构与 getMarketCapFromEastmoney 的 MarketCapItem 完全一致，便于上层无差别消费。
 */
export async function getMarketCapFrom10jqka(
  thscodes: string[],
): Promise<MarketCapItem[]> {
  if (thscodes.length === 0) return [];
  // 按 market 分组去重，单条目可带 80+ 只
  const groups = new Map<string, string[]>();
  for (const ts of thscodes) {
    const key = to10jqkaKey(ts);
    if (key) {
      const list = groups.get(key.market) ?? [];
      list.push(key.code);
      groups.set(key.market, list);
    }
  }
  if (groups.size === 0) return [];
  const codeList = [...groups.entries()].map(([market, codes]) => ({
    codes: [...new Set(codes)],
    market,
  }));
  const res = await fetch(JQKA_QUOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code_list: codeList,
      trade_class: 'post_market',
      data_fields: ['3541450', '24', '264648'],
      lang: 'zh_hans',
      gpid: 1,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`10jqka 行情 HTTP ${res.status}`);
  const json = (await res.json()) as {
    status_code?: number;
    status_msg?: string;
    data?: {
      quote_data?: {
        market: string;
        code: string;
        data_fields: string[];
        value: (number | null)[][];
      }[];
    };
  };
  if (json.status_code !== 0) {
    throw new Error(
      `10jqka 行情 API error: status_code=${String(json.status_code)} ${json.status_msg ?? ''}`,
    );
  }
  const items: MarketCapItem[] = [];
  for (const q of json.data?.quote_data ?? []) {
    // 取最后一行快照（multi_last_snapshot 语义）；行内值按回显 data_fields 顺序定位
    const row = q.value[q.value.length - 1];
    if (!row) continue;
    const get = (id: string): number | null => {
      const i = q.data_fields.indexOf(id);
      if (i < 0 || i >= row.length) return null;
      const v = row[i];
      return v === null || v === undefined || !Number.isFinite(Number(v))
        ? null
        : Number(v);
    };
    const suffix = q.market === '17' ? '.SH' : q.market === '33' ? '.SZ' : '.BJ';
    const thscode = `${q.code}${suffix}`;
    items.push({
      thscode,
      ticker: q.code,
      name: '', // 10jqka 接口不含名称
      price: get('24'),
      change_pct: get('264648'),
      market_cap: get('3541450'),
      industry: null, // 10jqka 接口不含行业
    });
  }
  return items;
}

/**
 * 市值/价格/涨跌幅主数据源（同花顺 10jqka 优先，东财兜底）— 各调用点统一入口
 * - SH/SZ/BJ 均走 10jqka（market 17/33/151，北交所为 920 新代码段）
 * - 10jqka 失败/缺数/无效代码 → 降级东财 push2；东财请求失败静默忽略（catch 返回空），绝不让东财阻塞主流程
 * - 合并去重：10jqka 条目优先，东财仅补缺（含行业/名称）
 */
export async function getMarketCapWithFallback(
  thscodes: string[],
): Promise<MarketCapItem[]> {
  if (thscodes.length === 0) return [];
  const unique = [...new Set(thscodes)];
  const jqkaCandidates = unique.filter((t) => to10jqkaKey(t) !== null);
  const emOnly = unique.filter((t) => to10jqkaKey(t) === null); // 无效格式代码等

  let jqkaItems: MarketCapItem[] = [];
  if (jqkaCandidates.length > 0) {
    try {
      jqkaItems = await getMarketCapFrom10jqka(jqkaCandidates);
    } catch (err) {
      // 10jqka 失败降级东财，不阻塞主流程
      console.warn(
        `[hithink] 10jqka 行情失败，降级东财: ${(err as Error).message}`,
      );
      jqkaItems = [];
    }
  }

  // 10jqka 缺数（未返回该 thscode 或市值缺失）→ 也交给东财补齐
  const got = new Set(jqkaItems.map((i) => i.thscode));
  const missing = jqkaCandidates.filter(
    (t) => !got.has(t) || jqkaItems.find((i) => i.thscode === t)?.market_cap == null,
  );
  const needEm = [...new Set([...emOnly, ...missing])];

  let emItems: MarketCapItem[] = [];
  if (needEm.length > 0) {
    try {
      emItems = await getMarketCapFromEastmoney(needEm);
    } catch {
      // 东财失败静默忽略（主流程不受影响，字段保持 null）
      emItems = [];
    }
    // 东财将北交所(f13=0)一律映射为 .SZ，与输入 .BJ 不一致 → 按输入 thscode 修正后缀
    const emThscodeFix = new Map<string, string>(
      needEm.map((t) => [t.split('.')[0] ?? t, t]),
    );
    for (const it of emItems) {
      const fixed = emThscodeFix.get(it.ticker);
      if (fixed && it.thscode !== fixed) it.thscode = fixed;
    }
  }

  // 合并去重：10jqka 优先，东财补缺
  const byCode = new Map<string, MarketCapItem>();
  for (const it of jqkaItems) byCode.set(it.thscode, it);
  for (const it of emItems) if (!byCode.has(it.thscode)) byCode.set(it.thscode, it);
  return [...byCode.values()];
}

/**
 * 历史日 K（东财 push2his，前复权）— 同花顺 K 线超时/失败时的降级数据源。
 * 字段：f51 日期、f52 开盘、f53 收盘、f54 最高、f55 最低、f56 成交量（手）。
 * 返回字段与同花顺 KlineItem 对齐（date_ms / open_price / ...），便于上层统一映射。
 */
export async function getKlineFromEastmoney(
  thscode: string,
  days = 250,
): Promise<
  {
    date_ms: number;
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;
    volume: number;
  }[]
> {
  const secid = toEastmoneySecid(thscode);
  const lmt = Math.max(1, Math.min(1000, Math.round(days)));
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}&klt=101&fqt=1&lmt=${lmt}&end=20500101` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`;
  const res = await fetch(url, {
    headers: { 'User-Agent': EM_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`东财 K 线 HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { klines?: string[] } };
  const rows = json.data?.klines ?? [];
  return rows.map((line) => {
    const [date, open, close, high, low, volume] = line.split(',');
    return {
      // 东财返回 YYYY-MM-DD，转北京时间 0 点时间戳（与同花顺 date_ms 口径一致）
      date_ms: new Date(`${date}T00:00:00+08:00`).getTime(),
      open_price: Number(open),
      high_price: Number(high),
      low_price: Number(low),
      close_price: Number(close),
      volume: Number(volume),
    };
  });
}
