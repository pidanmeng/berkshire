import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyUniverseFilters,
  assignPool,
  buildScreenerOutput,
  chunk,
  isHighLeverageIndustry,
  loadIndicatorsCache,
  parseIndicatorsYear,
  pct,
  scoreRow,
  toCsv,
  toDigest,
  type FullRow,
  type StageAOutput,
} from "../screen.ts";

const row = (over: Partial<FullRow>): FullRow => ({
  thscode: "600519.SH", ticker: "600519", name: "贵州茅台", exchange: "SH",
  price: 1700, changePct: 1.2, marketCapYi: 21300, peTtm: 28, pbMrq: 8, industry: "白酒",
  ...over,
});

describe("applyUniverseFilters", () => {
  const opts = { minMcapYi: 10, excludeSt: true };

  it("ST / 退市 → excluded", () => {
    const { excluded } = applyUniverseFilters(
      [row({ thscode: "000001.SZ", ticker: "000001", name: "ST某某" })],
      opts,
    );
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toContain("ST");
  });

  it("市值 < minMcapYi → excluded（微盘）", () => {
    const { excluded } = applyUniverseFilters([row({ marketCapYi: 8 })], opts);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toContain("微盘");
  });

  it("PE<0 → loss 亏损池", () => {
    const { loss, main } = applyUniverseFilters([row({ peTtm: -15 })], opts);
    expect(loss).toHaveLength(1);
    expect(main).toHaveLength(0);
  });

  it("正常标的 → main", () => {
    const { main, loss, excluded } = applyUniverseFilters([row({})], opts);
    expect(main).toHaveLength(1);
    expect(loss).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });

  it("excludeSt=false 时保留 ST", () => {
    const { excluded, main } = applyUniverseFilters(
      [row({ thscode: "000001.SZ", ticker: "000001", name: "ST某某" })],
      { minMcapYi: 10, excludeSt: false },
    );
    expect(excluded).toHaveLength(0);
    expect(main).toHaveLength(1);
  });
});

describe("pct 单位换算", () => {
  it("百分数 → 小数；null/空/非法 → null", () => {
    expect(pct("15.2")).toBeCloseTo(0.152);
    expect(pct("-3.5")).toBeCloseTo(-0.035);
    expect(pct(null)).toBeNull();
    expect(pct("")).toBeNull();
    expect(pct("-")).toBeNull();
    expect(pct("abc")).toBeNull();
  });
});

describe("parseIndicatorsYear", () => {
  const raw = {
    growth: {
      calculate_operating_income_yoy_growth_ratio: "15.2",
      calculate_parent_holder_net_profit_yoy_growth_ratio: "19.5",
    },
    profitability: { index_weighted_avg_roe: "30.1", sale_gross_margin: "91.5", sale_net_interest_ratio: "52.3" },
    solvency: { assets_debt_ratio: "20.1" },
    "cash-flow": { net_profit_cash_content: "128.5" },
  };

  it("映射五类指标并统一 ÷100", () => {
    const y = parseIndicatorsYear(raw);
    expect(y.roe).toBeCloseTo(0.301);
    expect(y.grossMargin).toBeCloseTo(0.915);
    expect(y.netMargin).toBeCloseTo(0.523);
    expect(y.ocfToNi).toBeCloseTo(1.285);
    expect(y.debtRatio).toBeCloseTo(0.201);
    expect(y.revenueYoy).toBeCloseTo(0.152);
    expect(y.netProfitYoy).toBeCloseTo(0.195);
  });

  it("真实 API 响应结构（中国巨石 2025-4）", () => {
    const real = {
      growth: {
        calculate_operating_income_yoy_growth_ratio: "19.07881900",
        calculate_operating_profit_yoy_growth_ratio: "45.60051600",
        total_assets_growth_ratio: "2.3400",
        calculate_parent_holder_net_profit_yoy_growth_ratio: "34.38494700",
      },
      profitability: {
        total_assets_net_ratio: "6.3243",
        index_deduct_weighted_avg_roe: "11.2500",
        sale_gross_margin: "33.1183",
        sale_net_interest_ratio: "18.0887",
        index_weighted_avg_roe: "10.6200",
      },
      solvency: { current_ratio: "1.0486", cash_ratio: "26.35962400", quick_ratio: "0.6847", earned_interest_multiple: "16.6093", assets_debt_ratio: "40.4136" },
      "cash-flow": { net_profit_cash_content: "127.85131100", cash_operating_index: "0.60293240", operating_cash_flow_net_divide_income: "22.2474", cash_meet_invest_ratio: "1.69615095" },
    };
    const y = parseIndicatorsYear(real);
    expect(y.roe).toBeCloseTo(0.1062);
    expect(y.grossMargin).toBeCloseTo(0.331183);
    expect(y.netMargin).toBeCloseTo(0.180887);
    expect(y.ocfToNi).toBeCloseTo(1.27851311);
    expect(y.debtRatio).toBeCloseTo(0.404136);
    expect(y.revenueYoy).toBeCloseTo(0.19078819);
    expect(y.netProfitYoy).toBeCloseTo(0.34384947);
  });

  it("缺失 ability 不抛错", () => {
    const y = parseIndicatorsYear({});
    expect(y.roe).toBeNull();
    expect(y.ocfToNi).toBeNull();
  });
});

