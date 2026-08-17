import { describe, expect, it } from "bun:test";
import { buildFinancialsBlock, alignAnnualStatements, computePeg, parseFmNestedValue, buildFieldBlock } from "../backfill";
import type { IncomeStatement, BalanceSheet, CashFlow } from "../../hithink/hithink";

// 构造 mock 三表数据（单位：元）
function mockStatements(opts: {
  years: number[];
  revenue: (number | null)[];
  operatingCosts: (number | null)[];
  netProfit: (number | null)[];
  equity: (number | null)[];
  totalDebt: (number | null)[];
  assetsTotal: (number | null)[];
  ocf: (number | null)[];
}): { income: IncomeStatement[]; balance: BalanceSheet[]; cashflow: CashFlow[] } {
  const { years, revenue, operatingCosts, netProfit, equity, totalDebt, assetsTotal, ocf } = opts;
  const income: IncomeStatement[] = [];
  const balance: BalanceSheet[] = [];
  const cashflow: CashFlow[] = [];
  for (let i = 0; i < years.length; i++) {
    const y = years[i]!;
    income.push({
      thscode: "600176.SH", ticker: "600176", period: `${y}-12-31`, fiscal_year: y, fiscal_period: "年报",
      report_date_ms: 0, period_end_ms: 0, currency: "CNY",
      operating_income: revenue[i] ?? null, operating_costs: operatingCosts[i] ?? null,
      operating_expenses: null, sales_fee: null, manage_fee: null, research_and_development_expenses: null,
      operating_profit: null, interest_expenses: null, profit_total: null, income_tax_expense: null,
      net_profit: netProfit[i] ?? null, parent_holder_net_profit: netProfit[i] ?? null, basic_eps: null,
    });
    balance.push({
      thscode: "600176.SH", ticker: "600176", period: `${y}-12-31`, fiscal_year: y, fiscal_period: "年报",
      report_date_ms: 0, period_end_ms: 0, currency: "CNY",
      assets_total: assetsTotal[i] ?? null, total_current_assets: null, non_current_nets_total: null,
      cash: null, accounts_receivable: null, total_debt: totalDebt[i] ?? null, holder_equity_total: equity[i] ?? null,
    });
    cashflow.push({
      thscode: "600176.SH", ticker: "600176", period: `${y}-12-31`, fiscal_year: y, fiscal_period: "年报",
      report_date_ms: 0, period_end_ms: 0, currency: "CNY",
      act_cash_flow_net: ocf[i] ?? null, invest_cash_flow_net: null, financing_cash_flow_net: null,
      pay_fixed_assets_etc_cash: null, pay_dividends_profits_interest_cash: null, cash_equivalents_net_addition: null,
    });
  }
  return { income, balance, cashflow };
}

