import { describe, it, expect } from "bun:test";
import { screenCompany, parseCompanyNoteMetrics, normalizePercentInputs } from "../quality-screen.ts";

describe("normalizePercentInputs（auto 模式单位容错）", () => {
  it("百分比传参（|值| ≥1 且 ≤100）折算为小数并告警", () => {
    const m: any = { roe: 14.65, grossMargin: 35.48, netMargin: 4.92, debtRatio: 51.2, revenueGrowth: 1.5 };
    const warnings = normalizePercentInputs(m, [
      ["roe", "ROE"],
      ["grossMargin", "毛利率"],
      ["netMargin", "净利率"],
      ["debtRatio", "资产负债率"],
    ]);
    expect(m.roe).toBeCloseTo(0.1465, 4);
    expect(m.grossMargin).toBeCloseTo(0.3548, 4);
    expect(m.netMargin).toBeCloseTo(0.0492, 4);
    expect(m.debtRatio).toBeCloseTo(0.512, 3);
    expect(warnings.length).toBe(4);
    expect(warnings[0]).toContain("ROE 14.65");
  });

  it("growth/倍数类字段不折算（可合法 >100%）", () => {
    const m: any = { revenueGrowth: 1.5, earningsGrowth: 0.9, ocfToNi: 1.1, peTtm: 28 };
    const warnings = normalizePercentInputs(m, [
      ["roe", "ROE"],
      ["debtRatio", "资产负债率"],
    ]);
    expect(m.revenueGrowth).toBe(1.5); // 150% 保持原值
    expect(m.ocfToNi).toBe(1.1);
    expect(m.peTtm).toBe(28);
    expect(warnings.length).toBe(0);
  });

  it("小数传参（<1）不折算、不告警", () => {
    const m: any = { roe: 0.1465, debtRatio: 0.512 };
    const warnings = normalizePercentInputs(m, [["roe", "ROE"], ["debtRatio", "资产负债率"]]);
    expect(m.roe).toBe(0.1465);
    expect(m.debtRatio).toBe(0.512);
    expect(warnings.length).toBe(0);
  });
});