describe("scoreRow + assignPool 集成", () => {
  const cur = {
    roe: 0.30, grossMargin: 0.91, netMargin: 0.52, ocfToNi: 1.05, debtRatio: 0.20,
    revenueYoy: 0.17, netProfitYoy: 0.19,
  };

  it("优质公司 → GREEN → star 池", () => {
    const base = scoreRow(row({ peTtm: 28 }), cur);
    expect(base.verdict).toBe("GREEN");
    expect(base.overallScore).toBeGreaterThanOrEqual(7);
    expect(assignPool(base).pool).toBe("star");
  });

  it("亏损 + 高杠杆 + 双负增长 → RED → exclude 池", () => {
    const base = scoreRow(row({ peTtm: -5 }), {
      roe: -0.05, grossMargin: 0.08, netMargin: -0.02, ocfToNi: 0.30, debtRatio: 0.82,
      revenueYoy: -0.15, netProfitYoy: -0.4,
    });
    expect(base.verdict).toBe("RED");
    expect(assignPool(base).pool).toBe("exclude");
  });

  it("YELLOW（含低分）→ watch；RED → exclude", () => {
    const midHigh = scoreRow(row({ peTtm: 22 }), {
      roe: 0.12, grossMargin: 0.28, netMargin: 0.08, ocfToNi: 0.85, debtRatio: 0.45,
      revenueYoy: 0.08, netProfitYoy: 0.06,
    });
    expect(midHigh.verdict).toBe("YELLOW");
    expect(assignPool(midHigh).pool).toBe("watch");

    const midLow = scoreRow(row({ peTtm: 30 }), {
      roe: 0.08, grossMargin: 0.22, netMargin: 0.06, ocfToNi: 0.9, debtRatio: 0.48,
      revenueYoy: 0.03, netProfitYoy: 0.02,
    });
    expect(midLow.verdict).toBe("YELLOW");
    expect(assignPool(midLow).pool).toBe("watch");

    const red = scoreRow(row({ peTtm: -5 }), {
      roe: -0.05, grossMargin: 0.08, netMargin: -0.02, ocfToNi: 0.30, debtRatio: 0.82,
      revenueYoy: -0.15, netProfitYoy: -0.4,
    });
    expect(assignPool(red).pool).toBe("exclude");
  });

  it("连续两年复核：roePrev 落盘", () => {
    const base = scoreRow(row({}), cur, { ...cur, roe: 0.12 });
    expect(base.roePrev).toBeCloseTo(0.12);
  });
});

