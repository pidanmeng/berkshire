/**
 * 投研信源索引库 — 通用信源导航（不限定行业）
 *
 * 用法（配合脚本）：
 *   bun run fetch-source.ts <url>                      # 抓取 URL 正文
 *   bun run search.ts --list                           # 列出信源索引
 *   bun run search.ts --search "关键词" --type 公告      # 按类型推荐信源 URL
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --announcements     # 代码→公告
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --reports           # 代码→研报
 *   bun run .trae/scripts/stock-data/stock.ts --code 002714 --financial         # 代码→财报（定期报告）
 *   bun run .trae/scripts/stock-data/stock.ts --name 牧原股份                    # 名称→代码
 *   bun run evaluate.ts --code 600519                  # 估值快照 + 四大师评估框架
 */

export type SourceType =
  | '研报'
  | '公告'
  | '财报'
  | '财经新闻'
  | '官方统计'
  | '舆情社区';

export interface SourceEntry {
  name: string;
  url: string;
  type: SourceType;
  note: string;
  /** 搜索 URL 模板，用 {q} 占位查询词 */
  searchTemplate?: string;
}

/** 各类型信源域名特征 → 用于 URL 自动分类 */
export const DOMAIN_RULES: { pattern: RegExp; type: SourceType }[] = [
  // ---- 官方统计 / 监管 ----
  { pattern: /stats\.gov\.cn/, type: '官方统计' },
  { pattern: /gov\.cn/, type: '官方统计' },
  { pattern: /ndrc\.gov\.cn/, type: '官方统计' },
  { pattern: /pbc\.gov\.cn/, type: '官方统计' },
  { pattern: /mof\.gov\.cn/, type: '官方统计' },
  { pattern: /miit\.gov\.cn/, type: '官方统计' },
  { pattern: /mofcom\.gov\.cn/, type: '官方统计' },
  { pattern: /customs\.gov\.cn/, type: '官方统计' },
  // ---- 交易所 / 公告 ----
  { pattern: /cninfo\.com\.cn/, type: '公告' },
  { pattern: /sse\.com\.cn/, type: '公告' },
  { pattern: /szse\.cn/, type: '公告' },
  { pattern: /hkexnews\.hk/, type: '公告' },
  { pattern: /sec\.gov/, type: '公告' },
  // ---- 财报 / 公司 IR ----
  { pattern: /(ir|investor|investors)\./, type: '财报' },
  // ---- 研报聚合（先于财经媒体，避免 eastmoney 命中财经新闻） ----
  {
    pattern:
      /(pdf\.dfcfw|fxbaogao|hibor|research\.eastmoney|reportapi\.eastmoney|data\.eastmoney\.com\/report)/,
    type: '研报',
  },
  {
    pattern: /(lhratings|shenwan|dongxing|eastsec|gtja|cicc|htsec|swsresearch)/,
    type: '研报',
  },
  // ---- 财经媒体 ----
  { pattern: /(xinhuanet|people\.com\.cn|news\.cn)/, type: '财经新闻' },
  {
    pattern:
      /(eastmoney|10jqka|hexun|sina\.com\.cn|163\.com|qq\.com|sohu\.com|cls\.cn|yicai\.com|nbd\.com\.cn|zqrb\.cn|stcn\.com|cs\.com\.cn|21jingji|caixin\.com)/,
    type: '财经新闻',
  },
  // ---- 社区 ----
  { pattern: /(xueqiu|zhihu|tieba|weibo)/, type: '舆情社区' },
];