describe("screenCompany", () => {
  // ======== 基础功能 ========
  it("GREEN: 高 ROE + 高毛利 + 低负债 + 低 PE + 正增长", () => {
    const r = screenCompany({
      name: "茅台", code: "600519",
      roe: 0.30, grossMargin: 0.91, netMargin: 0.52,
      ocfToNi: 1.05, debtRatio: 0.20, peTtm: 28,
      revenueGrowth: 0.17, earningsGrowth: 0.19,
    });
    expect(r.verdict).toBe("GREEN");
    expect(r.redFlags.length).toBe(0);
    expect(r.overallScore).toBeGreaterThanOrEqual(7);
    expect(r.markdown).toContain("茅台");
    expect(r.markdown).toContain("600519");
    expect(r.sevenQuality.profitability).toBeGreaterThanOrEqual(8);
    expect(r.sevenQuality.cashQuality).toBeGreaterThanOrEqual(7);
  });

  it("RED: 亏损 + 高杠杆 + 现金流极差 + 双负增长", () => {
    const r = screenCompany({
      name: "ST某", code: "000001",
      roe: -0.05, grossMargin: 0.08, netMargin: -0.02,
      ocfToNi: 0.30, debtRatio: 0.82, peTtm: -5,
      revenueGrowth: -0.15, earningsGrowth: -0.40,
    });
    expect(r.verdict).toBe("RED");
    expect(r.redFlags.length).toBeGreaterThanOrEqual(2);
    expect(r.overallScore).toBeLessThan(5);
    expect(r.sevenQuality.valuation).toBeLessThanOrEqual(2);
  });

  it("YELLOW: 中等水平，无红牌", () => {
    const r = screenCompany({
      name: "中游公司", code: "000002",
      roe: 0.12, grossMargin: 0.28, netMargin: 0.08,
      ocfToNi: 0.85, debtRatio: 0.45, peTtm: 22,
      revenueGrowth: 0.08, earningsGrowth: 0.06,
    });
    expect(r.verdict).toBe("YELLOW");
    expect(r.redFlags.length).toBe(0);
    expect(r.yellowFlags.length).toBe(0);
  });

  // ======== 边界条件 ========
  it("全 null 输入：不应崩溃，应给出中性 YELLOW 结论", () => {
    const r = screenCompany({
      name: "数据缺失", code: "999999",
      roe: null, grossMargin: null, netMargin: null,
      ocfToNi: null, debtRatio: null, peTtm: null,
      revenueGrowth: null, earningsGrowth: null,
    });
    expect(r.verdict).toBe("YELLOW");
    expect(r.redFlags.length).toBe(0);
    expect(r.yellowFlags.length).toBeGreaterThanOrEqual(1); // 数据缺失警告
    expect(r.markdown).toContain("N/A");
  });

  it("PE 为负值（亏损）应触发红牌", () => {
    const r = screenCompany({
      name: "亏损公司", code: "000003",
      roe: 0.02, grossMargin: 0.25, netMargin: 0.01,
      ocfToNi: 0.9, debtRatio: 0.40, peTtm: -10,
      revenueGrowth: 0.05, earningsGrowth: -0.05,
    });
    const hasPeRed = r.redFlags.some(f => f.includes("PE(TTM) 为负值"));
    expect(hasPeRed).toBe(true);
  });

  it("戴维斯双杀：营收负 + 净利负 + PE>30 应触发红牌", () => {
    const r = screenCompany({
      name: "双杀", code: "000004",
      roe: 0.08, grossMargin: 0.30, netMargin: 0.05,
      ocfToNi: 0.6, debtRatio: 0.50, peTtm: 35,
      revenueGrowth: -0.05, earningsGrowth: -0.10,
    });
    const hasDoubleKill = r.redFlags.some(f => f.includes("戴维斯双杀"));
    expect(hasDoubleKill).toBe(true);
  });

  it("OCF/NI < 0.5 应触发红牌", () => {
    const r = screenCompany({
      name: "低现金流", code: "000005",
      roe: 0.15, grossMargin: 0.35, netMargin: 0.12,
      ocfToNi: 0.40, debtRatio: 0.35, peTtm: 20,
      revenueGrowth: 0.10, earningsGrowth: 0.10,
    });
    const hasOcfRed = r.redFlags.some(f => f.includes("经营现金流/净利润仅"));
    expect(hasOcfRed).toBe(true);
  });

  it("高 PE 但高增长不应触发黄牌", () => {
    const r = screenCompany({
      name: "高成长", code: "000006",
      roe: 0.20, grossMargin: 0.50, netMargin: 0.18,
      ocfToNi: 1.1, debtRatio: 0.30, peTtm: 45,
      revenueGrowth: 0.25, earningsGrowth: 0.30,
    });
    const hasPeYellow = r.yellowFlags.some(f => f.includes("PE(TTM)"));
    expect(hasPeYellow).toBe(false); // 有 25%+ 高增长支撑，不触发
  });

  // ======== 七项评分卡 ========
  it("盈利能力评分：ROE>=20% 应得高分", () => {
    const r = screenCompany({
      name: "高分", code: "000007",
      roe: 0.25, grossMargin: 0.40, netMargin: 0.20,
      ocfToNi: 1.0, debtRatio: 0.30, peTtm: 18,
      revenueGrowth: 0.15, earningsGrowth: 0.20,
    });
    expect(r.sevenQuality.profitability).toBeGreaterThanOrEqual(8);
    expect(r.sevenQuality.businessMoat).toBeGreaterThanOrEqual(8);
  });

  it("杠杆安全评分：负债率>70% 应得低分", () => {
    const r = screenCompany({
      name: "高杠杆", code: "000008",
      roe: 0.10, grossMargin: 0.25, netMargin: 0.08,
      ocfToNi: 0.9, debtRatio: 0.75, peTtm: 15,
      revenueGrowth: 0.05, earningsGrowth: 0.05,
    });
    expect(r.sevenQuality.leverageSafety).toBeLessThanOrEqual(3);
  });

  // ======== Markdown 输出完整性 ========
  it("Markdown 应包含 7 项评分卡表格", () => {
    const r = screenCompany({
      name: "测试", code: "000009",
      roe: 0.15, grossMargin: 0.30, netMargin: 0.10,
      ocfToNi: 0.9, debtRatio: 0.40, peTtm: 20,
      revenueGrowth: 0.10, earningsGrowth: 0.10,
    });
    expect(r.markdown).toContain("7 项质量评分卡");
    expect(r.markdown).toContain("盈利能力 Profitability");
    expect(r.markdown).toContain("现金流质量 Cash Quality");
    expect(r.markdown).toContain("生意模式护城河 Business Moat");
    expect(r.markdown).toContain("筛查结论");
  });

  it("红牌为空时 Markdown 应显示『（无）』", () => {
    const r = screenCompany({
      name: "无红牌", code: "000010",
      roe: 0.20, grossMargin: 0.40, netMargin: 0.15,
      ocfToNi: 1.2, debtRatio: 0.25, peTtm: 15,
      revenueGrowth: 0.20, earningsGrowth: 0.25,
    });
    expect(r.redFlags.length).toBe(0);
    expect(r.markdown).toContain("- （无）");
  });

  // ======== 财务排雷扩展红牌 ========
  it("现金收入比 < 0.7 应触发红牌", () => {
    const r = screenCompany({
      name: "激进确认", code: "000011",
      roe: 0.15, grossMargin: 0.35, netMargin: 0.12,
      ocfToNi: 1.0, debtRatio: 0.40, peTtm: 20,
      revenueGrowth: 0.10, earningsGrowth: 0.10,
      cashToRevenue: 0.55,
    });
    const has = r.redFlags.some(f => f.includes("现金收入比"));
    expect(has).toBe(true);
  });

  it("利息覆盖倍数 < 1 应触发红牌", () => {
    const r = screenCompany({
      name: "偿债承压", code: "000012",
      roe: 0.10, grossMargin: 0.30, netMargin: 0.06,
      ocfToNi: 0.9, debtRatio: 0.55, peTtm: 18,
      revenueGrowth: 0.05, earningsGrowth: 0.03,
      interestCoverage: 0.8,
    });
    const has = r.redFlags.some(f => f.includes("利息覆盖倍数"));
    expect(has).toBe(true);
  });

  it("应收账款增速远超收入增速应触发红牌", () => {
    const r = screenCompany({
      name: "应收膨胀", code: "000013",
      roe: 0.12, grossMargin: 0.28, netMargin: 0.08,
      ocfToNi: 0.85, debtRatio: 0.45, peTtm: 22,
      revenueGrowth: 0.05, earningsGrowth: 0.06,
      receivablesGrowth: 0.55, // 收入 5%，应收 55%
    });
    const has = r.redFlags.some(f => f.includes("应收账款增速"));
    expect(has).toBe(true);
  });

  it("收入负增而存货高增应触发红牌", () => {
    const r = screenCompany({
      name: "存货积压", code: "000014",
      roe: 0.08, grossMargin: 0.25, netMargin: 0.05,
      ocfToNi: 0.9, debtRatio: 0.50, peTtm: 15,
      revenueGrowth: -0.05, earningsGrowth: -0.10,
      inventoryGrowth: 0.40,
    });
    const has = r.redFlags.some(f => f.includes("存货"));
    expect(has).toBe(true);
  });

  it("存贷双高（货币资金≥30% + 负债率≥60%）应触发红牌", () => {
    const r = screenCompany({
      name: "存贷双高", code: "000015",
      roe: 0.10, grossMargin: 0.25, netMargin: 0.05,
      ocfToNi: 0.9, debtRatio: 0.65, peTtm: 18,
      revenueGrowth: 0.03, earningsGrowth: 0.02,
      cashAssetRatio: 0.35,
    });
    const has = r.redFlags.some(f => f.includes("存贷双高"));
    expect(has).toBe(true);
  });

  it("商誉/净资产 > 50% 应触发红牌", () => {
    const r = screenCompany({
      name: "高商誉", code: "000016",
      roe: 0.12, grossMargin: 0.30, netMargin: 0.08,
      ocfToNi: 1.0, debtRatio: 0.40, peTtm: 20,
      revenueGrowth: 0.10, earningsGrowth: 0.10,
      goodwillRatio: 0.60,
    });
    const has = r.redFlags.some(f => f.includes("商誉/净资产"));
    expect(has).toBe(true);
  });

  it("存在监管处罚记录应触发红牌", () => {
    const r = screenCompany({
      name: "违规公司", code: "000017",
      roe: 0.18, grossMargin: 0.40, netMargin: 0.15,
      ocfToNi: 1.1, debtRatio: 0.30, peTtm: 15,
      revenueGrowth: 0.12, earningsGrowth: 0.15,
      regulatoryViolations: true,
    });
    const has = r.redFlags.some(f => f.includes("监管处罚"));
    expect(has).toBe(true);
  });

  it("提供部分扩展指标时，缺失的扩展项应给出数据缺失黄牌", () => {
    const r = screenCompany({
      name: "部分扩展", code: "000018",
      roe: 0.15, grossMargin: 0.30, netMargin: 0.10,
      ocfToNi: 0.9, debtRatio: 0.40, peTtm: 20,
      revenueGrowth: 0.10, earningsGrowth: 0.10,
      cashToRevenue: 1.05, // 仅提供一项
    });
    const hasMissing = r.yellowFlags.some(f => f.includes("数据缺失"));
    expect(hasMissing).toBe(true);
  });

  it("未提供任何扩展指标时，不产生扩展项数据缺失黄牌（兼容旧行为）", () => {
    const r = screenCompany({
      name: "中游公司", code: "000019",
      roe: 0.12, grossMargin: 0.28, netMargin: 0.08,
      ocfToNi: 0.85, debtRatio: 0.45, peTtm: 22,
      revenueGrowth: 0.08, earningsGrowth: 0.06,
    });
    expect(r.yellowFlags.some(f => f.includes("数据缺失"))).toBe(false);
    expect(r.markdown).toContain("现金收入比");
    expect(r.markdown).toContain("监管处罚记录");
  });
});