describe("buildFinancialsBlock — 百分数格式约定", () => {
  it("比率字段以百分数形式输出（×100），保留 2 位小数", () => {
    // 中国巨石 2025 年报近似值：营收 188.81 亿、净利 32.85 亿、权益 ~325 亿、负债 ~128 亿、资产 ~317 亿、OCF 42.01 亿
    // 2024 年：营收 158.56 亿、净利 24.45 亿
    const { income, balance, cashflow } = mockStatements({
      years: [2024, 2025],
      revenue: [15.856e9, 18.881e9],
      operatingCosts: [10.5e9, 12.62e9],
      netProfit: [2.445e9, 3.285e9],
      equity: [30e9, 32.5e9],
      totalDebt: [12.5e9, 12.8e9],
      assetsTotal: [42e9, 31.7e9],
      ocf: [2.0e9, 4.201e9],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).not.toBeNull();
    // ROE ≈ 3.285/32.5 = 10.11% → 输出 10.11（百分数，非 0.1011）
    expect(block).toMatch(/roe: 10\.1\d/);
    // gross_margin ≈ 1 - 12.62/18.881 = 33.15% → 输出 33.15（百分数）
    expect(block).toMatch(/gross_margin: 33\.1\d/);
    // net_margin ≈ 3.285/18.881 = 17.40% → 输出 17.4
    expect(block).toMatch(/net_margin: 17\.4/);
    // asset_liability_ratio ≈ 12.8/31.7 = 40.38% → 输出 40.38
    expect(block).toMatch(/asset_liability_ratio: 40\.3\d/);
    // revenue_yoy ≈ 18.881/15.856 - 1 = 19.08% → 输出 19.08
    expect(block).toMatch(/revenue_yoy: 19\.0\d/);
    // net_profit_yoy ≈ 3.285/2.445 - 1 = 34.36% → 输出 34.36
    expect(block).toMatch(/net_profit_yoy: 34\.3\d/);
  });

  it("OCF/NI 为比值，不乘 100", () => {
    const { income, balance, cashflow } = mockStatements({
      years: [2024, 2025],
      revenue: [10e9, 12e9],
      operatingCosts: [7e9, 8e9],
      netProfit: [2e9, 3e9],
      equity: [20e9, 25e9],
      totalDebt: [8e9, 10e9],
      assetsTotal: [28e9, 35e9],
      ocf: [2.5e9, 3.6e9],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).not.toBeNull();
    // OCF/NI = 3.6/3 = 1.2（比值，不是 120）
    expect(block).toMatch(/ocf_to_ni: 1\.2\b/);
  });

  it("金额字段转换为亿元，保留 2 位小数", () => {
    const { income, balance, cashflow } = mockStatements({
      years: [2025],
      revenue: [18.881e9],
      operatingCosts: [12.62e9],
      netProfit: [3.285e9],
      equity: [32.5e9],
      totalDebt: [12.8e9],
      assetsTotal: [31.7e9],
      ocf: [4.201e9],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).not.toBeNull();
    expect(block).toMatch(/revenue_yi: 188\.81/);
    expect(block).toMatch(/net_profit_yi: 32\.85/);
    expect(block).toMatch(/ocf_yi: 42\.01/);
  });

  it("history 块的比率字段也是百分数形式", () => {
    const { income, balance, cashflow } = mockStatements({
      years: [2023, 2024, 2025],
      revenue: [14.876e9, 15.856e9, 18.881e9],
      operatingCosts: [10e9, 10.5e9, 12.62e9],
      netProfit: [3.044e9, 2.445e9, 3.285e9],
      equity: [30e9, 30.5e9, 32.5e9],
      totalDebt: [12.5e9, 12.5e9, 12.8e9],
      assetsTotal: [42e9, 43e9, 31.7e9],
      ocf: [0.867e9, 2.032e9, 4.201e9],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).not.toBeNull();
    // 2023 年 ROE ≈ 3.044/30 = 10.15% → history 里应为 10.15
    const history2023 = block!.match(/fiscal_year: 2023[\s\S]*?roe: ([\d.]+)/);
    expect(history2023).not.toBeNull();
    expect(parseFloat(history2023![1])).toBeGreaterThan(10);
    expect(parseFloat(history2023![1])).toBeLessThan(11);
    // 2024 年 net_margin ≈ 2.445/15.856 = 15.42% → history 里应为 15.42
    const history2024nm = block!.match(/fiscal_year: 2024[\s\S]*?net_margin: ([\d.]+)/);
    expect(history2024nm).not.toBeNull();
    expect(parseFloat(history2024nm![1])).toBeGreaterThan(15);
    expect(parseFloat(history2024nm![1])).toBeLessThan(16);
  });

  it("负净利时 OCF/NI 为负值（不截断负号）", () => {
    // 德福科技场景：OCF=-3.81亿，NI=1.13亿 → OCF/NI=-3.37
    const { income, balance, cashflow } = mockStatements({
      years: [2024, 2025],
      revenue: [8e9, 12.437e9],
      operatingCosts: [6e9, 11.55e9],
      netProfit: [2.5e9, 0.113e9],
      equity: [5e9, 5.35e9],
      totalDebt: [4e9, 4.5e9],
      assetsTotal: [9e9, 9.85e9],
      ocf: [1e9, -0.381e9],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).not.toBeNull();
    // OCF/NI = -0.381/0.113 = -3.37（负号保留）
    expect(block).toMatch(/ocf_to_ni: -3\.3\d/);
  });

  it("空数据返回 null", () => {
    const block = buildFinancialsBlock([], [], []);
    expect(block).toBeNull();
  });

  it("revenue 全为 null 返回 null", () => {
    const { income, balance, cashflow } = mockStatements({
      years: [2025],
      revenue: [null],
      operatingCosts: [null],
      netProfit: [null],
      equity: [null],
      totalDebt: [null],
      assetsTotal: [null],
      ocf: [null],
    });
    const block = buildFinancialsBlock(income, balance, cashflow);
    expect(block).toBeNull();
  });
});

describe("alignAnnualStatements", () => {
  it("按 fiscal_year 升序对齐三表", () => {
    const { income, balance, cashflow } = mockStatements({
      years: [2025, 2023, 2024],
      revenue: [18e9, 14e9, 15e9],
      operatingCosts: [12e9, 10e9, 10.5e9],
      netProfit: [3e9, 3e9, 2.4e9],
      equity: [32e9, 30e9, 30.5e9],
      totalDebt: [12e9, 12e9, 12.5e9],
      assetsTotal: [31e9, 42e9, 43e9],
      ocf: [4e9, 0.8e9, 2e9],
    });
    const rows = alignAnnualStatements(income, balance, cashflow);
    expect(rows.length).toBe(3);
    expect(rows[0]!.fiscal_year).toBe(2023);
    expect(rows[1]!.fiscal_year).toBe(2024);
    expect(rows[2]!.fiscal_year).toBe(2025);
    expect(rows[2]!.revenue).toBe(18e9);
  });
});

describe("computePeg — 隐含增速 PEG 推导", () => {
  it("正常推导：PE=30，基准期净利=40 亿、当期净利=25 亿 → 隐含增速 60%，PEG=0.5", () => {
    const peg = computePeg(30, 40, 25);
    expect(peg).toEqual({ value: 0.5, growth_basis: "forward" });
  });

  it("PEG 保留 1 位小数", () => {
    // PE=20，增速 35% → PEG=0.5714 → 0.6
    const peg = computePeg(20, 13.5, 10);
    expect(peg!.value).toBe(0.6);
  });

  it("隐含增速 ≤0（净利下滑/不增长）→ null，留人工维护", () => {
    expect(computePeg(30, 20, 25)).toBeNull(); // 增速 -20%
    expect(computePeg(30, 25, 25)).toBeNull(); // 增速 0%
  });

  it("任一输入缺失/非正 → null", () => {
    expect(computePeg(null, 40, 25)).toBeNull();
    expect(computePeg(30, null, 25)).toBeNull();
    expect(computePeg(30, 40, null)).toBeNull();
    expect(computePeg(0, 40, 25)).toBeNull();
    expect(computePeg(30, 40, 0)).toBeNull();
  });
});

describe("parseFmNestedValue — frontmatter 嵌套块字段提取", () => {
  const fm = [
    "forward_pe:                  # 注释",
    "  value: 30.0",
    "  base_net_profit_yi: 40",
    '  base_period: "2027E"',
    "peg:",
    "  value: 0.5",
    "financials:",
    "  net_profit_yi: 25",
    "  net_profit_yoy: 60.0",
    "  history:",
    "    - fiscal_year: 2025",
    "      net_profit_yi: 25",
  ].join("\n");

  it("提取顶层嵌套块字段（忽略更深层 history 内的同名键）", () => {
    expect(parseFmNestedValue(fm, "financials", "net_profit_yi")).toBe("25");
    expect(parseFmNestedValue(fm, "financials", "net_profit_yoy")).toBe("60.0");
    expect(parseFmNestedValue(fm, "forward_pe", "value")).toBe("30.0");
    expect(parseFmNestedValue(fm, "forward_pe", "base_net_profit_yi")).toBe("40");
  });

  it("字段不存在 → undefined", () => {
    expect(parseFmNestedValue(fm, "financials", "not_exist")).toBeUndefined();
    expect(parseFmNestedValue(fm, "missing_block", "value")).toBeUndefined();
  });

  it("base_period 带引号提取出去引号内容", () => {
    expect(parseFmNestedValue(fm, "forward_pe", "base_period")).toBe("2027E");
  });
});

describe("buildFieldBlock — valuation_type / peg 写入", () => {
  const emptyScores = {};
  const emptyTargets = {};

  it("写入 valuation_type（默认 general）与 peg 块，base_period 对齐 forward_pe", () => {
    const block = buildFieldBlock(
      emptyScores, emptyTargets, null, null,
      {}, null, new Set(),
      "growth",
      { value: 0.5, growth_basis: "forward" },
      "2027E",
    );
    expect(block).toContain('valuation_type: "growth"');
    expect(block).toContain("peg:");
    expect(block).toContain("  value: 0.5");
    expect(block).toContain('  growth_basis: "forward"');
    expect(block).toContain('  base_period: "2027E"');
  });

  it("valuation_type 缺省 → general", () => {
    const block = buildFieldBlock(emptyScores, emptyTargets, null, null, {}, null, new Set());
    expect(block).toContain('valuation_type: "general"');
  });

  it("skipExistingKeys 命中 valuation_type/peg 时跳过（人工维护）", () => {
    const block = buildFieldBlock(
      emptyScores, emptyTargets, null, null,
      {}, null, new Set(["valuation_type", "peg"]),
      "growth", { value: 0.5, growth_basis: "forward" }, "2027E",
    );
    expect(block).not.toContain("valuation_type");
    expect(block).not.toContain("peg:");
  });

  it("peg 为 null 时不写 peg 块", () => {
    const block = buildFieldBlock(emptyScores, emptyTargets, null, null, {}, null, new Set(), "growth", null);
    expect(block).not.toContain("peg:");
  });
});