describe("buildScreenerOutput 分池统计", () => {
  it("meta.counts 与 pools 一致", () => {
    const stageA: StageAOutput = {
      meta: { generatedAt: "2026-08-16T00:00:00.000Z", quoteAsOf: "x", minMcapYi: 10, excludeSt: true },
      main: [row({}), row({ thscode: "000001.SZ", ticker: "000001", name: "平安银行", industry: "银行" })],
      loss: [row({ thscode: "000002.SZ", ticker: "000002", name: "亏损股", peTtm: -5 })],
      excluded: [{ row: row({ name: "ST甲" }), reason: "ST/退市风险标识" }],
    };
    const cur = {
      roe: 0.30, grossMargin: 0.91, netMargin: 0.52, ocfToNi: 1.05, debtRatio: 0.20,
      revenueYoy: 0.17, netProfitYoy: 0.19,
    };
    const rows = [
      { ...scoreRow(stageA.main[0], cur), pool: "star" as const, highLeverageNote: false },
      { ...scoreRow(stageA.main[1], { ...cur, debtRatio: 0.8 }), pool: "watch" as const, highLeverageNote: true },
      { ...scoreRow(stageA.loss[0], { ...cur, roe: -0.02, netProfitYoy: -0.3, peTtm: -5 }), pool: "loss" as const, highLeverageNote: false },
    ];
    const out = buildScreenerOutput(stageA, rows, {
      report: "2025-4", prevReport: "2024-4", minMcapYi: 10, excludeSt: true, concurrency: 20,
    });
    expect(out.meta.counts.universe).toBe(4);
    expect(out.meta.counts.star).toBe(1);
    expect(out.meta.counts.watch).toBe(1);
    expect(out.meta.counts.loss).toBe(1);
    expect(out.pools.star[0].thscode).toBe("600519.SH");
    expect(out.pools.watch[0].highLeverageNote).toBe(true);
  });
});

describe("isHighLeverageIndustry", () => {
  it("银行/保险/证券/地产 → true；白酒 → false", () => {
    expect(isHighLeverageIndustry("银行")).toBe(true);
    expect(isHighLeverageIndustry("保险")).toBe(true);
    expect(isHighLeverageIndustry("证券")).toBe(true);
    expect(isHighLeverageIndustry("房地产开发")).toBe(true);
    expect(isHighLeverageIndustry("白酒")).toBe(false);
    expect(isHighLeverageIndustry(null)).toBe(false);
  });
});

describe("chunk", () => {
  it("分块边界", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("loadIndicatorsCache", () => {
  it("解析 JSONL，跳过损坏行", () => {
    const dir = join(tmpdir(), `screen-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "cache.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ thscode: "600519.SH", raw: { a: { b: "1" } } }),
        "not-json-line",
        JSON.stringify({ thscode: "000001.SZ", raw: { a: { c: "2" } } }),
      ].join("\n"),
      "utf-8",
    );
    try {
      const map = loadIndicatorsCache(file);
      expect(map.size).toBe(2);
      expect(map.get("600519.SH")?.a.b).toBe("1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("文件不存在 → 空 Map", () => {
    expect(loadIndicatorsCache("/nonexistent/x.jsonl").size).toBe(0);
  });
});

describe("toCsv / toDigest", () => {
  it("CSV 含表头、转义逗号", () => {
    const r = { ...scoreRow(row({}), {
      roe: 0.3, grossMargin: 0.91, netMargin: 0.52, ocfToNi: 1.05, debtRatio: 0.2,
      revenueYoy: 0.17, netProfitYoy: 0.19,
    }), pool: "star" as const, highLeverageNote: false, reason: undefined };
    const csv = toCsv([r]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("thscode");
    expect(lines[1]).toContain("600519.SH");
  });

  it("digest 含池统计与明星池表头", () => {
    const stageA: StageAOutput = {
      meta: { generatedAt: "2026-08-16T00:00:00.000Z", quoteAsOf: "x", minMcapYi: 10, excludeSt: true },
      main: [row({})], loss: [], excluded: [],
    };
    const cur = {
      roe: 0.30, grossMargin: 0.91, netMargin: 0.52, ocfToNi: 1.05, debtRatio: 0.20,
      revenueYoy: 0.17, netProfitYoy: 0.19,
    };
    const rows = [{ ...scoreRow(stageA.main[0], cur), pool: "star" as const, highLeverageNote: false }];
    const out = buildScreenerOutput(stageA, rows, {
      report: "2025-4", prevReport: "2024-4", minMcapYi: 10, excludeSt: true, concurrency: 20,
    });
    const digest = toDigest(out);
    expect(digest).toContain("明星池");
    expect(digest).toContain("600519.SH");
    expect(digest).toContain("贵州茅台");
  });
});