describe("parseCompanyNoteMetrics（report 模式最新财年取值）", () => {
  const note = `---
type: "company"
research_cutoff:
  report_period: "2025FY"
---

# 测试公司

## 财务数据

| 指标 | 2023 | 2024 | 2025 | 趋势 |
|------|------|------|------|------|
| 营收（亿元） | 42.21（+8.97%） | 49.39（+17.00%） | 57.56（+16.54%） | 逐年向好 |
| 归母净利润（亿元） | 1.73（-46.99%） | 3.37（+94.47%） | 2.83（-16.02%） | 波动 |
| 毛利率 | 14.35% | 19.17% | 17.75% | V 型 |
| 净利率 | 4.11% | 6.83% | 4.92% | 周期波动 |
| ROE | 1.46% | 2.79% | 2.29% | 三年 <3% |
| 资产负债率 | 23.40% | 23.90% | 23.63% | 极低杠杆 |
`;

  it("三年对照表取最新财年（2025 末列）数值，不取首行 2023", () => {
    const m = parseCompanyNoteMetrics(note);
    expect(m.roe).toBeCloseTo(0.0229, 4);
    expect(m.grossMargin).toBeCloseTo(0.1775, 4);
    expect(m.netMargin).toBeCloseTo(0.0492, 4);
    expect(m.debtRatio).toBeCloseTo(0.2363, 4);
  });

  it("营收/净利同比取 2025 括号内值（16.54% / -16.02%），负号保留", () => {
    const m = parseCompanyNoteMetrics(note);
    expect(m.revenueGrowth).toBeCloseTo(0.1654, 4);
    expect(m.earningsGrowth).toBeCloseTo(-0.1602, 4);
  });

  it("OCF/NI 取多值序列最后一个（最新财年），如『OCF/净利三年 1.99/1.37/1.49』→ 1.49", () => {
    const m = parseCompanyNoteMetrics(`${note}\nOCF/净利三年 1.99/1.37/1.49\n`);
    expect(m.ocfToNi).toBeCloseTo(1.49, 2);
  });

  it("阈值文本（<30%）不误命中商誉；商誉=0 直接置 0", () => {
    const m = parseCompanyNoteMetrics(`${note}\n商誉 0（安全），商誉/净资产 <30%\n`);
    expect(m.goodwillRatio).toBe(0);
    const m2 = parseCompanyNoteMetrics(note);
    expect(m2.goodwillRatio).toBeNull(); // 无商誉描述 → 不触发警示
  });

  it("financials frontmatter 块优先于正文表格", () => {
    const withFin = `---
financials:
  report_period: 2025
  roe: 24.91
  ocf_to_ni: 1.845
  revenue_yoy: 17.0
  net_profit_yoy: 42.3
---

${note}
`;
    const m = parseCompanyNoteMetrics(withFin);
    expect(m.roe).toBeCloseTo(0.2491, 4);
    expect(m.ocfToNi).toBeCloseTo(1.845, 3);
    expect(m.revenueGrowth).toBeCloseTo(0.17, 4);
    expect(m.earningsGrowth).toBeCloseTo(0.423, 4);
  });

  it("空内容不崩溃，返回全 null 指标", () => {
    const m = parseCompanyNoteMetrics("");
    expect(m.roe).toBeNull();
    expect(m.goodwillRatio).toBeNull();
  });
});

