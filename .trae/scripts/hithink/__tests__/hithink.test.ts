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
