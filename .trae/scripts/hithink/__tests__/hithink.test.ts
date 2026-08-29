import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

const credentialNames = [
  "HITHINK_FINANCE_API_KEY",
  "HITHINK_API_KEY",
  "FUYAO_TOKEN",
] as const;
const originalCredentials = new Map(
  credentialNames.map((name) => [name, process.env[name]]),
);

beforeAll(() => {
  for (const name of credentialNames) delete process.env[name];
});

afterAll(() => {
  for (const name of credentialNames) {
    const value = originalCredentials.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("hithink API credentials", () => {
  it("uses built-in fallback key when no env credential configured", async () => {
    const { searchTicker } = await import(`../hithink.ts?missing-credentials=${Date.now()}`);
    const items = await searchTicker("600519");
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((i) => i.thscode === "600519.SH")).toBe(true);
  });
});

describe("toEastmoneySecid", () => {
  it("maps SH → 1.xxx, SZ → 0.xxx", async () => {
    const { toEastmoneySecid } = await import(`../hithink.ts?secid=${Date.now()}`);
    expect(toEastmoneySecid("600519.SH")).toBe("1.600519");
    expect(toEastmoneySecid("000001.SZ")).toBe("0.000001");
    expect(toEastmoneySecid("invalid")).toBe("invalid");
  });
});

describe("getMarketCapFromEastmoney", () => {
  it("maps f20 市值 / f100 行业，并对缺失值置 null", async () => {
    const { getMarketCapFromEastmoney } = await import(`../hithink.ts?em=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      expect(s).toContain("fields=f2,f3,f12,f13,f14,f20,f100");
      return new Response(
        JSON.stringify({
          data: {
            diff: [
              { f2: 1718, f3: 1.2, f12: "600519", f13: "1", f14: "贵州茅台", f20: 2.15e12, f100: "白酒" },
              { f2: 190, f3: -2.1, f12: "300750", f13: "0", f14: "宁德时代", f20: 8.4e11, f100: "-" },
              { f2: 5, f3: 0, f12: "000001", f13: "0", f14: "平安银行", f20: 2.5e11, f100: "" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const items = await getMarketCapFromEastmoney(["600519.SH", "300750.SZ", "000001.SZ"]);
      expect(items).toHaveLength(3);
      const maotai = items.find((i) => i.thscode === "600519.SH")!;
      expect(maotai.industry).toBe("白酒");
      expect(maotai.market_cap).toBe(2.15e12);
      const catl = items.find((i) => i.thscode === "300750.SZ")!;
      expect(catl.industry).toBeNull();
      const pab = items.find((i) => i.thscode === "000001.SZ")!;
      expect(pab.industry).toBeNull();
      expect(pab.price).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("空列表直接返回，不发请求", async () => {
    const { getMarketCapFromEastmoney } = await import(`../hithink.ts?em2=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    try {
      const items = await getMarketCapFromEastmoney([]);
      expect(items).toEqual([]);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getTickerList", () => {
  it("解析分页代码表（含 total）", async () => {
    const { getTickerList } = await import(`../hithink.ts?list=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      expect(s).toContain("/api/meta/tickers/list");
      expect(s).toContain("asset_type=a-share");
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            timestamp: 123,
            total: 2,
            item: [
              { thscode: "600519.SH", ticker: "600519", name: "贵州茅台", exchange: "SH", asset_type: "a-share", currency: "CNY" },
              { thscode: "000001.SZ", ticker: "000001", name: "平安银行", exchange: "SZ", asset_type: "a-share", currency: "CNY" },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const { total, item } = await getTickerList("SH,SZ", "a-share", 10000, 0);
      expect(total).toBe(2);
      expect(item.map((i) => i.thscode)).toEqual(["600519.SH", "000001.SZ"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getIndicators", () => {
  it("用真实 index_id 映射 yoy 字段（calculate_* 前缀）", async () => {
    const { getIndicators } = await import(`../hithink.ts?gi=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            thscode: "600176.SH",
            report: "2025-4",
            abilities: [
              { ability: "growth", indicators: [
                { index_id: "calculate_operating_income_yoy_growth_ratio", value: "19.08" },
                { index_id: "calculate_parent_holder_net_profit_yoy_growth_ratio", value: "34.38" },
              ] },
              { ability: "profitability", indicators: [{ index_id: "index_weighted_avg_roe", value: "10.62" }] },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    try {
      const [ind] = await getIndicators("600176.SH", "2025-4");
      // 上游 yoy 为百分数（19.08 = +19.08%），映射 ÷100 为比率
      expect(ind.yoy_operating_income).toBeCloseTo(0.1908);
      expect(ind.yoy_net_profit).toBeCloseTo(0.3438);
      expect(ind.yoy_parent_holder_net_profit).toBeCloseTo(0.3438);
      expect(ind.roe).toBeCloseTo(0.1062);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getIndicatorsRaw", () => {
  it("按 ability 分组返回原始字符串值", async () => {
    const { getIndicatorsRaw } = await import(`../hithink.ts?raw=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      expect(s).toContain("/api/a-share/financials/indicators");
      expect(s).toContain("report=2025-4");
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            thscode: "600519.SH",
            report: "2025-4",
            abilities: [
              { ability: "growth", indicators: [{ index_id: "operating_income_yoy_growth_ratio", value: "15.2" }] },
              { ability: "cash-flow", indicators: [{ index_id: "net_profit_cash_content", value: "128.5" }] },
              { ability: "solvency", indicators: [{ index_id: "assets_debt_ratio", value: "20.1" }] },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const raw = await getIndicatorsRaw("600519.SH", "2025-4");
      expect(raw["growth"]["operating_income_yoy_growth_ratio"]).toBe("15.2");
      expect(raw["cash-flow"]["net_profit_cash_content"]).toBe("128.5");
      expect(raw["solvency"]["assets_debt_ratio"]).toBe("20.1");
      expect(raw["missing"]).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("to10jqkaKey", () => {
  it("映射 SH→17、SZ→33、BJ→151", async () => {
    const { to10jqkaKey } = await import(`../hithink.ts?jqk=${Date.now()}`);
    expect(to10jqkaKey("600519.SH")).toEqual({ market: "17", code: "600519" });
    expect(to10jqkaKey("688825.SH")).toEqual({ market: "17", code: "688825" });
    expect(to10jqkaKey("300750.SZ")).toEqual({ market: "33", code: "300750" });
    expect(to10jqkaKey("000001.SZ")).toEqual({ market: "33", code: "000001" });
    expect(to10jqkaKey("920002.BJ")).toEqual({ market: "151", code: "920002" });
    expect(to10jqkaKey("833171.BJ")).toEqual({ market: "151", code: "833171" });
    expect(to10jqkaKey("invalid")).toBeNull();
  });
});

describe("getMarketCapFrom10jqka", () => {
  const jqkaOkBody = (quoteData: unknown[]) =>
    JSON.stringify({ status_code: 0, status_msg: "ok", data: { quote_data: quoteData }, fail_params: null });

  it("按 market 分组请求，并按回显 data_fields 顺序解析字段", async () => {
    const { getMarketCapFrom10jqka } = await import(`../hithink.ts?jq1=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain("multi_last_snapshot");
      const body = JSON.parse(String(init?.body)) as { code_list: { market: string; codes: string[] }[] };
      // 多 market 分组（SH/SZ 各一）
      const sh = body.code_list.find((g) => g.market === "17")!;
      const sz = body.code_list.find((g) => g.market === "33")!;
      expect(sh.codes.sort()).toEqual(["600519", "688825"]);
      expect(sz.codes.sort()).toEqual(["000001", "300750"]);
      // 回显 data_fields 顺序与请求不同（服务端会重排），须按回显顺序解析
      return new Response(
        jqkaOkBody([
          { market: "17", code: "600519", data_fields: ["24", "3541450", "264648"], value: [[1297.35, 1621855900000, 5.1]] },
          { market: "33", code: "300750", data_fields: ["3541450", "24", "264648"], value: [[840000000000, 190.5, -2.1]] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const items = await getMarketCapFrom10jqka(["600519.SH", "688825.SH", "300750.SZ", "000001.SZ"]);
      expect(items).toHaveLength(2); // 服务端仅回显 2 只，缺数由上层兜底
      const maotai = items.find((i) => i.thscode === "600519.SH")!;
      expect(maotai.price).toBe(1297.35);
      expect(maotai.market_cap).toBe(1621855900000);
      expect(maotai.change_pct).toBe(5.1);
      const catl = items.find((i) => i.thscode === "300750.SZ")!;
      expect(catl.price).toBe(190.5);
      expect(catl.market_cap).toBe(840000000000);
      expect(catl.change_pct).toBe(-2.1);
      // 10jqka 接口不含名称/行业 → name 空串、industry null
      expect(maotai.name).toBe("");
      expect(maotai.industry).toBeNull();
      expect(maotai.ticker).toBe("600519");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("空响应返回 []", async () => {
    const { getMarketCapFrom10jqka } = await import(`../hithink.ts?jq2=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(jqkaOkBody([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    try {
      const items = await getMarketCapFrom10jqka(["600519.SH"]);
      expect(items).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("无效代码跳过，不发请求直接返回空", async () => {
    const { getMarketCapFrom10jqka } = await import(`../hithink.ts?jq3=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response(jqkaOkBody([]), { status: 200 });
    });
    try {
      const items = await getMarketCapFrom10jqka(["invalid", "600519"]);
      expect(items).toEqual([]);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it(".BJ 按 market 151 分组请求并解析为 .BJ 后缀", async () => {
    const { getMarketCapFrom10jqka } = await import(`../hithink.ts?jq4=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { code_list: { market: string; codes: string[] }[] };
      const bj = body.code_list.find((g) => g.market === "151")!;
      expect(bj.codes).toEqual(["920002"]);
      return new Response(
        jqkaOkBody([
          { market: "151", code: "920002", data_fields: ["24", "3541450", "264648"], value: [[51.3, 3268023200, -0.72]] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      const items = await getMarketCapFrom10jqka(["920002.BJ"]);
      expect(items).toHaveLength(1);
      expect(items[0].thscode).toBe("920002.BJ");
      expect(items[0].price).toBe(51.3);
      expect(items[0].market_cap).toBe(3268023200);
      expect(items[0].change_pct).toBe(-0.72);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getMarketCapWithFallback", () => {
  const emBody = (rows: Record<string, number | string>[]) => JSON.stringify({ data: { diff: rows } });
  const jqkaSingle = (market: string, code: string, row: (number | null)[]) =>
    JSON.stringify({
      status_code: 0,
      data: {
        quote_data: [{ market, code, data_fields: ["24", "3541450", "264648"], value: [row] }],
      },
    });

  it("10jqka 失败时降级东财（不抛错）", async () => {
    const { getMarketCapWithFallback } = await import(`../hithink.ts?fb1=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    const warn = console.warn;
    console.warn = () => {};
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.includes("10jqka")) throw new Error("10jqka 超时");
      return new Response(
        emBody([{ f2: 1718, f3: 1.2, f12: "600519", f13: "1", f14: "贵州茅台", f20: 2.15e12, f100: "白酒" }]),
        { status: 200 },
      );
    });
    try {
      const items = await getMarketCapWithFallback(["600519.SH"]);
      expect(items).toHaveLength(1);
      expect(items[0].thscode).toBe("600519.SH");
      expect(items[0].market_cap).toBe(2.15e12);
      expect(items[0].industry).toBe("白酒"); // 东财补行业
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = warn;
    }
  });

  it("北交所与沪深同走 10jqka（market 151/17/33），无缺数时不触发东财", async () => {
    const { getMarketCapWithFallback } = await import(`../hithink.ts?fb2=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    let emCalled = false;
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("10jqka")) {
        const body = JSON.parse(String(init?.body)) as { code_list: { market: string }[] };
        const markets = body.code_list.map((g) => g.market).sort();
        // 10jqka 请求应同时包含 SH(17)/SZ(33)/BJ(151)
        expect(markets).toEqual(["151", "17", "33"]);
        return new Response(
          JSON.stringify({
            status_code: 0,
            status_msg: "ok",
            data: {
              quote_data: [
                { market: "17", code: "600519", data_fields: ["24", "3541450", "264648"], value: [[1297.35, 1621855900000, 5.1]] },
                { market: "33", code: "000001", data_fields: ["24", "3541450", "264648"], value: [[11.64, 226078950000, 0.5]] },
                { market: "151", code: "920002", data_fields: ["24", "3541450", "264648"], value: [[51.3, 3268023200, -0.72]] },
              ],
            },
          }),
          { status: 200 },
        );
      }
      emCalled = true;
      return new Response(emBody([]), { status: 200 });
    });
    try {
      const items = await getMarketCapWithFallback(["600519.SH", "000001.SZ", "920002.BJ"]);
      expect(emCalled).toBe(false); // 10jqka 全覆盖，不触发东财
      expect(items).toHaveLength(3);
      const maotai = items.find((i) => i.thscode === "600519.SH")!;
      expect(maotai.market_cap).toBe(1621855900000);
      const pab = items.find((i) => i.thscode === "000001.SZ")!;
      expect(pab.market_cap).toBe(226078950000);
      const bj = items.find((i) => i.thscode === "920002.BJ")!;
      expect(bj.market_cap).toBe(3268023200);
      expect(bj.industry).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("10jqka 缺数时东财补缺并合并去重（10jqka 条目优先）", async () => {
    const { getMarketCapWithFallback } = await import(`../hithink.ts?fb3=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.includes("10jqka")) {
        return new Response(jqkaSingle("17", "600519", [1297.35, 1621855900000, 5.1]), { status: 200 });
      }
      // 东财只补缺 000001.SZ
      expect(s).toContain("secids=0.000001");
      return new Response(
        emBody([{ f2: 11.2, f3: 0.5, f12: "000001", f13: "0", f14: "平安银行", f20: 2.5e11, f100: "银行" }]),
        { status: 200 },
      );
    });
    try {
      const items = await getMarketCapWithFallback(["600519.SH", "000001.SZ"]);
      expect(items).toHaveLength(2);
      const maotai = items.find((i) => i.thscode === "600519.SH")!;
      expect(maotai.market_cap).toBe(1621855900000);
      expect(maotai.industry).toBeNull(); // 10jqka 条目优先（无行业）
      const pab = items.find((i) => i.thscode === "000001.SZ")!;
      expect(pab.market_cap).toBe(2.5e11);
      expect(pab.industry).toBe("银行");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("东财失败静默忽略，仅返回 10jqka 结果（不阻塞主流程）", async () => {
    const { getMarketCapWithFallback } = await import(`../hithink.ts?fb4=${Date.now()}`);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.includes("10jqka")) {
        return new Response(jqkaSingle("33", "300750", [190.5, 840000000000, -2.1]), { status: 200 });
      }
      throw new Error("东财被限流");
    });
    try {
      const items = await getMarketCapWithFallback(["300750.SZ", "833171.BJ"]);
      // 300750 来自 10jqka；833171 东财失败 → 缺失但不抛错
      expect(items).toHaveLength(1);
      expect(items[0].thscode).toBe("300750.SZ");
      expect(items[0].market_cap).toBe(840000000000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