describe("一次性损益失真检测（quality-screen-oneshot-greening）", () => {
  const baseMetrics = {
    name: "三生国健", code: "688336",
    roe: 0.41, grossMargin: 0.70, netMargin: 0.40,
    ocfToNi: 1.0, debtRatio: 0.30, peTtm: 14.58,
    revenueGrowth: 2.5181, earningsGrowth: 3.1149, // 净利同比 311%（BD 首付款驱动）
  };

  it("净利同比 >300%（疑似一次性损益）：输出失真警告并下调估值/成长维度", () => {
    const r = screenCompany({ ...baseMetrics });
    // 红牌含一次性损益警告
    const hasWarn = r.redFlags.some(f => f.includes("一次性损益"));
    expect(hasWarn).toBe(true);
    expect(r.verdictText).toContain("一次性损益");
    // 估值/成长降分：GREEN 高分不再因 BD 收入给满分
    expect(r.sevenQuality.valuation).toBeLessThanOrEqual(7);  // 10 - 3
    expect(r.sevenQuality.growth).toBeLessThanOrEqual(7);     // 9 - 3（或更低）
    expect(r.verdict).not.toBe("GREEN"); // 一次性损益红牌 → 不得再给 GREEN
  });

  it("显式提供 --nonrecurring-net-profit + note：确认失真并附注说明", () => {
    const r = screenCompany({
      ...baseMetrics,
      earningsGrowth: 0.10, // 正常增长但明确输入一次性损益
      nonrecurringNetProfit: 5.0,
      nonrecurringNote: "2025 年含 28 亿辉瑞 BD 首付款",
    });
    expect(r.redFlags.some(f => f.includes("一次性损益") && f.includes("辉瑞"))).toBe(true);
    expect(r.verdictText).toContain("辉瑞 BD 首付款");
    expect(r.sevenQuality.valuation).toBeLessThanOrEqual(7);
  });

  it("无一次性损益输入且增长正常：评分不变，不触发警告", () => {
    const r = screenCompany({
      ...baseMetrics,
      earningsGrowth: 0.15, revenueGrowth: 0.10,
    });
    expect(r.redFlags.some(f => f.includes("一次性损益"))).toBe(false);
    expect(r.verdict).toBe("GREEN");
    expect(r.sevenQuality.valuation).toBe(10);   // PE 14.58 < 15 → 满分未降
    expect(r.sevenQuality.growth).toBe(7);       // 营收 10%/净利 15% 增长率 → 7（未被降分）
  });

  it("report 模式从 frontmatter financials 块读取 nonrecurring_net_profit / nonrecurring_note", () => {
    const withFin = `---
financials:
  report_period: 2025
  roe: 41.32
  gross_margin: 70.0
  net_margin: 40.0
  asset_liability_ratio: 30.0
  ocf_to_ni: 1.0
  revenue_yoy: 251.81
  net_profit_yoy: 311.49
  pe_ttm: 14.58
  nonrecurring_net_profit: 5.0
  nonrecurring_note: "2025 年含 28 亿辉瑞 BD 首付款（一次性）"
---
`;
    const m = parseCompanyNoteMetrics(withFin);
    expect(m.nonrecurringNetProfit).toBe(5.0);
    expect(m.nonrecurringNote).toContain("辉瑞");
    const r = screenCompany(m as any);
    expect(r.redFlags.some(f => f.includes("一次性损益"))).toBe(true);
  });
});