/** 通用信源（跨行业，不含行业垂直站） */
export const SOURCES: SourceEntry[] = [
  // ================= 一、券商研报 =================
  {
    name: '东方财富研报中心',
    url: 'https://data.eastmoney.com/report/',
    type: '研报',
    note: '覆盖主流券商研报，可按行业/个股检索，PDF 全文可下载',
    searchTemplate:
      'https://data.eastmoney.com/report/info/industry.html?name={q}',
  },
  {
    name: '慧博投研资讯',
    url: 'https://www.hibor.com.cn/',
    type: '研报',
    note: '研报聚合最全（含历史研报），需注册，部分内容付费',
    searchTemplate: 'https://www.hibor.com.cn/list/{q}.html',
  },
  {
    name: '研报客（fxbaogao）',
    url: 'https://www.fxbaogao.com/',
    type: '研报',
    note: '券商研报聚合站，PDF 直链多',
  },
  {
    name: '新浪财经-研报',
    url: 'https://stock.finance.sina.com.cn/stock/go.php/vReport_List/kind/search/index.phtml',
    type: '研报',
    note: '按股票代码检索研报',
    searchTemplate:
      'https://stock.finance.sina.com.cn/stock/go.php/vReport_List/kind/search/index.phtml?symbol={q}',
  },
  {
    name: '萝卜投研',
    url: 'https://robo.datayes.com/',
    type: '研报',
    note: 'AI 投研平台，行业报告与数据',
  },
  {
    name: '东方财富-板块行情',
    url: 'https://quote.eastmoney.com/center/gridlist.html#hs_a_board',
    type: '研报',
    note: 'A 股板块/行业行情与成分股（可用 sector.ts 脚本查询）',
  },
  // ================= 二、企业公告 / 财报 =================
  {
    name: '巨潮资讯网（cninfo）',
    url: 'https://www.cninfo.com.cn/new/index',
    type: '公告',
    note: 'A 股上市公司公告与定期报告法定披露平台（最权威），可用 stock.ts 脚本直接查询',
    searchTemplate:
      'https://www.cninfo.com.cn/new/fulltextSearch/full?searchkey={q}&sdate=&edate=&isfulltext=false&sortName=pubdate&sortType=desc',
  },
  {
    name: '上交所（SSE）',
    url: 'https://www.sse.com.cn/',
    type: '公告',
    note: '沪市上市公司公告、定期报告',
  },
  {
    name: '深交所（SZSE）',
    url: 'https://www.szse.cn/',
    type: '公告',
    note: '深市上市公司公告、定期报告',
  },
  {
    name: '港交所披露易（HKEX）',
    url: 'https://www1.hkexnews.hk/',
    type: '公告',
    note: '港股上市公司公告与年报',
  },
  {
    name: '美国 SEC EDGAR',
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany',
    type: '公告',
    note: '美股公司 10-K/10-Q/8-K',
  },
  // ================= 三、财经新闻 =================
  {
    name: '新华财经',
    url: 'https://www.news.cn/fortune/',
    type: '财经新闻',
    note: '权威政策与产业报道',
  },
  {
    name: '证券时报网',
    url: 'https://www.stcn.com/',
    type: '财经新闻',
    note: '权威证券类媒体',
  },
  {
    name: '证券日报',
    url: 'https://www.zqrb.cn/',
    type: '财经新闻',
    note: '上市公司深度报道',
  },
  {
    name: '财联社（电报）',
    url: 'https://www.cls.cn/telegraph',
    type: '财经新闻',
    note: '实时快讯、盘面异动',
  },
  {
    name: '第一财经',
    url: 'https://www.yicai.com/',
    type: '财经新闻',
    note: '宏观与产业报道',
  },
  {
    name: '每经网',
    url: 'https://www.nbd.com.cn/',
    type: '财经新闻',
    note: '深度财经报道',
  },
  {
    name: '新浪财经',
    url: 'https://finance.sina.com.cn/',
    type: '财经新闻',
    note: '资讯聚合，覆盖面广',
  },
  // ================= 四、官方统计 =================
  {
    name: '国家统计局',
    url: 'https://www.stats.gov.cn/',
    type: '官方统计',
    note: 'GDP/CPI/工业/农业生产数据',
  },
  {
    name: '工信部',
    url: 'https://www.miit.gov.cn/',
    type: '官方统计',
    note: '工业运行、产量数据',
  },
  {
    name: '海关总署',
    url: 'https://www.customs.gov.cn/',
    type: '官方统计',
    note: '进出口数据',
  },
  {
    name: '发改委',
    url: 'https://www.ndrc.gov.cn/',
    type: '官方统计',
    note: '价格监测、政策',
  },
  {
    name: '商务部',
    url: 'https://www.mofcom.gov.cn/',
    type: '官方统计',
    note: '消费、外贸政策',
  },
  {
    name: '央行（PBoC）',
    url: 'https://www.pbc.gov.cn/',
    type: '官方统计',
    note: '货币政策、金融数据',
  },
  {
    name: '财政部',
    url: 'https://www.mof.gov.cn/',
    type: '官方统计',
    note: '财政数据',
  },
  // ================= 五、舆情社区 =================
  {
    name: '雪球',
    url: 'https://xueqiu.com/',
    type: '舆情社区',
    note: '投资者讨论、个股情绪',
  },
  {
    name: '知乎',
    url: 'https://www.zhihu.com/',
    type: '舆情社区',
    note: '行业深度问答',
  },
];

/** 判断 URL 属于哪种信源类型 */
export function classifyUrl(url: string): SourceType {
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(url)) return rule.type;
  }
  return '财经新闻';
}