describe("PEG / 品种估值豁免（quality-screen-peg-exemption）", () => {
  const baseMetrics = {
    name: "成长股", code: "000020",
    roe: 0.22, grossMargin: 0.55, netMargin: 0.20,
    ocfToNi: 1.1, debtRatio: 0.30,
  };

  it("PE>40 且净利增速≥25%：估值维度不再机械低分（0-2），改按高成长放宽区间", () => {
    const r = screenCompany({
      ...baseMetrics,
      peTtm: 45, revenueGrowth: 0.25, earningsGrowth: 0.30,
    });
    expect(r.sevenQuality.valuation).toBe(7); // 高成长区间：45 ≤50 → 7
    expect(r.verdictText).not.toBe("");
    // 报告应注明估值模型（按品种）为 growth 主锚
    expect(r.markdown).toContain("PEG + Forward PE");
  });

  it("显式 --peg 0.9：高 PE 高估值豁免，估值维度按 PEG 分档得高分", () => {
    const r = screenCompany({
      ...baseMetrics,
      peTtm: 60, peg: 0.9, earningsGrowth: 0.50,
    });
    expect(r.sevenQuality.valuation).toBe(9); // PEG<1 → 9
    expect(r.markdown).toContain("| PEG | 0.90 |");
  });

  it("显式 --peg 2.5：显著偏贵仍低分（PEG>2 → 3），即使高 PE", () => {
    const r = screenCompany({
      ...baseMetrics,
      peTtm: 60, peg: 2.5, earningsGrowth: 0.50,
    });
    expect(r.sevenQuality.valuation).toBe(3);
  });

  it("PEG 1-1.5 基本匹配 → 7；1.5-2 偏高 → 5", () => {
    const r1 = screenCompany({ ...baseMetrics, peTtm: 60, peg: 1.2 });
    expect(r1.sevenQuality.valuation).toBe(7);
    const r2 = screenCompany({ ...baseMetrics, peTtm: 60, peg: 1.8 });
    expect(r2.sevenQuality.valuation).toBe(5);
  });

  it("既有 PE 区间行为不变：非高成长无 PEG 时按原区间评分", () => {
    const r = screenCompany({
      ...baseMetrics,
      peTtm: 30, revenueGrowth: 0.10, earningsGrowth: 0.10,
    });
    expect(r.sevenQuality.valuation).toBe(6); // 25<30≤35 → 6（与原逻辑一致）
  });

  it("report 模式从 frontmatter 读取 peg.value 与 valuation_type", () => {
    const withPeg = `---
valuation_type: "growth"
peg:
  value: 1.3
  growth_basis: forward
  base_period: 2027E
financials:
  report_period: 2025
  roe: 22.0
  gross_margin: 55.0
  net_margin: 20.0
  asset_liability_ratio: 30.0
  ocf_to_ni: 1.1
  revenue_yoy: 25.0
  net_profit_yoy: 30.0
  pe_ttm: 45.0
---
`;
    const m = parseCompanyNoteMetrics(withPeg);
    expect(m.peg).toBeCloseTo(1.3, 4);
    expect(m.type).toBe("growth");
    const r = screenCompany(m as any);
    expect(r.sevenQuality.valuation).toBe(7); // PEG 1-1.5 → 7
    expect(r.markdown).toContain("`growth` · PEG + Forward PE");
  });

  it("frontmatter 无 peg/valuation_type 时不误报（兼容旧笔记）", () => {
    const m = parseCompanyNoteMetrics("---\ntype: \"company\"\n---\n# 无 PEG\n");
    expect(m.peg).toBeUndefined();
    expect(m.type).toBeUndefined();
  });
});
